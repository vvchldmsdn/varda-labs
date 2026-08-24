const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9._-]+$/;

export const CRON_MARKET_CYCLE_LIMITS = {
  maxCloseTargetsPerGroup: 25,
  maxCloseTargetsPerCycle: 50,
  maxLiveTargetsPerCycle: 50,
  activeRunLeaseMinutes: 30,
} as const;

export type CronCloseSyncGroup = {
  market: "korea" | "us";
  expectedCloseDate: string;
  tickers: string[];
};

type SnapshotWriteCounts = {
  insert: number;
  update: number;
  skip: number;
  blocked: number;
};

export type CronMarketCycleSnapshotJobLike = {
  ok: boolean;
  writeReady: boolean;
  snapshotDate: string;
  targetCount: number;
  failedCount: number;
  targets: Array<
    | {
        status: "ready" | "written" | "blocked";
        result: {
          writeReady: boolean;
          closeSyncPlan: {
            missingCount: number;
            staleCount: number;
            suggestedKisBatches: Array<{
              market: string;
              expectedCloseDate: string;
              tickers: string[];
            }>;
          };
          plannedWrites: {
            dailyPortfolioSnapshots: SnapshotWriteCounts;
            dailyPositionSnapshots: SnapshotWriteCounts;
          };
          results: Record<string, { blockers?: string[] }>;
        };
      }
    | {
        status: "failed";
        error: { code: string };
      }
  >;
};

export type CronMarketCyclePlan = {
  ok: boolean;
  action:
    | "blocked"
    | "no_action"
    | "sync_closes_then_snapshot"
    | "write_snapshot";
  snapshotDate: string;
  closeGroups: CronCloseSyncGroup[];
  closeTargetCount: number;
  snapshotWriteNeeded: boolean;
  blockers: string[];
};

export function buildCronMarketCyclePlan({
  snapshotJob,
  kisCooldownActive,
}: {
  snapshotJob: CronMarketCycleSnapshotJobLike;
  kisCooldownActive: boolean;
}): CronMarketCyclePlan {
  const blockers = new Set<string>();
  const closeGroups = buildCronCloseSyncGroups(snapshotJob, blockers);
  const closeTargetCount = closeGroups.reduce(
    (total, group) => total + group.tickers.length,
    0,
  );
  const snapshotWriteNeeded = hasSnapshotInserts(snapshotJob);

  if (!DATE_KEY_PATTERN.test(snapshotJob.snapshotDate)) {
    blockers.add("invalid_snapshot_date");
  }
  if (snapshotJob.targetCount === 0) blockers.add("no_snapshot_targets");
  if (snapshotJob.failedCount > 0) blockers.add("snapshot_preflight_failed");
  if (closeTargetCount > CRON_MARKET_CYCLE_LIMITS.maxCloseTargetsPerCycle) {
    blockers.add("close_target_cycle_limit_exceeded");
  }
  if (closeGroups.length > 0 && kisCooldownActive) {
    blockers.add("kis_close_cooldown_active");
  }

  for (const target of snapshotJob.targets) {
    if (target.status === "failed") {
      blockers.add(`snapshot_preflight_error:${target.error.code}`);
      continue;
    }

    const plan = target.result.closeSyncPlan;
    const pendingCloseCount = plan.missingCount + plan.staleCount;
    if (pendingCloseCount > 0 && plan.suggestedKisBatches.length === 0) {
      blockers.add("pending_close_without_sync_target");
    }
    for (const result of Object.values(target.result.results)) {
      for (const blocker of result.blockers ?? []) {
        blockers.add(`snapshot_blocker:${blocker}`);
      }
    }
    if (!target.result.writeReady && pendingCloseCount === 0) {
      blockers.add("snapshot_not_write_ready");
    }
  }

  const blockerList = Array.from(blockers).sort();
  if (blockerList.length > 0) {
    return {
      ok: false,
      action: "blocked",
      snapshotDate: snapshotJob.snapshotDate,
      closeGroups,
      closeTargetCount,
      snapshotWriteNeeded,
      blockers: blockerList,
    };
  }

  if (closeGroups.length > 0) {
    return {
      ok: true,
      action: "sync_closes_then_snapshot",
      snapshotDate: snapshotJob.snapshotDate,
      closeGroups,
      closeTargetCount,
      snapshotWriteNeeded: true,
      blockers: [],
    };
  }

  return {
    ok: true,
    action: snapshotWriteNeeded ? "write_snapshot" : "no_action",
    snapshotDate: snapshotJob.snapshotDate,
    closeGroups: [],
    closeTargetCount: 0,
    snapshotWriteNeeded,
    blockers: [],
  };
}

function buildCronCloseSyncGroups(
  snapshotJob: CronMarketCycleSnapshotJobLike,
  blockers: Set<string>,
) {
  const tickersByGroup = new Map<string, Set<string>>();

  for (const target of snapshotJob.targets) {
    if (target.status === "failed") continue;

    for (const batch of target.result.closeSyncPlan.suggestedKisBatches) {
      const market = normalizeMarket(batch.market);
      if (!market || !DATE_KEY_PATTERN.test(batch.expectedCloseDate)) {
        blockers.add("invalid_close_sync_group");
        continue;
      }

      const key = `${market}|${batch.expectedCloseDate}`;
      const tickers = tickersByGroup.get(key) ?? new Set<string>();
      for (const rawTicker of batch.tickers) {
        const ticker = rawTicker.trim().toUpperCase();
        if (!ticker || ticker.length > 50 || !TICKER_PATTERN.test(ticker)) {
          blockers.add("invalid_close_sync_ticker");
          continue;
        }
        tickers.add(ticker);
      }
      tickersByGroup.set(key, tickers);
    }
  }

  const groups: CronCloseSyncGroup[] = [];
  for (const [key, tickerSet] of tickersByGroup) {
    const [market, expectedCloseDate] = key.split("|") as [
      CronCloseSyncGroup["market"],
      string,
    ];
    const tickers = Array.from(tickerSet).sort();
    if (tickers.length === 0) {
      blockers.add("empty_close_sync_group");
      continue;
    }
    if (tickers.length > CRON_MARKET_CYCLE_LIMITS.maxCloseTargetsPerGroup) {
      blockers.add("close_target_group_limit_exceeded");
    }
    groups.push({ market, expectedCloseDate, tickers });
  }

  return groups.sort((left, right) =>
    `${left.expectedCloseDate}:${left.market}`.localeCompare(
      `${right.expectedCloseDate}:${right.market}`,
    ),
  );
}

function hasSnapshotInserts(snapshotJob: CronMarketCycleSnapshotJobLike) {
  return snapshotJob.targets.some((target) => {
    if (target.status === "failed") return false;
    return (
      target.result.plannedWrites.dailyPortfolioSnapshots.insert > 0 ||
      target.result.plannedWrites.dailyPositionSnapshots.insert > 0
    );
  });
}

function normalizeMarket(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "korea" || normalized === "us" ? normalized : null;
}
