import { ADJUSTED_CLOSE_BASIS } from "./providers/types.ts";

export const ASSET_PRICE_CONSUMER_ADMISSION_POLICY = Object.freeze({
  version: "asset_price_snapshot_consumer_admission_v3",
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
  sharedKisRawHistoricalReturn: Object.freeze({
    priceField: "close_price",
    priceBasis: "raw_price_return",
    consumerPurpose: "tenant_scoped_instrument_analysis",
    tenantBoundary: "shared_market_data_cache_owner_independent",
    providerBoundary: "kis_only_with_complete_provenance",
    corporateActionAdjustment: "not_claimed",
    distributionAdjustment: "not_claimed",
    persistence: "forbidden",
    recommendation: "forbidden",
  }),
  sharedKisRawTrendEvidence: Object.freeze({
    priceField: "close_price",
    priceBasis: "raw_price_level",
    consumerPurpose: "tenant_scoped_descriptive_trend_evidence",
    tenantBoundary: "shared_market_data_cache_owner_independent",
    providerBoundary: "kis_only_with_complete_provenance",
    corporateActionAdjustment: "not_claimed",
    distributionAdjustment: "not_claimed",
    persistence: "forbidden",
    allocationEffect: "none",
    recommendation: "forbidden",
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

export type SharedKisRawHistoricalAdmissionIssue =
  | "invalid_instrument_identity"
  | "raw_close_missing"
  | "raw_source_not_kis"
  | "provider_symbol_missing"
  | "provider_exchange_missing"
  | "fetched_at_invalid"
  | "conflicting_provider_binding";

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

export type SharedKisRawHistoricalPriceAdmission<T> = Readonly<{
  policy: typeof ASSET_PRICE_CONSUMER_ADMISSION_POLICY.sharedKisRawHistoricalReturn;
  status: "ready" | "blocked";
  rows: readonly T[];
  summary: Readonly<{
    suppliedRowCount: number;
    admittedRowCount: number;
    excludedRowCount: number;
    admittedInstrumentCount: number;
    excludedInstrumentCount: number;
  }>;
  issues: readonly SharedKisRawHistoricalAdmissionIssue[];
}>;

export type SharedKisRawTrendEvidenceAdmission<T> = Readonly<{
  policy: typeof ASSET_PRICE_CONSUMER_ADMISSION_POLICY.sharedKisRawTrendEvidence;
  status: "ready" | "blocked";
  rows: readonly T[];
  summary: Readonly<{
    suppliedRowCount: number;
    admittedRowCount: number;
    excludedRowCount: number;
    admittedInstrumentCount: number;
    excludedInstrumentCount: number;
  }>;
  issues: readonly SharedKisRawHistoricalAdmissionIssue[];
}>;

export type PreferredPrivateHistoricalPriceBasis =
  | "provider_adjusted_close"
  | "private_kis_raw_close";

export type PreferredPrivateHistoricalPriceRow<T> = Readonly<{
  row: T;
  priceBasis: PreferredPrivateHistoricalPriceBasis;
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

export function admitSharedKisRawHistoricalPriceRows<
  T extends RawHistoricalPriceConsumerEvidenceRow,
>(rows: readonly T[]): SharedKisRawHistoricalPriceAdmission<T> {
  const result = admitSharedKisRawRows(rows);
  return Object.freeze({
    policy: ASSET_PRICE_CONSUMER_ADMISSION_POLICY.sharedKisRawHistoricalReturn,
    ...result,
  });
}

export function admitSharedKisRawTrendEvidenceRows<
  T extends RawHistoricalPriceConsumerEvidenceRow,
>(rows: readonly T[]): SharedKisRawTrendEvidenceAdmission<T> {
  const result = admitSharedKisRawRows(rows);
  return Object.freeze({
    policy: ASSET_PRICE_CONSUMER_ADMISSION_POLICY.sharedKisRawTrendEvidence,
    ...result,
  });
}

function admitSharedKisRawRows<T extends RawHistoricalPriceConsumerEvidenceRow>(
  rows: readonly T[],
) {
  const suppliedRows = Array.isArray(rows) ? rows : [];

  const issues = new Set<SharedKisRawHistoricalAdmissionIssue>();
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
      const rowIssues = validateSharedKisRawRow(row);
      for (const issue of rowIssues) issues.add(issue);
      if (rowIssues.length > 0) continue;
      eligibleRows.push(row);
      bindingKeys.add(rawProviderBindingKey(row));
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
    status: admittedRows.length > 0 ? ("ready" as const) : ("blocked" as const),
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

export function selectPreferredPrivateHistoricalPriceRows<
  T extends AssetPriceInstrumentEvidenceRow,
>(input: {
  adjustedRows: readonly T[];
  privateRawRows: readonly T[];
}) {
  const adjustedByInstrument = groupRowsByInstrument(input.adjustedRows);
  const rawByInstrument = groupRowsByInstrument(input.privateRawRows);
  const instrumentKeys = [
    ...new Set([
      ...adjustedByInstrument.keys(),
      ...rawByInstrument.keys(),
    ]),
  ].sort();
  const rows: PreferredPrivateHistoricalPriceRow<T>[] = [];
  let adjustedInstrumentCount = 0;
  let privateRawInstrumentCount = 0;

  for (const instrumentKey of instrumentKeys) {
    const adjustedRows = sortHistoricalRows(
      adjustedByInstrument.get(instrumentKey) ?? [],
    );
    const rawRows = sortHistoricalRows(rawByInstrument.get(instrumentKey) ?? []);
    const useAdjusted = adjustedHistoryCoversRawHistory(
      adjustedRows,
      rawRows,
    );
    const selectedRows = useAdjusted ? adjustedRows : rawRows;
    if (selectedRows.length === 0) continue;

    const priceBasis = useAdjusted
      ? ("provider_adjusted_close" as const)
      : ("private_kis_raw_close" as const);
    if (useAdjusted) adjustedInstrumentCount += 1;
    else privateRawInstrumentCount += 1;
    rows.push(
      ...selectedRows.map((row) => Object.freeze({ row, priceBasis })),
    );
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    summary: Object.freeze({
      selectedInstrumentCount:
        adjustedInstrumentCount + privateRawInstrumentCount,
      adjustedInstrumentCount,
      privateRawInstrumentCount,
    }),
  });
}

export function adjustedHistoryCoversRawHistory(
  adjustedRows: readonly AssetPriceInstrumentEvidenceRow[],
  rawRows: readonly AssetPriceInstrumentEvidenceRow[],
) {
  if (adjustedRows.length < 2) return false;
  if (rawRows.length < 2) return true;
  const adjusted = sortHistoricalRows(adjustedRows);
  const raw = sortHistoricalRows(rawRows);
  return (
    adjusted[0].priceDate <= raw[0].priceDate &&
    adjusted.at(-1)!.priceDate >= raw.at(-1)!.priceDate
  );
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

function validateSharedKisRawRow(
  row: RawHistoricalPriceConsumerEvidenceRow,
): SharedKisRawHistoricalAdmissionIssue[] {
  const issues: SharedKisRawHistoricalAdmissionIssue[] = [];
  if (positiveNumber(row.closePrice) === null) issues.push("raw_close_missing");
  const source = normalizeText(row.source)?.toLowerCase() ?? "";
  if (!/^kis(?:$|[_:])/.test(source)) {
    issues.push("raw_source_not_kis");
  }
  if (!normalizeText(row.providerSymbol)) issues.push("provider_symbol_missing");
  if (!normalizeText(row.providerExchange)) {
    issues.push("provider_exchange_missing");
  }
  if (!isValidTimestamp(row.fetchedAt)) issues.push("fetched_at_invalid");
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

function groupRowsByInstrument<T extends AssetPriceInstrumentEvidenceRow>(
  rows: readonly T[],
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const instrumentKey = normalizeInstrumentKey(row);
    if (!instrumentKey) continue;
    const group = groups.get(instrumentKey) ?? [];
    group.push(row);
    groups.set(instrumentKey, group);
  }
  return groups;
}

function sortHistoricalRows<T extends AssetPriceInstrumentEvidenceRow>(
  rows: readonly T[],
) {
  return [...rows].sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
}

function providerBindingKey(row: AdjustedHistoricalPriceConsumerEvidenceRow) {
  return [
    normalizeText(row.adjustedCloseProvider)?.toLowerCase(),
    normalizeText(row.providerSymbol)?.toUpperCase(),
    normalizeText(row.providerExchange)?.toUpperCase(),
  ].join("|");
}

function rawProviderBindingKey(row: RawHistoricalPriceConsumerEvidenceRow) {
  return [
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
