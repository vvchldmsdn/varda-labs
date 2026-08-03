import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { parseBooleanQuery, parseEnumQuery } from "@/lib/http-query";
import {
  FX_REFRESH_PROVIDER_NAMES,
  FxRefreshRequestError,
} from "@/lib/market-data/fx-refresh";
import { runUsdKrwFxRefreshJob } from "@/lib/market-data/fx-refresh-job";
import type { FxRefreshProviderName } from "@/lib/market-data/fx-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAuthorizedAdminJob(request.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = parseBooleanQuery(url.searchParams.get("dryRun"), true);
  const confirmWrite = parseBooleanQuery(
    url.searchParams.get("confirmWrite"),
    false,
  );
  const provider = parseProvider(url.searchParams.get("provider"));

  if (dryRun === null) {
    return NextResponse.json(
      { error: "dryRun must be true or false when provided" },
      { status: 400 },
    );
  }

  if (confirmWrite === null) {
    return NextResponse.json(
      { error: "confirmWrite must be true or false when provided" },
      { status: 400 },
    );
  }

  if (provider === null) {
    return NextResponse.json(
      { error: "provider must be one of: er-api-open" },
      { status: 400 },
    );
  }

  if (!dryRun && !confirmWrite) {
    return NextResponse.json(
      {
        error: "FX writes require dryRun=false and confirmWrite=true",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runUsdKrwFxRefreshJob({ dryRun, provider });
    return NextResponse.json(result, {
      status: result.status === "blocked" ? 409 : 200,
    });
  } catch (error) {
    if (error instanceof FxRefreshRequestError) {
      return NextResponse.json(
        {
          error: error.code,
          message: error.message,
          details: error.details,
        },
        { status: error.statusCode },
      );
    }

    return NextResponse.json(
      { error: "fx_refresh_dry_run_failed" },
      { status: 500 },
    );
  }
}

function parseProvider(value: string | null): FxRefreshProviderName | null {
  return parseEnumQuery(value, FX_REFRESH_PROVIDER_NAMES, "er-api-open");
}
