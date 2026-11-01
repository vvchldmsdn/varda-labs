import { parseHoldingOnboardingInput, type HoldingOnboardingActionState } from "./holding-onboarding";

export const MAX_HOLDING_BATCH = 12;
export type HoldingDraft = {
  key: string; instrumentId: string; name: string; ticker: string;
  market: "korea" | "us"; assetType: "etf" | "stock";
  quantity: string; averageCost: string; currentPrice: string;
};
export type HoldingBatchState = {
  status: "idle" | "complete" | "partial" | "invalid";
  /** Absent only for an older server response or an unknown transport outcome. */
  attemptedKeys?: string[];
  results: { key: string; result: HoldingOnboardingActionState }[];
};

export function validateHoldingDrafts(rows: HoldingDraft[], context: FormData): HoldingBatchState["results"] {
  return rows.flatMap(row => {
    const input = new FormData();
    for (const field of ["accountId", "portfolioGroupId", "newPortfolioGroupName"]) input.set(field, context.get(field) ?? "");
    for (const [key, value] of Object.entries(row)) input.set(key === "key" ? "operationId" : key, value);
    const parsed = parseHoldingOnboardingInput(input);
    return parsed.ok ? [] : [{ key: row.key, result: { status: "invalid" as const, message: parsed.message } }];
  });
}

export function unresolvedHoldingKeys(submitted: HoldingDraft[], result: HoldingBatchState): string[] {
  return submitted.filter(row => {
    if (result.attemptedKeys && !result.attemptedKeys.includes(row.key)) return false;
    return !result.results.some(item => item.key === row.key && item.result.status !== "error");
  }).map(row => row.key);
}
