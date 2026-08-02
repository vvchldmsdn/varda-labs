import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlySimulationResearchUniversePreflightBundleForSelection } from "@/db/queries/simulation-research-universe-preflight";
import { ADJUSTED_CLOSE_BASIS } from "@/lib/market-data/providers/types";
import { mapRiskEvidenceDateToServiceDate } from "@/lib/portfolio-risk-calendar";
import { buildSimulationOwnerInputCandidate } from "@/lib/simulation-owner-input-candidate";
import { buildSimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";
import {
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
} from "@/lib/simulation-owner-research-execution";
import { resolveSimulationResearchHorizon } from "@/lib/simulation-research-horizon";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantSimulationOwnerResearch(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  horizon?: string | string[];
  now?: Date;
}) {
  const portfolio = await getReadOnlyTenantPortfolioStructure({
    tenantContext: options.tenantContext,
    account: options.account,
  });
  const candidate = buildSimulationOwnerInputCandidate({
    account: portfolio.selectedAccount,
    portfolio,
  });
  const latestCommonStoredServiceDate =
    options.endServiceDate === undefined
      ? await getLatestCommonQualifiedStoredServiceDate(candidate)
      : null;
  const endSelection = resolveSimulationOwnerExecutionEndSelection({
    suppliedValue: options.endServiceDate,
    latestCommonStoredServiceDate,
  });
  const historicalBundle = candidate.selection
    ? await getReadOnlySimulationResearchUniversePreflightBundleForSelection({
        selection: candidate.selection,
        endServiceDate:
          endSelection.status === "valid"
            ? endSelection.endServiceDate
            : options.endServiceDate,
        now: options.now,
      })
    : null;
  const inputPreflight = buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight: historicalBundle?.model ?? null,
  });
  const execution = buildSimulationOwnerResearchExecution({
    candidate,
    inputPreflight,
    endSelection,
    horizonSelection: resolveSimulationResearchHorizon(options.horizon),
    matrix:
      endSelection.status === "valid"
        ? historicalBundle?.periodPreflight?.matrixArtifact ?? null
        : null,
  });

  return Object.freeze({ inputPreflight, execution });
}

export async function getReadOnlyTenantSimulationOwnerInputPreflight(options: {
  tenantContext: TenantContext;
  account?: string | string[] | null;
  endServiceDate?: string | string[];
  now?: Date;
}) {
  const result = await getReadOnlyTenantSimulationOwnerResearch(options);
  return result.inputPreflight;
}

async function getLatestCommonQualifiedStoredServiceDate(
  candidate: ReturnType<typeof buildSimulationOwnerInputCandidate>,
) {
  const instruments = candidate.instruments.filter(
    (row) =>
      row.classification === "listed_instrument" &&
      row.weightBps !== null &&
      row.weightBps > 0,
  );
  if (instruments.length === 0) return null;

  const normalizedMarket = sql<string>`lower(trim(${assetPriceSnapshots.market}))`;
  const normalizedCurrency = sql<string>`upper(trim(${assetPriceSnapshots.currency}))`;
  const normalizedTicker = sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`;
  const priceRows = await db
    .select({
      market: normalizedMarket,
      currency: normalizedCurrency,
      ticker: normalizedTicker,
      latestSourceDate: sql<string | null>`max(${assetPriceSnapshots.priceDate})`,
      providerBindingCount: sql<number>`count(distinct (lower(trim(${assetPriceSnapshots.adjustedCloseProvider})) || '|' || upper(trim(${assetPriceSnapshots.providerSymbol})) || '|' || upper(trim(${assetPriceSnapshots.providerExchange}))))`,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        inArray(
          normalizedTicker,
          [...new Set(instruments.map((row) => row.ticker))],
        ),
        eq(assetPriceSnapshots.isSample, false),
        isNotNull(assetPriceSnapshots.adjustedClosePrice),
        sql`${assetPriceSnapshots.adjustedClosePrice} > 0`,
        eq(
          assetPriceSnapshots.adjustedCloseBasis,
          ADJUSTED_CLOSE_BASIS.provider,
        ),
        sql`nullif(trim(${assetPriceSnapshots.adjustedCloseProvider}), '') is not null`,
        sql`nullif(trim(${assetPriceSnapshots.adjustedCloseSource}), '') is not null`,
        isNotNull(assetPriceSnapshots.adjustedCloseFetchedAt),
        sql`nullif(trim(${assetPriceSnapshots.providerSymbol}), '') is not null`,
        sql`nullif(trim(${assetPriceSnapshots.providerExchange}), '') is not null`,
      ),
    )
    .groupBy(normalizedMarket, normalizedCurrency, normalizedTicker);

  const latestByInstrument = new Map(
    priceRows.map((row) => [
      `${row.market}|${row.currency}|${row.ticker}`,
      row,
    ]),
  );
  const latestServiceDates: string[] = [];
  for (const instrument of instruments) {
    const row = latestByInstrument.get(instrument.instrumentKey);
    if (
      !row?.latestSourceDate ||
      Number(row.providerBindingCount) !== 1
    ) {
      return null;
    }
    latestServiceDates.push(
      mapRiskEvidenceDateToServiceDate(row.latestSourceDate),
    );
  }

  if (instruments.some((row) => row.currency === "USD")) {
    const [latestFx] = await db
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
      );
    if (!latestFx?.latestSourceDate) return null;
    latestServiceDates.push(
      mapRiskEvidenceDateToServiceDate(latestFx.latestSourceDate),
    );
  }

  return latestServiceDates.sort()[0] ?? null;
}
