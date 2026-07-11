const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;

export class MarketContextShadowSourceError extends Error {
  constructor(code) {
    super("Base44 market context shadow source is invalid");
    this.name = "MarketContextShadowSourceError";
    this.code = code;
  }
}

export function normalizeBase44MarketContextShadowSource({
  marketRegimeRecords,
  globalFactorRecords,
}) {
  return Object.freeze({
    marketRegimes: freezeRows(
      requireArray(
        marketRegimeRecords,
        "invalid_market_regime_source",
      ).map(normalizeMarketRegime),
    ),
    globalFactors: freezeRows(
      requireArray(
        globalFactorRecords,
        "invalid_global_factor_source",
      ).map(normalizeGlobalFactor),
    ),
  });
}

function normalizeMarketRegime(record) {
  assertRecord(record, "invalid_market_regime_source_record");
  return {
    legacyBase44Id: requiredBase44Id(
      record.id,
      "invalid_market_regime_identity",
    ),
    regimeDate: requiredDate(record.date, "invalid_market_regime_date"),
    account: optionalString(record.account) ?? "all",
    labelPresent: hasContent(record.label),
    driversPresent: hasContent(record.drivers_json),
    isSample: normalizeBooleanEvidence(record, "is_sample").value === true,
  };
}

function normalizeGlobalFactor(record) {
  assertRecord(record, "invalid_global_factor_source_record");
  const statusPresent = hasOwn(record, "status");
  const status = statusPresent
    ? optionalString(record.status)?.toLowerCase() ?? null
    : null;
  const estimated = normalizeBooleanEvidence(record, "is_estimated");
  const preliminary = normalizeBooleanEvidence(record, "is_preliminary");

  return {
    legacyBase44Id: requiredBase44Id(
      record.id,
      "invalid_global_factor_identity",
    ),
    factorDate: requiredDate(record.date, "invalid_global_factor_date"),
    factorKey: requiredString(
      record.factor_key,
      "missing_global_factor_key",
    ),
    statusPresent,
    status,
    estimatedPresent: estimated.present,
    isEstimated: estimated.value,
    preliminaryPresent: preliminary.present,
    isPreliminary: preliminary.value,
    isSample: normalizeBooleanEvidence(record, "is_sample").value === true,
  };
}

function normalizeBooleanEvidence(record, key) {
  if (!hasOwn(record, key)) return { present: false, value: null };
  const value = record[key];
  if (value === true || value === "true") {
    return { present: true, value: true };
  }
  if (value === false || value === "false") {
    return { present: true, value: false };
  }
  return { present: true, value: null };
}

function requireArray(value, code) {
  if (!Array.isArray(value)) throw new MarketContextShadowSourceError(code);
  return value;
}

function assertRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MarketContextShadowSourceError(code);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasContent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredString(value, code) {
  const normalized = optionalString(value);
  if (normalized === null) throw new MarketContextShadowSourceError(code);
  return normalized;
}

function requiredBase44Id(value, code) {
  const normalized = requiredString(value, code);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new MarketContextShadowSourceError(code);
  }
  return normalized.toLowerCase();
}

function requiredDate(value, code) {
  const normalized = requiredString(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new MarketContextShadowSourceError(code);
  }
  return normalized;
}

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}
