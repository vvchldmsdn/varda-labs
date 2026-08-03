import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import {
  fetchUsdKrwFxCandidate,
  FX_REFRESH_ACTUAL_WRITE_CONTRACT,
  FX_REFRESH_DRY_RUN_CONTRACT,
  FxRefreshRequestError,
  planFxRateWrite,
  prepareFxRateActualWrite,
} from "@/lib/market-data/fx-refresh";
import type {
  ExistingFxRateRow,
  FxRateActualWrite,
  FxRefreshProviderName,
} from "@/lib/market-data/fx-refresh";

export async function runUsdKrwFxRefreshJob({
  dryRun = true,
  provider = "er-api-open",
  acceptExistingVardaRow = false,
}: {
  dryRun?: boolean;
  provider?: FxRefreshProviderName;
  acceptExistingVardaRow?: boolean;
} = {}) {
  const candidate = await fetchUsdKrwFxCandidate({ provider });
  const existingRows = await getExistingFxRows(candidate.rateDate);
  const plannedWrite = planFxRateWrite(candidate, existingRows);
  const baseResult = {
    provider,
    pair: candidate.pair,
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
    runMetadataWritten: false as const,
  };

  if (dryRun) {
    return {
      ...baseResult,
      ok: plannedWrite.action !== "blocked",
      dryRun: true as const,
      writesEnabled: false as const,
      status: "planned" as const,
      contract: FX_REFRESH_DRY_RUN_CONTRACT,
      write: null,
    };
  }

  if (
    acceptExistingVardaRow &&
    plannedWrite.action === "planned_skip" &&
    plannedWrite.reason === "same_varda_row_value"
  ) {
    return {
      ...baseResult,
      ok: true,
      dryRun: false as const,
      writesEnabled: true as const,
      status: "skipped" as const,
      contract: FX_REFRESH_ACTUAL_WRITE_CONTRACT,
      write: null,
    };
  }

  const preparedWrite = prepareFxRateActualWrite(candidate, plannedWrite);
  if (!preparedWrite.ok) {
    return {
      ...baseResult,
      ok: false,
      dryRun: false as const,
      writesEnabled: true as const,
      status: "blocked" as const,
      contract: FX_REFRESH_ACTUAL_WRITE_CONTRACT,
      reason: preparedWrite.reason,
      planAction: preparedWrite.planAction,
      write: null,
    };
  }

  return {
    ...baseResult,
    ok: true,
    dryRun: false as const,
    writesEnabled: true as const,
    status: "written" as const,
    contract: FX_REFRESH_ACTUAL_WRITE_CONTRACT,
    write: await executeFxRateActualWrite(preparedWrite.write),
  };
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

async function executeFxRateActualWrite(write: FxRateActualWrite) {
  const returning = {
    id: fxRates.id,
    rateDate: fxRates.rateDate,
    usdKrw: fxRates.usdKrw,
    source: fxRates.source,
    status: fxRates.status,
    fetchedAt: fxRates.fetchedAt,
  };

  if (write.action === "insert") {
    const [inserted] = await db
      .insert(fxRates)
      .values(write.values)
      .returning(returning);

    return { action: "inserted" as const, table: write.table, row: inserted };
  }

  const [updated] = await db
    .update(fxRates)
    .set(write.values)
    .where(eq(fxRates.id, write.id))
    .returning(returning);

  if (!updated) {
    throw new FxRefreshRequestError(
      "fx_write_target_not_found",
      "FX write target was not found",
      { statusCode: 409 },
    );
  }

  return { action: "updated" as const, table: write.table, row: updated };
}
