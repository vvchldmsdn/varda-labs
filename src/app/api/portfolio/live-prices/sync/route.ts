import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { getTenantLivePriceTargets } from "@/db/queries/tenant-live-price-targets";
import { fxRates, livePriceQuotes } from "@/db/schema";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getKisProviderPolicy } from "@/lib/market-data/providers/kis";
import { selectKisUsdKrwQuoteTarget } from "@/lib/market-data/providers/kis-fx";
import { planTenantLiveFxSync } from "@/lib/market-data/tenant-live-fx-sync-policy";
import { planTenantLivePriceSync, TENANT_LIVE_PRICE_SYNC_POLICY, type TenantLivePriceTarget } from "@/lib/market-data/tenant-live-price-sync-policy";
import { enqueueMarketCollection } from "@/lib/market-data/collection-queue";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";
import type { CollectionInput } from "@/lib/market-data/collection-policy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type RefreshReason = "page_view" | "manual" | "poll";

export async function POST(request: Request) {
  const reason = await readRefreshReason(request);
  if (!reason) return response({ state: "invalid_request" }, 400);
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) return response({ state: "session_unavailable" }, resolution.failure.httpStatus);
  try {
    const targets = await getTenantLivePriceTargets(resolution.tenantContext);
    if (targets.length > TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount) {
      if (reason === "poll") { scheduleMarketCollection(); return response({ state: "queued", targetLimitExceeded: true, retryAfterSeconds: 10 }, 202); }
      return response({ state: "target_limit_exceeded", targetCount: targets.length, maximumTargetCount: TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount }, 409);
    }
    const [quotes, fxEvidence] = await Promise.all([getCurrentKisQuoteEvidence(targets), getCurrentUsdKrwEvidence()]);
    const plan = planTenantLivePriceSync({ targets, quotes });
    // A manual click does not force another provider request for a fresh shared quote.
    const fxPlan = planTenantLiveFxSync({ currencies: targets.map(t => t.currency), evidence: fxEvidence, reason: "page_view" });
    const fxTarget = selectKisUsdKrwQuoteTarget({ targets, quotes });
    const jobs: CollectionInput[] = plan.staleTargets.map(target => ({ ...target, kind: "live" }));
    if (fxPlan.shouldRefresh && fxTarget) jobs.push({ kind: "fx", ticker: fxTarget.ticker, market: "us", currency: "USD" });
    if (jobs.length === 0) {
      // Polling can wake another pending lane without admitting arbitrary instruments.
      scheduleMarketCollection();
      return response({ state: targets.length ? "fresh" : "empty", freshTargetCount: plan.freshTargetCount, targetCount: targets.length });
    }
    if (reason === "poll") {
      scheduleMarketCollection();
      return response({ state: "queued", retryAfterSeconds: 10, freshTargetCount: plan.freshTargetCount }, 202);
    }
    if (!getKisProviderPolicy().configured) return response({ state: "provider_unavailable" }, 503);
    // Keep the instrument cap separate from the one shared FX request.
    const result = await enqueueMarketCollection(jobs.filter(job => job.kind !== "fx"));
    if (jobs.some(job => job.kind === "fx")) await enqueueMarketCollection(jobs.filter(job => job.kind === "fx"));
    scheduleMarketCollection();
    return response({ state: "queued", queuedTargetCount: jobs.length, freshTargetCount: plan.freshTargetCount, targetCount: targets.length,
      retryAfterSeconds: result.retryAfterSeconds }, 202, { "Retry-After": String(result.retryAfterSeconds) });
  } catch { return response({ state: "service_unavailable" }, 503); }
}

async function getCurrentKisQuoteEvidence(
  targets: readonly TenantLivePriceTarget[],
) {
  const tickers = [...new Set(targets.map((target) => target.ticker))];

  return db
    .select({
      ticker: livePriceQuotes.ticker,
      market: livePriceQuotes.market,
      currency: livePriceQuotes.currency,
      provider: livePriceQuotes.provider,
      source: livePriceQuotes.source,
      status: livePriceQuotes.status,
      price: livePriceQuotes.price,
      fetchedAt: livePriceQuotes.fetchedAt,
    })
    .from(livePriceQuotes)
    .where(
      and(
        eq(livePriceQuotes.provider, TENANT_LIVE_PRICE_SYNC_POLICY.provider),
        inArray(livePriceQuotes.ticker, tickers),
      ),
    );
}

async function getCurrentUsdKrwEvidence() {
  const [row] = await db
    .select({
      usdKrw: fxRates.usdKrw,
      status: fxRates.status,
      fetchedAt: fxRates.fetchedAt,
    })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.isSample, false),
        eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
        sql`${fxRates.usdKrw} > 0`,
      ),
    )
    .orderBy(
      sql`${fxRates.fetchedAt} desc nulls last`,
      desc(fxRates.rateDate),
      desc(fxRates.createdAt),
    )
    .limit(1);

  return row ?? null;
}

async function readRefreshReason(request: Request): Promise<RefreshReason | null> {
  const url = new URL(request.url);
  if (url.search !== "") return null;
  if (request.headers.get("origin") !== url.origin) return null;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return null;
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  ) {
    return null;
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > 64)
  ) {
    return null;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isRecord(body) || Object.keys(body).length !== 1) return null;
  return body.reason === "page_view" || body.reason === "manual" || body.reason === "poll"
    ? body.reason
    : null;
}

function response(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
