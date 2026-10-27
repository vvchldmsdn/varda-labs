"use server";

import { revalidatePath } from "next/cache";

import type { HoldingOnboardingActionState } from "@/lib/holding-onboarding";
import { writeSessionHoldingOnboarding } from "@/lib/holding-onboarding-write";
import { MAX_HOLDING_BATCH, type HoldingBatchState } from "@/lib/holding-batch";
import { parseHoldingOnboardingInput } from "@/lib/holding-onboarding";

export async function createHoldingBatch(
  _previousState: HoldingBatchState,
  formData: FormData,
): Promise<HoldingBatchState> {
  const raw = formData.get("holdings");
  if (typeof raw !== "string" || raw.length > 32_000) return { status: "invalid", results: [] };
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { return { status: "invalid", results: [] }; }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_HOLDING_BATCH) return { status: "invalid", results: [] };
  const prepared: { key: string; data: FormData }[] = [];
  const identities = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.key !== "string" || !row.key.trim() || row.key.length > 60 || prepared.some(item => item.key === row.key)) return { status: "invalid", results: [] };
    const data = new FormData();
    for (const field of ["accountId", "portfolioGroupId", "newPortfolioGroupName"]) data.set(field, formData.get(field) ?? "");
    for (const field of ["instrumentId", "ticker", "name", "market", "assetType", "quantity", "averageCost", "currentPrice"]) {
      if (typeof row[field] !== "string") return { status: "invalid", results: [] };
      data.set(field, row[field]);
    }
    const parsed = parseHoldingOnboardingInput(data);
    if (!parsed.ok) return { status: "invalid", results: [{ key: row.key, result: { status: "invalid", message: parsed.message } }] };
    const identity = `${parsed.input.market}|${parsed.input.currency}|${parsed.input.ticker}`;
    if (identities.has(identity)) return { status: "invalid", results: [] };
    identities.add(identity);
    prepared.push({ key: row.key, data });
  }
  const results: HoldingBatchState["results"] = [];
  // Every row uses the existing owner-locked writer. Partial completion is explicit;
  // retries submit only unsaved rows, never a fictional all-or-nothing success.
  for (const row of prepared) {
    let result: HoldingOnboardingActionState;
    try {
      result = await writeSessionHoldingOnboarding(row.data);
    } catch {
      // Keep earlier successes visible if an unexpected transport failure occurs.
      results.push({ key: row.key, result: { status: "error", message: "저장 상태를 확인하지 못했습니다. 보유 내역을 확인한 뒤 다시 시도해 주세요." } });
      break;
    }
    results.push({ key: row.key, result });
    if (result.status === "unauthorized" || result.status === "price_unavailable") break;
  }
  if (results.some(row => row.result.status === "success")) revalidateHoldingPages();
  return { status: results.length === prepared.length && results.every(row => row.result.status === "success") ? "complete" : "partial", results };
}

export async function createHoldingOnboarding(
  _previousState: HoldingOnboardingActionState,
  formData: FormData,
): Promise<HoldingOnboardingActionState> {
  const result = await writeSessionHoldingOnboarding(formData);

  if (result.status === "success") {
    revalidateHoldingPages();
  }

  return result;
}

function revalidateHoldingPages() {
  for (const path of [
      "/",
      "/today",
      "/additional-contribution",
      "/history",
      "/portfolio/first-look",
      "/portfolio/onboarding",
      "/portfolio/groups",
      "/portfolio/holdings",
      "/portfolio/holdings/new",
      "/portfolio/risk",
      "/portfolio/structure",
      "/portfolio/targets",
      "/investment-lab",
      "/simulation",
  ]) {
    revalidatePath(path);
  }
}
