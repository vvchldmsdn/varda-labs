import { NextResponse } from "next/server";
import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { getMarketCollectionSummary } from "@/lib/market-data/collection-queue";
import { getKisRequestBudgetSummary } from "@/lib/market-data/provider-budget";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!isAuthorizedAdminJob(request.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (new URL(request.url).search) return NextResponse.json({ error: "query_parameters_not_allowed" }, { status: 400, headers });
  try {
    const [queue, budget] = await Promise.all([getMarketCollectionSummary(), getKisRequestBudgetSummary()]);
    return NextResponse.json({ queue, budget, secretsIncluded: false }, { headers });
  }
  catch { return NextResponse.json({ error: "service_unavailable" }, { status: 503, headers }); }
}
