import type {
  DailySnapshotRunResult,
  SnapshotAccount,
} from "@/lib/snapshots/daily";

export type DailySnapshotJobResult = {
  ok: boolean;
  dryRun: boolean;
  writeReady: boolean;
  snapshotDate: string;
  requestedAccount: SnapshotAccount;
  targetCount: number;
  readyCount: number;
  writtenCount: number;
  blockedCount: number;
  failedCount: number;
  targets: DailySnapshotTenantResult[];
};

export type DailySnapshotTenantResult =
  | {
      ownerUserId: string;
      status: "ready" | "written";
      result: DailySnapshotRunResult;
    }
  | {
      ownerUserId: string;
      status: "blocked";
      result: DailySnapshotRunResult;
    }
  | {
      ownerUserId: string;
      status: "failed";
      error: {
        code: string;
        message: string;
        statusCode: number;
      };
    };

export function buildDailySnapshotJobResult({
  dryRun,
  snapshotDate,
  requestedAccount,
  targets,
}: {
  dryRun: boolean;
  snapshotDate: string;
  requestedAccount: SnapshotAccount;
  targets: DailySnapshotTenantResult[];
}): DailySnapshotJobResult {
  const readyCount = targets.filter(
    (target) => target.status === "ready",
  ).length;
  const writtenCount = targets.filter(
    (target) => target.status === "written",
  ).length;
  const blockedCount = targets.filter(
    (target) => target.status === "blocked",
  ).length;
  const failedCount = targets.filter(
    (target) => target.status === "failed",
  ).length;
  const successfulCount = dryRun ? readyCount : writtenCount;

  return {
    ok: successfulCount === targets.length,
    dryRun,
    writeReady: failedCount === 0 && blockedCount === 0,
    snapshotDate,
    requestedAccount,
    targetCount: targets.length,
    readyCount,
    writtenCount,
    blockedCount,
    failedCount,
    targets,
  };
}
