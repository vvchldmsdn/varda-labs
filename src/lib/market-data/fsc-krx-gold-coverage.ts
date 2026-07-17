import {
  FSC_KRX_GOLD_SOURCE_CONTRACT,
  type FscKrxGoldSourceRow,
} from "./fsc-krx-gold.ts";
import { isFscKrxGoldExpectedTradingDate } from "./fsc-krx-gold-publication.ts";

export type FscKrxGoldCoverageReport = Readonly<{
  status: "ready_for_schema_review" | "blocked";
  source: typeof FSC_KRX_GOLD_SOURCE_CONTRACT.source;
  productKey: typeof FSC_KRX_GOLD_SOURCE_CONTRACT.target.productKey;
  fromDate: string;
  toDate: string;
  expectedTradingDateCount: number;
  observedDateCount: number;
  targetRowCount: number;
  otherProductRowCount: number;
  rejectedRowCount: number;
  providerTotalCount: number | null;
  fetchedProviderRowCount: number;
  identityUniverse: readonly Readonly<{
    shortCode: string;
    isin: string;
    itemName: string;
  }>[];
  identityConflictCount: number;
  duplicateDateCount: number;
  conflictingCloseDateCount: number;
  missingTradingDates: readonly string[];
  unexpectedTradingDates: readonly string[];
  blockedReasons: readonly string[];
}>;

const MAX_COVERAGE_DAYS = 6_000;
export function buildFscKrxGoldCoverageReport(input: Readonly<{
  rows: readonly FscKrxGoldSourceRow[];
  rejectedRowCount: number;
  fromDate: string;
  toDate: string;
  providerTotalCount?: number | null;
  fetchedProviderRowCount?: number;
}>): FscKrxGoldCoverageReport {
  const dates = enumerateIsoDates(input.fromDate, input.toDate);
  const expectedTradingDates = dates.filter(isFscKrxGoldExpectedTradingDate);
  const expectedSet = new Set(expectedTradingDates);
  const target = FSC_KRX_GOLD_SOURCE_CONTRACT.target;
  const identityUniverse = uniqueIdentities(input.rows);
  const identityConflicts = input.rows.filter((row) => {
    const matches = [
      row.shortCode === target.shortCode,
      row.isin === target.isin,
      row.itemName === target.itemName,
    ];
    return matches.some(Boolean) && !matches.every(Boolean);
  });
  const targetRows = input.rows.filter(
    (row) =>
      row.shortCode === target.shortCode &&
      row.isin === target.isin &&
      row.itemName === target.itemName &&
      row.priceDate >= input.fromDate &&
      row.priceDate <= input.toDate,
  );
  const rowsByDate = groupRowsByDate(targetRows);
  const duplicateDates: string[] = [];
  const conflictingCloseDates: string[] = [];

  for (const [priceDate, rows] of rowsByDate) {
    if (rows.length <= 1) continue;
    const closes = new Set(rows.map((row) => row.closeKrwPerG));
    if (closes.size === 1) duplicateDates.push(priceDate);
    else conflictingCloseDates.push(priceDate);
  }

  const observedDates = [...rowsByDate.keys()].sort(asciiCompare);
  const observedSet = new Set(observedDates);
  const missingTradingDates = expectedTradingDates.filter(
    (date) => !observedSet.has(date),
  );
  const unexpectedTradingDates = observedDates.filter(
    (date) => !expectedSet.has(date),
  );
  const providerTotalCount = input.providerTotalCount ?? null;
  const fetchedProviderRowCount =
    input.fetchedProviderRowCount ?? input.rows.length + input.rejectedRowCount;
  const blockedReasons: string[] = [];

  if (input.rejectedRowCount > 0) blockedReasons.push("provider_rows_rejected");
  if (identityConflicts.length > 0) {
    blockedReasons.push("target_identity_conflict");
  }
  if (targetRows.length === 0) blockedReasons.push("target_rows_missing");
  if (duplicateDates.length > 0) blockedReasons.push("duplicate_date_rows");
  if (conflictingCloseDates.length > 0) {
    blockedReasons.push("conflicting_close_rows");
  }
  if (missingTradingDates.length > 0) {
    blockedReasons.push("expected_trading_dates_missing");
  }
  if (unexpectedTradingDates.length > 0) {
    blockedReasons.push("unexpected_trading_dates");
  }
  if (
    providerTotalCount !== null &&
    providerTotalCount !== fetchedProviderRowCount
  ) {
    blockedReasons.push("pagination_incomplete");
  }

  return Object.freeze({
    status:
      blockedReasons.length === 0 ? "ready_for_schema_review" : "blocked",
    source: FSC_KRX_GOLD_SOURCE_CONTRACT.source,
    productKey: target.productKey,
    fromDate: input.fromDate,
    toDate: input.toDate,
    expectedTradingDateCount: expectedTradingDates.length,
    observedDateCount: observedDates.length,
    targetRowCount: targetRows.length,
    otherProductRowCount: input.rows.length - targetRows.length,
    rejectedRowCount: input.rejectedRowCount,
    providerTotalCount,
    fetchedProviderRowCount,
    identityUniverse,
    identityConflictCount: identityConflicts.length,
    duplicateDateCount: duplicateDates.length,
    conflictingCloseDateCount: conflictingCloseDates.length,
    missingTradingDates: Object.freeze(missingTradingDates),
    unexpectedTradingDates: Object.freeze(unexpectedTradingDates),
    blockedReasons: Object.freeze(blockedReasons),
  });
}

function uniqueIdentities(rows: readonly FscKrxGoldSourceRow[]) {
  const identities = new Map<
    string,
    Readonly<{ shortCode: string; isin: string; itemName: string }>
  >();

  for (const row of rows) {
    const key = `${row.shortCode}\u0000${row.isin}\u0000${row.itemName}`;
    if (!identities.has(key)) {
      identities.set(
        key,
        Object.freeze({
          shortCode: row.shortCode,
          isin: row.isin,
          itemName: row.itemName,
        }),
      );
    }
  }

  return Object.freeze(
    [...identities.entries()]
      .sort(([left], [right]) => asciiCompare(left, right))
      .map(([, identity]) => identity),
  );
}

function groupRowsByDate(rows: readonly FscKrxGoldSourceRow[]) {
  const grouped = new Map<string, FscKrxGoldSourceRow[]>();
  for (const row of rows) {
    const dateRows = grouped.get(row.priceDate) ?? [];
    dateRows.push(row);
    grouped.set(row.priceDate, dateRows);
  }
  return grouped;
}

function enumerateIsoDates(fromDate: string, toDate: string) {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    throw new Error("invalid_coverage_date_range");
  }

  const dates: string[] = [];
  let current = fromDate;
  while (current <= toDate) {
    dates.push(current);
    if (dates.length > MAX_COVERAGE_DAYS) {
      throw new Error("coverage_date_range_too_large");
    }
    current = shiftIsoDate(current, 1);
  }
  return dates;
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function asciiCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
