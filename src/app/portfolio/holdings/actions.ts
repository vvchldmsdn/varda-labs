"use server";

import { revalidatePath } from "next/cache";
import { readSessionHoldingAnalysisProgress } from "@/lib/holding-analysis-data-progress";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope } from "@/db/queries/holding-analysis-data-readiness";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export async function readHoldingAnalysisProgress(holdingId: string) {
  return readSessionHoldingAnalysisProgress(holdingId);
}

export async function readHoldingAnalysisScope(scopeKey: string) {
  const unavailable = { state: 'unavailable' as const };
  try {
    const session = await resolveCurrentTenantContext();
    if (!session.ok || typeof scopeKey !== 'string' || scopeKey.length > 80) return unavailable;
    const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext: session.tenantContext, scope: scopeKey });
    if (context.state !== 'ready' || context.resolution.state !== 'resolved') return unavailable;
    return await getReadOnlyTenantHoldingAnalysisDataReadinessForScope({ tenantContext: session.tenantContext, scope: context.resolution.scope, serviceDate: resolveSnapshotCycle(new Date()).snapshotDate });
  } catch { return unavailable; }
}

import type {
  HoldingAnalysisDataPreparationActionState,
} from "@/lib/holding-analysis-data-readiness";
import { prepareSessionHoldingAnalysisData } from "@/lib/holding-analysis-data-preparation-write";
import type { HoldingStateCorrectionActionState } from "@/lib/holding-state-correction";
import { writeSessionHoldingStateCorrection } from "@/lib/holding-state-correction-write";
import type { HoldingLifecycleActionState } from "@/lib/holding-lifecycle";
import {
  archiveSessionHolding,
  restoreSessionHolding,
} from "@/lib/holding-lifecycle-write";
import type { ManualKrxGoldPriceActionState } from "@/lib/market-data/manual-asset-price";
import { writeSessionManualKrxGoldPrice } from "@/lib/market-data/manual-krx-gold-price-write";

export type { ManualKrxGoldPriceActionState } from "@/lib/market-data/manual-asset-price";

const HOLDING_STATE_AFFECTED_PATHS = [
  "/",
  "/today",
  "/additional-contribution",
  "/portfolio/holdings",
  "/portfolio/first-look",
  "/portfolio/groups",
  "/portfolio/risk",
  "/portfolio/structure",
  "/portfolio/targets",
  "/investment-lab",
  "/simulation",
] as const;

export async function correctHoldingState(
  _previousState: HoldingStateCorrectionActionState,
  formData: FormData,
): Promise<HoldingStateCorrectionActionState> {
  const state = await writeSessionHoldingStateCorrection(formData);
  if (state.status === "success") {
    for (const path of HOLDING_STATE_AFFECTED_PATHS) revalidatePath(path);
  }
  return state;
}

export async function archiveHolding(
  _previousState: HoldingLifecycleActionState,
  formData: FormData,
): Promise<HoldingLifecycleActionState> {
  const state = await archiveSessionHolding(formData);
  if (state.status === "success") {
    for (const path of HOLDING_STATE_AFFECTED_PATHS) revalidatePath(path);
  }
  return state;
}

export async function restoreHolding(
  _previousState: HoldingLifecycleActionState,
  formData: FormData,
): Promise<HoldingLifecycleActionState> {
  const state = await restoreSessionHolding(formData);
  if (state.status === "success") {
    for (const path of HOLDING_STATE_AFFECTED_PATHS) revalidatePath(path);
  }
  return state;
}

export async function updateManualKrxGoldPrice(
  _previousState: ManualKrxGoldPriceActionState,
  formData: FormData,
): Promise<ManualKrxGoldPriceActionState> {
  const state = await writeSessionManualKrxGoldPrice(
    formData.get("currentPrice"),
  );

  if (state.status === "success") {
    for (const path of [
      "/",
      "/today",
      "/additional-contribution",
      "/portfolio/holdings",
      "/portfolio/structure",
      "/investment-lab",
      "/simulation",
    ]) {
      revalidatePath(path);
    }
  }

  return state;
}

export async function prepareHoldingAnalysisData(
  _previousState: HoldingAnalysisDataPreparationActionState,
  formData: FormData,
): Promise<HoldingAnalysisDataPreparationActionState> {
  const state = await prepareSessionHoldingAnalysisData(formData);
  if (state.status === "success" || state.status === "already_ready") {
    for (const path of [
      "/additional-contribution",
      "/portfolio/holdings",
      "/portfolio/first-look",
      "/portfolio/risk",
      "/investment-lab",
      "/simulation",
    ]) {
      revalidatePath(path);
    }
  }
  return state;
}
