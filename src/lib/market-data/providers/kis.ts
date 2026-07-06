import "server-only";

import type {
  ClosePrice,
  LiveQuote,
  MarketDataProvider,
  PriceLookupTarget,
  ProviderRequestContext,
  ProviderResult,
} from "./types";

export const KIS_REQUIRED_ENV_KEYS = ["KIS_APP_KEY", "KIS_APP_SECRET"] as const;
export const KIS_OPTIONAL_ENV_KEYS = [
  "KIS_ACCOUNT_NO",
  "KIS_BASE_URL",
  "KIS_IS_MOCK",
  "KIS_TOKEN_POLICY",
] as const;

export type KisTokenPolicy = "per_request" | "memory_cache";

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
      return buildSkeletonResult(
        targets.map((target) => toSkippedLiveQuote(target, context)),
        context,
      );
    },
    async fetchClosePrices(targets, context) {
      return buildSkeletonResult(
        targets.map((target) => toSkippedClosePrice(target, context)),
        context,
      );
    },
  };
}

export function redactKisSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/(KIS_APP_KEY|KIS_APP_SECRET|KIS_ACCESS_TOKEN)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(appkey|appsecret|authorization|access_token)([\"':=\s]+)([^,\"'\s]+)/gi, "$1$2[redacted]");
}

function buildSkeletonResult<TQuote extends LiveQuote | ClosePrice>(
  rows: TQuote[],
  context: ProviderRequestContext,
): ProviderResult<TQuote> {
  const policy = getKisProviderPolicy();

  return {
    provider: "kis",
    fetchedAt: context.requestedAt,
    rows,
    warnings: [
      "kis provider skeleton only; no KIS HTTP request was performed",
      `kis configured: ${policy.configured}`,
      `kis token policy: ${policy.tokenPolicy}`,
      ...policy.missingEnvKeys.map((key) => `missing env: ${key}`),
    ],
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

function parseTokenPolicy(value: string | undefined): KisTokenPolicy {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "memory_cache") return "memory_cache";
  return "per_request";
}

function hasEnvValue(value: string | undefined) {
  return Boolean(value?.trim());
}
