import "server-only";

import type {
  ClosePrice,
  LiveQuote,
  MarketDataProvider,
  PriceLookupTarget,
  ProviderRequestContext,
  ProviderResult,
} from "./types";
import { redactSensitiveText } from "@/lib/redaction";

export const KIS_REQUIRED_ENV_KEYS = ["KIS_APP_KEY", "KIS_APP_SECRET"] as const;
export const KIS_OPTIONAL_ENV_KEYS = [
  "KIS_ACCOUNT_NO",
  "KIS_BASE_URL",
  "KIS_IS_MOCK",
  "KIS_TOKEN_POLICY",
] as const;

export type KisTokenPolicy = "per_request" | "memory_cache";
type KisMarket = "korea" | "us";

type KisConfig = {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  tokenPolicy: KisTokenPolicy;
};

type KisTokenCache = {
  accessToken: string;
  expiresAt: number;
};

type KisHistoryRow = {
  date: string;
  close: string;
  source: string;
  exchange: string | null;
};

type KisLiveRow = {
  price: string;
  source: string;
  exchange: string | null;
};

export type KisProviderPolicy = {
  provider: "kis";
  configured: boolean;
  missingEnvKeys: string[];
  optionalEnvKeys: string[];
  tokenPolicy: KisTokenPolicy;
  tokenStorage: "none" | "server_memory";
  storesSecretsInDatabase: false;
  notes: string[];
};

type EnvReader = Record<string, string | undefined>;
const DEFAULT_KIS_BASE_URL = "https://openapi.koreainvestment.com:9443";
const MOCK_KIS_BASE_URL = "https://openapivts.koreainvestment.com:29443";
const US_EXCHANGES = ["NAS", "NYS", "AMS"] as const;
let memoryTokenCache: KisTokenCache | null = null;

export function getKisProviderPolicy(env: EnvReader = process.env): KisProviderPolicy {
  const missingEnvKeys = KIS_REQUIRED_ENV_KEYS.filter(
    (key) => !hasEnvValue(env[key]),
  );
  const tokenPolicy = parseTokenPolicy(env.KIS_TOKEN_POLICY);

  return {
    provider: "kis",
    configured: missingEnvKeys.length === 0,
    missingEnvKeys,
    optionalEnvKeys: [...KIS_OPTIONAL_ENV_KEYS],
    tokenPolicy,
    tokenStorage: tokenPolicy === "memory_cache" ? "server_memory" : "none",
    storesSecretsInDatabase: false,
    notes: [
      "KIS app key, app secret, and access tokens must not be stored in Postgres settings or market_data_sync_runs metadata.",
      "per_request token policy is the safest first implementation because it persists no token.",
      "memory_cache token policy may reuse tokens only inside a warm server instance and must tolerate cold-start refetches.",
      "Vercel KV or another external secret store can be considered later, but is not required for the first KIS adapter.",
    ],
  };
}

export function createKisMarketDataProvider(): MarketDataProvider {
  return {
    name: "kis",
    supportedMarkets: ["korea", "us"],
    async fetchLiveQuotes(targets, context) {
      return fetchKisLiveQuotes(targets, context);
    },
    async fetchClosePrices(targets, context) {
      return fetchKisClosePrices(targets, context);
    },
  };
}

async function fetchKisLiveQuotes(
  targets: PriceLookupTarget[],
  context: ProviderRequestContext,
): Promise<ProviderResult<LiveQuote>> {
  const fetchedAt = context.requestedAt;
  const config = getKisConfig();

  if (!config) {
    const policy = getKisProviderPolicy();

    return {
      provider: "kis",
      fetchedAt,
      rows: targets.map((target) => ({
        ...toSkippedLiveQuote(target, context),
        status: "error",
        error: `missing_env:${policy.missingEnvKeys.join(",")}`,
      })),
      warnings: [
        "kis provider is not configured",
        ...policy.missingEnvKeys.map((key) => `missing env: ${key}`),
      ],
    };
  }

  let token: string;
  try {
    token = await getKisAccessToken(config);
  } catch (error) {
    const message = redactSensitiveText(toErrorMessage(error));
    return {
      provider: "kis",
      fetchedAt,
      rows: targets.map((target) => ({
        ...toSkippedLiveQuote(target, context),
        status: "error",
        error: message,
      })),
      warnings: ["kis token request failed"],
    };
  }

  const rows: LiveQuote[] = [];

  for (const target of targets) {
    try {
      const liveRow = await fetchKisLiveRow(target, token, config);
      rows.push(toLiveQuote(target, liveRow, fetchedAt));
    } catch (error) {
      rows.push({
        ...toSkippedLiveQuote(target, context),
        status: "error",
        error: redactSensitiveText(toErrorMessage(error)),
      });
    }

    await sleep(180);
  }

  return {
    provider: "kis",
    fetchedAt,
    rows,
    warnings: [
      context.dryRun
        ? "kis live dry-run preview only; no live_price_quotes rows were written"
        : "kis live prices fetched for guarded live_price_quotes write",
    ],
  };
}

async function fetchKisClosePrices(
  targets: PriceLookupTarget[],
  context: ProviderRequestContext,
): Promise<ProviderResult<ClosePrice>> {
  const fetchedAt = context.requestedAt;
  const config = getKisConfig();

  if (!config) {
    const policy = getKisProviderPolicy();

    return {
      provider: "kis",
      fetchedAt,
      rows: targets.map((target) => ({
        ...toSkippedClosePrice(target, context),
        status: "error",
        error: `missing_env:${policy.missingEnvKeys.join(",")}`,
      })),
      warnings: [
        "kis provider is not configured",
        ...policy.missingEnvKeys.map((key) => `missing env: ${key}`),
      ],
    };
  }

  let token: string;
  try {
    token = await getKisAccessToken(config);
  } catch (error) {
    const message = redactSensitiveText(toErrorMessage(error));
    return {
      provider: "kis",
      fetchedAt,
      rows: targets.map((target) => ({
        ...toSkippedClosePrice(target, context),
        status: "error",
        error: message,
      })),
      warnings: ["kis token request failed"],
    };
  }

  const rows: ClosePrice[] = [];
  const warnings: string[] = [];

  for (const target of targets) {
    try {
      const historyRow = await fetchLatestCloseRow(target, token, config, context);
      rows.push(toClosePrice(target, historyRow, context, fetchedAt));
    } catch (error) {
      rows.push({
        ...toSkippedClosePrice(target, context),
        status: "error",
        error: redactSensitiveText(toErrorMessage(error)),
      });
    }

    await sleep(180);
  }

  warnings.push(
    context.dryRun
      ? "kis close dry-run preview only; no asset_price_snapshots or assets rows were written"
      : "kis close prices fetched for guarded asset_price_snapshots write",
  );

  return {
    provider: "kis",
    fetchedAt,
    rows,
    warnings,
  };
}

async function getKisAccessToken(config: KisConfig) {
  const now = Date.now();
  if (
    config.tokenPolicy === "memory_cache" &&
    memoryTokenCache &&
    memoryTokenCache.expiresAt > now + 60_000
  ) {
    return memoryTokenCache.accessToken;
  }

  const response = await fetch(`${config.baseUrl}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: config.appKey,
      appsecret: config.appSecret,
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const data = await readKisJson(response, "token");
  const token = optionalText(data.access_token);

  if (!response.ok || !token) {
    throw new Error(
      `KIS token failed (${response.status}): ${kisErrorText(data)}`,
    );
  }

  const expiresInSeconds = toNumber(data.expires_in) ?? 23 * 60 * 60;
  if (config.tokenPolicy === "memory_cache") {
    memoryTokenCache = {
      accessToken: token,
      expiresAt: now + expiresInSeconds * 1000,
    };
  }

  return token;
}

async function fetchLatestCloseRow(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
  context: ProviderRequestContext,
) {
  const market = classifyTargetMarket(target);
  return market === "korea"
    ? fetchKoreanClose(target, token, config, context)
    : fetchUsClose(target, token, config, context);
}

async function fetchKisLiveRow(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
): Promise<KisLiveRow> {
  const market = classifyTargetMarket(target);
  return market === "korea"
    ? fetchKoreanLiveQuote(target, token, config)
    : fetchUsLiveQuote(target, token, config);
}

async function fetchKoreanLiveQuote(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
): Promise<KisLiveRow> {
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: target.ticker,
  });
  const response = await fetch(
    `${config.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-price?${params}`,
    {
      headers: kisHeaders(config, token, "FHKST01010100"),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const data = await readKisJson(response, `domestic-live:${target.ticker}`);

  if (data.rt_cd !== "0") {
    throw new Error(`KIS domestic live failed (${target.ticker}): ${kisErrorText(data)}`);
  }

  const output = objectRecord(data.output);
  const price = normalizePositiveDecimal(output?.stck_prpr);

  if (!price) {
    throw new Error(`KIS domestic live returned no price (${target.ticker})`);
  }

  return {
    price,
    source: "kis_domestic_inquire_price",
    exchange: null,
  };
}

async function fetchUsLiveQuote(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
): Promise<KisLiveRow> {
  const errors: string[] = [];

  for (const exchange of US_EXCHANGES) {
    try {
      const params = new URLSearchParams({
        AUTH: "",
        EXCD: exchange,
        SYMB: target.ticker,
      });
      const response = await fetch(
        `${config.baseUrl}/uapi/overseas-price/v1/quotations/price?${params}`,
        {
          headers: kisHeaders(config, token, "HHDFS00000300"),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const data = await readKisJson(response, `overseas-live:${target.ticker}:${exchange}`);

      if (data.rt_cd !== "0") {
        errors.push(`${exchange}:${kisErrorText(data)}`);
        continue;
      }

      const output = objectRecord(data.output);
      const price = normalizePositiveDecimal(output?.last);

      if (price) {
        return {
          price,
          source: `kis_overseas_price:${exchange}`,
          exchange,
        };
      }

      errors.push(`${exchange}:empty`);
    } catch (error) {
      errors.push(`${exchange}:${redactSensitiveText(toErrorMessage(error))}`);
    }

    await sleep(180);
  }

  throw new Error(`KIS overseas live returned no price (${target.ticker}): ${errors.join(" / ")}`);
}

async function fetchKoreanClose(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
  context: ProviderRequestContext,
): Promise<KisHistoryRow> {
  const endDate = toCompactDate(context.priceDate);
  const startDate = shiftDate(context.priceDate, -21).replace(/-/g, "");
  const params = new URLSearchParams({
    fid_cond_mrkt_div_code: "J",
    fid_input_iscd: target.ticker,
    fid_input_date_1: startDate,
    fid_input_date_2: endDate,
    fid_period_div_code: "D",
    fid_org_adj_prc: "1",
  });
  const response = await fetch(
    `${config.baseUrl}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?${params}`,
    {
      headers: kisHeaders(config, token, "FHKST03010100"),
      signal: AbortSignal.timeout(12_000),
    },
  );
  const data = await readKisJson(response, `domestic:${target.ticker}`);

  if (data.rt_cd !== "0") {
    throw new Error(`KIS domestic failed (${target.ticker}): ${kisErrorText(data)}`);
  }

  const row = pickLatestClose(
    data.output2,
    context.priceDate,
    "stck_bsop_date",
    "stck_clpr",
  );
  if (!row) throw new Error(`KIS domestic returned no close (${target.ticker})`);

  return {
    ...row,
    source: "kis_domestic_itemchartprice",
    exchange: null,
  };
}

async function fetchUsClose(
  target: PriceLookupTarget,
  token: string,
  config: KisConfig,
  context: ProviderRequestContext,
): Promise<KisHistoryRow> {
  const errors: string[] = [];

  for (const exchange of US_EXCHANGES) {
    try {
      const params = new URLSearchParams({
        AUTH: "",
        EXCD: exchange,
        SYMB: target.ticker,
        GUBN: "0",
        BYMD: toCompactDate(context.priceDate),
        MODP: "1",
        KEYB: "",
      });
      const response = await fetch(
        `${config.baseUrl}/uapi/overseas-price/v1/quotations/dailyprice?${params}`,
        {
          headers: kisHeaders(config, token, "HHDFS76240000"),
          signal: AbortSignal.timeout(12_000),
        },
      );
      const data = await readKisJson(response, `overseas:${target.ticker}:${exchange}`);

      if (data.rt_cd !== "0") {
        errors.push(`${exchange}:${kisErrorText(data)}`);
        continue;
      }

      const row = pickLatestClose(
        data.output2,
        context.priceDate,
        "xymd",
        "clos",
      );
      if (row) {
        return {
          ...row,
          source: `kis_overseas_dailyprice:${exchange}`,
          exchange,
        };
      }
      errors.push(`${exchange}:empty`);
    } catch (error) {
      errors.push(`${exchange}:${redactSensitiveText(toErrorMessage(error))}`);
    }

    await sleep(180);
  }

  throw new Error(`KIS overseas returned no close (${target.ticker}): ${errors.join(" / ")}`);
}

function toLiveQuote(
  target: PriceLookupTarget,
  row: KisLiveRow,
  fetchedAt: Date,
): LiveQuote {
  const market = classifyTargetMarket(target);

  return {
    ticker: target.ticker,
    market,
    currency: market === "korea" ? "KRW" : "USD",
    price: row.price,
    priceAsOf: fetchedAt,
    fetchedAt,
    source: row.source,
    quoteType: "live",
    status: "ok",
  };
}

function toClosePrice(
  target: PriceLookupTarget,
  row: KisHistoryRow,
  context: ProviderRequestContext,
  fetchedAt: Date,
): ClosePrice {
  const market = classifyTargetMarket(target);

  return {
    ticker: target.ticker,
    market,
    currency: market === "korea" ? "KRW" : "USD",
    priceDate: row.date,
    closePrice: row.close,
    adjustedClosePrice: row.close,
    closePriceKrw: market === "korea" ? row.close : null,
    fxRate: null,
    fetchedAt,
    source: row.source,
    quoteType: "close",
    status: "ok",
    isSample: false,
  };
}

function toSkippedLiveQuote(
  target: PriceLookupTarget,
  context: ProviderRequestContext,
): LiveQuote {
  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    price: null,
    priceAsOf: null,
    fetchedAt: context.requestedAt,
    source: "kis",
    quoteType: "live",
    status: "skipped",
    error: "kis_provider_not_implemented",
  };
}

function toSkippedClosePrice(
  target: PriceLookupTarget,
  context: ProviderRequestContext,
): ClosePrice {
  return {
    ticker: target.ticker,
    market: target.market,
    currency: target.currency,
    priceDate: context.priceDate,
    closePrice: null,
    adjustedClosePrice: null,
    closePriceKrw: null,
    fxRate: null,
    fetchedAt: context.requestedAt,
    source: "kis",
    quoteType: "close",
    status: "skipped",
    error: "kis_provider_not_implemented",
  };
}

function getKisConfig(env: EnvReader = process.env): KisConfig | null {
  const appKey = env.KIS_APP_KEY?.trim();
  const appSecret = env.KIS_APP_SECRET?.trim();

  if (!appKey || !appSecret) return null;

  return {
    appKey,
    appSecret,
    baseUrl: resolveBaseUrl(env),
    tokenPolicy: parseTokenPolicy(env.KIS_TOKEN_POLICY),
  };
}

function resolveBaseUrl(env: EnvReader) {
  const explicitBaseUrl = env.KIS_BASE_URL?.trim();
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/$/, "");

  const isMock = ["true", "1", "yes"].includes(
    env.KIS_IS_MOCK?.trim().toLowerCase() ?? "",
  );
  return isMock ? MOCK_KIS_BASE_URL : DEFAULT_KIS_BASE_URL;
}

function kisHeaders(config: KisConfig, token: string, trId: string) {
  return {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
    appkey: config.appKey,
    appsecret: config.appSecret,
    tr_id: trId,
  };
}

async function readKisJson(response: Response, context: string) {
  const text = await response.text();

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`KIS ${context} JSON parse failed (${response.status})`);
  }
}

function pickLatestClose(
  rows: unknown,
  maxDate: string,
  dateKey: string,
  closeKey: string,
): { date: string; close: string } | null {
  if (!Array.isArray(rows)) return null;

  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const record = row as Record<string, unknown>;
      const date = normalizeDate(record[dateKey]);
      const close = normalizePositiveDecimal(record[closeKey]);

      if (!date || !close || date > maxDate) return null;
      return { date, close };
    })
    .filter((row): row is { date: string; close: string } => row !== null)
    .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
}

function classifyTargetMarket(target: PriceLookupTarget): KisMarket {
  const market = target.market.trim().toLowerCase();
  const currency = target.currency.trim().toUpperCase();
  const ticker = target.ticker.trim().toUpperCase();

  if (market === "korea" || currency === "KRW") return "korea";
  if (/^(?=.*\d)[0-9A-Z]{6}$/.test(ticker)) return "korea";
  return "us";
}

function normalizeDate(value: unknown) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function normalizePositiveDecimal(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return String(value);
}

function objectRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function toCompactDate(value: string) {
  return value.replace(/-/g, "");
}

function shiftDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function kisErrorText(data: Record<string, unknown>) {
  const code = optionalText(data.error_code) ?? optionalText(data.msg_cd);
  const message =
    optionalText(data.error_description) ??
    optionalText(data.msg1) ??
    optionalText(data.message);

  if (code && message) return `[${code}] ${redactSensitiveText(message)}`;
  if (code) return `[${code}]`;
  if (message) return redactSensitiveText(message);
  return "unknown_error";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown KIS provider error";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTokenPolicy(value: string | undefined): KisTokenPolicy {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "memory_cache") return "memory_cache";
  return "per_request";
}

function hasEnvValue(value: string | undefined) {
  return Boolean(value?.trim());
}
