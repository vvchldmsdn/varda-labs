import { NextResponse } from "next/server";

import {
  getKisProviderPolicy,
  createKisMarketDataProvider,
} from "@/lib/market-data/providers/kis";
import {
  getKisPriceSyncCooldownStatus,
  isPriceSyncMode,
  PriceSyncError,
  runMarketPriceSync,
} from "@/lib/market-data/price-sync";

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
    });
    return NextResponse.json(result);
  } catch (error) {
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

function isAuthorizedAdminJob(headers: Headers) {
  const configuredSecret = getConfiguredSecret();
  const presentedSecret = getPresentedSecret(headers);

  return configuredSecret !== null && presentedSecret === configuredSecret;
}

function getConfiguredSecret() {
  const secret = process.env.ADMIN_JOB_SECRET ?? process.env.CRON_SECRET;
  const normalized = secret?.trim();
  return normalized ? normalized : null;
}

function getPresentedSecret(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  const bearerPrefix = "Bearer ";

  if (authorization?.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    return token ? token : null;
  }

  const headerSecret = headers.get("x-admin-job-secret")?.trim();
  return headerSecret ? headerSecret : null;
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
