import { NextResponse } from "next/server";

import {
  isPriceSyncMode,
  PriceSyncError,
  runMarketPriceSync,
} from "@/lib/market-data/price-sync";

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

  const fixture = parseBooleanQuery(
    url.searchParams.get("fixture"),
    mode === "close" && dryRun,
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

  if (mode === "close" && !dryRun && (!fixture || priceDate === undefined)) {
    return NextResponse.json(
      {
        error:
          "close fixture writes require dryRun=false, fixture=true, and date=YYYY-MM-DD",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runMarketPriceSync({
      mode,
      dryRun,
      fixture,
      priceDate,
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
