const ACCOUNTS = ["brokerage", "isa", "irp", "all"] as const;
const MODES = ["preflight"] as const;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_QUERY_KEYS = new Set(["date", "account", "mode"]);
const REJECTED_QUERY_KEYS = new Set([
  "dryrun",
  "confirmwrite",
  "write",
  "force",
  "backfill",
  "delete",
]);
const SECRET_SHAPED_QUERY_KEY_PATTERN =
  /(secret|token|credential|password|api[_-]?key|authorization|header|env)/i;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type CronPreflightAccount = (typeof ACCOUNTS)[number];

export type CronPreflightQuery =
  | {
      ok: true;
      snapshotDate: string | undefined;
      account: CronPreflightAccount;
      mode: "preflight";
    }
  | {
      ok: false;
      statusCode: 400;
      error: string;
      message: string;
    };

type SnapshotWriteCounts = {
  insert: number;
  update: number;
  skip: number;
  blocked: number;
};

type DailySnapshotLike = {
  ok: boolean;
  dryRun: boolean;
  writeReady: boolean;
  snapshotDate: string;
  requestedAccount: CronPreflightAccount;
  accounts: string[];
  cycle: {
    snapshotDate: string;
    capturedAt: string;
    cycleStartAt: string;
    cycleEndAt: string;
  };
  closeReferences: Array<{
    market: string;
    requiredCount: number;
    requiredTickerCount: number;
    calendarReferenceDate: string;
    expectedCloseDate: string;
    status: string;
    reason: string;
  }>;
  freshClose: {
    requiredCount: number;
    satisfiedCount: number;
    missingCount: number;
    rowsUsedCount: number;
    coverage: Array<{
      ticker: string | null;
      name: string;
      account: string;
      market: string;
      currency: string;
      expectedCloseDate: string;
      selectedCloseDate: string | null;
      selectedSource: string | null;
      status: "satisfied" | "missing" | "stale";
      reason: string;
    }>;
    missing: Array<{
      ticker: string | null;
      name: string;
      account: string;
      market: string;
      expectedCloseDate: string;
      actualCloseDate: string | null;
      reason: string;
    }>;
  };
  closeSyncPlan: {
    canProceedToSnapshotWrite: boolean;
    requiredCount: number;
    coveredCount: number;
    missingCount: number;
    staleCount: number;
    manualCurrentNotSyncableCount: number;
    markets: Array<{
      market: string;
      expectedCloseDate: string | null;
      requiredCount: number;
      requiredTickerCount: number;
      coveredCount: number;
      missingCount: number;
      staleCount: number;
    }>;
    suggestedKisBatches: Array<{
      market: string;
      expectedCloseDate: string;
      tickers: string[];
      count: number;
      maxBatchSize: number;
      dryRunQuery: string;
      manualWriteRequired: boolean;
      writeRequiresConfirmWrite: boolean;
    }>;
  };
  plannedWrites: {
    dailyPortfolioSnapshots: SnapshotWriteCounts;
    dailyPositionSnapshots: SnapshotWriteCounts;
  };
  results: Record<
    string,
    {
      status: string;
      reason: string | null;
      blockers: string[];
    }
  >;
  warnings: string[];
};

type KisCooldownLike = {
  active: boolean;
  provider: string;
  mode: string;
  cooldownSeconds: number;
  retryAfterSeconds: number;
  lastRunStatus: string | null;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
};

export type CronPreflightResponse = {
  ok: boolean;
  routeMode: "preflight";
  wouldWrite: false;
  secretsIncluded: false;
  cycle: {
    snapshotDate: string;
    resolvedAtKst: string;
    capturedAt: string;
    cycleStartAt: string;
    cycleEndAt: string;
    cronScheduleUtc: string | null;
  };
  expectedCloseDates: Array<{
    market: string;
    expectedCloseDate: string;
    requiredCount: number;
    requiredTickerCount: number;
    status: string;
  }>;
  closeCoverage: {
    requiredCount: number;
    satisfiedCount: number;
    missingCount: number;
    staleCount: number;
    rowsUsedCount: number;
    items: DailySnapshotLike["freshClose"]["coverage"];
    missing: DailySnapshotLike["freshClose"]["missing"];
  };
  closeSyncPlan: {
    canProceedToSnapshotWrite: boolean;
    requiredCount: number;
    coveredCount: number;
    missingCount: number;
    staleCount: number;
    manualCurrentNotSyncableCount: number;
    markets: DailySnapshotLike["closeSyncPlan"]["markets"];
    suggestedBatches: Array<{
      market: string;
      expectedCloseDate: string;
      tickers: string[];
      count: number;
      maxBatchSize: number;
      dryRunQuery: string | null;
      manualWriteRequired: boolean;
      writeRequiresConfirmWrite: boolean;
    }>;
  };
  snapshot: {
    writeReady: boolean;
    requestedAccount: CronPreflightAccount;
    accounts: string[];
    plannedPortfolioWrites: SnapshotWriteCounts;
    plannedPositionWrites: SnapshotWriteCounts;
  };
  kisCooldown: KisCooldownLike;
  blockingReasons: string[];
  nextRecommendedAction:
    | "no_action_required"
    | "blocked_by_kis_cooldown"
    | "manual_kis_close_dry_run_required"
    | "manual_daily_snapshot_dry_run_required"
    | "blocked_by_missing_close_coverage"
    | "blocked_by_duplicate_or_unmanaged_rows"
    | "blocked_by_preflight_error";
  warnings: string[];
};

export function parseCronPreflightQuery(
  searchParams: URLSearchParams,
): CronPreflightQuery {
  const rejectedQuery = findRejectedQuery(searchParams);
  if (rejectedQuery) {
    return {
      ok: false,
      statusCode: 400,
      error: rejectedQuery.sensitive ? "sensitive_query" : "unsupported_query",
      message: rejectedQuery.sensitive
        ? "sensitive query parameters are not allowed on preflight route"
        : `query parameter is not allowed on preflight route: ${rejectedQuery.key}`,
    };
  }

  const snapshotDate = parseDateKeyQuery(searchParams.get("date"));
  if (snapshotDate === null) {
    return {
      ok: false,
      statusCode: 400,
      error: "invalid_date",
      message: "date must be YYYY-MM-DD when provided",
    };
  }

  const account = parseEnumQuery(searchParams.get("account"), ACCOUNTS, "all");
  if (account === null) {
    return {
      ok: false,
      statusCode: 400,
      error: "invalid_account",
      message: "account must be one of: brokerage, isa, irp, all",
    };
  }

  const mode = parseEnumQuery(searchParams.get("mode"), MODES, "preflight");
  if (mode === null) {
    return {
      ok: false,
      statusCode: 400,
      error: "invalid_mode",
      message: "mode must be preflight when provided",
    };
  }

  return {
    ok: true,
    snapshotDate,
    account,
    mode,
  };
}

export function buildCronPreflightResponse({
  snapshot,
  kisCooldown,
  cronScheduleUtc,
}: {
  snapshot: DailySnapshotLike;
  kisCooldown: KisCooldownLike;
  cronScheduleUtc: string | null;
}): CronPreflightResponse {
  const blockingReasons = buildBlockingReasons(snapshot, kisCooldown);

  return {
    ok: snapshot.ok,
    routeMode: "preflight",
    wouldWrite: false,
    secretsIncluded: false,
    cycle: {
      snapshotDate: snapshot.snapshotDate,
      resolvedAtKst: toKstIsoString(snapshot.cycle.capturedAt),
      capturedAt: snapshot.cycle.capturedAt,
      cycleStartAt: snapshot.cycle.cycleStartAt,
      cycleEndAt: snapshot.cycle.cycleEndAt,
      cronScheduleUtc,
    },
    expectedCloseDates: snapshot.closeReferences.map((reference) => ({
      market: reference.market,
      expectedCloseDate: reference.expectedCloseDate,
      requiredCount: reference.requiredCount,
      requiredTickerCount: reference.requiredTickerCount,
      status: reference.status,
    })),
    closeCoverage: {
      requiredCount: snapshot.freshClose.requiredCount,
      satisfiedCount: snapshot.freshClose.satisfiedCount,
      missingCount: snapshot.freshClose.missingCount,
      staleCount: snapshot.closeSyncPlan.staleCount,
      rowsUsedCount: snapshot.freshClose.rowsUsedCount,
      items: snapshot.freshClose.coverage,
      missing: snapshot.freshClose.missing,
    },
    closeSyncPlan: {
      canProceedToSnapshotWrite: snapshot.closeSyncPlan.canProceedToSnapshotWrite,
      requiredCount: snapshot.closeSyncPlan.requiredCount,
      coveredCount: snapshot.closeSyncPlan.coveredCount,
      missingCount: snapshot.closeSyncPlan.missingCount,
      staleCount: snapshot.closeSyncPlan.staleCount,
      manualCurrentNotSyncableCount:
        snapshot.closeSyncPlan.manualCurrentNotSyncableCount,
      markets: snapshot.closeSyncPlan.markets.map((market) => ({
        market: market.market,
        expectedCloseDate: market.expectedCloseDate,
        requiredCount: market.requiredCount,
        requiredTickerCount: market.requiredTickerCount,
        coveredCount: market.coveredCount,
        missingCount: market.missingCount,
        staleCount: market.staleCount,
      })),
      suggestedBatches: snapshot.closeSyncPlan.suggestedKisBatches.map(
        (batch) => ({
          market: batch.market,
          expectedCloseDate: batch.expectedCloseDate,
          tickers: batch.tickers,
          count: batch.count,
          maxBatchSize: batch.maxBatchSize,
          dryRunQuery: safeDryRunQuery(batch.dryRunQuery),
          manualWriteRequired: batch.manualWriteRequired,
          writeRequiresConfirmWrite: batch.writeRequiresConfirmWrite,
        }),
      ),
    },
    snapshot: {
      writeReady: snapshot.writeReady,
      requestedAccount: snapshot.requestedAccount,
      accounts: snapshot.accounts,
      plannedPortfolioWrites: snapshot.plannedWrites.dailyPortfolioSnapshots,
      plannedPositionWrites: snapshot.plannedWrites.dailyPositionSnapshots,
    },
    kisCooldown: {
      active: kisCooldown.active,
      provider: kisCooldown.provider,
      mode: kisCooldown.mode,
      cooldownSeconds: kisCooldown.cooldownSeconds,
      retryAfterSeconds: kisCooldown.retryAfterSeconds,
      lastRunStatus: kisCooldown.lastRunStatus,
      lastRunStartedAt: kisCooldown.lastRunStartedAt,
      lastRunFinishedAt: kisCooldown.lastRunFinishedAt,
    },
    blockingReasons,
    nextRecommendedAction: nextRecommendedAction(
      snapshot,
      kisCooldown,
      blockingReasons,
    ),
    warnings: snapshot.warnings,
  };
}

function findRejectedQuery(searchParams: URLSearchParams) {
  for (const key of searchParams.keys()) {
    const normalized = key.trim().toLowerCase();
    if (SECRET_SHAPED_QUERY_KEY_PATTERN.test(normalized)) {
      return { key, sensitive: true };
    }
    if (!ALLOWED_QUERY_KEYS.has(normalized)) return { key, sensitive: false };
    if (REJECTED_QUERY_KEYS.has(normalized)) return { key, sensitive: false };
  }
  return null;
}

function safeDryRunQuery(query: string) {
  const normalized = query.toLowerCase();
  if (normalized.includes("confirmwrite=true")) return null;
  if (normalized.includes("dryrun=false")) return null;
  return query;
}

function buildBlockingReasons(
  snapshot: DailySnapshotLike,
  kisCooldown: KisCooldownLike,
) {
  const reasons = new Set<string>();

  if (shouldBlockForKisCooldown(snapshot, kisCooldown)) {
    reasons.add("blocked_by_kis_cooldown");
  }
  if (snapshot.closeSyncPlan.missingCount > 0) {
    reasons.add("blocked_by_missing_close_coverage");
  }
  if (snapshot.closeSyncPlan.staleCount > 0) {
    reasons.add("blocked_by_stale_close_coverage");
  }
  for (const asset of snapshot.freshClose.missing) {
    reasons.add(`missing_close:${asset.ticker ?? asset.name}`);
  }
  for (const [account, result] of Object.entries(snapshot.results)) {
    for (const blocker of result.blockers ?? []) {
      reasons.add(`account:${account}:${blocker}`);
    }
  }
  if (!snapshot.writeReady && reasons.size === 0) {
    reasons.add("snapshot_write_not_ready");
  }

  return Array.from(reasons).sort();
}

function nextRecommendedAction(
  snapshot: DailySnapshotLike,
  kisCooldown: KisCooldownLike,
  blockingReasons: string[],
): CronPreflightResponse["nextRecommendedAction"] {
  if (shouldBlockForKisCooldown(snapshot, kisCooldown)) {
    return "blocked_by_kis_cooldown";
  }
  if (snapshot.closeSyncPlan.suggestedKisBatches.length > 0) {
    return "manual_kis_close_dry_run_required";
  }
  if (
    snapshot.closeSyncPlan.missingCount > 0 ||
    snapshot.closeSyncPlan.staleCount > 0
  ) {
    return "blocked_by_missing_close_coverage";
  }
  if (!snapshot.writeReady) {
    return blockingReasons.length > 0
      ? "blocked_by_duplicate_or_unmanaged_rows"
      : "blocked_by_preflight_error";
  }
  if (hasSnapshotInserts(snapshot.plannedWrites)) {
    return "manual_daily_snapshot_dry_run_required";
  }
  return "no_action_required";
}

function shouldBlockForKisCooldown(
  snapshot: DailySnapshotLike,
  kisCooldown: KisCooldownLike,
) {
  return kisCooldown.active && snapshot.closeSyncPlan.suggestedKisBatches.length > 0;
}

function hasSnapshotInserts(plannedWrites: DailySnapshotLike["plannedWrites"]) {
  return (
    plannedWrites.dailyPortfolioSnapshots.insert > 0 ||
    plannedWrites.dailyPositionSnapshots.insert > 0
  );
}

function toKstIsoString(isoString: string) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Date(date.getTime() + KST_OFFSET_MS)
    .toISOString()
    .replace("Z", "+09:00");
}

function parseDateKeyQuery(value: string | null) {
  if (value === null || value.trim() === "") return undefined;

  const normalized = value.trim();
  return DATE_KEY_PATTERN.test(normalized) ? normalized : null;
}

function parseEnumQuery<const Value extends string>(
  value: string | null,
  allowedValues: readonly Value[],
  defaultValue: Value,
) {
  if (value === null || value.trim() === "") return defaultValue;

  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized as Value)
    ? (normalized as Value)
    : null;
}
