import { MANUAL_ASSET_PRICE_POLICY } from "./market-data/manual-asset-price.ts";
import {
  accountsForPortfolioScope,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

const CURRENT_SNAPSHOT_SOURCE = "varda_manual_daily_snapshot";
const MANUAL_PRICE_BASIS = "manual_current";

export const MANUAL_VALUATION_HISTORY_POLICY = Object.freeze({
  version: "manual_valuation_history_v1",
  currentSnapshotSource: CURRENT_SNAPSHOT_SOURCE,
  priceSource: MANUAL_ASSET_PRICE_POLICY.source,
  priceBasis: MANUAL_PRICE_BASIS,
  carryMeaning: "stored_valuation_not_market_observation",
  sameDateWriteMeaning: "latest_snapshot_state_not_immutable_input_event",
  researchAdmission: "current_segment_candidate_only",
} as const);

export type ManualValuationTarget = Readonly<{
  assetName: string;
  account: string;
  market: string;
  currency: string;
  assetType: string;
}>;

export type ManualValuationCurrentRow = Readonly<{
  assetId: string;
  assetName: string;
  account: string;
  market: string;
  currency: string;
  assetType: string | null;
  currentPrice: string | number | null;
  priceSource: string | null;
  priceAsOf: Date | string | null;
  priceQuoteType: string | null;
  priceStatus: string | null;
}>;

export type ManualValuationSnapshotRow = Readonly<{
  snapshotDate: string;
  assetId: string | null;
  legacyAssetId: string | null;
  assetName: string;
  account: string;
  market: string | null;
  currency: string | null;
  assetType: string | null;
  source: string | null;
  priceSource: string | null;
  priceBasis: string | null;
  currentPrice: string | number | null;
  priceDate: string | null;
  referenceDate: string | null;
  capturedAt: Date | string | null;
}>;

export type ManualValuationHistoryCoverage = ReturnType<
  typeof buildManualValuationHistoryCoverage
>;

export function buildManualValuationHistoryCoverage(input: {
  account: PortfolioAccountScope;
  target: ManualValuationTarget;
  currentRows: readonly ManualValuationCurrentRow[];
  snapshotRows: readonly ManualValuationSnapshotRow[];
  requiredSnapshotDates: readonly string[];
}) {
  const selectedAccounts = accountsForPortfolioScope(input.account);
  const targetAccount = normalizeText(input.target.account).toLowerCase();
  const applicable = selectedAccounts.some(
    (account) => account === targetAccount,
  );

  if (!applicable) {
    return emptyCoverage("not_applicable");
  }

  const currentRows = input.currentRows.filter((row) =>
    matchesTarget(row, input.target),
  );
  const currentManualRows = currentRows
    .filter(isCurrentManualValuation)
    .sort((left, right) => timestampMs(right.priceAsOf) - timestampMs(left.priceAsOf));
  const latestCurrent = currentManualRows[0] ?? null;
  const targetSnapshotRows = input.snapshotRows.filter((row) =>
    matchesTarget(row, input.target),
  );

  const trustedRows: Array<{
    snapshotDate: string;
    referenceDate: string;
    observationKey: string;
    carried: boolean;
  }> = [];
  let nonCurrentWriterRowCount = 0;
  let nonManualValuationRowCount = 0;
  let invalidRowCount = 0;
  let futureDatedRowCount = 0;

  for (const row of targetSnapshotRows) {
    if (normalizeText(row.source).toLowerCase() !== CURRENT_SNAPSHOT_SOURCE) {
      nonCurrentWriterRowCount += 1;
      continue;
    }
    if (
      normalizeText(row.priceSource).toLowerCase() !==
        MANUAL_ASSET_PRICE_POLICY.source ||
      normalizeText(row.priceBasis).toLowerCase() !== MANUAL_PRICE_BASIS
    ) {
      nonManualValuationRowCount += 1;
      continue;
    }
    if (!isValidSnapshotEnvelope(row)) {
      invalidRowCount += 1;
      continue;
    }
    const referenceDate = row.referenceDate ?? row.priceDate;
    if (!referenceDate) {
      invalidRowCount += 1;
      continue;
    }
    if (referenceDate > row.snapshotDate) {
      futureDatedRowCount += 1;
      continue;
    }
    const price = finitePositiveNumber(row.currentPrice);
    if (price === null) {
      invalidRowCount += 1;
      continue;
    }
    const identity = normalizeText(row.assetId) || normalizeText(row.legacyAssetId);
    if (!identity) {
      invalidRowCount += 1;
      continue;
    }
    trustedRows.push({
      snapshotDate: row.snapshotDate,
      referenceDate,
      observationKey: `${identity}\u0000${referenceDate}\u0000${price}`,
      carried: referenceDate < row.snapshotDate,
    });
  }

  const requiredDates = uniqueSortedDates(input.requiredSnapshotDates);
  const coveredDates = new Set(trustedRows.map((row) => row.snapshotDate));
  const coveredRequiredDates = requiredDates.filter((date) => coveredDates.has(date));
  const observationDates = new Set(trustedRows.map((row) => row.observationKey));
  const valuationDates = uniqueSortedDates(
    trustedRows.map((row) => row.snapshotDate),
  );
  const referenceDates = uniqueSortedDates(
    trustedRows.map((row) => row.referenceDate),
  );
  const currentSegmentCoveragePct =
    requiredDates.length > 0
      ? (coveredRequiredDates.length / requiredDates.length) * 100
      : null;
  const status = resolveHistoryStatus({
    currentAvailable: latestCurrent !== null,
    requiredDateCount: requiredDates.length,
    coveredRequiredDateCount: coveredRequiredDates.length,
    trustedRowCount: trustedRows.length,
  });

  return Object.freeze({
    status,
    policy: MANUAL_VALUATION_HISTORY_POLICY,
    applicable: true,
    current: Object.freeze({
      status: latestCurrent ? ("stored_manual" as const) : ("unavailable" as const),
      price: latestCurrent ? finitePositiveNumber(latestCurrent.currentPrice) : null,
      priceAsOf: latestCurrent ? timestampIso(latestCurrent.priceAsOf) : null,
      matchingRowCount: currentRows.length,
      validManualRowCount: currentManualRows.length,
    }),
    history: Object.freeze({
      sourceRowCount: targetSnapshotRows.length,
      trustedValuationRowCount: trustedRows.length,
      distinctManualObservationCount: observationDates.size,
      carriedValuationRowCount: trustedRows.filter((row) => row.carried).length,
      nonCurrentWriterRowCount,
      nonManualValuationRowCount,
      invalidRowCount,
      futureDatedRowCount,
      requiredCurrentSegmentDateCount: requiredDates.length,
      coveredCurrentSegmentDateCount: coveredRequiredDates.length,
      currentSegmentCoveragePct,
      availableStartServiceDate: valuationDates[0] ?? null,
      availableEndServiceDate: valuationDates.at(-1) ?? null,
      latestManualReferenceDate: referenceDates.at(-1) ?? null,
    }),
  });
}

function emptyCoverage(status: "not_applicable") {
  return Object.freeze({
    status,
    policy: MANUAL_VALUATION_HISTORY_POLICY,
    applicable: false,
    current: Object.freeze({
      status: "not_applicable" as const,
      price: null,
      priceAsOf: null,
      matchingRowCount: 0,
      validManualRowCount: 0,
    }),
    history: Object.freeze({
      sourceRowCount: 0,
      trustedValuationRowCount: 0,
      distinctManualObservationCount: 0,
      carriedValuationRowCount: 0,
      nonCurrentWriterRowCount: 0,
      nonManualValuationRowCount: 0,
      invalidRowCount: 0,
      futureDatedRowCount: 0,
      requiredCurrentSegmentDateCount: 0,
      coveredCurrentSegmentDateCount: 0,
      currentSegmentCoveragePct: null,
      availableStartServiceDate: null,
      availableEndServiceDate: null,
      latestManualReferenceDate: null,
    }),
  });
}

function resolveHistoryStatus(input: {
  currentAvailable: boolean;
  requiredDateCount: number;
  coveredRequiredDateCount: number;
  trustedRowCount: number;
}) {
  if (!input.currentAvailable && input.trustedRowCount === 0) {
    return "unavailable" as const;
  }
  if (input.requiredDateCount === 0 || input.trustedRowCount === 0) {
    return "history_pending" as const;
  }
  if (input.coveredRequiredDateCount < input.requiredDateCount) {
    return "partial_current_segment" as const;
  }
  return "current_segment_covered" as const;
}

function isCurrentManualValuation(row: ManualValuationCurrentRow) {
  return (
    normalizeText(row.priceSource).toLowerCase() ===
      MANUAL_ASSET_PRICE_POLICY.source &&
    normalizeText(row.priceQuoteType).toLowerCase() ===
      MANUAL_ASSET_PRICE_POLICY.quoteType &&
    normalizeText(row.priceStatus).toLowerCase() ===
      MANUAL_ASSET_PRICE_POLICY.status &&
    finitePositiveNumber(row.currentPrice) !== null &&
    timestampMs(row.priceAsOf) > 0
  );
}

function isValidSnapshotEnvelope(row: ManualValuationSnapshotRow) {
  return (
    isIsoDate(row.snapshotDate) &&
    timestampMs(row.capturedAt) > 0
  );
}

function matchesTarget(
  row: {
    assetName: string;
    account: string;
    market: string | null;
    currency: string | null;
    assetType: string | null;
  },
  target: ManualValuationTarget,
) {
  return (
    normalizeText(row.assetName) === normalizeText(target.assetName) &&
    normalizeText(row.account).toLowerCase() ===
      normalizeText(target.account).toLowerCase() &&
    normalizeText(row.market).toLowerCase() ===
      normalizeText(target.market).toLowerCase() &&
    normalizeText(row.currency).toUpperCase() ===
      normalizeText(target.currency).toUpperCase() &&
    normalizeText(row.assetType).toLowerCase() ===
      normalizeText(target.assetType).toLowerCase()
  );
}

function uniqueSortedDates(values: readonly string[]) {
  return [...new Set(values.filter(isIsoDate))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function finitePositiveNumber(value: string | number | null) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function timestampMs(value: Date | string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  return Number.isFinite(milliseconds)
    ? milliseconds
    : Number.NEGATIVE_INFINITY;
}

function timestampIso(value: Date | string | null) {
  const milliseconds = timestampMs(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
