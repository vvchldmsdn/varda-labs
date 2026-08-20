"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SelfServiceTenantOnboardingActionState } from "@/lib/auth/self-service-tenant-onboarding";
import { createCurrentSessionTenant } from "@/lib/auth/self-service-tenant-onboarding-write";

export async function createEmptyPortfolio(
  _previousState: SelfServiceTenantOnboardingActionState,
  formData: FormData,
) {
  const result = await createCurrentSessionTenant(formData);
  if (result.status === "success" || result.status === "already_ready") {
    revalidatePath("/portfolio/onboarding");
    revalidatePath("/portfolio/accounts");
    redirect("/portfolio/accounts?account=all");
  }
  return result;
}
