import "server-only";

import { getActivePortfolioOwnerUserIds } from "@/db/queries/active-portfolio-owners";
import { loadPortfolioRiskPriceCandidates } from "@/db/queries/portfolio-risk";
import {
  evaluateAdditionalContributionMa120OperationalEvidence,
  type AdditionalContributionMa120OperationalEvidence,
  type AdditionalContributionMa120OperationalPriceBasis,
} from "@/lib/additional-contribution-ma120-operational-evidence";
import {
  admitAdjustedHistoricalPriceRows,
  admitPrivateSingleTenantRawTrendEvidenceRows,
} from "@/lib/market-data/asset-price-consumer-admission";
import type { PortfolioStructureHoldingRow } from "@/lib/portfolio-structure";
import type { TenantContext } from "@/lib/session-resolver-contract";

const HISTORY_LOOKBACK_CALENDAR_DAYS = 420;

type Ma120HoldingInput = Pick<
  PortfolioStructureHoldingRow,
  | "market"
  | "currency"
  | "ticker"
  | "currentPrice"
  | "priceSource"
>;

export type AdditionalContributionMa120UnavailableReason =
  | "invalid_instrument_identity"
  | "price_history_missing"
  | "price_history_not_admitted"
  | "comparison_price_source_incompatible";

export type AdditionalContributionMa120ReadRow = Readonly<{
  instrumentKey: string;
  status:
    | AdditionalContributionMa120OperationalEvidence["status"]
    | "unavailable";
  priceBasis: AdditionalContributionMa120OperationalPriceBasis | null;
  evidence: AdditionalContributionMa120OperationalEvidence | null;
  unavailableReason: AdditionalContributionMa120UnavailableReason | null;
}>;

export async function getReadOnlyTenantAdditionalContributionMa120Evidence({
  holdings,
  serviceDate,
  tenantContext,
}: {
  holdings: readonly Ma120HoldingInput[];
  serviceDate: string;
  tenantContext: TenantContext;
}) {
  const normalizedHoldings = holdings
    .map(normalizeHolding)
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const tickers = [...new Set(normalizedHoldings.map((row) => row.ticker))];
  const sourceDateFrom = shiftUtcDate(
    serviceDate,
    -HISTORY_LOOKBACK_CALENDAR_DAYS,
  );

  const [candidateRows, activeOwnerUserIds] = await Promise.all([
    loadPortfolioRiskPriceCandidates({
      tickers,
      sourceDateFrom,
      sourceDateTo: serviceDate,
    }),
    getActivePortfolioOwnerUserIds(),
  ]);
  const adjustedAdmission = admitAdjustedHistoricalPriceRows(candidateRows);
  const privateRawAdmission =
    admitPrivateSingleTenantRawTrendEvidenceRows({
      rows: candidateRows,
      requestedOwnerUserId: tenantContext.ownerUserId,
      activeOwnerUserIds,
    });
  const adjustedRowsByInstrument = groupRowsByInstrument(
    adjustedAdmission.rows,
  );
  const privateRawRowsByInstrument = groupRowsByInstrument(
    privateRawAdmission.rows,
  );

  const candidateInstrumentKeys = new Set(
    candidateRows.map(instrumentKey).filter((key): key is string => key !== null),
  );
  const rows: AdditionalContributionMa120ReadRow[] = normalizedHoldings.map(
    (holding) => {
      const adjustedRows =
        adjustedRowsByInstrument.get(holding.instrumentKey) ?? [];
      const privateRawRows =
        privateRawRowsByInstrument.get(holding.instrumentKey) ?? [];
      const selection = selectComparisonCompatibleRows({
        adjustedRows,
        privateRawRows,
        priceSource: holding.priceSource,
      });
      if (!selection) {
        const hasAdmittedRows =
          adjustedRows.length > 0 || privateRawRows.length > 0;
        return unavailableRow(
          holding.instrumentKey,
          hasAdmittedRows
            ? "comparison_price_source_incompatible"
            : candidateInstrumentKeys.has(holding.instrumentKey)
              ? "price_history_not_admitted"
              : "price_history_missing",
        );
      }

      const evidence = evaluateAdditionalContributionMa120OperationalEvidence({
        instrumentKey: holding.instrumentKey,
        asOfPriceDate: serviceDate,
        comparisonPrice: holding.currentPrice,
        priceBasis: selection.priceBasis,
        observations: selection.rows.map((row) => ({
          priceDate: row.priceDate,
          price: Number(selection.price(row)),
        })),
      });
      return Object.freeze({
        instrumentKey: holding.instrumentKey,
        status: evidence.status,
        priceBasis: selection.priceBasis,
        evidence,
        unavailableReason: null,
      });
    },
  );
  const usableCount = rows.filter((row) =>
    row.status === "above_ma" ||
    row.status === "at_ma" ||
    row.status === "below_ma",
  ).length;

  return Object.freeze({
    policyVersion:
      "additional_contribution_ma120_operational_evidence_v1" as const,
    allocationEffect: "none" as const,
    status:
      usableCount === rows.length && rows.length > 0
        ? ("ready" as const)
        : usableCount > 0
          ? ("partial" as const)
          : ("unavailable" as const),
    suppliedHoldingCount: holdings.length,
    evaluatedHoldingCount: rows.length,
    usableCount,
    unavailableCount: rows.length - usableCount,
    rows: Object.freeze(rows),
  });
}

function normalizeHolding(row: Ma120HoldingInput) {
  const key = instrumentKey(row);
  const currentPrice = Number(row.currentPrice);
  const ticker = normalizeText(row.ticker)?.toUpperCase();
  if (!key || !ticker || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return null;
  }
  return Object.freeze({
    instrumentKey: key,
    ticker,
    currentPrice,
    priceSource: normalizeText(row.priceSource),
  });
}

function unavailableRow(
  instrumentKey: string,
  unavailableReason: AdditionalContributionMa120UnavailableReason,
  priceBasis: AdditionalContributionMa120OperationalPriceBasis | null = null,
): AdditionalContributionMa120ReadRow {
  return Object.freeze({
    instrumentKey,
    status: "unavailable" as const,
    priceBasis,
    evidence: null,
    unavailableReason,
  });
}

function groupRowsByInstrument<
  T extends Readonly<{
    market: string | null;
    currency: string | null;
    ticker: string | null;
  }>,
>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = instrumentKey(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function selectComparisonCompatibleRows<
  T extends Readonly<{
    closePrice: unknown;
    adjustedClosePrice: unknown;
  }>,
>({
  adjustedRows,
  privateRawRows,
  priceSource,
}: {
  adjustedRows: readonly T[];
  privateRawRows: readonly T[];
  priceSource: string | null;
}) {
  if (isKisPriceSource(priceSource) && privateRawRows.length > 0) {
    return Object.freeze({
      priceBasis: "private_kis_raw_close" as const,
      rows: privateRawRows,
      price: (row: T) => row.closePrice,
    });
  }
  if (
    isAdjustedComparisonPriceSource(priceSource) &&
    adjustedRows.length > 0
  ) {
    return Object.freeze({
      priceBasis: "provider_adjusted_close" as const,
      rows: adjustedRows,
      price: (row: T) => row.adjustedClosePrice,
    });
  }
  return null;
}

function instrumentKey(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeText(row.market)?.toLowerCase();
  const currency = normalizeText(row.currency)?.toUpperCase();
  const ticker = normalizeText(row.ticker)?.toUpperCase();
  return market && currency && ticker
    ? `${market}:${currency}:${ticker}`
    : null;
}

function isKisPriceSource(value: string | null) {
  return normalizeText(value)?.toLowerCase().startsWith("kis") === true;
}

function isAdjustedComparisonPriceSource(value: string | null) {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized === "provider_adjusted_close" ||
    normalized?.startsWith("provider_adjusted_close:") === true;
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function shiftUtcDate(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
