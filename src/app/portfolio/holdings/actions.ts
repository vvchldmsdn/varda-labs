"use server";

import { revalidatePath } from "next/cache";

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
