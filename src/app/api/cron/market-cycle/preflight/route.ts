import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  buildCronPreflightJobResponse,
  parseCronPreflightQuery,
} from "@/lib/cron-preflight";
import { buildCronRuntimeConfigStatus } from "@/lib/cron-runtime-config";
import { getKisPriceSyncCooldownStatus } from "@/lib/market-data/price-sync";
import {
  DailySnapshotRequestError,
} from "@/lib/snapshots/daily";
import { runDailySnapshotJob } from "@/lib/snapshots/daily-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  const query = parseCronPreflightQuery(url.searchParams);

  if (!query.ok) {
    return NextResponse.json(
      {
        ok: false,
        routeMode: "preflight",
        wouldWrite: false,
        secretsIncluded: false,
        error: query.error,
        message: query.message,
      },
      { status: query.statusCode, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const [snapshot, kisCooldown] = await Promise.all([
      runDailySnapshotJob({
        dryRun: true,
        snapshotDate: query.snapshotDate,
        account: query.account,
      }),
      getKisPriceSyncCooldownStatus("close"),
    ]);
    const response = buildCronPreflightJobResponse({
      snapshotJob: snapshot,
      kisCooldown,
      cronScheduleUtc: request.headers.get("x-vercel-cron-schedule"),
    });

    return NextResponse.json(
      {
        ...response,
        runtimeConfig: buildCronRuntimeConfigStatus(process.env),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof DailySnapshotRequestError) {
      return NextResponse.json(
        {
          ok: false,
          routeMode: "preflight",
          wouldWrite: false,
          secretsIncluded: false,
          error: error.code,
          message: error.message,
          blockingReasons: [`request_error:${error.code}`],
          nextRecommendedAction: "blocked_by_preflight_error",
        },
        { status: error.statusCode, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        routeMode: "preflight",
        wouldWrite: false,
        secretsIncluded: false,
        error: "cron preflight failed",
        blockingReasons: ["unexpected_preflight_error"],
        nextRecommendedAction: "blocked_by_preflight_error",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
