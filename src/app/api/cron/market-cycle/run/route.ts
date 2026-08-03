import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { runCronMarketCycle } from "@/lib/cron-market-cycle-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const url = new URL(request.url);
  if (Array.from(url.searchParams.keys()).length > 0) {
    return NextResponse.json(
      {
        ok: false,
        routeMode: "write",
        writesEnabled: false,
        secretsIncluded: false,
        error: "query_parameters_not_allowed",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (process.env.MARKET_CYCLE_CRON_WRITE_ENABLED !== "true") {
    return NextResponse.json(
      {
        ok: false,
        status: "disabled",
        routeMode: "write",
        writesEnabled: false,
        secretsIncluded: false,
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }

  const result = await runCronMarketCycle({
    cronScheduleUtc: request.headers.get("x-vercel-cron-schedule"),
  });
  const status = result.status === "failed" ? 500 : result.ok ? 200 : 409;

  return NextResponse.json(result, {
    status,
    headers: NO_STORE_HEADERS,
  });
}
