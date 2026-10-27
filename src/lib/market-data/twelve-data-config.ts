import "server-only";
import { assertTwelveDataBudgetPolicy, type TwelveDataBudgetPolicy } from "./twelve-data-budget-policy";
import { twelveDataAccessError, type TwelveDataOptions } from "./providers/twelve-data";
import type { TwelveDataDataset } from "./providers/twelve-data-contract";

export type TwelveDataStoragePolicy = { retentionSeconds: number; quoteFreshSeconds: number; fxFreshSeconds: number; historyFreshSeconds: number };
export type TwelveDataServiceConfig = {
  provider: Omit<Extract<TwelveDataOptions, { mode: "live" }>, "reserve">;
  budget: TwelveDataBudgetPolicy;
  storage: TwelveDataStoragePolicy;
};
const noReservation = async () => false;

export function twelveDataConfigAllows(config: TwelveDataServiceConfig | undefined, dataset: TwelveDataDataset) {
  if (!config || config.provider?.mode !== "live") return false;
  try {
    assertTwelveDataBudgetPolicy(config.budget);
    const storage = config.storage;
    if (!storage || !Number.isSafeInteger(storage.retentionSeconds) || storage.retentionSeconds < 60 || storage.retentionSeconds > 10 * 366 * 86_400 ||
        [storage.quoteFreshSeconds, storage.fxFreshSeconds, storage.historyFreshSeconds].some(value => !Number.isSafeInteger(value) || value < 1 || value > storage.retentionSeconds) ||
        config.provider.license.cacheScope.length > 160 || config.provider.license.reference.length > 200 ||
        !Array.isArray(config.provider.listings) || config.provider.listings.length > 10_000) return false;
    return twelveDataAccessError({ ...config.provider, reserve: noReservation }, dataset, new Date()) === null;
  } catch { return false; }
}

/** Values are read only when called on the server. Missing/invalid configuration stays disabled. */
export function getTwelveDataServerConfig(env: Record<string, string | undefined> = process.env): TwelveDataServiceConfig | undefined {
  if (env.CAIRN_TWELVE_DATA_ENABLED !== "true" || !env.TWELVE_DATA_API_KEY || !env.CAIRN_TWELVE_DATA_SERVER_CONFIG) return undefined;
  try {
    const parsed = JSON.parse(env.CAIRN_TWELVE_DATA_SERVER_CONFIG);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const config: TwelveDataServiceConfig = { provider: { ...parsed.provider, mode: "live", apiKey: env.TWELVE_DATA_API_KEY,
      license: { ...parsed.provider?.license, expiresAt: new Date(parsed.provider?.license?.expiresAt) } }, budget: parsed.budget, storage: parsed.storage };
    return ["us_quote", "us_daily_raw", "usd_krw", "usd_krw_history"].some(dataset => twelveDataConfigAllows(config, dataset as TwelveDataDataset)) ? config : undefined;
  } catch { return undefined; }
}
