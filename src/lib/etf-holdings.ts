import { toNumber } from "./portfolio-math.ts";

export type EtfHoldingRawRow = {
  id: string;
  legacyBase44Id: string | null;
  etfMasterId: string | null;
  legacyEtfId: string | null;
  etfTicker: string;
  etfName: string;
  asOfDate: string;
  holdingSymbol: string | null;
  holdingName: string;
  holdingMarket: string | null;
  holdingCountry: string | null;
  currency: string | null;
  sector: string | null;
  industry: string | null;
  securityType: string | null;
  source: string | null;
  rank: number | null;
  weightPct: string | number | null;
  shares: string | number | null;
  marketValue: string | number | null;
};

export type GroupedTextStatus = "single" | "mixed" | "empty";
export type GroupedNumericStatus =
  | "sum"
  | "empty"
  | "multiple_sources"
  | "mixed_currency";

export type GroupedTextValue = {
  value: string | null;
  status: GroupedTextStatus;
};

export type GroupedNumericValue = {
  value: number | null;
  status: GroupedNumericStatus;
};

export type GroupedRankValue = {
  value: number | null;
  disagrees: boolean;
};

export type GroupedEtfHoldingRow = {
  identityKey: string;
  etfTicker: string;
  etfName: string;
  asOfDate: string;
  holdingSymbol: string | null;
  holdingName: string;
  rawRowCount: number;
  hasDuplicates: boolean;
  source: GroupedTextValue;
  rank: GroupedRankValue;
  weightPct: GroupedNumericValue;
  shares: GroupedNumericValue;
  marketValue: GroupedNumericValue;
  holdingMarket: GroupedTextValue;
  holdingCountry: GroupedTextValue;
  currency: GroupedTextValue;
  sector: GroupedTextValue;
  industry: GroupedTextValue;
  securityType: GroupedTextValue;
  rawRows: EtfHoldingRawRow[];
};

export type GroupedEtfHoldingsResult = {
  rawRowCount: number;
  groupedRowCount: number;
  duplicateGroupCount: number;
  groups: GroupedEtfHoldingRow[];
};

export function groupEtfHoldingRows(
  rows: EtfHoldingRawRow[],
): GroupedEtfHoldingsResult {
  const groupsByIdentity = new Map<string, EtfHoldingRawRow[]>();

  for (const row of rows) {
    const key = etfHoldingIdentityKey(row);
    const existingRows = groupsByIdentity.get(key);
    if (existingRows) {
      existingRows.push(row);
    } else {
      groupsByIdentity.set(key, [row]);
    }
  }

  const groups = [...groupsByIdentity.entries()]
    .map(([identityKey, groupRows]) => buildGroupedHolding(identityKey, groupRows))
    .sort(compareGroupedHoldings);

  return {
    rawRowCount: rows.length,
    groupedRowCount: groups.length,
    duplicateGroupCount: groups.filter((group) => group.hasDuplicates).length,
    groups,
  };
}

export function selectLatestEtfHoldingAsOfDate(
  rows: EtfHoldingRawRow[],
  etfTicker?: string,
) {
  const normalizedTicker = canonicalString(etfTicker);
  const dates = rows
    .filter(
      (row) =>
        !normalizedTicker ||
        canonicalString(row.etfTicker) === normalizedTicker,
    )
    .map((row) => row.asOfDate)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left));

  return dates[0] ?? null;
}

export function etfHoldingIdentityKey(row: EtfHoldingRawRow) {
  return [
    canonicalString(row.etfTicker) ?? "",
    row.asOfDate,
    canonicalString(row.holdingSymbol) ?? "(null)",
    canonicalString(row.holdingName) ?? "",
  ].join("|");
}

function buildGroupedHolding(
  identityKey: string,
  rows: EtfHoldingRawRow[],
): GroupedEtfHoldingRow {
  const representative = rows[0];
  const source = groupedText(rows, (row) => row.source);
  const currency = groupedText(rows, (row) => row.currency);

  return {
    identityKey,
    etfTicker: representative.etfTicker,
    etfName: representative.etfName,
    asOfDate: representative.asOfDate,
    holdingSymbol: representative.holdingSymbol,
    holdingName: representative.holdingName,
    rawRowCount: rows.length,
    hasDuplicates: rows.length > 1,
    source,
    rank: groupedRank(rows),
    weightPct: groupedWeightPct(rows, source),
    shares: groupedCurrencyNumeric(rows, source, currency, (row) => row.shares),
    marketValue: groupedCurrencyNumeric(
      rows,
      source,
      currency,
      (row) => row.marketValue,
    ),
    holdingMarket: groupedText(rows, (row) => row.holdingMarket),
    holdingCountry: groupedText(rows, (row) => row.holdingCountry),
    currency,
    sector: groupedText(rows, (row) => row.sector),
    industry: groupedText(rows, (row) => row.industry),
    securityType: groupedText(rows, (row) => row.securityType),
    rawRows: rows,
  };
}

function groupedText(
  rows: EtfHoldingRawRow[],
  selector: (row: EtfHoldingRawRow) => string | null,
): GroupedTextValue {
  const values = rows.map((row) => cleanNullableString(selector(row)));
  const uniqueValues = new Set(
    values.map((value) => canonicalString(value) ?? "(null)"),
  );
  const nonEmptyValues = values.filter((value): value is string => Boolean(value));

  if (uniqueValues.size === 1) {
    return {
      value: nonEmptyValues[0] ?? null,
      status: nonEmptyValues.length > 0 ? "single" : "empty",
    };
  }

  return {
    value: null,
    status: "mixed",
  };
}

function groupedRank(rows: EtfHoldingRawRow[]): GroupedRankValue {
  const ranks = rows
    .map((row) => row.rank)
    .filter((rank): rank is number => rank !== null && Number.isFinite(rank));
  const uniqueRanks = new Set(ranks);

  return {
    value: ranks.length > 0 ? Math.min(...ranks) : null,
    disagrees: uniqueRanks.size > 1,
  };
}

function groupedWeightPct(
  rows: EtfHoldingRawRow[],
  source: GroupedTextValue,
): GroupedNumericValue {
  if (source.status === "mixed") {
    return { value: null, status: "multiple_sources" };
  }

  return sumNumeric(rows, (row) => row.weightPct);
}

function groupedCurrencyNumeric(
  rows: EtfHoldingRawRow[],
  source: GroupedTextValue,
  currency: GroupedTextValue,
  selector: (row: EtfHoldingRawRow) => string | number | null,
): GroupedNumericValue {
  if (source.status === "mixed") {
    return { value: null, status: "multiple_sources" };
  }
  if (currency.status === "mixed") {
    return { value: null, status: "mixed_currency" };
  }

  return sumNumeric(rows, selector);
}

function sumNumeric(
  rows: EtfHoldingRawRow[],
  selector: (row: EtfHoldingRawRow) => string | number | null,
): GroupedNumericValue {
  const values = rows
    .map((row) => toNumber(selector(row)))
    .filter((value): value is number => value !== null);

  if (values.length === 0) {
    return { value: null, status: "empty" };
  }

  return {
    value: values.reduce((sum, value) => sum + value, 0),
    status: "sum",
  };
}

function compareGroupedHoldings(
  left: GroupedEtfHoldingRow,
  right: GroupedEtfHoldingRow,
) {
  const leftRank = left.rank.value ?? Number.POSITIVE_INFINITY;
  const rightRank = right.rank.value ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftWeight = left.weightPct.value ?? 0;
  const rightWeight = right.weightPct.value ?? 0;
  if (leftWeight !== rightWeight) return rightWeight - leftWeight;

  return left.holdingName.localeCompare(right.holdingName);
}

function canonicalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function cleanNullableString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}
