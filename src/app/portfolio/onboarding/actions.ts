"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SelfServiceTenantOnboardingActionState } from "@/lib/auth/self-service-tenant-onboarding";
import { createCurrentSessionTenant } from "@/lib/auth/self-service-tenant-onboarding-write";
import { createAccount } from "@/app/portfolio/accounts/actions";
import type { AccountManagementActionState } from "@/lib/account-management";

export async function createEmptyPortfolio(
  _previousState: SelfServiceTenantOnboardingActionState,
  formData: FormData,
) {
  const result = await createCurrentSessionTenant(formData);
  if (result.status === "success" || result.status === "already_ready") {
    revalidatePath("/portfolio/onboarding");
    revalidatePath("/portfolio/accounts");
    redirect("/portfolio/onboarding");
  }
  return result;
}

export async function createFirstAccount(
  previousState: AccountManagementActionState,
  formData: FormData,
) {
  const result = await createAccount(previousState, formData);
  if (result.status === "success") {
    revalidatePath("/portfolio/onboarding");
    redirect("/portfolio/onboarding");
  }
  return result;
}
