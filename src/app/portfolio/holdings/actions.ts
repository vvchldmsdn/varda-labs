"use server";

import { revalidatePath } from "next/cache";

import type { ManualKrxGoldPriceActionState } from "@/lib/market-data/manual-asset-price";
import { writeSessionManualKrxGoldPrice } from "@/lib/market-data/manual-krx-gold-price-write";

export type { ManualKrxGoldPriceActionState } from "@/lib/market-data/manual-asset-price";

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
