import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { getReadOnlyTenantHoldings } from "@/db/queries/tenant-holdings";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import {
  buildHoldingAnalysisDataReadiness,
  type HoldingAnalysisDataCandidate,
  type HoldingAnalysisDataReadiness,
} from "@/lib/holding-analysis-data-readiness";
import { shiftRiskDate } from "@/lib/portfolio-risk-calendar";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type HoldingAnalysisDataReadinessQueryResult =
  | Readonly<{
      state: "ready";
      entries: readonly HoldingAnalysisDataReadiness[];
    }>
  | Readonly<{ state: "unavailable" }>;

export type ScopedHoldingAnalysisDataReadinessQueryResult =
  | Readonly<{
      state: "ready";
      entries: readonly Readonly<{
        holdingId: string;
        accountCode: string;
        name: string;
        ticker: string | null;
        readiness: HoldingAnalysisDataReadiness;
      }>[];
    }>
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantHoldingAnalysisDataReadinessForScope(
  options: {
    tenantContext: TenantContext;
    serviceDate: string;
    scope: PortfolioAnalysisScope;
  },
): Promise<ScopedHoldingAnalysisDataReadinessQueryResult> {
  const holdingsResult = await getReadOnlyTenantHoldings(options);
  if (
    holdingsResult.state !== "ready" &&
    holdingsResult.state !== "partial"
  ) {
    return Object.freeze({ state: "unavailable" as const });
  }

  const holdings = holdingsResult.holdings.filter(
    (holding) => holding.archivedAt === null,
  );
  if (holdings.length === 0) {
    return Object.freeze({ state: "ready" as const, entries: Object.freeze([]) });
  }

  const readinessResult = await getReadOnlyTenantHoldingAnalysisDataReadiness({
    tenantContext: options.tenantContext,
    serviceDate: options.serviceDate,
    holdings: holdings.map((holding) => ({
      holdingId: holding.holdingId,
      accountCode: holding.accountCode,
      name: holding.name,
      ticker: holding.ticker,
      assetType: holding.assetType,
      market: holding.market,
      currency: holding.currency,
    })),
  });
  if (readinessResult.state !== "ready") {
    return Object.freeze({ state: "unavailable" as const });
  }

  const readinessByHoldingId = new Map(
    readinessResult.entries.map((entry) => [entry.holdingId, entry]),
  );
  return Object.freeze({
    state: "ready" as const,
    entries: Object.freeze(
      holdings.flatMap((holding) => {
        const readiness = readinessByHoldingId.get(holding.holdingId);
        return readiness
          ? [
              Object.freeze({
                holdingId: holding.holdingId,
                accountCode: holding.accountCode,
                name: holding.name,
                ticker: holding.ticker,
                readiness,
              }),
            ]
          : [];
      }),
    ),
  });
}

export async function getReadOnlyTenantHoldingAnalysisDataReadiness(options: {
  tenantContext: TenantContext;
  serviceDate: string;
  holdings: readonly HoldingAnalysisDataCandidate[];
}): Promise<HoldingAnalysisDataReadinessQueryResult> {
  try {
    const tickers = [
      ...new Set(
        options.holdings
          .map((holding) => holding.ticker?.trim().toUpperCase() ?? "")
          .filter(Boolean),
      ),
    ];
    const sourceDateFrom = shiftRiskDate(options.serviceDate, -399);
    const sourceDateTo = options.serviceDate;
    const requiresFx = options.holdings.some(
      (holding) => holding.currency.trim().toUpperCase() === "USD",
    );
    const [priceRows, fxRows] = await Promise.all([
      tickers.length > 0
        ? loadRawPriceRows({ tickers, sourceDateFrom, sourceDateTo })
        : Promise.resolve([]),
      requiresFx
        ? loadFxRows({ sourceDateFrom, sourceDateTo })
        : Promise.resolve([]),
    ]);

    return Object.freeze({
      state: "ready" as const,
      entries: Object.freeze(
        options.holdings.map((holding) =>
          buildHoldingAnalysisDataReadiness({
            holding,
            serviceDate: options.serviceDate,
            priceRows,
            fxRows,
          }),
        ),
      ),
    });
  } catch {
    return Object.freeze({ state: "unavailable" as const });
  }
}

export async function getReadOnlyTenantHoldingAnalysisPreparationTarget(
  options: {
    tenantContext: TenantContext;
    holdingId: string;
  },
): Promise<HoldingAnalysisDataCandidate | null> {
  const resultSets = await runTenantReadTransaction(
    options.tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(TENANT_HOLDING_PREPARATION_TARGET_SQL, [
        options.holdingId,
      ]),
    ],
  );
  const rows = resultSets[0];
  if (rows.length !== 1) return null;
  const row = rows[0];

  return Object.freeze({
    holdingId: requiredString(row.holding_id),
    accountCode: requiredString(row.account_code),
    name: requiredString(row.name),
    ticker: nullableString(row.ticker),
    assetType: nullableString(row.asset_type),
    market: requiredString(row.market).trim().toLowerCase(),
    currency: requiredString(row.currency).trim().toUpperCase(),
  });
}

async function loadRawPriceRows(input: {
  tickers: readonly string[];
  sourceDateFrom: string;
  sourceDateTo: string;
}) {
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

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Holding analysis preparation target is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

const TENANT_HOLDING_PREPARATION_TARGET_SQL = `
  select
    asset.id::text as holding_id,
    account.code as account_code,
    asset.name,
    asset.ticker,
    asset.asset_type,
    asset.market,
    asset.currency
  from public.assets as asset
  inner join public.accounts as account on asset.account_id = account.id
  where asset.id = $1::uuid
    and account.is_active = true
    and asset.account = account.code
    and asset.archived_at is null
    and asset.quantity > 0
  limit 2
`;
