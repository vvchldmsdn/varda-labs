const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;

export class HistoryShadowSourceError extends Error {
  constructor(code) {
    super("Base44 history shadow source is invalid");
    this.name = "HistoryShadowSourceError";
    this.code = code;
  }
}

export function normalizeBase44HistoryShadowSource({
  balanceRecords,
  portfolioRecords,
  positionRecords,
  fxRateRecords,
}) {
  return Object.freeze({
    balances: freezeRows(
      requireArray(balanceRecords, "invalid_balance_source").map(
        normalizeBalance,
      ),
    ),
    portfolios: freezeRows(
      requireArray(portfolioRecords, "invalid_portfolio_source").map(
        normalizePortfolio,
      ),
    ),
    positions: freezeRows(
      requireArray(positionRecords, "invalid_position_source").map(
        normalizePosition,
      ),
    ),
    fxRates: freezeRows(
      requireArray(fxRateRecords, "invalid_fx_source").map(normalizeFxRate),
    ),
  });
}

function normalizeBalance(record) {
  assertRecord(record, "invalid_balance_source_record");
  return {
    legacyBase44Id: requiredBase44Id(
      record.id,
      "invalid_balance_identity",
    ),
    balanceDate: requiredDate(record.date, "invalid_balance_date"),
  };
}

function normalizePortfolio(record) {
  assertRecord(record, "invalid_portfolio_source_record");
  return {
    legacyBase44Id: requiredBase44Id(
      record.id,
      "invalid_portfolio_identity",
    ),
    snapshotDate: requiredDate(
      record.snapshot_date,
      "invalid_portfolio_snapshot_date",
    ),
    account: requiredString(record.account, "missing_portfolio_account"),
    source: "base44_import",
  };
}

function normalizePosition(record) {
  assertRecord(record, "invalid_position_source_record");
  return {
    legacyBase44Id: requiredBase44Id(
      record.id,
      "invalid_position_identity",
    ),
    snapshotDate: requiredDate(
      record.snapshot_date,
      "invalid_position_snapshot_date",
    ),
    account: requiredString(record.account, "missing_position_account"),
    legacyAssetId: requiredBase44Id(
      record.asset_id,
      "invalid_position_asset_reference",
    ),
    source: "base44_import",
  };
}

function normalizeFxRate(record) {
  assertRecord(record, "invalid_fx_source_record");
  return {
    legacyBase44Id: requiredBase44Id(record.id, "invalid_fx_identity"),
    rateDate: requiredDate(record.date, "invalid_fx_date"),
    status: optionalString(record.status),
    source: optionalString(record.source),
    isSample: normalizeBoolean(record.is_sample),
  };
}

function requireArray(value, code) {
  if (!Array.isArray(value)) throw new HistoryShadowSourceError(code);
  return value;
}

function assertRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HistoryShadowSourceError(code);
  }
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredString(value, code) {
  const normalized = optionalString(value);
  if (normalized === null) throw new HistoryShadowSourceError(code);
  return normalized;
}

function requiredBase44Id(value, code) {
  const normalized = requiredString(value, code);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new HistoryShadowSourceError(code);
  }
  return normalized.toLowerCase();
}

function requiredDate(value, code) {
  const normalized = requiredString(value, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HistoryShadowSourceError(code);
  }
  return normalized;
}

function normalizeBoolean(value) {
  if (value === true || value === "true") return true;
  return false;
}

function freezeRows(rows) {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}
