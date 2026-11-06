import "server-only";
import { fxObservationWrite } from "./fx-observation-write";
import { preserveUnchangedCutoffFx } from "@/db/queries/snapshot-cutoff-observations";

import { and, eq, lte, isNull, or } from "drizzle-orm";

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
  FxRateCandidate,
  FxRateActualWrite,
  FxRefreshProviderName,
} from "@/lib/market-data/fx-refresh";

export async function runUsdKrwFxRefreshJob({
  dryRun = true,
  provider = "er-api-open",
  acceptExistingVardaRow = false,
  refreshUnchangedReceipt = false,
}: {
  dryRun?: boolean;
  provider?: FxRefreshProviderName;
  acceptExistingVardaRow?: boolean;
  refreshUnchangedReceipt?: boolean;
} = {}) {
  const candidate = await fetchUsdKrwFxCandidate({ provider });
  return runUsdKrwFxCandidateJob({
    candidate,
    dryRun,
    acceptExistingVardaRow,
    refreshUnchangedReceipt,
  });
}

export async function runUsdKrwFxCandidateJob({
  candidate,
  dryRun = true,
  acceptExistingVardaRow = false,
  refreshUnchangedReceipt = false,
}: {
  candidate: FxRateCandidate;
  dryRun?: boolean;
  acceptExistingVardaRow?: boolean;
  refreshUnchangedReceipt?: boolean;
}) {
  const existingRows = await getExistingFxRows(candidate.rateDate);
  const basePlan = planFxRateWrite(candidate, existingRows);
  const observation = fxObservationWrite(candidate);
  const existing = existingRows.length === 1 ? existingRows[0] : undefined;
  // A collection receipt cannot replace a dated reference, including its value.
  // Keeping only the old timestamp while replacing the rate would invent evidence.
  const preserveReference = basePlan.action !== 'blocked' && existing && !existing.legacyBase44Id && !existing.isSample && existing.status === 'ok'
    && !!existing.source && Number.isFinite(Number(existing.usdKrw)) && Number(existing.usdKrw) > 0
    && existing.observedAt && existing.fetchedAt && ['spot', 'daily_reference'].includes(existing.rateKind ?? '')
    && existing.observedAt.getTime() <= existing.fetchedAt.getTime() && existing.fetchedAt.getTime() <= Date.now()
    && !observation.observedAt;
  const plannedWrite = preserveReference
    ? { ...basePlan, action: 'planned_skip' as const, reason: 'dated_reference_preserved', plannedWrites: { insert: 0, update: 0, skip: 1, blocked: 0 } }
    : basePlan;
  const baseResult = {
    provider: candidate.provider,
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

  if (preserveReference) return { ...baseResult, ok: true, dryRun: false as const, writesEnabled: true as const,
    status: 'skipped' as const, contract: FX_REFRESH_ACTUAL_WRITE_CONTRACT, write: null };

  if (
    acceptExistingVardaRow &&
    plannedWrite.action === "planned_skip" &&
    plannedWrite.reason === "same_varda_row_value"
  ) {
    if (refreshUnchangedReceipt) {
      const receipt = new Date(candidate.fetchedAt);
      if (!Number.isFinite(receipt.getTime()) || receipt.getTime() > Date.now()) throw new Error('invalid_fx_receipt');
      const updated = await db.update(fxRates).set({fetchedAt: receipt, source: candidate.source, usdKrw: candidate.usdKrw, ...fxObservationWrite(candidate)}).where(and(
        unchangedFxRow(existingRows[0]),
        eq(fxRates.isSample, false), eq(fxRates.status, "ok"), isNull(fxRates.legacyBase44Id),
        or(isNull(fxRates.fetchedAt), lte(fxRates.fetchedAt, receipt)),
      )).returning({id:fxRates.id});
      if (!updated.length) throw new Error('fx_receipt_changed');
    } else await preserveUnchangedCutoffFx(candidate, existingRows[0]);
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
    write: await executeFxRateActualWrite(preparedWrite.write, observation, existing),
  };
}

type FxEvidenceRow = ExistingFxRateRow & { observedAt: Date | null; fetchedAt: Date | null; rateKind: string | null; isSample: boolean };
function unchangedFxRow(row: FxEvidenceRow) {
  return and(eq(fxRates.id, row.id), eq(fxRates.usdKrw, String(row.usdKrw)),
    row.source == null ? isNull(fxRates.source) : eq(fxRates.source, row.source),
    row.observedAt == null ? isNull(fxRates.observedAt) : eq(fxRates.observedAt, row.observedAt),
    row.fetchedAt == null ? isNull(fxRates.fetchedAt) : eq(fxRates.fetchedAt, row.fetchedAt),
    row.rateKind == null ? isNull(fxRates.rateKind) : eq(fxRates.rateKind, row.rateKind),
    row.status == null ? isNull(fxRates.status) : eq(fxRates.status, row.status),
    eq(fxRates.isSample, row.isSample), isNull(fxRates.legacyBase44Id));
}
async function getExistingFxRows(rateDate: string): Promise<FxEvidenceRow[]> {
  return db
    .select({
      id: fxRates.id,
      rateDate: fxRates.rateDate,
      usdKrw: fxRates.usdKrw,
      source: fxRates.source,
      status: fxRates.status,
      legacyBase44Id: fxRates.legacyBase44Id,
      observedAt: fxRates.observedAt, fetchedAt: fxRates.fetchedAt, rateKind: fxRates.rateKind, isSample: fxRates.isSample,
    })
    .from(fxRates)
    .where(eq(fxRates.rateDate, rateDate));
}

async function executeFxRateActualWrite(write: FxRateActualWrite, observation: ReturnType<typeof fxObservationWrite>, existing?: FxEvidenceRow) {
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
      .values({ ...write.values, ...observation })
      .returning(returning);

    return { action: "inserted" as const, table: write.table, row: inserted };
  }

  if (!existing) throw new Error('fx_write_target_not_found');
  const [updated] = await db
    .update(fxRates)
    .set({ ...write.values, ...observation })
    .where(and(unchangedFxRow(existing), or(isNull(fxRates.fetchedAt), lte(fxRates.fetchedAt, write.values.fetchedAt))))
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
