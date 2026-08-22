import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  assetPriceSnapshots,
  fxRates,
} from "@/db/schema";
import { planSimulationPeriodPreflightScan } from "@/lib/simulation-period-preflight-plan";
import {
  buildSimulationOwnerHistoricalValidationEndpointDates,
  SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY,
} from "@/lib/simulation-owner-historical-outcome-validation";
import {
  buildPrivateOwnerRawHistory,
  resolveLatestCommonPrivateOwnerRawServiceDate,
  resolvePrivateOwnerRawAvailableServiceDates,
  type PrivateOwnerRawHistoryInstrumentInput,
} from "@/lib/simulation-private-owner-raw-history";
import type { SimulationResearchUniverseSelection } from "@/lib/simulation-research-universe-preflight";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getLatestCommonPrivateOwnerRawServiceDate(options: {
  tenantContext: TenantContext;
  selection: SimulationResearchUniverseSelection;
}) {
  if (options.selection.status !== "valid") return null;
  const instruments = toPrivateHistoryInstruments(options.selection);
  const modeled = instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  if (modeled.length === 0) return null;

  const normalizedMarket = sql<string>`lower(trim(${assetPriceSnapshots.market}))`;
  const normalizedCurrency = sql<string>`upper(trim(${assetPriceSnapshots.currency}))`;
  const normalizedTicker = sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`;
  const [latestSourceRows, latestFxRows] = await Promise.all([
    db
      .select({
        market: normalizedMarket,
        currency: normalizedCurrency,
        ticker: normalizedTicker,
        latestSourceDate: sql<string | null>`max(${assetPriceSnapshots.priceDate})`,
        providerBindingCount: sql<number>`count(distinct (upper(trim(${assetPriceSnapshots.providerSymbol})) || '|' || upper(trim(${assetPriceSnapshots.providerExchange}))))`,
      })
      .from(assetPriceSnapshots)
      .where(
        and(
          inArray(
            normalizedTicker,
            [...new Set(modeled.map((row) => row.ticker))],
          ),
          eq(assetPriceSnapshots.isSample, false),
          sql`${assetPriceSnapshots.closePrice} > 0`,
          sql`lower(trim(${assetPriceSnapshots.source})) like 'kis%'`,
          sql`nullif(trim(${assetPriceSnapshots.providerSymbol}), '') is not null`,
          sql`nullif(trim(${assetPriceSnapshots.providerExchange}), '') is not null`,
          isNotNull(assetPriceSnapshots.fetchedAt),
        ),
      )
      .groupBy(normalizedMarket, normalizedCurrency, normalizedTicker),
    modeled.some((row) => row.currency === "USD")
      ? db
          .select({
            latestSourceDate: sql<string | null>`max(${fxRates.rateDate})`,
          })
          .from(fxRates)
          .where(
            and(
              eq(fxRates.isSample, false),
              eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
              sql`${fxRates.usdKrw} > 0`,
            ),
          )
      : Promise.resolve([{ latestSourceDate: null }]),
  ]);

  return resolveLatestCommonPrivateOwnerRawServiceDate({
    instruments,
    latestSourceRows,
    latestFxSourceDate: latestFxRows[0]?.latestSourceDate ?? null,
  });
}

export async function getReadOnlyPrivateOwnerRawHistoryBundle(options: {
  tenantContext: TenantContext;
  selection: SimulationResearchUniverseSelection;
  endServiceDate: string;
  returnStepCount?: number;
}) {
  const [result] = await getReadOnlyPrivateOwnerRawHistoryBatch({
    tenantContext: options.tenantContext,
    selection: options.selection,
    requests: [
      {
        endServiceDate: options.endServiceDate,
        returnStepCount: options.returnStepCount ?? 90,
      },
    ],
  });
  return result;
}

export async function getReadOnlyPrivateOwnerRawHistoryBatch(options: {
  tenantContext: TenantContext;
  selection: SimulationResearchUniverseSelection;
  requests: readonly Readonly<{
    endServiceDate: string;
    returnStepCount: number;
  }>[];
}) {
  const source = await loadPrivateOwnerRawHistorySource(options);

  return Object.freeze(
    options.requests.map((request, index) => {
      const plan = source.plans[index];
      const hasQueryablePlan =
        plan?.status === "queryable" && plan.queryRange !== null;
      return buildPrivateOwnerRawHistory({
        requestedEndServiceDate: request.endServiceDate,
        returnStepCount: request.returnStepCount,
        instruments: source.instruments,
        priceRows: hasQueryablePlan ? source.priceRows : [],
        fxRows: hasQueryablePlan ? source.fxRows : [],
      });
    }),
  );
}

export async function getReadOnlyPrivateOwnerRawHistoryValidationBatch(
  options: {
    tenantContext: TenantContext;
    selection: SimulationResearchUniverseSelection;
    endServiceDate: string;
    currentReturnStepCount?: number;
  },
) {
  const policy = SIMULATION_OWNER_HISTORICAL_VALIDATION_POLICY;
  const scheduleReturnStepCount =
    policy.sourceReturnStepCount +
    policy.outcomeReturnStepCount * (policy.maximumEndpointCount - 1);
  const source = await loadPrivateOwnerRawHistorySource({
    tenantContext: options.tenantContext,
    selection: options.selection,
    requests: [
      {
        endServiceDate: options.endServiceDate,
        returnStepCount: scheduleReturnStepCount,
      },
    ],
  });
  const plan = source.plans[0];
  const hasQueryablePlan =
    plan?.status === "queryable" && plan.queryRange !== null;
  const priceRows = hasQueryablePlan ? source.priceRows : [];
  const fxRows = hasQueryablePlan ? source.fxRows : [];
  const availableServiceDates =
    hasQueryablePlan
      ? resolvePrivateOwnerRawAvailableServiceDates({
          endServiceDate: options.endServiceDate,
          priceRows,
          fxRows,
          requiresFx: source.requiresFx,
        })
      : Object.freeze([] as string[]);
  const endpointDates = buildSimulationOwnerHistoricalValidationEndpointDates(
    options.endServiceDate,
    availableServiceDates,
  );
  const buildResult = (endServiceDate: string, returnStepCount: number) =>
    buildPrivateOwnerRawHistory({
      requestedEndServiceDate: endServiceDate,
      returnStepCount,
      instruments: source.instruments,
      priceRows,
      fxRows,
    });

  return Object.freeze({
    current: buildResult(
      options.endServiceDate,
      options.currentReturnStepCount ?? 90,
    ),
    availableServiceDates,
    endpointDates,
    endpoints: Object.freeze(
      endpointDates.map((outcomeEndServiceDate) =>
        Object.freeze({
          outcomeEndServiceDate,
          result: buildResult(
            outcomeEndServiceDate,
            policy.sourceReturnStepCount,
          ),
        }),
      ),
    ),
  });
}

async function loadPrivateOwnerRawHistorySource(options: {
  tenantContext: TenantContext;
  selection: SimulationResearchUniverseSelection;
  requests: readonly Readonly<{
    endServiceDate: string;
    returnStepCount: number;
  }>[];
}) {
  const instruments =
    options.selection.status === "valid"
      ? toPrivateHistoryInstruments(options.selection)
      : [];
  const candidates = instruments
    .filter(
      (row) =>
        row.weightBps > 0 && row.classification === "listed_instrument",
    )
    .map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
    }));
  const plans = options.requests.map((request) =>
    planSimulationPeriodPreflightScan({ candidates, ...request }),
  );
  const queryablePlans = plans.filter(
    (plan) => plan.status === "queryable" && plan.queryRange,
  );
  const sourceDateFrom = queryablePlans
    .map((plan) => plan.queryRange?.sourceDateFrom)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const sourceDateTo = queryablePlans
    .map((plan) => plan.queryRange?.sourceDateTo)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const tickers = [...new Set(candidates.map((row) => row.ticker))];
  const [priceRows, fxRows] =
    sourceDateFrom && sourceDateTo
      ? await Promise.all([
          loadRawPriceRows({ tickers, sourceDateFrom, sourceDateTo }),
          queryablePlans.some((plan) => plan.requiresFx)
            ? loadFxRows({ sourceDateFrom, sourceDateTo })
            : Promise.resolve([]),
        ])
      : [[], []];

  return Object.freeze({
    instruments: Object.freeze(instruments),
    plans: Object.freeze(plans),
    priceRows: Object.freeze(priceRows),
    fxRows: Object.freeze(fxRows),
    requiresFx: queryablePlans.some((plan) => plan.requiresFx),
  });
}

async function loadRawPriceRows(input: {
  tickers: readonly string[];
  sourceDateFrom: string;
  sourceDateTo: string;
}) {
  if (input.tickers.length === 0) return [];

  return db
    .select({
      market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
      currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
      ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      source: assetPriceSnapshots.source,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        inArray(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          [...input.tickers],
        ),
        gte(assetPriceSnapshots.priceDate, input.sourceDateFrom),
        lte(assetPriceSnapshots.priceDate, input.sourceDateTo),
        eq(assetPriceSnapshots.isSample, false),
      ),
    )
    .orderBy(
      asc(assetPriceSnapshots.priceDate),
      asc(assetPriceSnapshots.market),
      asc(assetPriceSnapshots.currency),
      asc(assetPriceSnapshots.ticker),
    );
}

async function loadFxRows(input: {
  sourceDateFrom: string;
  sourceDateTo: string;
}) {
  return db
    .select({
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      status: sql<string>`lower(trim(${fxRates.status}))`,
    })
    .from(fxRates)
    .where(
      and(
        gte(fxRates.rateDate, input.sourceDateFrom),
        lte(fxRates.rateDate, input.sourceDateTo),
        eq(fxRates.isSample, false),
        eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
      ),
    )
    .orderBy(asc(fxRates.rateDate));
}

function toPrivateHistoryInstruments(
  selection: Extract<SimulationResearchUniverseSelection, { status: "valid" }>,
): PrivateOwnerRawHistoryInstrumentInput[] {
  return selection.instruments.map((row) => ({
    instrumentKey: row.instrumentKey,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    classification: row.classification,
    weightBps: row.weightBps,
  }));
}
