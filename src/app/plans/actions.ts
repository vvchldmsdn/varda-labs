"use server";
import { createCurrentSessionTenant } from "@/lib/auth/self-service-tenant-onboarding-write";
export async function preparePlanAccount(formData: FormData) {
  // Existing verified-identity creation, never creates accounts or holdings.
  return createCurrentSessionTenant(formData);
}
