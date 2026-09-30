import "server-only";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";
import { isProviderCollectionDeferred } from "@/lib/market-data/collection-policy";

import {
  buildCronMarketCyclePlan,
  resolveCronCutoffPreparation,
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
import { runNativeDailySnapshotJob } from "@/lib/snapshots/native-daily-job";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { snapshotDeadline } from "@/lib/snapshots/write-context";

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
    | "prepared"
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
  phase?: "pre_cutoff";
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
  nativeSnapshot?: Awaited<ReturnType<typeof runNativeDailySnapshotJob>> | { status: "failed" };
};

type CronMarketCycleOptions = { now?: Date; cronScheduleUtc?: string | null };

export async function runCronMarketCycle(options: CronMarketCycleOptions = {}): Promise<CronMarketCycleRunResult> {
  return snapshotDeadline.run(Date.now()+260000,()=>runCronMarketCycleWithinDeadline(options));
}
async function runCronMarketCycleWithinDeadline(options: CronMarketCycleOptions): Promise<CronMarketCycleRunResult> {
  // Include lease acquisition and planning in the retry window. The route has
  // 300 seconds; stop adding waits at 180 seconds to leave time for snapshots.
  const closeRetryDeadline = performance.now() + 180_000;
  const now = options.now ?? new Date();
  const preparation = resolveCronCutoffPreparation(now);
  if (preparation) return runCutoffPreparation({ ...options, now, ...preparation });
  const snapshotDate = resolveSnapshotCycle(now).snapshotDate;
  const claim = await claimCronMarketCycleRun({
    snapshotDate,
    startedAt: now,
    cronScheduleUtc:options.cronScheduleUtc ?? null,
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

  const runId=claim.runId;
  // Drain even when today's cycle was already completed; preserve snapshot ordering.
  scheduleMarketCollection();
  // Freeze native cutoff valuation before shared FX upserts. Its policy is unchanged.
  const nativeSnapshot = await runNativeDailySnapshotJob({ dryRun: false, durable:true, snapshotDate }).catch(() => ({ status: "failed" as const }));
  let result: CronMarketCycleRunResult;
  try {
    // All close groups and the following live refresh share one internal lease.
    result = await withKisCollectionLeaseWait(() => runMarketCycleWithLease({ ...options, now, runId, snapshotDate, closeRetryDeadline }));
  } catch (error) {
    if (error instanceof KisRefreshLeaseBusyError) {
      result = emptyResult({
        ok: false, status: "blocked", runId, snapshotDate,
        blockers: ["kis_provider_refresh_busy"],
      });
    } else result=emptyResult({ok:false,status:"failed",runId,snapshotDate,blockers:["unexpected_market_cycle_error"]});
  }
  // Native cash-only portfolios and admitted providers do not depend on KIS readiness.
  const ownsRun=Boolean(result.runId && !["already_attempted","active_conflict","lock_busy"].includes(result.status));
  if(ownsRun && ["blocked","failed","no_action"].includes(result.status)) {
    try {
      const work=await runDailySnapshotJob({dryRun:false,durable:true,snapshotDate:result.snapshotDate});
      result={...result,snapshot:{targetCount:work.targetCount,writtenCount:work.writtenCount,blockedCount:work.blockedCount,failedCount:work.failedCount}};
      if(work.failedCount>0) result={...result,ok:false,status:"failed",blockers:[...result.blockers,"legacy_snapshot_failed"]};
      else if(work.blockedCount>0 || !work.ok || work.writtenCount!==work.targetCount) result={...result,ok:false,status:result.status==="failed" ? "failed" : "blocked",blockers:[...result.blockers,"legacy_snapshot_incomplete"]};
      else result={...result,ok:true,status:work.targetCount ? "completed" : "no_action",blockers:[]};
    } catch { result={...result,ok:false,status:"failed",blockers:[...result.blockers,"legacy_snapshot_failed"]}; }
  }
  const nativeFailed=nativeSnapshot.status === "failed" || ("failedCount" in nativeSnapshot && nativeSnapshot.failedCount>0);
  const nativeBlocked="blockedCount" in nativeSnapshot && nativeSnapshot.blockedCount>0;
  result={...result,nativeSnapshot,...(nativeFailed ? {ok:false,status:"failed" as const,blockers:[...result.blockers,"native_snapshot_failed"]} : nativeBlocked ? {ok:false,status:result.status==="failed" ? "failed" as const : "blocked" as const,blockers:[...result.blockers,"native_snapshot_incomplete"]} : {})};
  if(result.ok && result.status==="no_action" && "targetCount" in nativeSnapshot && nativeSnapshot.targetCount>0) result={...result,status:"completed"};
  if(ownsRun) {
    try { await finishRun(result,result.status==="failed" ? "failed" : result.ok ? "completed" : "blocked"); }
    catch { return {...result,ok:false,status:"failed",blockers:[...result.blockers,"run_finalization_failed"]}; }
  }
  return result;
}

async function runCutoffPreparation({ now, snapshotDate, remainingMs, cronScheduleUtc }: {
  now: Date; snapshotDate: string; remainingMs: number; cronScheduleUtc?: string | null;
}): Promise<CronMarketCycleRunResult> {
  const deadline = performance.now() + remainingMs;
  const claim = await claimCronMarketCycleRun({ snapshotDate, startedAt: now,
    cronScheduleUtc: cronScheduleUtc ?? null, phase: "pre_cutoff" });
  if (claim.outcome !== "claimed") return emptyResult({ phase: "pre_cutoff",
    ok: claim.outcome === "already_attempted" && claim.status === "completed",
    status: claim.outcome, runId: claim.runId, snapshotDate, blockers: [claim.outcome] });
  let result = emptyResult({ phase: "pre_cutoff", ok: false, status: "blocked", runId: claim.runId, snapshotDate });
  try {
    result = await withKisCollectionLeaseWait(async () => {
      const blockers: string[] = [];
      let fx = result.fx;
      let liveSync = result.liveSync;
      // Waiting for another worker must not turn a post-cutoff receipt into
      // evidence for the earlier boundary. Writers also enforce receipt time.
      if (performance.now() >= deadline) return { ...result, blockers: ["cutoff_preparation_window_elapsed"] };
      try {
        const refreshed = await runUsdKrwFxRefreshJob({ dryRun: false, acceptExistingVardaRow: true });
        fx = refreshed.status === "written" || refreshed.status === "skipped"
          ? { status: refreshed.status, rateDate: refreshed.candidate.rateDate, source: refreshed.candidate.source }
          : { status: "failed", rateDate: null, source: null };
      } catch { fx = { status: "failed", rateDate: null, source: null }; }
      if (fx.status === "failed") blockers.push("cutoff_fx_collection_incomplete");
      if (performance.now() >= deadline) blockers.push("cutoff_preparation_window_elapsed");
      else if (!getKisProviderPolicy().configured) blockers.push("kis_provider_not_configured");
      else {
        try { liveSync = await syncLiveQuotes(createKisMarketDataProvider()); }
        catch { liveSync = { ...emptyLiveSyncSummary(), status: "failed" }; }
        if (liveSync.status !== "completed") blockers.push("cutoff_price_collection_incomplete");
        if (performance.now() >= deadline) blockers.push("cutoff_preparation_window_elapsed");
      }
      return { ...result, fx, liveSync, ok: blockers.length === 0,
        status: blockers.length === 0 ? "prepared" as const : "blocked" as const,
        blockers: [...new Set(blockers)] };
    });
  } catch (error) {
    result = { ...result, status: error instanceof KisRefreshLeaseBusyError ? "blocked" : "failed",
      blockers: [error instanceof KisRefreshLeaseBusyError ? "kis_provider_refresh_busy" : "unexpected_cutoff_preparation_error"] };
  }
  // Preparation never enters either snapshot writer or a provider fallback.
  // Its separate mode leaves the ordinary 07:00 attempt/lease history intact.
  try { await finishRun(result, result.status === "failed" ? "failed" : result.ok ? "completed" : "blocked"); }
  catch { return { ...result, ok: false, status: "failed", blockers: [...result.blockers, "run_finalization_failed"] }; }
  return result;
}

async function runMarketCycleWithLease({
  now = new Date(),
  runId,
  snapshotDate,
  closeRetryDeadline,
}: {
  now?: Date;
  cronScheduleUtc?: string | null;
  runId: string;
  snapshotDate: string;
  closeRetryDeadline: number;
}): Promise<CronMarketCycleRunResult> {
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

    // Current-cycle FX is collected before planning/writing; legacy prices and quantities use the actual valuation time.
    try {
      const fxResult = await runUsdKrwFxRefreshJob({
        dryRun: false,
        acceptExistingVardaRow: true,
        refreshUnchangedReceipt: true,
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

    let { snapshotJob, plan, deferredBlockers } = await loadPlan(new Date());
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
      ({ snapshotJob, plan, deferredBlockers } = await loadPlan(new Date()));
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
      return result;
    }

    // A failed live request may still use an independently verified official close.
    const snapshotWrite = await runDailySnapshotJob({
      dryRun: false,
      durable:true,
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
      return result;
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
    return result;
  } catch (error) {
    safeErrorMessage(error, "Cron market cycle failed");
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
  return result;
}

async function finishRun(
  result: CronMarketCycleRunResult,
  status: "completed" | "blocked" | "failed",
  error: string | null = null,
) {
  if (!result.runId) return;
  const preparation = result.phase === "pre_cutoff";
  await finishCronMarketCycleRun({
    runId: result.runId,
    status,
    finishedAt: new Date(),
    requestedCount: preparation ? result.liveSync.requestedCount + Number(result.fx.status !== "not_attempted") : result.snapshot.targetCount + (result.nativeSnapshot && "targetCount" in result.nativeSnapshot ? result.nativeSnapshot.targetCount : result.nativeSnapshot?.status==="failed" ? 1 : 0),
    successCount: preparation ? result.liveSync.successCount + Number(["written", "skipped"].includes(result.fx.status)) : result.snapshot.writtenCount + (result.nativeSnapshot && "targetCount" in result.nativeSnapshot ? result.nativeSnapshot.targetCount-result.nativeSnapshot.failedCount-result.nativeSnapshot.blockedCount : 0),
    failedCount: preparation ? result.liveSync.failedCount + Number(result.liveSync.status === "failed") + Number(result.fx.status === "failed") : result.snapshot.failedCount + (result.nativeSnapshot?.status === "failed" ? 1 : result.nativeSnapshot?.failedCount ?? 0),
    skippedCount: preparation ? result.liveSync.skippedCount : result.snapshot.blockedCount + (result.nativeSnapshot && "blockedCount" in result.nativeSnapshot ? result.nativeSnapshot.blockedCount : 0),
    metadata: {
      snapshotDate: result.snapshotDate,
      phase: result.phase ?? status,
      outcome: result.status,
      fx: result.fx,
      factorSync: result.factorSync,
      closeSync: result.closeSync,
      liveSync: result.liveSync,
      snapshot: result.snapshot,
      nativeSnapshot:result.nativeSnapshot,
      retryPolicy:{maxAttempts:4,backoffMinutes:5,lookbackDays:3,drainedBy:"next_market_cycle_invocation"},
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
    ...(overrides.phase ? { phase: overrides.phase } : {}),
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
    ...(overrides.nativeSnapshot ? {nativeSnapshot:overrides.nativeSnapshot} : {}),
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
