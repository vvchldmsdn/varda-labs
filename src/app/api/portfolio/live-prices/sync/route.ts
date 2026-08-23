import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { getTenantLivePriceTargets } from "@/db/queries/tenant-live-price-targets";
import { livePriceQuotes } from "@/db/schema";
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
import {
  planTenantLivePriceSync,
  TENANT_LIVE_PRICE_SYNC_POLICY,
  type TenantLivePriceTarget,
} from "@/lib/market-data/tenant-live-price-sync-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type RefreshReason = "page_view" | "manual";

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

    const quotes = await getCurrentKisQuoteEvidence(targets);
    const plan = planTenantLivePriceSync({ targets, quotes });
    const requestedTargets =
      reason === "manual" ? plan.targets : plan.staleTargets;

    if (requestedTargets.length === 0) {
      return response({
        state: "fresh",
        targetCount: plan.targets.length,
        freshTargetCount: plan.freshTargetCount,
        refreshedTargetCount: 0,
      });
    }

    const providerPolicy = getKisProviderPolicy();
    if (!providerPolicy.configured) {
      return response({ state: "provider_unavailable" }, 503);
    }

    const cooldown = await getKisPriceSyncCooldownStatus("live");
    if (cooldown.active) {
      return response(
        {
          state: "cooldown",
          retryAfterSeconds: cooldown.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(cooldown.retryAfterSeconds) },
      );
    }

    const result = await runMarketPriceSync({
      mode: "live",
      dryRun: false,
      fixture: false,
      provider: createKisMarketDataProvider(),
      explicitTargets: requestedTargets,
    });
    const refreshedTargetCount = result.insertedCount + result.updatedCount;

    if (refreshedTargetCount === 0) {
      return response(
        {
          state: "provider_failed",
          requestedTargetCount: result.requestedCount,
          failedTargetCount: result.failedCount,
        },
        502,
      );
    }

    return response({
      state: result.failedCount > 0 ? "partial" : "synced",
      targetCount: plan.targets.length,
      requestedTargetCount: result.requestedCount,
      refreshedTargetCount,
      failedTargetCount: result.failedCount,
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
