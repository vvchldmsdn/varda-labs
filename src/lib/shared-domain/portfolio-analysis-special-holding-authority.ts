import {
  KRX_GOLD_ACTIVE_VALUATION_POLICY,
  KRX_GOLD_CLOSE_ONLY_CONTRACT,
} from "./instrument-identity.ts";

export const DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS = Object.freeze({
  version: "legacy_imported_special_holding_decisions_v1",
  authority: "product_owner_review_2026_07_16",
  scope: Object.freeze(["investment_lab", "simulation"]),
  decisions: Object.freeze({
    krxGold: Object.freeze({
      assetName: "금현물",
      account: "brokerage",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
      productKey: KRX_GOLD_CLOSE_ONLY_CONTRACT.identityBinding.productKey,
      outcome: "manual_valuation_history_required",
    }),
    fount: Object.freeze({
      assetName: "Fount 일임서비스",
      account: "irp",
      market: "korea",
      currency: "KRW",
      assetType: "etf",
      outcome: "intentionally_excluded",
    }),
  }),
} as const);

export const PORTFOLIO_ANALYSIS_SPECIAL_HOLDING_POLICY = Object.freeze({
  version: "portfolio_analysis_special_holding_authority_v1",
  currentGoldValuation: KRX_GOLD_ACTIVE_VALUATION_POLICY.currentValuation.mode,
  matchBasis: "exact_name_account_market_currency_asset_type",
  nameOnlyInference: "forbidden",
} as const);

export type DecisionSupportSpecialHoldingKey =
  keyof typeof DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions;

export type DecisionSupportSpecialHoldingMetadata = Readonly<{
  assetName?: string | null;
  account?: string | null;
  market?: string | null;
  currency?: string | null;
  assetType?: string | null;
}>;

export function matchesDecisionSupportSpecialHolding(
  row: DecisionSupportSpecialHoldingMetadata,
  decisionKey: DecisionSupportSpecialHoldingKey,
) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions[decisionKey];
  return (
    normalizeLower(row.assetName) === normalizeLower(decision.assetName) &&
    normalizeLower(row.account) === decision.account &&
    normalizeLower(row.market) === decision.market &&
    normalizeUpper(row.currency) === decision.currency &&
    normalizeLower(row.assetType) === decision.assetType
  );
}

export function resolveDecisionSupportSpecialHolding(
  row: DecisionSupportSpecialHoldingMetadata,
): DecisionSupportSpecialHoldingKey | null {
  if (matchesDecisionSupportSpecialHolding(row, "fount")) return "fount";
  if (matchesDecisionSupportSpecialHolding(row, "krxGold")) return "krxGold";
  return null;
}

function normalizeLower(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUpper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
