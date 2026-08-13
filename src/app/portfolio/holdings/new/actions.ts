"use server";

import { revalidatePath } from "next/cache";

import type { HoldingOnboardingActionState } from "@/lib/holding-onboarding";
import { writeSessionHoldingOnboarding } from "@/lib/holding-onboarding-write";

export async function createHoldingOnboarding(
  _previousState: HoldingOnboardingActionState,
  formData: FormData,
): Promise<HoldingOnboardingActionState> {
  const result = await writeSessionHoldingOnboarding(formData);

  if (result.status === "success") {
    for (const path of [
      "/",
      "/today",
      "/additional-contribution",
      "/portfolio/groups",
      "/portfolio/holdings",
      "/portfolio/risk",
      "/portfolio/structure",
      "/portfolio/targets",
      "/investment-lab",
      "/simulation",
    ]) {
      revalidatePath(path);
    }
  }

  return result;
}
