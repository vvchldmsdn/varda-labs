import type { HoldingOnboardingActionState } from "./holding-onboarding";

export const MAX_HOLDING_BATCH = 12;
export type HoldingDraft = {
  key: string; instrumentId: string; name: string; ticker: string;
  market: "korea" | "us"; assetType: "etf" | "stock";
  quantity: string; averageCost: string; currentPrice: string;
};
export type HoldingBatchState = {
  status: "idle" | "complete" | "partial" | "invalid";
  results: { key: string; result: HoldingOnboardingActionState }[];
};
