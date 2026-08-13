"use server";

import { revalidatePath } from "next/cache";

import {
  archiveSessionPortfolioGroup,
  writeSessionPortfolioGroup,
} from "@/lib/portfolio-group-management-write";
import type { PortfolioGroupManagementActionState } from "@/lib/portfolio-group-management";

const AFFECTED_PATHS = [
  "/",
  "/today",
  "/additional-contribution",
  "/history",
  "/portfolio/groups",
  "/portfolio/holdings",
  "/portfolio/holdings/new",
  "/portfolio/structure",
  "/portfolio/risk",
  "/portfolio/targets",
  "/investment-lab",
  "/simulation",
] as const;

export async function savePortfolioGroup(
  _previousState: PortfolioGroupManagementActionState,
  formData: FormData,
): Promise<PortfolioGroupManagementActionState> {
  const result = await writeSessionPortfolioGroup(formData);
  if (result.status === "success") revalidateAffectedPaths();
  return result;
}

export async function archivePortfolioGroup(
  _previousState: PortfolioGroupManagementActionState,
  formData: FormData,
): Promise<PortfolioGroupManagementActionState> {
  const result = await archiveSessionPortfolioGroup(formData);
  if (result.status === "success") revalidateAffectedPaths();
  return result;
}

function revalidateAffectedPaths() {
  for (const path of AFFECTED_PATHS) revalidatePath(path);
}
