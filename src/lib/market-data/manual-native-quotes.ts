import "server-only";
import { createHash } from "node:crypto";
import { getTwelveDataServerConfig, readTwelveDataEvidence, requestTwelveDataEvidence, resolveTwelveDataTarget } from "./twelve-data-service";
import { getTwelveDataCollectionJobs, type TwelveDataCollectionInput } from "./twelve-data-collection";
import { readCollectionProgress } from "./collection-queue";
import { refreshItem, type QuoteRefreshItem } from "./quote-refresh-progress";

/** Only the authenticated refresh handler supplies owned targets. Polling reads;
 * it never creates demand. Licensing, identity, freshness and budgets stay in the service. */
export async function manualNativeQuotes(targets: readonly { ticker: string; market: string; currency: string }[], collect: boolean, startedAt = new Date().toISOString()) {
  const config = getTwelveDataServerConfig();
  if (!config || config.provider.audience !== "member_display") return { available: false, pending: false, failed: false, version: "disabled", items: [] as QuoteRefreshItem[] };
  const at = new Date().toISOString();
  const resolved = targets.map(target => resolveTwelveDataTarget(target, config)).flatMap(row => row.status === "resolved" ? [row.target] : []);
  const unique = [...new Map(resolved.map(target => [target.key, target])).values()];
  const read = collect ? requestTwelveDataEvidence : readTwelveDataEvidence;
  const inputs: TwelveDataCollectionInput[] = [
    ...unique.map(target => ({ kind: "live" as const, target })),
    // KRW-only holdings and cash-only accounts can also be viewed in USD.
    { kind: "fx" },
  ];
  const settled = await Promise.allSettled(inputs.map(input => read({ ...input, asOf: at, knownAt: at }, config)));
  const keys = inputs.map(input => {
    try { return getTwelveDataCollectionJobs([input], { ...config, isFresh: async () => false, persist: async () => "stale_claim" })[0]?.key; }
    catch { return undefined; }
  });
  const jobs = await readCollectionProgress(keys.filter((key): key is string => Boolean(key)));
  const items = settled.flatMap((result, index) => {
    if (result.status === "fulfilled" && result.value.status === "disabled") return [];
    const input = inputs[index], evidence = result.status === "fulfilled" ? result.value : null;
    const row = input.kind === "fx" ? evidence?.fx[0] : evidence?.prices[0];
    const value = row && ("rate" in row ? row.rate : row.value);
    const valid = Boolean(evidence && evidence.status !== "conflict" && Number.isFinite(Number(value)) && Number(value) > 0);
    const checkedAt = evidence?.checkedAt ?? row?.fetchedAt;
    const ttl = input.kind === "fx" ? config.storage?.fxFreshSeconds : config.storage?.quoteFreshSeconds;
    const freshAtStart = Boolean(checkedAt && ttl && Date.parse(checkedAt) >= Date.parse(startedAt) - ttl * 1000 && Date.parse(checkedAt) <= Date.now());
    return [refreshItem({ id: `twelve_data:${input.kind === "fx" ? "USD/KRW" : input.target.key}`, provider: "Twelve Data",
      label: input.kind === "fx" ? "USD/KRW" : input.target.ticker, startedAt, readAt: at,
      fresh: valid && (freshAtStart || evidence?.status === "admitted" && !evidence.refreshDue), valid,
      priceAsOf: row?.observedAt, checkedAt, job: jobs.find(job => job.key === keys[index]),
      supported: evidence?.status === "conflict" ? false : undefined })];
  });
  const results = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failed = settled.some(result => result.status === "rejected");
  return {
    items,
    failed,
    available: results.some(result => result.status !== "disabled"),
    pending: results.some(result => result.status === "missing" || result.status === "stale" || result.status === "admitted" && result.refreshDue),
    version: createHash("sha256").update(JSON.stringify([failed, results.map(result => [result.status, result.prices, result.fx])])).digest("hex"),
  };
}
