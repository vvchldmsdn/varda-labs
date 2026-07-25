import { ADJUSTED_CLOSE_BASIS } from "./providers/types.ts";

export const ASSET_PRICE_CONSUMER_ADMISSION_POLICY = Object.freeze({
  version: "asset_price_snapshot_consumer_admission_v2",
  operationalClose: Object.freeze({
    priceField: "close_price",
    adjustedCloseFallback: "forbidden",
  }),
  adjustedHistoricalReturn: Object.freeze({
    priceField: "adjusted_close_price",
    adjustedCloseBasis: ADJUSTED_CLOSE_BASIS.provider,
    providerBinding: "single_binding_per_instrument",
    incompleteProvenance: "exclude_row",
    conflictingProviderBinding: "exclude_instrument",
  }),
  rawHistoricalReturn: Object.freeze({
    priceField: "close_price",
    provenanceFields: Object.freeze([
      "source",
      "provider_symbol",
      "provider_exchange",
      "fetched_at",
    ]),
    consumerRights: "not_admitted",
    rightsEvidence:
      "kis_multi_user_display_and_analysis_rights_unproven",
    incompleteProvenance: "exclude_row",
    rightsNotAdmitted: "exclude_all_rows",
  }),
} as const);

type NumericInput = number | string | null | undefined;

type AssetPriceInstrumentEvidenceRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  priceDate: string;
}>;

export type AdjustedHistoricalPriceConsumerEvidenceRow =
  AssetPriceInstrumentEvidenceRow &
    Readonly<{
      adjustedClosePrice: NumericInput;
      adjustedCloseBasis: string | null;
      adjustedCloseProvider: string | null;
      adjustedCloseSource: string | null;
      adjustedCloseFetchedAt: string | Date | null;
      providerSymbol: string | null;
      providerExchange: string | null;
    }>;

export type RawHistoricalPriceConsumerEvidenceRow =
  AssetPriceInstrumentEvidenceRow &
    Readonly<{
      closePrice: NumericInput;
      source: string | null;
      providerSymbol: string | null;
      providerExchange: string | null;
      fetchedAt: string | Date | null;
    }>;

export type AdjustedHistoricalAdmissionIssue =
  | "invalid_instrument_identity"
  | "adjusted_close_missing"
  | "adjusted_close_basis_ineligible"
  | "adjusted_close_provider_missing"
  | "adjusted_close_source_missing"
  | "adjusted_close_fetched_at_invalid"
  | "provider_symbol_missing"
  | "provider_exchange_missing"
  | "conflicting_provider_binding";

export type AdjustedHistoricalPriceAdmission<T> = Readonly<{
  policy: typeof ASSET_PRICE_CONSUMER_ADMISSION_POLICY.adjustedHistoricalReturn;
  rows: readonly T[];
  summary: Readonly<{
    suppliedRowCount: number;
    admittedRowCount: number;
    excludedRowCount: number;
    admittedInstrumentCount: number;
    excludedInstrumentCount: number;
  }>;
  issues: readonly AdjustedHistoricalAdmissionIssue[];
}>;

export type RawHistoricalAdmissionIssue =
  | "invalid_instrument_identity"
  | "raw_history_consumer_rights_not_admitted";

export type RawHistoricalPriceAdmission<T> = Readonly<{
  policy: typeof ASSET_PRICE_CONSUMER_ADMISSION_POLICY.rawHistoricalReturn;
  rows: readonly T[];
  summary: Readonly<{
    suppliedRowCount: number;
    admittedRowCount: 0;
    excludedRowCount: number;
    admittedInstrumentCount: 0;
    excludedInstrumentCount: number;
  }>;
  issues: readonly RawHistoricalAdmissionIssue[];
}>;

export function resolveOperationalClosePrice(input: {
  closePrice: NumericInput;
}) {
  return positiveNumber(input.closePrice);
}

export function admitAdjustedHistoricalPriceRows<
  T extends AdjustedHistoricalPriceConsumerEvidenceRow,
>(rows: readonly T[]): AdjustedHistoricalPriceAdmission<T> {
  const suppliedRows = Array.isArray(rows) ? rows : [];
  const issues = new Set<AdjustedHistoricalAdmissionIssue>();
  const groups = new Map<string, T[]>();

  for (const row of suppliedRows) {
    const instrumentKey = normalizeInstrumentKey(row);
    if (!instrumentKey) {
      issues.add("invalid_instrument_identity");
      continue;
    }
    const group = groups.get(instrumentKey) ?? [];
    group.push(row);
    groups.set(instrumentKey, group);
  }

  const admittedRows: T[] = [];
  let admittedInstrumentCount = 0;
  let excludedInstrumentCount = 0;

  for (const groupRows of groups.values()) {
    const eligibleRows: T[] = [];
    const bindingKeys = new Set<string>();

    for (const row of groupRows) {
      const rowIssues = validateAdjustedHistoricalRow(row);
      for (const issue of rowIssues) issues.add(issue);
      if (rowIssues.length > 0) continue;

      eligibleRows.push(row);
      bindingKeys.add(providerBindingKey(row));
    }

    if (bindingKeys.size > 1) {
      issues.add("conflicting_provider_binding");
      excludedInstrumentCount += 1;
      continue;
    }

    if (eligibleRows.length === 0) {
      excludedInstrumentCount += 1;
      continue;
    }

    admittedRows.push(...eligibleRows);
    admittedInstrumentCount += 1;
  }

  return Object.freeze({
    policy: ASSET_PRICE_CONSUMER_ADMISSION_POLICY.adjustedHistoricalReturn,
    rows: Object.freeze(admittedRows),
    summary: Object.freeze({
      suppliedRowCount: suppliedRows.length,
      admittedRowCount: admittedRows.length,
      excludedRowCount: suppliedRows.length - admittedRows.length,
      admittedInstrumentCount,
      excludedInstrumentCount,
    }),
    issues: Object.freeze([...issues].sort()),
  });
}

export function admitRawHistoricalPriceRows<
  T extends RawHistoricalPriceConsumerEvidenceRow,
>(rows: readonly T[]): RawHistoricalPriceAdmission<T> {
  const suppliedRows = Array.isArray(rows) ? rows : [];
  const issues = new Set<RawHistoricalAdmissionIssue>([
    "raw_history_consumer_rights_not_admitted",
  ]);
  const instrumentKeys = new Set<string>();

  for (const row of suppliedRows) {
    const instrumentKey = normalizeInstrumentKey(row);
    if (!instrumentKey) {
      issues.add("invalid_instrument_identity");
      continue;
    }
    instrumentKeys.add(instrumentKey);
  }

  return Object.freeze({
    policy: ASSET_PRICE_CONSUMER_ADMISSION_POLICY.rawHistoricalReturn,
    rows: Object.freeze([]),
    summary: Object.freeze({
      suppliedRowCount: suppliedRows.length,
      admittedRowCount: 0,
      excludedRowCount: suppliedRows.length,
      admittedInstrumentCount: 0,
      excludedInstrumentCount: instrumentKeys.size,
    }),
    issues: Object.freeze([...issues].sort()),
  });
}

function validateAdjustedHistoricalRow(
  row: AdjustedHistoricalPriceConsumerEvidenceRow,
): AdjustedHistoricalAdmissionIssue[] {
  const issues: AdjustedHistoricalAdmissionIssue[] = [];
  if (positiveNumber(row.adjustedClosePrice) === null) {
    issues.push("adjusted_close_missing");
  }
  if (
    row.adjustedCloseBasis !==
    ASSET_PRICE_CONSUMER_ADMISSION_POLICY.adjustedHistoricalReturn
      .adjustedCloseBasis
  ) {
    issues.push("adjusted_close_basis_ineligible");
  }
  if (!normalizeText(row.adjustedCloseProvider)) {
    issues.push("adjusted_close_provider_missing");
  }
  if (!normalizeText(row.adjustedCloseSource)) {
    issues.push("adjusted_close_source_missing");
  }
  if (!isValidTimestamp(row.adjustedCloseFetchedAt)) {
    issues.push("adjusted_close_fetched_at_invalid");
  }
  if (!normalizeText(row.providerSymbol)) {
    issues.push("provider_symbol_missing");
  }
  if (!normalizeText(row.providerExchange)) {
    issues.push("provider_exchange_missing");
  }
  return issues;
}

function normalizeInstrumentKey(row: AssetPriceInstrumentEvidenceRow) {
  const market = normalizeText(row.market)?.toLowerCase();
  const currency = normalizeText(row.currency)?.toUpperCase();
  const ticker = normalizeText(row.ticker)?.toUpperCase();
  return market && currency && ticker
    ? `${market}|${currency}|${ticker}`
    : null;
}

function providerBindingKey(row: AdjustedHistoricalPriceConsumerEvidenceRow) {
  return [
    normalizeText(row.adjustedCloseProvider)?.toLowerCase(),
    normalizeText(row.providerSymbol)?.toUpperCase(),
    normalizeText(row.providerExchange)?.toUpperCase(),
  ].join("|");
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function positiveNumber(value: NumericInput) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isValidTimestamp(value: string | Date | null) {
  const parsed = value instanceof Date ? value : value ? new Date(value) : null;
  return parsed !== null && Number.isFinite(parsed.getTime());
}
