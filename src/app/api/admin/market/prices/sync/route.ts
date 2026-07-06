import { NextResponse } from "next/server";

import {
  getKisProviderPolicy,
  createKisMarketDataProvider,
} from "@/lib/market-data/providers/kis";
import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import {
  getKisPriceSyncCooldownStatus,
  isPriceSyncMode,
  PriceSyncError,
  PriceSyncRequestError,
  runMarketPriceSync,
} from "@/lib/market-data/price-sync";
import type { PriceSyncTargetFilter } from "@/lib/market-data/price-sync";

type PriceProviderName = "stub" | "kis";
const KIS_WRITE_TARGET_LIMIT_MAX = 5;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const dryRun = parseBooleanQuery(url.searchParams.get("dryRun"), true);
  const priceDate = parsePriceDate(url.searchParams.get("date"));
  const providerName = parseProvider(url.searchParams.get("provider"));
  const targetLimit = parseTargetLimit(url.searchParams.get("limit"));
  const targetFilter = parseTargetFilter(url.searchParams);
  const confirmWrite = parseBooleanQuery(
    url.searchParams.get("confirmWrite"),
    false,
  );

  if (!isPriceSyncMode(mode)) {
    return NextResponse.json(
      { error: "mode must be one of: live, close" },
      { status: 400 },
    );
  }

  if (dryRun === null) {
    return NextResponse.json(
      { error: "dryRun must be true or false when provided" },
      { status: 400 },
    );
  }

  if (providerName === null) {
    return NextResponse.json(
      { error: "provider must be one of: stub, kis" },
      { status: 400 },
    );
  }

  if (targetLimit === null) {
    return NextResponse.json(
      { error: "limit must be an integer between 1 and 15 when provided" },
      { status: 400 },
    );
  }

  if (targetFilter.error) {
    return NextResponse.json({ error: targetFilter.error }, { status: 400 });
  }

  if (confirmWrite === null) {
    return NextResponse.json(
      { error: "confirmWrite must be true or false when provided" },
      { status: 400 },
    );
  }

  const fixture = parseBooleanQuery(
    url.searchParams.get("fixture"),
    providerName === "stub" && mode === "close" && dryRun,
  );

  if (fixture === null) {
    return NextResponse.json(
      { error: "fixture must be true or false when provided" },
      { status: 400 },
    );
  }

  if (priceDate === null) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD when provided" },
      { status: 400 },
    );
  }

  if (mode === "live" && fixture) {
    return NextResponse.json(
      { error: "fixture is only supported for close mode" },
      { status: 400 },
    );
  }

  if (providerName === "kis") {
    const kisPolicy = getKisProviderPolicy();

    if (mode !== "close" || fixture) {
      return NextResponse.json(
        {
          error:
            "provider=kis is only enabled for mode=close and fixture=false",
        },
        { status: 400 },
      );
    }

    if (!dryRun && !confirmWrite) {
      return NextResponse.json(
        {
          error:
            "KIS close writes require dryRun=false and confirmWrite=true",
        },
        { status: 400 },
      );
    }

    if (
      !dryRun &&
      (targetLimit === undefined || targetLimit > KIS_WRITE_TARGET_LIMIT_MAX)
    ) {
      return NextResponse.json(
        {
          error: `KIS close writes require limit between 1 and ${KIS_WRITE_TARGET_LIMIT_MAX}`,
        },
        { status: 400 },
      );
    }

    if (!kisPolicy.configured) {
      return NextResponse.json(
        {
          error: "KIS provider is not configured",
          provider: "kis",
          missingEnvKeys: kisPolicy.missingEnvKeys,
        },
        { status: 503 },
      );
    }

    const cooldown = await getKisPriceSyncCooldownStatus(mode);

    if (cooldown.active) {
      return NextResponse.json(
        {
          error: "kis_job_cooldown_active",
          provider: cooldown.provider,
          mode: cooldown.mode,
          cooldownSeconds: cooldown.cooldownSeconds,
          retryAfterSeconds: cooldown.retryAfterSeconds,
          lastRunId: cooldown.lastRunId,
          lastRunStatus: cooldown.lastRunStatus,
          lastRunStartedAt: cooldown.lastRunStartedAt,
          lastRunFinishedAt: cooldown.lastRunFinishedAt,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(cooldown.retryAfterSeconds),
          },
        },
      );
    }
  }

  if (
    providerName === "stub" &&
    mode === "close" &&
    !dryRun &&
    (!fixture || priceDate === undefined)
  ) {
    return NextResponse.json(
      {
        error:
          "close fixture writes require dryRun=false, fixture=true, and date=YYYY-MM-DD",
      },
      { status: 400 },
    );
  }

  try {
    const provider =
      providerName === "kis" ? createKisMarketDataProvider() : undefined;
    const result = await runMarketPriceSync({
      mode,
      dryRun,
      fixture,
      priceDate,
      provider,
      targetLimit: targetLimit ?? undefined,
      targetFilter: targetFilter.value,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PriceSyncRequestError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        { status: error.statusCode },
      );
    }

    if (error instanceof PriceSyncError) {
      return NextResponse.json(
        {
          error: "Price sync failed",
          runId: error.runId,
          message: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ error: "Price sync failed" }, { status: 500 });
  }
}

function parseBooleanQuery(value: string | null, defaultValue: boolean) {
  if (value === null) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return null;
}

function parsePriceDate(value: string | null) {
  if (value === null) return undefined;
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function parseProvider(value: string | null): PriceProviderName | null {
  if (value === null || value.trim() === "") return "stub";

  const normalized = value.trim().toLowerCase();
  if (normalized === "stub" || normalized === "kis") return normalized;
  return null;
}

function parseTargetLimit(value: string | null) {
  if (value === null || value.trim() === "") return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 15) return null;
  return parsed;
}

function parseTargetFilter(searchParams: URLSearchParams): {
  value: PriceSyncTargetFilter;
  error: string | null;
} {
  const tickerResult = parseTickers(searchParams.get("tickers"));
  if (tickerResult === null) {
    return {
      value: {},
      error:
        "tickers must be a comma-separated list of ticker symbols using letters, numbers, dot, dash, or underscore",
    };
  }

  const marketResult = parseMarketFilter(searchParams.get("market"));
  if (marketResult === null) {
    return {
      value: {},
      error: "market must be one of: korea, us",
    };
  }

  const accountResult = parseAccountFilter(searchParams.get("account"));
  if (accountResult === null) {
    return {
      value: {},
      error: "account must be one of: brokerage, isa, irp, all",
    };
  }

  return {
    value: {
      tickers: tickerResult,
      market: marketResult,
      account: accountResult,
    },
    error: null,
  };
}

function parseTickers(value: string | null) {
  if (value === null) return undefined;

  const rawTickers = value.split(",");
  const tickers: string[] = [];
  const seen = new Set<string>();

  for (const rawTicker of rawTickers) {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker || ticker.length > 50 || !/^[A-Z0-9._-]+$/.test(ticker)) {
      return null;
    }

    if (!seen.has(ticker)) {
      seen.add(ticker);
      tickers.push(ticker);
    }
  }

  return tickers.length > 0 ? tickers : null;
}

function parseMarketFilter(value: string | null) {
  if (value === null || value.trim() === "") return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "korea" || normalized === "us") return normalized;
  return null;
}

function parseAccountFilter(value: string | null) {
  if (value === null || value.trim() === "") return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "all") return undefined;
  if (
    normalized === "brokerage" ||
    normalized === "isa" ||
    normalized === "irp"
  ) {
    return normalized;
  }

  return null;
}
