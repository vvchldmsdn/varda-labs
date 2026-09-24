import "server-only";
import { createHash } from "node:crypto";
import { claimMarketCollection, enqueueProviderCollectionJobs, finishMarketCollection, hasReadyMarketCollection,
  isMarketCollectionClaimCurrent, maintainMarketCollection, type ClaimedCollectionJob } from "@/lib/market-data/collection-queue";
import { collectionRetrySeconds, MARKET_COLLECTION_POLICY, normalizeCollectionJobs, type CollectionJob } from "@/lib/market-data/collection-policy";
import { assertTwelveDataBudgetPolicy, coolDownTwelveData, markTwelveDataSuccess, reserveTwelveDataRequest,
  twelveDataBudgetScope, twelveDataReservationId, type TwelveDataBudgetPolicy, type TwelveDataReservationResult } from "@/lib/market-data/twelve-data-budget";
import { createTwelveDataMarketDataProvider, twelveDataAccessError, type TwelveDataOptions } from "@/lib/market-data/providers/twelve-data";
import { assertDateWindow, assertActionDateWindow, resolveTwelveDataListing, TWELVE_DATA_CONTRACT_VERSION, type TwelveDataDataset, type TwelveDataFxRate,
  type TwelveDataActionCoverage, type TwelveDataListing, type TwelveDataProvenance, type TwelveDataHistoricalFxRate } from "@/lib/market-data/providers/twelve-data-contract";
import type { ClosePrice, LiveQuote, PriceLookupTarget } from "@/lib/market-data/providers/types";

export type TwelveDataCollectionInput = { kind: "fx"; requestedAt?: string } | {
  kind: "live" | "history"; target: PriceLookupTarget; startDate?: string; endDate?: string; actionsOnly?: boolean;
};
export type TwelveDataCollectionPayload =
  { dataset: "us_quote"; target: PriceLookupTarget; listing: TwelveDataListing; rows: Array<LiveQuote & { provenance: TwelveDataProvenance }> } |
  { dataset: "us_daily_raw"; target: PriceLookupTarget; listing: TwelveDataListing; rows: Array<ClosePrice & { provenance: TwelveDataProvenance }>; actions?: TwelveDataActionCoverage[]; actionsOnly?: boolean } |
  { dataset: "usd_krw"; rate: TwelveDataFxRate } |
  { dataset: "usd_krw_history"; rate: TwelveDataHistoricalFxRate };
export type TwelveDataCollectionConfig = {
  provider: Omit<Extract<TwelveDataOptions, { mode: "live" }>, "reserve">;
  budget: TwelveDataBudgetPolicy;
  /** Must read by provider/license scope/MIC/session/adjustment/as-of; never a legacy ticker-only cache. */
  isFresh: (job: CollectionJob) => Promise<boolean>;
  /** Must check job.claimToken in the SAME transaction as an idempotent provenance-preserving write. */
  persist: (job: ClaimedCollectionJob, payload: TwelveDataCollectionPayload) => Promise<"written" | "stale_claim" | "conflict">;
};

const datasets = { live: "us_quote", history: "us_daily_raw", fx: "usd_krw" } as const;
export const twelveDataCollectionDataset = (input: TwelveDataCollectionInput): TwelveDataDataset => input.kind === "fx" && input.requestedAt ? "usd_krw_history" : datasets[input.kind];
const denyReservation = async () => false;

/** No config discovery and no fallback route: an unconfigured deployment does not even touch the queue. */
export async function enqueueTwelveDataCollection(inputs: readonly TwelveDataCollectionInput[], config?: TwelveDataCollectionConfig) {
  if (!enabled(config)) return { status: "disabled" as const, queuedCount: 0 };
  const jobs = getTwelveDataCollectionJobs(inputs, config);
  const result = await enqueueProviderCollectionJobs(partition(config), jobs);
  return { status: "queued" as const, ...result };
}

/** Explicit server worker seam, intentionally not scheduled by an existing cron or HTTP route. */
export async function drainTwelveDataCollection(config?: TwelveDataCollectionConfig) {
  let processed = 0, failed = 0, cacheHits = 0;
  if (!enabled(config)) return { status: "disabled" as const, processed, failed, cacheHits };
  const scope = partition(config), budgetScope = twelveDataBudgetScope(config.provider.apiKey);
  if (!await hasReadyMarketCollection(scope)) return { status: "idle" as const, processed, failed, cacheHits };
  await maintainMarketCollection(scope);
  const deadline = Date.now() + MARKET_COLLECTION_POLICY.workerBudgetMs;
  while (processed < MARKET_COLLECTION_POLICY.maximumWorkerJobs && Date.now() < deadline - 9_000) {
    const job = await claimMarketCollection(scope);
    if (!job) break;
    let deferred = false, retryAfterSeconds = collectionRetrySeconds(job.attempts, 0), code = "provider_unavailable", ok = false;
    let slot = 0, reservation: TwelveDataReservationResult | null = null;
    try {
      const input = resolveTwelveDataJobInput(job, config), dataset = twelveDataCollectionDataset(input);
      if (twelveDataAccessError({ ...config.provider, reserve: denyReservation }, dataset, new Date())) throw new Error("twelve_data_release_not_authorized");
      if (!await isMarketCollectionClaimCurrent(job)) throw new Error("twelve_data_stale_claim");
      if (await config.isFresh(job)) { ok = true; code = "cache_fresh"; cacheHits++; }
      else {
        const provider = createTwelveDataMarketDataProvider({ ...config.provider, reserve: async (cost) => {
          if (Date.now() >= deadline - 9_000 || !await isMarketCollectionClaimCurrent(job)) return false;
          reservation = await reserveTwelveDataRequest(budgetScope, twelveDataReservationId(job.claimToken, slot++), cost, config.budget);
          return reservation.status === "granted";
        } });
        const now = new Date();
        let payload: TwelveDataCollectionPayload;
        if (input.kind === "fx") {
          if (input.requestedAt) {
            const result = await provider.fetchHistoricalUsdKrwRate(new Date(input.requestedAt), now);
            if (!result.rate) throw new Error(result.error ?? "twelve_data_empty_result");
            payload = { dataset: "usd_krw_history", rate: result.rate };
          } else {
            const result = await provider.fetchUsdKrwRate(now);
            if (!result.rate) throw new Error(result.error ?? "twelve_data_empty_result");
            payload = { dataset: "usd_krw", rate: result.rate };
          }
        } else if (input.kind === "live") {
          const result = await provider.fetchLiveQuotes([input.target], { requestedAt: now, dryRun: false, fixture: false, mode: "live", priceDate: now.toISOString().slice(0, 10) });
          if (result.rows.length !== 1 || result.rows[0].status !== "ok") throw new Error(result.rows[0]?.error ?? "twelve_data_empty_result");
          payload = { dataset: "us_quote", target: input.target, listing: resolveTwelveDataListing(input.target, config.provider.listings), rows: result.rows as Array<LiveQuote & { provenance: TwelveDataProvenance }> };
        } else {
          const result = input.actionsOnly ? null : await provider.fetchHistoricalClosePrices!([input.target], { requestedAt: now, dryRun: false, startDate: job.startDate!, endDate: job.endDate! });
          if (result && (!result.rows.length || result.failures.length)) throw new Error(result.failures[0]?.error ?? "twelve_data_empty_result");
          payload = { dataset: "us_daily_raw", target: input.target, listing: resolveTwelveDataListing(input.target, config.provider.listings), rows: (result?.rows ?? []) as Array<ClosePrice & { provenance: TwelveDataProvenance }>, ...(input.actionsOnly ? { actionsOnly: true } : {}) };
          payload.actions = [];
          for (const type of ["split", "dividend"] as const) {
            const actionDataset = type === "split" ? "us_splits" : "us_dividends";
            if (twelveDataAccessError({ ...config.provider, reserve: denyReservation }, actionDataset, now)) continue;
            const actionResult = await provider.fetchCorporateActions(input.target, type, job.startDate!, job.endDate!, now);
            if (!actionResult.coverage) throw new Error(actionResult.error ?? "twelve_data_action_values_invalid");
            payload.actions.push(actionResult.coverage);
          }
        }
        assertWritableProvenance(payload, config);
        if (!await isMarketCollectionClaimCurrent(job)) throw new Error("twelve_data_stale_claim");
        const persisted = await config.persist(job, payload);
        if (persisted === "conflict") throw new Error("twelve_data_provenance_conflict");
        if (persisted !== "written") throw new Error("twelve_data_stale_claim");
        ok = true; code = "collected";
        await markTwelveDataSuccess(budgetScope);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const lastReservation = reservation as TwelveDataReservationResult | null;
      if (/budget_limited|budget_unavailable|stale_claim/.test(message)) {
        deferred = true; code = "provider_budget_wait";
        retryAfterSeconds = Math.max(10, lastReservation?.retryAfterSeconds ?? 60);
      } else if (/rate_limited|transport_failed|auth_failed/.test(message)) {
        const failure = message.includes("auth_failed") ? "auth_failed" : message.includes("rate_limited") ? "rate_limited" : "transport_error";
        retryAfterSeconds = Math.max(retryAfterSeconds, await coolDownTwelveData(budgetScope, failure));
        code = failure;
      } else if (/authorized|listing|identity|provenance/.test(message)) code = "capability_unavailable";
    }
    await finishMarketCollection(job, { ok, deferred, code, retryAfterSeconds: ok ? 0 : Math.min(3600, retryAfterSeconds) });
    processed++; if (!ok) failed++;
    // No inner retries; the existing durable queue owns bounded attempts and fair backoff.
    if (!ok) break;
  }
  return { status: "completed" as const, processed, failed, cacheHits };
}

function enabled(config: TwelveDataCollectionConfig | undefined): config is TwelveDataCollectionConfig {
  if (!config || config.provider?.mode !== "live" || typeof config.isFresh !== "function" || typeof config.persist !== "function") return false;
  assertTwelveDataBudgetPolicy(config.budget);
  return ([...Object.values(datasets), "usd_krw_history"] as TwelveDataDataset[]).some((dataset) =>
    twelveDataAccessError({ ...config.provider, reserve: denyReservation }, dataset, new Date()) === null);
}

function partition(config: TwelveDataCollectionConfig) {
  const p = config.provider;
  const scopeHash = hash([twelveDataBudgetScope(p.apiKey), p.audience, p.license.cacheScope, p.license.reference, p.license.quoteDelay]);
  return { provider: "twelve_data" as const, scopeHash };
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function jobKey(job: Omit<CollectionJob, "key">, target: PriceLookupTarget | null, config: TwelveDataCollectionConfig, requestedAt?: string, actionsOnly = false) {
  const listing = target ? resolveTwelveDataListing(target, config.provider.listings) : null;
  const identity = listing ? [listing.instrumentKey, listing.symbol, listing.micCode, listing.exchange, listing.type, listing.exchangeTimezone] : ["USD", "KRW"];
  if (requestedAt) return `twelve_data:${partition(config).scopeHash}:usd_krw_history:${Date.parse(requestedAt)}:${hash([identity, requestedAt])}`;
  return `twelve_data:${partition(config).scopeHash}:${actionsOnly ? "us_actions" : datasets[job.kind]}:${hash([identity, job.startDate, job.endDate])}`;
}
export function getTwelveDataCollectionJobs(inputs: readonly TwelveDataCollectionInput[], config: TwelveDataCollectionConfig) {
  if (inputs.length > MARKET_COLLECTION_POLICY.maximumEnqueueTargets) throw new Error("collection_target_limit");
  const jobs = new Map<string, CollectionJob>();
  for (const input of inputs) {
    if (!["live", "history", "fx"].includes(input.kind) || twelveDataAccessError({ ...config.provider, reserve: denyReservation }, twelveDataCollectionDataset(input), new Date())) {
      throw new Error("twelve_data_capability_unavailable");
    }
    const target = input.kind === "fx" ? null : input.target;
    const requestedAt = input.kind === "fx" && input.requestedAt ? normalizeHistoricalFxInstant(input.requestedAt) : undefined;
    if (target) resolveTwelveDataListing(target, config.provider.listings);
    const normalized = normalizeCollectionJobs([{ kind: input.kind, ticker: target?.ticker ?? "USD", market: "us", currency: "USD",
      ...(input.kind === "history" ? { startDate: input.startDate, endDate: input.endDate } : {}) }]);
    for (const source of normalized) {
      const actionsOnly = input.kind === "history" && input.actionsOnly === true;
      if (source.kind === "history") (actionsOnly ? assertActionDateWindow : assertDateWindow)(source.startDate!, source.endDate!, new Date());
      if (actionsOnly && twelveDataAccessError({ ...config.provider, reserve: denyReservation }, "us_splits", new Date())) throw new Error("twelve_data_capability_unavailable");
      const job = { ...source, key: jobKey(source, target, config, requestedAt, actionsOnly) };
      jobs.set(job.key, job);
    }
  }
  return [...jobs.values()];
}
export function resolveTwelveDataJobInput(job: CollectionJob, config: TwelveDataCollectionConfig): TwelveDataCollectionInput {
  if (job.kind === "fx") {
    const encoded = job.key.match(/:usd_krw_history:(\d{1,13}):[a-f0-9]{64}$/);
    const requestedAt = encoded ? normalizeHistoricalFxInstant(new Date(Number(encoded[1])).toISOString()) : undefined;
    if (job.market !== "us" || job.currency !== "USD" || job.ticker !== "USD" || job.startDate !== null || job.endDate !== null || jobKey(job, null, config, requestedAt) !== job.key) throw new Error("twelve_data_identity_invalid");
    return { kind: "fx", ...(requestedAt ? { requestedAt } : {}) };
  }
  const actionsOnly = job.kind === "history" && job.key.includes(":us_actions:");
  const candidates = config.provider.listings.filter((listing) => listing.ticker === job.ticker).map((listing): PriceLookupTarget => ({
    key: listing.instrumentKey, ticker: listing.ticker, market: "us", currency: "USD", authority: "explicit_instrument", accounts: [], assetIds: [], assetNames: [],
  })).filter((target) => jobKey(job, target, config, undefined, actionsOnly) === job.key);
  if (candidates.length !== 1 || job.market !== "us" || job.currency !== "USD") throw new Error("twelve_data_identity_invalid");
  return { kind: job.kind, target: candidates[0], ...(job.kind === "history" ? { startDate: job.startDate!, endDate: job.endDate!, ...(actionsOnly ? { actionsOnly: true } : {}) } : {}) };
}
export function assertWritableProvenance(payload: TwelveDataCollectionPayload, config: TwelveDataCollectionConfig) {
  const records = "rate" in payload ? [payload.rate] : payload.rows;
  const actionsOnly = payload.dataset === "us_daily_raw" && payload.actionsOnly === true;
  if (actionsOnly && (records.length || !payload.actions?.some(coverage => coverage.type === "split"))) throw new Error("twelve_data_provenance_invalid");
  if ((!records.length && !actionsOnly) || records.some((record) => {
    const p = record.provenance;
    return !p || p.contractVersion !== TWELVE_DATA_CONTRACT_VERSION || p.synthetic || p.source !== "twelve_data" ||
      p.licenseScope !== config.provider.license.cacheScope || p.dataset !== payload.dataset ||
      !(p.fetchedAt instanceof Date) || !Number.isFinite(p.fetchedAt.getTime()) || p.fetchedAt.getTime() > Date.now();
  })) throw new Error("twelve_data_provenance_invalid");
  if ("rate" in payload) {
    const { rate } = payload;
    if (rate.baseCurrency !== "USD" || rate.quoteCurrency !== "KRW" || rate.provenance.priceBasis !== "fx_rate" ||
      rate.provenance.adjustment !== "not_applicable" || rate.provenance.session !== "not_applicable" ||
      !(rate.observedAt instanceof Date) || rate.observedAt.getTime() !== rate.provenance.observedAt?.getTime() ||
      rate.fetchedAt.getTime() !== rate.provenance.fetchedAt.getTime()) throw new Error("twelve_data_provenance_invalid");
    if (payload.dataset === "usd_krw_history" && (normalizeHistoricalFxInstant(payload.rate.requestedAt.toISOString()) !== payload.rate.requestedAt.toISOString() || payload.rate.observedAt > payload.rate.requestedAt)) throw new Error("twelve_data_provenance_invalid");
    return;
  }
  if (payload.rows.some((row) => row.ticker !== payload.target.ticker || row.market !== "us" || row.currency !== "USD" ||
      row.status !== "ok" || row.source !== "twelve_data" || row.provenance.session !== "regular")) throw new Error("twelve_data_identity_invalid");
  if (payload.dataset === "us_daily_raw" && payload.rows.some((row) => row.provenance.priceBasis !== "raw_close" ||
      row.provenance.adjustment !== "none" || row.provenance.observedAt !== null || row.provenance.exchangeDate !== row.priceDate ||
      row.adjustedClosePrice !== null || row.adjustedCloseBasis !== null || row.closePriceKrw !== null || row.fxRate !== null || row.isSample)) {
    throw new Error("twelve_data_provenance_invalid");
  }
  if (payload.dataset === "us_daily_raw" && payload.actions?.some((coverage) => coverage.synthetic || coverage.source !== "twelve_data" ||
      coverage.licenseScope !== config.provider.license.cacheScope || !(coverage.fetchedAt instanceof Date) || !Number.isFinite(coverage.fetchedAt.getTime()) || coverage.fetchedAt.getTime() > Date.now())) {
    throw new Error("twelve_data_provenance_invalid");
  }
  if (payload.dataset === "us_quote" && payload.rows.some((row) => row.provenance.priceBasis !== "provider_quote_close" ||
      row.provenance.adjustment !== "not_applicable" || !(row.priceAsOf instanceof Date) || !Number.isFinite(row.priceAsOf.getTime()) ||
      row.priceAsOf.getTime() > row.fetchedAt.getTime())) throw new Error("twelve_data_provenance_invalid");
}

/** Date parameter precision is seconds; do not manufacture sub-second observations. */
export function normalizeHistoricalFxInstant(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time < Date.UTC(1970, 0, 1) || time > Date.now()) throw new Error("twelve_data_fx_request_time_invalid");
  return new Date(Math.floor(time / 1000) * 1000).toISOString();
}
