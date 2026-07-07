import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  buildCronPreflightResponse,
  parseCronPreflightQuery,
} from "@/lib/cron-preflight";
import { getKisPriceSyncCooldownStatus } from "@/lib/market-data/price-sync";
import {
  DailySnapshotRequestError,
  runDailySnapshot,
  type SnapshotAccount,
} from "@/lib/snapshots/daily";

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
      runDailySnapshot({
        dryRun: true,
        snapshotDate: query.snapshotDate,
        account: query.account as SnapshotAccount,
      }),
      getKisPriceSyncCooldownStatus("close"),
    ]);
    const response = buildCronPreflightResponse({
      snapshot,
      kisCooldown,
      cronScheduleUtc: request.headers.get("x-vercel-cron-schedule"),
    });

    return NextResponse.json(response, { headers: NO_STORE_HEADERS });
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
