import "server-only";
import { after } from "next/server";
import { cache } from "react";
import { drainTwelveDataCollection, enqueueTwelveDataCollection, resolveTwelveDataJobInput, type TwelveDataCollectionConfig } from "./twelve-data-collection";
import { queryTwelveDataEvidence, queryTwelveDataHistoricalFx, queryTwelveDataSplitRisk, persistTwelveDataEvidence, type TwelveDataHistoricalFxQuery, type TwelveDataEvidenceQuery, type TwelveDataSplitRiskQuery } from "./twelve-data-store";
import { getTwelveDataServerConfig, twelveDataConfigAllows, type TwelveDataServiceConfig } from "./twelve-data-config";
import { MARKET_COLLECTION_POLICY } from "./collection-policy";
import { twelveDataExchangeDate } from "./providers/twelve-data-contract";
export { getTwelveDataServerConfig } from "./twelve-data-config";
export { resolveTwelveDataTarget, getTwelveDataCompletedHistoryWindow } from "./twelve-data-identity";
export type { TwelveDataServiceConfig } from "./twelve-data-config";
export type { TwelveDataEvidence, TwelveDataEvidenceQuery, ProviderStoredPrice, ProviderStoredFx, ProviderStoredHistoricalFx, ProviderStoredAction, TwelveDataHistoricalFxQuery, TwelveDataHistoricalFxEvidence } from "./twelve-data-store";

export const readTwelveDataEvidence = queryTwelveDataEvidence;
export const readTwelveDataHistoricalFx = queryTwelveDataHistoricalFx;
export const readTwelveDataSplitRisk = queryTwelveDataSplitRisk;

/** Today uses an action-only job: never request an unfinished daily price bar. */
export async function requestTwelveDataSplitRisk(query: TwelveDataSplitRiskQuery, config?: TwelveDataServiceConfig) {
  const risk = await readTwelveDataSplitRisk(query, config);
  if (!(risk.status === "unknown" || risk.status === "provisional" && risk.refreshDue) || !twelveDataConfigAllows(config, "us_daily_raw")) return risk;
  try {
    const actionsOnly = risk.status === "provisional" || query.endDate === twelveDataExchangeDate(new Date());
    const queued = await enqueueTwelveDataCollection([{ kind: "history", target: query.target, startDate: query.startDate, endDate: query.endDate, ...(actionsOnly ? { actionsOnly: true } : {}) }], worker(config));
    if (queued.queuedCount) scheduleTwelveDataService(config);
  }
  catch { /* Missing/failed/unbounded coverage remains unavailable. */ }
  return risk;
}

function worker(config?: TwelveDataServiceConfig): TwelveDataCollectionConfig | undefined {
  if (!config || !(["us_quote", "us_daily_raw", "usd_krw", "usd_krw_history"] as const).some(dataset => twelveDataConfigAllows(config, dataset))) return undefined;
  const collection: TwelveDataCollectionConfig = { ...config,
    persist: (job, payload) => persistTwelveDataEvidence(job, payload, config),
    isFresh: async job => {
      const input = resolveTwelveDataJobInput(job, collection);
      if (input.kind === "history" && input.actionsOnly) {
        const risk = await readTwelveDataSplitRisk({ target: input.target, startDate: input.startDate!, endDate: input.endDate!, asOf: new Date().toISOString() }, config);
        if (risk.status === "conflict") throw new Error("twelve_data_provenance_conflict");
        return risk.status === "admitted" || risk.status === "provisional" && !risk.refreshDue;
      }
      const result = await queryTwelveDataEvidence({ ...input, asOf: new Date().toISOString() }, config);
      // A quarantined identity requires operator review, not automatic last-writer-wins replacement.
      if (result.status === "conflict") throw new Error("twelve_data_provenance_conflict");
      if (input.kind === "history" && twelveDataConfigAllows(config, "us_splits")) {
        const splits = await readTwelveDataSplitRisk({ target: input.target, startDate: input.startDate!, endDate: input.endDate!, asOf: new Date().toISOString() }, config);
        if (splits.status === "conflict") throw new Error("twelve_data_provenance_conflict");
        if (splits.status !== "admitted") return false;
      }
      return result.status === "admitted" && !result.refreshDue && (input.kind !== "history" || result.corporateActionCoverage === "complete" ||
        !twelveDataConfigAllows(config, "us_splits") || !twelveDataConfigAllows(config, "us_dividends"));
    },
  };
  return collection;
}

/** Demand enqueues shared work; no request handler calls the vendor inline. */
export async function requestTwelveDataEvidence(query: TwelveDataEvidenceQuery, config?: TwelveDataServiceConfig) {
  const evidence = await readTwelveDataEvidence(query, config);
  if (evidence.status === "disabled" || evidence.status === "conflict" || evidence.status === "admitted" && !evidence.refreshDue) return { ...evidence, queuedCount: 0 };
  const input = query.kind === "fx" ? { kind: "fx" as const, requestedAt: query.requestedAt } : { kind: query.kind, target: query.target!, startDate: query.startDate, endDate: query.endDate };
  const queued = await enqueueTwelveDataCollection([input], worker(config));
  if (queued.queuedCount) scheduleTwelveDataService(config);
  return { ...evidence, queuedCount: queued.queuedCount };
}

/** Bounded demand for exactly dated observations; queued work survives response/process interruption. */
export async function requestTwelveDataHistoricalFx(query: TwelveDataHistoricalFxQuery, config?: TwelveDataServiceConfig) {
  const evidence = await readTwelveDataHistoricalFx(query, config);
  if (evidence.status === "disabled" || !evidence.missingAt.length) return { ...evidence, queuedCount: 0 };
  const inputs = evidence.missingAt.slice(0, MARKET_COLLECTION_POLICY.maximumEnqueueTargets).map(requestedAt => ({ kind: "fx" as const, requestedAt }));
  const queued = await enqueueTwelveDataCollection(inputs, worker(config));
  if (queued.queuedCount) scheduleTwelveDataService(config);
  return { ...evidence, queuedCount: queued.queuedCount };
}

/** Existing durable queue, leases and atomic budget; deliberately no public route or cron activation. */
export function drainTwelveDataService(config?: TwelveDataServiceConfig) {
  return drainTwelveDataCollection(worker(config));
}

/** Existing authenticated worker/cron trigger may resume this partition independently of KIS. */
export function resumeConfiguredTwelveDataService(config: TwelveDataServiceConfig | undefined = getTwelveDataServerConfig()) {
  return drainTwelveDataService(config);
}

/** Same after-response pattern as the KIS worker; no cron or external call in the response path. */
export const scheduleTwelveDataService = cache((config?: TwelveDataServiceConfig) => {
  if (!worker(config)) return;
  after(async () => {
    try { await drainTwelveDataService(config); } catch { /* Durable jobs and fenced claims survive interruption. */ }
  });
});
