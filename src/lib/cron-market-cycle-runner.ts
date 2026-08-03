import "server-only";

import {
  buildCronMarketCyclePlan,
  type CronCloseSyncGroup,
  type CronMarketCyclePlan,
} from "@/lib/cron-market-cycle";
import {
  claimCronMarketCycleRun,
  finishCronMarketCycleRun,
} from "@/lib/cron-market-cycle-run-repository";
import { runUsdKrwFxRefreshJob } from "@/lib/market-data/fx-refresh-job";
import {
  getKisPriceSyncCooldownStatus,
  runMarketPriceSync,
} from "@/lib/market-data/price-sync";
import {
  createKisMarketDataProvider,
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import { safeErrorMessage } from "@/lib/redaction";
import { runDailySnapshotJob } from "@/lib/snapshots/daily-job";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

type CloseSyncSummary = {
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
    status: "written" | "skipped" | "not_attempted";
    rateDate: string | null;
    source: string | null;
  };
  closeSync: CloseSyncSummary;
  snapshot: {
    targetCount: number;
    writtenCount: number;
    blockedCount: number;
    failedCount: number;
  };
  blockers: string[];
};

export async function runCronMarketCycle({
  now = new Date(),
  cronScheduleUtc = null,
}: {
  now?: Date;
  cronScheduleUtc?: string | null;
} = {}): Promise<CronMarketCycleRunResult> {
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

  try {
    const fxResult = await runUsdKrwFxRefreshJob({
      dryRun: false,
      acceptExistingVardaRow: true,
    });
    if (fxResult.status === "planned" || fxResult.status === "blocked") {
      throw new Error("FX refresh did not produce an admissible actual result");
    }
    fxSummary = {
      status: fxResult.status,
      rateDate: fxResult.candidate.rateDate,
      source: fxResult.candidate.source,
    };

    let { snapshotJob, plan } = await loadPlan(now);
    if (!plan.ok) {
      return finishBlocked({
        runId,
        snapshotDate,
        fxSummary,
        closeSync,
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
          closeSync,
          plan: {
            ...plan,
            ok: false,
            action: "blocked",
            blockers: ["kis_provider_not_configured"],
          },
          snapshotJob,
        });
      }

      closeSync = await syncCloseGroups(plan.closeGroups);
      ({ snapshotJob, plan } = await loadPlan(now));
      if (!plan.ok || plan.action === "sync_closes_then_snapshot") {
        return finishBlocked({
          runId,
          snapshotDate,
          fxSummary,
          closeSync,
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
      const result = emptyResult({
        ok: true,
        status: "no_action",
        runId,
        snapshotDate,
        fx: fxSummary,
        closeSync,
      });
      await finishRun(result, "completed");
      return result;
    }

    const snapshotWrite = await runDailySnapshotJob({
      dryRun: false,
      snapshotDate,
      account: "all",
      now,
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
        closeSync,
        snapshot: snapshotSummary,
        blockers: ["snapshot_write_incomplete"],
      });
      await finishRun(result, "blocked");
      return result;
    }

    const result = emptyResult({
      ok: true,
      status: "completed",
      runId,
      snapshotDate,
      fx: fxSummary,
      closeSync,
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
      closeSync,
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
  const [snapshotJob, kisCooldown] = await Promise.all([
    runDailySnapshotJob({ dryRun: true, account: "all", now }),
    getKisPriceSyncCooldownStatus("close", now),
  ]);
  return {
    snapshotJob,
    plan: buildCronMarketCyclePlan({
      snapshotJob,
      kisCooldownActive: kisCooldown.active,
    }),
  };
}

async function syncCloseGroups(groups: CronCloseSyncGroup[]) {
  const provider = createKisMarketDataProvider();
  const summary = emptyCloseSyncSummary();

  for (const group of groups) {
    const result = await runMarketPriceSync({
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

async function finishBlocked({
  runId,
  snapshotDate,
  fxSummary,
  closeSync,
  plan,
  snapshotJob,
}: {
  runId: string;
  snapshotDate: string;
  fxSummary: CronMarketCycleRunResult["fx"];
  closeSync: CloseSyncSummary;
  plan: CronMarketCyclePlan;
  snapshotJob: Awaited<ReturnType<typeof runDailySnapshotJob>>;
}) {
  const result = emptyResult({
    ok: false,
    status: "blocked",
    runId,
    snapshotDate,
    fx: fxSummary,
    closeSync,
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
    requestedCount: result.closeSync.requestedCount,
    successCount: result.closeSync.successCount,
    failedCount: result.closeSync.failedCount + result.snapshot.failedCount,
    skippedCount: result.closeSync.skippedCount,
    metadata: {
      snapshotDate: result.snapshotDate,
      phase: status,
      outcome: result.status,
      fx: result.fx,
      closeSync: result.closeSync,
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
    closeSync: overrides.closeSync ?? emptyCloseSyncSummary(),
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
