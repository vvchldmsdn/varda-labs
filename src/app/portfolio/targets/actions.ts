"use server";

import { revalidatePath } from "next/cache";

import {
  writeSessionPortfolioTargetPolicy,
  type PortfolioTargetPolicyActionState,
} from "@/lib/portfolio-target-policy-write";

export async function savePortfolioTargetPolicy(
  _previousState: PortfolioTargetPolicyActionState,
  formData: FormData,
): Promise<PortfolioTargetPolicyActionState> {
  const result = await writeSessionPortfolioTargetPolicy(formData);
  if (result.status === "success") {
    for (const path of [
      "/portfolio/targets",
      "/portfolio/structure",
      "/additional-contribution",
      "/investment-lab",
      "/simulation",
    ]) {
      revalidatePath(path);
    }
  }
  return result;
}
