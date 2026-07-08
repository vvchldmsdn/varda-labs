export const FX_REFRESH_DRY_RUN_CONTRACT = {
  supportedPairs: ["USD/KRW"],
  dryRunWrites: [],
  actualWriteTables: ["fx_rates"],
  forbiddenWriteTables: [
    "assets",
    "asset_price_snapshots",
    "daily_position_snapshots",
    "daily_portfolio_snapshots",
    "settings",
  ],
  writesRunMetadataOnDryRun: false,
} as const;

export const FX_REFRESH_PROVIDER_NAMES = ["er-api-open"] as const;

export type FxRefreshProviderName =
  (typeof FX_REFRESH_PROVIDER_NAMES)[number];

export type FxProviderName = FxRefreshProviderName | "frankfurter";

export type FxRateCandidate = {
  provider: FxProviderName;
  pair: "USD/KRW";
  rateDate: string;
  usdKrw: string;
  source: string;
  status: "ok";
  fetchedAt: string;
  providerTimestamp?: string;
};

export type FxProviderParseResult =
  | { ok: true; candidate: FxRateCandidate }
  | { ok: false; error: string };

export type ExistingFxRateRow = {
  id: string;
  rateDate: string;
  usdKrw: string | number;
  source: string | null;
  status: string | null;
  legacyBase44Id: string | null;
};

export type FxRateWritePlanAction =
  | "planned_insert"
  | "planned_update"
  | "planned_skip"
  | "blocked";

export type FxRateWritePlan = {
  action: FxRateWritePlanAction;
  reason: string;
  rateDate: string;
  usdKrw: string;
  source: string;
  existingRowId: string | null;
  plannedWrites: {
    insert: number;
    update: number;
    skip: number;
    blocked: number;
  };
};

export class FxRefreshRequestError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { statusCode?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "FxRefreshRequestError";
    this.code = code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }
}

const EXCHANGE_RATE_OPEN_ACCESS_URL = "https://open.er-api.com/v6/latest/USD";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FX_RATE_DIFF_THRESHOLD = 0.01;

export async function fetchUsdKrwFxCandidate(options: {
  provider: FxRefreshProviderName;
  fetchedAt?: Date;
}) {
  if (options.provider !== "er-api-open") {
    throw new FxRefreshRequestError(
      "unsupported_fx_provider",
      "Unsupported FX provider",
      { statusCode: 400 },
    );
  }

  const fetchedAt = options.fetchedAt ?? new Date();
  let response: Response;

  try {
    response = await fetch(EXCHANGE_RATE_OPEN_ACCESS_URL, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FxRefreshRequestError(
      "fx_provider_request_failed",
      "FX provider request failed",
      { statusCode: 502, details: { provider: options.provider } },
    );
  }

  if (!response.ok) {
    throw new FxRefreshRequestError(
      "fx_provider_http_error",
      "FX provider returned an HTTP error",
      {
        statusCode: 502,
        details: {
          provider: options.provider,
          providerStatus: response.status,
        },
      },
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new FxRefreshRequestError(
      "fx_provider_invalid_json",
      "FX provider returned invalid JSON",
      { statusCode: 502, details: { provider: options.provider } },
    );
  }

  const parsed = parseExchangeRateOpenAccessUsdKrwResponse(payload, {
    fetchedAt,
  });

  if (!parsed.ok) {
    throw new FxRefreshRequestError(
      parsed.error,
      "FX provider returned an unusable USD/KRW response",
      { statusCode: 502, details: { provider: options.provider } },
    );
  }

  return parsed.candidate;
}

export function parseExchangeRateOpenAccessUsdKrwResponse(
  payload: unknown,
  options: { fetchedAt?: Date | string } = {},
): FxProviderParseResult {
  const record = asRecord(payload);
  if (!record) return { ok: false, error: "malformed_provider_response" };

  if (record.result !== undefined && record.result !== "success") {
    return { ok: false, error: "provider_status_not_success" };
  }

  if (record.base_code !== undefined && record.base_code !== "USD") {
    return { ok: false, error: "unexpected_provider_base" };
  }

  const rates = asRecord(record.rates);
  const usdKrw = toPositiveDecimalString(rates?.KRW);
  if (!usdKrw) return { ok: false, error: "missing_or_invalid_usdkrw" };

  const providerTimestamp = extractExchangeRateApiTimestamp(record);
  if (!providerTimestamp) {
    return { ok: false, error: "missing_or_invalid_provider_timestamp" };
  }

  return {
    ok: true,
    candidate: {
      provider: "er-api-open",
      pair: "USD/KRW",
      rateDate: providerTimestamp.toISOString().slice(0, 10),
      usdKrw,
      source: "er-api_open_access",
      status: "ok",
      fetchedAt: toIsoString(options.fetchedAt),
      providerTimestamp: providerTimestamp.toISOString(),
    },
  };
}

export function parseFrankfurterUsdKrwResponse(
  payload: unknown,
  options: { fetchedAt?: Date | string } = {},
): FxProviderParseResult {
  const record = asRecord(payload);
  if (!record) return { ok: false, error: "malformed_provider_response" };

  if (record.base !== undefined && record.base !== "USD") {
    return { ok: false, error: "unexpected_provider_base" };
  }

  const rates = asRecord(record.rates);
  if (!rates) return { ok: false, error: "missing_provider_rates" };

  const latestShapeRate = toPositiveDecimalString(rates.KRW);
  if (latestShapeRate) {
    const rateDate = typeof record.date === "string" ? record.date : null;
    if (!isDateKey(rateDate)) {
      return { ok: false, error: "missing_or_invalid_rate_date" };
    }

    return {
      ok: true,
      candidate: {
        provider: "frankfurter",
        pair: "USD/KRW",
        rateDate,
        usdKrw: latestShapeRate,
        source: "frankfurter",
        status: "ok",
        fetchedAt: toIsoString(options.fetchedAt),
      },
    };
  }

  const dateKeys = Object.keys(rates)
    .filter(isDateKey)
    .sort()
    .reverse();

  for (const rateDate of dateKeys) {
    const row = asRecord(rates[rateDate]);
    const usdKrw = toPositiveDecimalString(row?.KRW);

    if (usdKrw) {
      return {
        ok: true,
        candidate: {
          provider: "frankfurter",
          pair: "USD/KRW",
          rateDate,
          usdKrw,
          source: "frankfurter",
          status: "ok",
          fetchedAt: toIsoString(options.fetchedAt),
        },
      };
    }
  }

  return { ok: false, error: "missing_or_invalid_usdkrw" };
}

export function planFxRateWrite(
  candidate: FxRateCandidate,
  existingRows: ExistingFxRateRow[],
): FxRateWritePlan {
  if (!isDateKey(candidate.rateDate)) {
    return toPlan(candidate, "blocked", "invalid_candidate_rate_date");
  }

  if (!toPositiveDecimalString(candidate.usdKrw)) {
    return toPlan(candidate, "blocked", "invalid_candidate_usdkrw");
  }

  if (existingRows.length === 0) {
    return toPlan(candidate, "planned_insert", "new_varda_row");
  }

  if (existingRows.length > 1) {
    return toPlan(candidate, "blocked", "duplicate_rate_date_rows");
  }

  const existing = existingRows[0];
  if (hasLegacyBase44Id(existing)) {
    return toPlan(
      candidate,
      "planned_skip",
      "imported_legacy_row_preserved",
      existing.id,
    );
  }

  const existingUsdKrw = Number(existing.usdKrw);
  const candidateUsdKrw = Number(candidate.usdKrw);

  if (
    !Number.isFinite(existingUsdKrw) ||
    !Number.isFinite(candidateUsdKrw) ||
    existingUsdKrw <= 0
  ) {
    return toPlan(candidate, "blocked", "invalid_existing_usdkrw", existing.id);
  }

  if (Math.abs(existingUsdKrw - candidateUsdKrw) > FX_RATE_DIFF_THRESHOLD) {
    return toPlan(candidate, "planned_update", "varda_row_value_changed", existing.id);
  }

  return toPlan(candidate, "planned_skip", "same_varda_row_value", existing.id);
}

function toPlan(
  candidate: FxRateCandidate,
  action: FxRateWritePlanAction,
  reason: string,
  existingRowId: string | null = null,
): FxRateWritePlan {
  return {
    action,
    reason,
    rateDate: candidate.rateDate,
    usdKrw: candidate.usdKrw,
    source: candidate.source,
    existingRowId,
    plannedWrites: {
      insert: action === "planned_insert" ? 1 : 0,
      update: action === "planned_update" ? 1 : 0,
      skip: action === "planned_skip" ? 1 : 0,
      blocked: action === "blocked" ? 1 : 0,
    },
  };
}

function extractExchangeRateApiTimestamp(record: Record<string, unknown>) {
  if (typeof record.time_last_update_utc === "string") {
    const parsed = new Date(record.time_last_update_utc);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  if (typeof record.time_last_update_unix === "number") {
    const parsed = new Date(record.time_last_update_unix * 1000);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return null;
}

function hasLegacyBase44Id(row: ExistingFxRateRow) {
  return Boolean(row.legacyBase44Id?.trim());
}

function toPositiveDecimalString(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(parsed);
}

function toIsoString(value: Date | string | undefined) {
  const parsed = value === undefined ? new Date() : new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : new Date().toISOString();
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
