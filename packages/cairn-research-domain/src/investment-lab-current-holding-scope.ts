import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
} from "./portfolio-structure.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./investment-lab-special-holding-authority.ts";

export const INVESTMENT_LAB_CURRENT_HOLDING_SCOPE_POLICY = Object.freeze({
  version: "investment_lab_current_holding_scope_v1",
  scope: "investment_lab_and_simulation_research_only",
  exclusionAuthority: "explicit_static_owner_scope_decision",
  exclusionMatch: "exact_name_account_market_currency_asset_type",
  remainingWeightBasis: "renormalized_current_value",
  globalPortfolioMutation: "forbidden",
} as const);

export type InvestmentLabCurrentHoldingScopeInput = Readonly<{
  holdingRows: readonly PortfolioStructureHoldingRow[];
  exclusions: readonly PortfolioStructureExclusion[];
}>;

export type InvestmentLabCurrentHoldingScope = Readonly<{
  status: "not_applicable" | "applied";
  policy: typeof INVESTMENT_LAB_CURRENT_HOLDING_SCOPE_POLICY;
  excludedHoldingCount: number;
  excludedValuationGapCount: number;
  excludedCurrentValueKrw: number;
  portfolio: Readonly<{
    holdingRows: readonly PortfolioStructureHoldingRow[];
    exclusions: readonly PortfolioStructureExclusion[];
  }>;
}>;

export function applyInvestmentLabCurrentHoldingScope(
  input: InvestmentLabCurrentHoldingScopeInput,
): InvestmentLabCurrentHoldingScope {
  const excludedHoldings = input.holdingRows.filter(matchesFountDecision);
  const excludedValuationGaps = input.exclusions.filter(matchesFountDecision);
  const retainedHoldings = input.holdingRows.filter(
    (row) => !matchesFountDecision(row),
  );
  const retainedExclusions = input.exclusions.filter(
    (row) => !matchesFountDecision(row),
  );
  const totalValueKrw = retainedHoldings.reduce(
    (sum, row) => sum + finiteOrZero(row.currentValueKrw),
    0,
  );
  const holdingRows = retainedHoldings.map((row) =>
    Object.freeze({
      ...row,
      currentWeightPct:
        totalValueKrw > 0
          ? (finiteOrZero(row.currentValueKrw) / totalValueKrw) * 100
          : 0,
    }),
  );
  const excludedHoldingCount = excludedHoldings.length;
  const excludedValuationGapCount = excludedValuationGaps.length;

  return Object.freeze({
    status:
      excludedHoldingCount + excludedValuationGapCount > 0
        ? "applied"
        : "not_applicable",
    policy: INVESTMENT_LAB_CURRENT_HOLDING_SCOPE_POLICY,
    excludedHoldingCount,
    excludedValuationGapCount,
    excludedCurrentValueKrw: excludedHoldings.reduce(
      (sum, row) => sum + finiteOrZero(row.currentValueKrw),
      0,
    ),
    portfolio: Object.freeze({
      holdingRows: Object.freeze(holdingRows),
      exclusions: Object.freeze([...retainedExclusions]),
    }),
  });
}

function matchesFountDecision(
  row: PortfolioStructureHoldingRow | PortfolioStructureExclusion,
) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  return (
    normalize(row.name) === normalize(decision.assetName) &&
    normalize(row.account) === decision.account &&
    normalize(row.market) === decision.market &&
    normalizeUpper(row.currency) === decision.currency &&
    normalize(row.assetType) === decision.assetType
  );
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeUpper(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
