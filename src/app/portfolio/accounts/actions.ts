"use server";

import { revalidatePath } from "next/cache";

import type { AccountManagementActionState } from "@/lib/account-management";
import {
  archiveSessionAccount,
  createSessionAccount,
  restoreSessionAccount,
  updateSessionAccount,
} from "@/lib/account-management-write";

const AFFECTED_PATHS = [
  "/",
  "/today",
  "/additional-contribution",
  "/history",
  "/portfolio/accounts",
  "/portfolio/groups",
  "/portfolio/holdings",
  "/portfolio/holdings/new",
  "/portfolio/risk",
  "/portfolio/structure",
  "/portfolio/targets",
  "/investment-lab",
  "/simulation",
] as const;

export async function createAccount(
  _previousState: AccountManagementActionState,
  formData: FormData,
) {
  return complete(await createSessionAccount(formData));
}

export async function updateAccount(
  _previousState: AccountManagementActionState,
  formData: FormData,
) {
  return complete(await updateSessionAccount(formData));
}

export async function archiveAccount(
  _previousState: AccountManagementActionState,
  formData: FormData,
) {
  return complete(await archiveSessionAccount(formData));
}

export async function restoreAccount(
  _previousState: AccountManagementActionState,
  formData: FormData,
) {
  return complete(await restoreSessionAccount(formData));
}

function complete(result: AccountManagementActionState) {
  if (result.status === "success") {
    for (const path of AFFECTED_PATHS) revalidatePath(path);
  }
  return result;
}
