import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { runRecentCloseCollection } from "@/lib/market-data/close-gap-collection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/** Catch up reference history after the US local date ends. This route has no
 * portfolio snapshot or simulation-execution writer in its call graph. */
export async function GET(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (new URL(request.url).searchParams.size > 0) {
    return NextResponse.json({ error: "query_parameters_not_allowed" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (process.env.MARKET_CYCLE_CRON_WRITE_ENABLED !== "true") {
    return NextResponse.json({ ok: false, status: "disabled", writesEnabled: false }, { status: 409, headers: NO_STORE_HEADERS });
  }
  const result = await runRecentCloseCollection({ deadline: Date.now() + 120_000 });
  return NextResponse.json({ ok: result.status !== "provider_unavailable", ...result }, { headers: NO_STORE_HEADERS });
}
