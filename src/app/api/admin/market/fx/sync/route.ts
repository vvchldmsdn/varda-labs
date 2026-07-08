import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { parseBooleanQuery, parseEnumQuery } from "@/lib/http-query";
import {
  fetchUsdKrwFxCandidate,
  FX_REFRESH_PROVIDER_NAMES,
  FX_REFRESH_DRY_RUN_CONTRACT,
  FxRefreshRequestError,
  planFxRateWrite,
} from "@/lib/market-data/fx-refresh";
import type {
  ExistingFxRateRow,
  FxRefreshProviderName,
} from "@/lib/market-data/fx-refresh";

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

  if (!dryRun) {
    return NextResponse.json(
      {
        error: "fx_actual_write_not_implemented",
        message:
          "FX actual writes require a separate approval after dry-run smoke.",
      },
      { status: 409 },
    );
  }

  try {
    const candidate = await fetchUsdKrwFxCandidate({ provider });
    const existingRows = await getExistingFxRows(candidate.rateDate);
    const plannedWrite = planFxRateWrite(candidate, existingRows);

    return NextResponse.json({
      ok: plannedWrite.action !== "blocked",
      dryRun: true,
      writesEnabled: false,
      runMetadataWritten: false,
      provider,
      pair: candidate.pair,
      contract: FX_REFRESH_DRY_RUN_CONTRACT,
      candidate: {
        rateDate: candidate.rateDate,
        usdKrw: candidate.usdKrw,
        source: candidate.source,
        status: candidate.status,
        fetchedAt: candidate.fetchedAt,
        providerTimestamp: candidate.providerTimestamp,
      },
      existingRowCount: existingRows.length,
      plannedWrite,
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

async function getExistingFxRows(rateDate: string): Promise<ExistingFxRateRow[]> {
  return db
    .select({
      id: fxRates.id,
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      source: fxRates.source,
      status: fxRates.status,
      legacyBase44Id: fxRates.legacyBase44Id,
    })
    .from(fxRates)
    .where(eq(fxRates.rateDate, rateDate));
}
