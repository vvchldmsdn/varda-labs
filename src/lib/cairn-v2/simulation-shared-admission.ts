/** Limited source port of preserved original src/lib/market-data/asset-price-consumer-admission.ts.
 * Source SHA256 a34ccd79a168c051fac288f6f596792da8d9f01d75a04fb99e3c04ecd9930e5e.
 * Reuses its shared KIS raw row/provenance admission only. It does not authenticate
 * users; the server must first resolve the session and admit the owned instrument universe.
 * No provider, storage, adjusted-price, trend, or global policy replacement is imported. */
import type {RawHistoricalPriceConsumerEvidenceRow} from '../market-data/asset-price-consumer-admission.ts';
export type {RawHistoricalPriceConsumerEvidenceRow} from '../market-data/asset-price-consumer-admission.ts';
type NumericInput=number|string|null|undefined;
type AssetPriceInstrumentEvidenceRow=Readonly<{market:string;currency:string;ticker:string;priceDate:string}>;
export const SHARED_KIS_RAW_ADMISSION_POLICY=Object.freeze({
 priceField:'close_price',priceBasis:'raw_price_return',consumerPurpose:'tenant_scoped_instrument_analysis',
 tenantBoundary:'shared_market_data_cache_owner_independent',providerBoundary:'kis_only_with_complete_provenance',
 corporateActionAdjustment:'not_claimed',distributionAdjustment:'not_claimed',persistence:'forbidden',recommendation:'forbidden',
} as const);
export type SharedKisRawHistoricalAdmissionIssue=
 |'invalid_instrument_identity'|'raw_close_missing'|'raw_source_not_kis'|'provider_symbol_missing'
 |'provider_exchange_missing'|'fetched_at_invalid'|'conflicting_provider_binding';
export type SharedKisRawHistoricalPriceAdmission<T>=Readonly<{
 policy:typeof SHARED_KIS_RAW_ADMISSION_POLICY;status:'ready'|'blocked';rows:readonly T[];
 summary:Readonly<{suppliedRowCount:number;admittedRowCount:number;excludedRowCount:number;admittedInstrumentCount:number;excludedInstrumentCount:number}>;
 issues:readonly SharedKisRawHistoricalAdmissionIssue[];
}>;
export function admitSharedKisRawHistoricalPriceRows<
  T extends RawHistoricalPriceConsumerEvidenceRow,
>(rows: readonly T[]): SharedKisRawHistoricalPriceAdmission<T> {
  const result = admitSharedKisRawRows(rows);
  return Object.freeze({
    policy: SHARED_KIS_RAW_ADMISSION_POLICY,
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
