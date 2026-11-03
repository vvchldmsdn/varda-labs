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
import { enqueueMarketCollection, readCollectionProgress } from "@/lib/market-data/collection-queue";
import { scheduleMarketCollection } from "@/lib/market-data/collection-worker";
import { livePriceReadVersion } from "@/lib/market-data/live-price-read-version";
import { manualNativeQuotes } from "@/lib/market-data/manual-native-quotes";
import { normalizeCollectionJobs, type CollectionInput } from "@/lib/market-data/collection-policy";
import { refreshItem, refreshProgress, refreshProgressState } from "@/lib/market-data/quote-refresh-progress";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
type RefreshReason = "page_view" | "manual" | "poll";

export async function POST(request: Request) {
  const input = await readRefreshReason(request);
  if (!input) return response({ state: "invalid_request" }, 400);
  const { reason, startedAt } = input;
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) return response({ state: "session_unavailable" }, resolution.failure.httpStatus);
  try {
    const targets = await getTenantLivePriceTargets(resolution.tenantContext);
    if (targets.length > TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount) {
      if (reason === "poll") { scheduleMarketCollection(); return response({ state: "queued", targetLimitExceeded: true, retryAfterSeconds: 10 }, 202); }
      return response({ state: "target_limit_exceeded", targetCount: targets.length, maximumTargetCount: TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount }, 409);
    }
    const readAt = new Date().toISOString();
    const [quotes, fxEvidence, native] = await Promise.all([getCurrentKisQuoteEvidence(targets), getCurrentUsdKrwEvidence(), manualNativeQuotes(targets, reason === "manual", startedAt).catch(() => ({available:false,pending:false,failed:true,version:"unavailable",items:[]}))]);
    const plan = planTenantLivePriceSync({ targets, quotes });
    const readVersion = livePriceReadVersion(targets, quotes, fxEvidence, native.version);
    // A manual click does not force another provider request for a fresh shared quote.
    const fxPlan = planTenantLiveFxSync({ currencies: targets.map(t => t.currency), evidence: fxEvidence, reason: "page_view" });
    const fxTarget = selectKisUsdKrwQuoteTarget({ targets, quotes });
    const configured = getKisProviderPolicy().configured;
    const finish = async (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) => {
      const required = configured ? normalizeCollectionJobs(plan.targets.map(target => ({ ...target, kind: "live" as const }))) : [];
      if (configured && fxPlan.hasUsdExposure && fxTarget) required.push(...normalizeCollectionJobs([{ kind: "fx", ticker: fxTarget.ticker, market: "us", currency: "USD" }]));
      const queued = await readCollectionProgress(required.map(job => job.key));
      const cutoff = Date.parse(startedAt) - TENANT_LIVE_PRICE_SYNC_POLICY.freshnessMilliseconds;
      const items = required.map(job => {
        const quote = quotes.filter(row => row.ticker.toUpperCase() === job.ticker && row.market.toLowerCase() === job.market && row.currency.toUpperCase() === job.currency)
          .sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())[0];
        const evidence = job.kind === "fx" ? fxEvidence : quote;
        const price = job.kind === "fx" ? fxEvidence?.usdKrw : quote?.price;
        const valid = evidence?.status === "ok" && Number.isFinite(Number(price)) && Number(price) > 0;
        const checkedAt = evidence?.fetchedAt ? new Date(evidence.fetchedAt).toISOString() : null;
        return refreshItem({ id: job.key, label: job.kind === "fx" ? "USD/KRW" : job.ticker, provider: "KIS", startedAt, readAt,
          valid, fresh: valid && Date.parse(checkedAt ?? "") >= cutoff && Date.parse(checkedAt ?? "") <= Date.now() + 60_000,
          checkedAt, priceAsOf: job.kind === "fx" ? null : quote?.priceAsOf?.toISOString() ?? null,
          job: queued.find(row => row.key === job.key) });
      });
      items.push(...(native.items ?? []));
      if (native.failed && !native.items?.length) items.push(refreshItem({ id: "native:unavailable", label: "해외 시세·환율", provider: "Twelve Data", startedAt, valid: false, fresh: false, supported: false }));
      // A disabled lane must not turn an owned but unsupported instrument into
      // an empty/successful operation.
      if (!configured) for (const target of targets) if (!items.some(item => item.label === target.ticker)) items.push(refreshItem({
        id: `unsupported:${target.market}:${target.ticker}`, label: target.ticker, provider: "", valid: false, fresh: false, startedAt, supported: false }));
      const progress = refreshProgress(items);
      const state = refreshProgressState(progress);
      return response({ ...body, state, startedAt, progress, readVersion, targetCount: targets.length }, state === "queued" ? 202 : status >= 400 ? status : 200, headers);
    };
    const jobs: CollectionInput[] = plan.staleTargets.map(target => ({ ...target, kind: "live" }));
    if (fxPlan.shouldRefresh && fxTarget) jobs.push({ kind: "fx", ticker: fxTarget.ticker, market: "us", currency: "USD" });
    if (jobs.length === 0) {
      // Polling can wake another pending lane without admitting arbitrary instruments.
      scheduleMarketCollection();
      return finish({ freshTargetCount: plan.freshTargetCount, retryAfterSeconds: 10 });
    }
    if (!configured) {
      if (!native.available) return finish({ state: "provider_unavailable" });
      scheduleMarketCollection();
      return finish({ unavailableProvider: "kis", retryAfterSeconds: 10 });
    }
    if (reason !== "manual") {
      scheduleMarketCollection();
      return finish({ retryAfterSeconds: 10, freshTargetCount: plan.freshTargetCount });
    }
    // Keep the instrument cap separate from the one shared FX request.
    const admissions = await Promise.allSettled([
      jobs.filter(job => job.kind !== "fx"), jobs.filter(job => job.kind === "fx"),
    ].filter(lane => lane.length).map(lane => enqueueMarketCollection(lane)));
    const accepted = admissions.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (accepted.length !== admissions.length) {
      scheduleMarketCollection();
      return finish({ retryAfterSeconds: 10 });
    }
    const result = accepted[0];
    scheduleMarketCollection();
    return finish({ queuedTargetCount: jobs.length, freshTargetCount: plan.freshTargetCount,
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
      priceAsOf: livePriceQuotes.priceAsOf,
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

async function readRefreshReason(request: Request): Promise<{ reason: RefreshReason; startedAt: string } | null> {
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
    (!/^(?:0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > 128)
  ) {
    return null;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isRecord(body) || Object.keys(body).some(key => key !== "reason" && key !== "startedAt")) return null;
  if (body.reason !== "page_view" && body.reason !== "manual" && body.reason !== "poll") return null;
  if (body.startedAt !== undefined && (body.reason !== "poll" || typeof body.startedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.startedAt) || !Number.isFinite(Date.parse(body.startedAt)) ||
    Date.parse(body.startedAt) > Date.now() + 60_000 || Date.now() - Date.parse(body.startedAt) > 31 * 60_000)) return null;
  return { reason: body.reason, startedAt: typeof body.startedAt === "string" ? body.startedAt : new Date().toISOString() };
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
