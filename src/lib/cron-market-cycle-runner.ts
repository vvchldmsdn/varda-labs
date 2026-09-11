import "server-only";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";
import { isProviderCollectionDeferred } from "@/lib/market-data/collection-policy";

import {
  buildCronMarketCyclePlan,
  CRON_MARKET_CYCLE_LIMITS,
  type CronCloseSyncGroup,
  type CronMarketCyclePlan,
} from "@/lib/cron-market-cycle";
import {
  claimCronMarketCycleRun,
  finishCronMarketCycleRun,
} from "@/lib/cron-market-cycle-run-repository";
import { runCoreMarketFactorRefreshJob } from "@/lib/market-data/core-market-factor-refresh-job";
import { runUsdKrwFxRefreshJob } from "@/lib/market-data/fx-refresh-job";
import { KisRefreshLeaseBusyError, withKisCollectionLeaseWait } from "@/lib/market-data/kis-refresh-lease";
import { runMarketPriceSync } from "@/lib/market-data/price-sync";
import {
  createKisMarketDataProvider,
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import type { MarketDataProvider } from "@/lib/market-data/providers/types";
import { safeErrorMessage } from "@/lib/redaction";
import { runDailySnapshotJob } from "@/lib/snapshots/daily-job";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

type CloseSyncSummary = {
  deferred: { code: "provider_budget_limited" | "provider_token_cooldown"; retryAfterSeconds: number } | null;
  groupCount: number;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  insertedCount: number;
  updatedCount: number;
  conflictCount: number;
  groups: Array<{
    market: string;
    expectedCloseDate: string;
    tickerCount: number;
    status: "completed" | "partial";
  }>;
};

type LiveSyncSummary = {
  status: "not_attempted" | "completed" | "partial" | "failed";
  expectedTargetCount: number;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  insertedCount: number;
  updatedCount: number;
  conflictCount: number;
};

type FactorSyncSummary = {
  status: "not_attempted" | "written" | "skipped" | "failed";
  candidateCount: number;
  insertedCount: number;
  skippedCount: number;
  latestCandidateDate: string | null;
};

export type CronMarketCycleRunResult = {
  ok: boolean;
  status:
    | "completed"
    | "no_action"
    | "blocked"
    | "failed"
    | "already_attempted"
    | "active_conflict"
    | "lock_busy";
  routeMode: "write";
  writesEnabled: true;
  secretsIncluded: false;
  runId: string | null;
  snapshotDate: string;
  fx: {
    status: "written" | "skipped" | "not_attempted" | "failed";
    rateDate: string | null;
    source: string | null;
  };
  factorSync: FactorSyncSummary;
  closeSync: CloseSyncSummary;
  liveSync: LiveSyncSummary;
  snapshot: {
    targetCount: number;
    writtenCount: number;
    blockedCount: number;
    failedCount: number;
  };
  blockers: string[];
};

type CronMarketCycleOptions = { now?: Date; cronScheduleUtc?: string | null };

export async function runCronMarketCycle(options: CronMarketCycleOptions = {}): Promise<CronMarketCycleRunResult> {
  // Include lease acquisition and planning in the retry window. The route has
  // 300 seconds; stop adding waits at 180 seconds to leave time for snapshots.
  const closeRetryDeadline = performance.now() + 180_000;
  // Drain even when today's cycle was already completed; preserve snapshot ordering.
  scheduleMarketCollection();
  try {
    // All close groups and the following live refresh share one internal lease.
    return await withKisCollectionLeaseWait(() => runMarketCycleWithLease({ ...options, closeRetryDeadline }));
  } catch (error) {
    if (error instanceof KisRefreshLeaseBusyError) {
      return emptyResult({
        ok: false, status: "active_conflict", runId: null,
        snapshotDate: resolveSnapshotCycle(options.now ?? new Date()).snapshotDate,
        blockers: ["kis_provider_refresh_busy"],
      });
    }
    throw error;
  }
}

async function runMarketCycleWithLease({
  now = new Date(),
  cronScheduleUtc = null,
  closeRetryDeadline,
}: {
  now?: Date;
  cronScheduleUtc?: string | null;
  closeRetryDeadline: number;
}): Promise<CronMarketCycleRunResult> {
  const snapshotDate = resolveSnapshotCycle(now).snapshotDate;
  const claim = await claimCronMarketCycleRun({
    snapshotDate,
    startedAt: now,
    cronScheduleUtc,
  });

  if (claim.outcome !== "claimed") {
    return emptyResult({
      ok: claim.outcome === "already_attempted" && claim.status === "completed",
      status: claim.outcome,
      runId: claim.runId,
      snapshotDate,
      blockers:
        claim.outcome === "already_attempted"
          ? [`cycle_already_attempted:${claim.status ?? "unknown"}`]
          : [claim.outcome],
    });
  }

  const runId = claim.runId;
  let fxSummary: CronMarketCycleRunResult["fx"] = {
    status: "not_attempted",
    rateDate: null,
    source: null,
  };
  let closeSync = emptyCloseSyncSummary();
  let liveSync = emptyLiveSyncSummary();
  let factorSync = emptyFactorSyncSummary();
  let kisProvider: MarketDataProvider | null = null;

  try {
    try {
      const factorResult = await runCoreMarketFactorRefreshJob({
        dryRun: false,
        now,
      });
      factorSync = {
        status: factorResult.insertedCount > 0 ? "written" : "skipped",
        candidateCount: factorResult.candidateCount,
        insertedCount: factorResult.insertedCount,
        skippedCount: factorResult.skippedCount,
        latestCandidateDate: factorResult.latestCandidateDate,
      };
    } catch {
      // Shared factor history is auxiliary research evidence and must not block snapshots.
      factorSync = { ...emptyFactorSyncSummary(), status: "failed" };
    }

    let { snapshotJob, plan, deferredBlockers } = await loadPlan(now);
    if (!plan.ok) {
      return finishBlocked({
        runId,
        snapshotDate,
        fxSummary,
        factorSync,
        closeSync,
        liveSync,
        plan,
        snapshotJob,
      });
    }

    if (plan.action === "sync_closes_then_snapshot") {
      const policy = getKisProviderPolicy();
      if (!policy.configured) {
        return finishBlocked({
          runId,
          snapshotDate,
          fxSummary,
          factorSync,
          closeSync,
          liveSync,
          plan: {
            ...plan,
            ok: false,
            action: "blocked",
            blockers: ["kis_provider_not_configured"],
          },
          snapshotJob,
        });
      }

      kisProvider = createKisMarketDataProvider();
      closeSync = await syncCloseGroups(plan.closeGroups, kisProvider, closeRetryDeadline);
      if (closeSync.deferred) {
        return finishBlocked({
          runId, snapshotDate, fxSummary, factorSync, closeSync, liveSync, snapshotJob,
          plan: { ...plan, ok: false, action: "blocked",
            blockers: ["close_sync_retry_window_exhausted", closeSync.deferred.code, ...deferredBlockers] },
        });
      }
      ({ snapshotJob, plan, deferredBlockers } = await loadPlan(now));
      if (!plan.ok || plan.action === "sync_closes_then_snapshot") {
        return finishBlocked({
          runId,
          snapshotDate,
          fxSummary,
          factorSync,
          closeSync,
          liveSync,
          plan: {
            ...plan,
            ok: false,
            action: "blocked",
            blockers: [
              ...plan.blockers,
              ...(plan.action === "sync_closes_then_snapshot"
                ? ["close_sync_incomplete"]
                : []),
            ],
          },
          snapshotJob,
        });
      }
    }

    if (plan.action === "no_action") {
      if (deferredBlockers.length > 0) {
        return finishBlocked({
          runId, snapshotDate, fxSummary, factorSync, closeSync, liveSync,
          plan: { ...plan, ok: false, action: "blocked", blockers: deferredBlockers },
          snapshotJob,
        });
      }
      const result = emptyResult({
        ok: true,
        status: "no_action",
        runId,
        snapshotDate,
        fx: fxSummary,
        factorSync,
        closeSync,
        liveSync,
      });
      await finishRun(result, "completed");
      return result;
    }

    // Persist independently admitted cutoff evidence before requesting today's
    // quotes. An unrelated live symbol/provider failure must not lose a day.
    const snapshotWrite = await runDailySnapshotJob({
      dryRun: false,
      snapshotDate,
      now: new Date(),
    });
    const snapshotSummary = {
      targetCount: snapshotWrite.targetCount,
      writtenCount: snapshotWrite.writtenCount,
      blockedCount: snapshotWrite.blockedCount,
      failedCount: snapshotWrite.failedCount,
    };

    if (!snapshotWrite.ok || snapshotWrite.writtenCount !== snapshotWrite.targetCount) {
      const result = emptyResult({
        ok: false,
        status: "blocked",
        runId,
        snapshotDate,
        fx: fxSummary,
        factorSync,
        closeSync,
        liveSync,
        snapshot: snapshotSummary,
        blockers: ["snapshot_write_incomplete", ...deferredBlockers],
      });
      await finishRun(result, "blocked");
      return result;
    }

    // FX rows are upserted by date. Refreshing before the snapshot can replace
    // the last observation from before 07:00 with an inadmissible later one.
    try {
      const fxResult = await runUsdKrwFxRefreshJob({
        dryRun: false,
        acceptExistingVardaRow: true,
      });
      if (fxResult.status === "planned" || fxResult.status === "blocked") {
        fxSummary = { status: "failed", rateDate: null, source: null };
      } else {
        fxSummary = {
          status: fxResult.status,
          rateDate: fxResult.candidate.rateDate,
          source: fxResult.candidate.source,
        };
      }
    } catch {
      fxSummary = { status: "failed", rateDate: null, source: null };
    }

    if (getKisProviderPolicy().configured) {
      try {
        kisProvider ??= createKisMarketDataProvider();
        liveSync = await syncLiveQuotes(kisProvider);
      } catch {
        liveSync = { ...emptyLiveSyncSummary(), status: "failed" };
      }
    }

    const result = emptyResult({
      ok: true,
      status: "completed",
      runId,
      snapshotDate,
      fx: fxSummary,
      factorSync,
      closeSync,
      liveSync,
      snapshot: snapshotSummary,
    });
    await finishRun(result, "completed");
    return result;
  } catch (error) {
    const safeError = safeErrorMessage(error, "Cron market cycle failed");
    const result = emptyResult({
      ok: false,
      status: "failed",
      runId,
      snapshotDate,
      fx: fxSummary,
      factorSync,
      closeSync,
      liveSync,
      blockers: ["unexpected_market_cycle_error"],
    });
    try {
      await finishRun(result, "failed", safeError);
    } catch {
      // Preserve the original sanitized failure response when finalization fails.
    }
    return result;
  }
}

async function loadPlan(now: Date) {
  const snapshotJob = await runDailySnapshotJob({ dryRun: true, now });
  // Invalid evidence belongs to its tenant. Keep those failures in the job
  // report while allowing other owners' independently checked snapshots to run.
  const targetPlans = snapshotJob.targets.map((target) => ({
    target,
    plan: buildCronMarketCyclePlan({
      snapshotJob: { ...snapshotJob, targetCount: 1,
        failedCount: target.status === "failed" ? 1 : 0, targets: [target] },
      kisCooldownActive: false,
    }),
  }));
  const eligible = targetPlans.filter(({ plan }) => plan.ok).map(({ target }) => target);
  const isolateTargets = eligible.length > 0 && eligible.length < snapshotJob.targets.length;
  return {
    snapshotJob,
    deferredBlockers: [...new Set(targetPlans.filter(({ plan }) => !plan.ok).flatMap(({ plan }) => plan.blockers))].sort(),
    plan: buildCronMarketCyclePlan({
      snapshotJob: isolateTargets
        ? { ...snapshotJob, targetCount: eligible.length, failedCount: 0, targets: eligible }
        : snapshotJob,
      // This path already owns the collection lease. Each KIS HTTP call still
      // consumes the durable budget; legacy whole-job idle time does not apply.
      kisCooldownActive: false,
    }),
  };
}

async function syncCloseGroups(
  groups: CronCloseSyncGroup[],
  provider: MarketDataProvider,
  retryDeadline: number,
) {
  const summary = emptyCloseSyncSummary();
  let retries = 0;

  for (const group of groups) {
    const syncGroup = () => runMarketPriceSync({
      mode: "close",
      dryRun: false,
      fixture: false,
      priceDate: group.expectedCloseDate,
      provider,
      targetFilter: {
        market: group.market,
        tickers: group.tickers,
      },
    });
    let result: Awaited<ReturnType<typeof syncGroup>>;
    while (true) {
      try {
        result = await syncGroup();
        break;
      } catch (error) {
        if (!isProviderCollectionDeferred(error)) throw error;
        const retryAfterSeconds = Math.max(1, Math.ceil(Number(error.retryAfterSeconds)));
        const deferred = {
          code: "code" in error && error.code === "provider_token_cooldown"
            ? "provider_token_cooldown" as const : "provider_budget_limited" as const,
          retryAfterSeconds,
        };
        const waitMs = retryAfterSeconds * 1_000;
        if (retries >= 4 || performance.now() + waitMs >= retryDeadline) {
          summary.deferred = deferred;
          return summary;
        }
        // Only replay the unfinished close group. Price sync persists rows after
        // the provider batch completes; earlier groups and financial writes are
        // never replayed. All attempts still reserve the normal durable budget.
        retries += 1;
        await delay(waitMs);
        if (performance.now() >= retryDeadline) {
          summary.deferred = deferred;
          return summary;
        }
      }
    }
    const complete =
      result.requestedCount === group.tickers.length &&
      result.successCount === result.requestedCount &&
      result.failedCount === 0 &&
      result.conflictCount === 0;

    summary.groupCount += 1;
    summary.requestedCount += result.requestedCount;
    summary.successCount += result.successCount;
    summary.failedCount += result.failedCount;
    summary.skippedCount += result.skippedCount;
    summary.insertedCount += result.insertedCount;
    summary.updatedCount += result.updatedCount;
    summary.conflictCount += result.conflictCount;
    summary.groups.push({
      market: group.market,
      expectedCloseDate: group.expectedCloseDate,
      tickerCount: group.tickers.length,
      status: complete ? "completed" : "partial",
    });
  }

  return summary;
}

async function syncLiveQuotes(provider: MarketDataProvider): Promise<LiveSyncSummary> {
  const result = await runMarketPriceSync({
    mode: "live",
    dryRun: false,
    fixture: false,
    provider,
    targetLimit: CRON_MARKET_CYCLE_LIMITS.maxLiveTargetsPerCycle,
  });
  const expectedTargetCount = result.targetFilterSummary.filteredPriceTargetCount;
  const complete =
    expectedTargetCount <= CRON_MARKET_CYCLE_LIMITS.maxLiveTargetsPerCycle &&
    result.requestedCount === expectedTargetCount &&
    result.successCount === result.requestedCount &&
    result.failedCount === 0 &&
    result.skippedCount === 0 &&
    result.conflictCount === 0 &&
    result.insertedCount + result.updatedCount === result.requestedCount;

  return {
    status: complete ? "completed" : "partial",
    expectedTargetCount,
    requestedCount: result.requestedCount,
    successCount: result.successCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    conflictCount: result.conflictCount,
  };
}

async function finishBlocked({
  runId,
  snapshotDate,
  fxSummary,
  factorSync,
  closeSync,
  liveSync,
  plan,
  snapshotJob,
}: {
  runId: string;
  snapshotDate: string;
  fxSummary: CronMarketCycleRunResult["fx"];
  factorSync: FactorSyncSummary;
  closeSync: CloseSyncSummary;
  liveSync: LiveSyncSummary;
  plan: CronMarketCyclePlan;
  snapshotJob: Awaited<ReturnType<typeof runDailySnapshotJob>>;
}) {
  const result = emptyResult({
    ok: false,
    status: "blocked",
    runId,
    snapshotDate,
    fx: fxSummary,
    factorSync,
    closeSync,
    liveSync,
    snapshot: {
      targetCount: snapshotJob.targetCount,
      writtenCount: 0,
      blockedCount: snapshotJob.blockedCount,
      failedCount: snapshotJob.failedCount,
    },
    blockers: [...new Set(plan.blockers)].sort(),
  });
  await finishRun(result, "blocked");
  return result;
}

async function finishRun(
  result: CronMarketCycleRunResult,
  status: "completed" | "blocked" | "failed",
  error: string | null = null,
) {
  if (!result.runId) return;
  await finishCronMarketCycleRun({
    runId: result.runId,
    status,
    finishedAt: new Date(),
    requestedCount:
      result.closeSync.requestedCount + result.liveSync.requestedCount,
    successCount: result.closeSync.successCount + result.liveSync.successCount,
    failedCount:
      result.closeSync.failedCount +
      result.liveSync.failedCount +
      result.snapshot.failedCount,
    skippedCount: result.closeSync.skippedCount + result.liveSync.skippedCount,
    metadata: {
      snapshotDate: result.snapshotDate,
      phase: status,
      outcome: result.status,
      fx: result.fx,
      factorSync: result.factorSync,
      closeSync: result.closeSync,
      liveSync: result.liveSync,
      snapshot: result.snapshot,
      blockers: result.blockers,
    },
    error,
  });
}

function emptyResult(
  overrides: Partial<CronMarketCycleRunResult> &
    Pick<CronMarketCycleRunResult, "ok" | "status" | "snapshotDate">,
): CronMarketCycleRunResult {
  return {
    ok: overrides.ok,
    status: overrides.status,
    routeMode: "write",
    writesEnabled: true,
    secretsIncluded: false,
    runId: overrides.runId ?? null,
    snapshotDate: overrides.snapshotDate,
    fx: overrides.fx ?? {
      status: "not_attempted",
      rateDate: null,
      source: null,
    },
    factorSync: overrides.factorSync ?? emptyFactorSyncSummary(),
    closeSync: overrides.closeSync ?? emptyCloseSyncSummary(),
    liveSync: overrides.liveSync ?? emptyLiveSyncSummary(),
    snapshot: overrides.snapshot ?? {
      targetCount: 0,
      writtenCount: 0,
      blockedCount: 0,
      failedCount: 0,
    },
    blockers: overrides.blockers ?? [],
  };
}

function emptyCloseSyncSummary(): CloseSyncSummary {
  return {
    deferred: null,
    groupCount: 0,
    requestedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    conflictCount: 0,
    groups: [],
  };
}

function emptyLiveSyncSummary(): LiveSyncSummary {
  return {
    status: "not_attempted",
    expectedTargetCount: 0,
    requestedCount: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    conflictCount: 0,
  };
}

function emptyFactorSyncSummary(): FactorSyncSummary {
  return {
    status: "not_attempted",
    candidateCount: 0,
    insertedCount: 0,
    skippedCount: 0,
    latestCandidateDate: null,
  };
}
