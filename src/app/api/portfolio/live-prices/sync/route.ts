import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { getTenantLivePriceTargets } from "@/db/queries/tenant-live-price-targets";
import { fxRates, livePriceQuotes } from "@/db/schema";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import {
  getKisPriceSyncCooldownStatus,
  PriceSyncError,
  PriceSyncRequestError,
  runMarketPriceSync,
} from "@/lib/market-data/price-sync";
import {
  createKisMarketDataProvider,
  getKisProviderPolicy,
} from "@/lib/market-data/providers/kis";
import { runUsdKrwFxRefreshJob } from "@/lib/market-data/fx-refresh-job";
import {
  planTenantLiveFxSync,
  type TenantLiveFxSyncPlan,
} from "@/lib/market-data/tenant-live-fx-sync-policy";
import {
  planTenantLivePriceSync,
  TENANT_LIVE_PRICE_SYNC_POLICY,
  type TenantLivePriceTarget,
} from "@/lib/market-data/tenant-live-price-sync-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RefreshReason = "page_view" | "manual";
type PriceRefreshState =
  | "fresh"
  | "synced"
  | "partial"
  | "cooldown"
  | "provider_unavailable"
  | "provider_failed";
type FxRefreshState = "not_required" | "fresh" | "synced" | "provider_failed";

type PriceRefreshOutcome = Readonly<{
  state: PriceRefreshState;
  requestedTargetCount: number;
  refreshedTargetCount: number;
  failedTargetCount: number;
  retryAfterSeconds: number | null;
}>;

type FxRefreshOutcome = Readonly<{ state: FxRefreshState }>;

export async function POST(request: Request) {
  const reason = await readRefreshReason(request);
  if (!reason) return response({ state: "invalid_request" }, 400);

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return response(
      { state: "session_unavailable" },
      resolution.failure.httpStatus,
    );
  }

  try {
    const targets = await getTenantLivePriceTargets(resolution.tenantContext);
    if (targets.length === 0) {
      return response({ state: "empty", targetCount: 0 });
    }
    if (targets.length > TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount) {
      return response(
        {
          state: "target_limit_exceeded",
          targetCount: targets.length,
          maximumTargetCount:
            TENANT_LIVE_PRICE_SYNC_POLICY.maximumTargetCount,
        },
        409,
      );
    }

    const [quotes, fxEvidence] = await Promise.all([
      getCurrentKisQuoteEvidence(targets),
      getCurrentUsdKrwEvidence(),
    ]);
    const plan = planTenantLivePriceSync({ targets, quotes });
    const requestedTargets =
      reason === "manual" ? plan.targets : plan.staleTargets;
    const fxPlan = planTenantLiveFxSync({
      currencies: targets.map((target) => target.currency),
      evidence: fxEvidence,
      reason,
    });

    const [priceOutcome, fxOutcome] = await Promise.all([
      refreshKisPrices(requestedTargets),
      refreshUsdKrw(fxPlan),
    ]);

    return combinedRefreshResponse({
      freshTargetCount: plan.freshTargetCount,
      fxOutcome,
      priceOutcome,
      targetCount: plan.targets.length,
    });
  } catch (error) {
    if (error instanceof PriceSyncRequestError) {
      return response({ state: "sync_request_rejected" }, error.statusCode);
    }
    if (error instanceof PriceSyncError) {
      return response({ state: "provider_failed" }, 502);
    }
    return response({ state: "service_unavailable" }, 503);
  }
}

async function refreshKisPrices(
  requestedTargets: readonly TenantLivePriceTarget[],
): Promise<PriceRefreshOutcome> {
  if (requestedTargets.length === 0) {
    return priceOutcome("fresh");
  }

  const providerPolicy = getKisProviderPolicy();
  if (!providerPolicy.configured) {
    return priceOutcome("provider_unavailable", requestedTargets.length);
  }

  const cooldown = await getKisPriceSyncCooldownStatus("live");
  if (cooldown.active) {
    return Object.freeze({
      ...priceOutcome("cooldown", requestedTargets.length),
      retryAfterSeconds: cooldown.retryAfterSeconds,
    });
  }

  try {
    const result = await runMarketPriceSync({
      mode: "live",
      dryRun: false,
      fixture: false,
      provider: createKisMarketDataProvider(),
      explicitTargets: [...requestedTargets],
    });
    const refreshedTargetCount = result.insertedCount + result.updatedCount;

    if (refreshedTargetCount === 0) {
      return Object.freeze({
        ...priceOutcome("provider_failed", result.requestedCount),
        failedTargetCount: result.failedCount,
      });
    }

    return Object.freeze({
      state: result.failedCount > 0 ? "partial" : "synced",
      requestedTargetCount: result.requestedCount,
      refreshedTargetCount,
      failedTargetCount: result.failedCount,
      retryAfterSeconds: null,
    });
  } catch (error) {
    if (error instanceof PriceSyncRequestError || error instanceof PriceSyncError) {
      return priceOutcome("provider_failed", requestedTargets.length);
    }
    throw error;
  }
}

async function refreshUsdKrw(
  plan: TenantLiveFxSyncPlan,
): Promise<FxRefreshOutcome> {
  if (plan.state === "not_required") {
    return Object.freeze({ state: "not_required" });
  }
  if (!plan.shouldRefresh) return Object.freeze({ state: "fresh" });

  try {
    const result = await runUsdKrwFxRefreshJob({
      dryRun: false,
      provider: "er-api-open",
      acceptExistingVardaRow: true,
    });
    if (!result.ok) return Object.freeze({ state: "provider_failed" });
    return Object.freeze({
      state: result.status === "written" ? "synced" : "fresh",
    });
  } catch {
    return Object.freeze({ state: "provider_failed" });
  }
}

function priceOutcome(
  state: PriceRefreshState,
  requestedTargetCount = 0,
): PriceRefreshOutcome {
  return Object.freeze({
    state,
    requestedTargetCount,
    refreshedTargetCount: 0,
    failedTargetCount: 0,
    retryAfterSeconds: null,
  });
}

function combinedRefreshResponse({
  freshTargetCount,
  fxOutcome,
  priceOutcome: prices,
  targetCount,
}: {
  freshTargetCount: number;
  fxOutcome: FxRefreshOutcome;
  priceOutcome: PriceRefreshOutcome;
  targetCount: number;
}) {
  const details = {
    targetCount,
    freshTargetCount,
    requestedTargetCount: prices.requestedTargetCount,
    refreshedTargetCount: prices.refreshedTargetCount,
    failedTargetCount: prices.failedTargetCount,
    priceState: prices.state,
    fxState: fxOutcome.state,
  };
  const priceChanged = prices.state === "synced" || prices.state === "partial";
  const fxChanged = fxOutcome.state === "synced";
  const hasFailure =
    prices.state === "provider_unavailable" ||
    prices.state === "provider_failed" ||
    fxOutcome.state === "provider_failed";

  if (prices.state === "cooldown" && !fxChanged) {
    const retryAfterSeconds = prices.retryAfterSeconds ?? 1;
    return response(
      { state: "cooldown", retryAfterSeconds, ...details },
      429,
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  if (hasFailure && !priceChanged && !fxChanged) {
    return response(
      {
        state:
          prices.state === "provider_unavailable"
            ? "provider_unavailable"
            : "provider_failed",
        ...details,
      },
      prices.state === "provider_unavailable" ? 503 : 502,
    );
  }

  if (hasFailure || prices.state === "partial" || prices.state === "cooldown") {
    return response({ state: "partial", ...details });
  }

  return response({
    state: priceChanged || fxChanged ? "synced" : "fresh",
    ...details,
  });
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
  return body.reason === "page_view" || body.reason === "manual"
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
