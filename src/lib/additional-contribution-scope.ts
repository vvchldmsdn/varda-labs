import type { PortfolioAnalysisScope } from "./portfolio-analysis-scope.ts";
import {
  normalizeTargetPolicyUniverseAccount,
  type TargetPolicyUniverseAccount,
} from "./target-policy-holding-universe.ts";

export const ADDITIONAL_CONTRIBUTION_SCOPE_POLICY = Object.freeze({
  version: "additional_contribution_scope_v1",
  supportedAuthority: "single_account_approved_target_policy",
  aggregateFallback: "forbidden",
  portfolioGroupFallback: "forbidden",
} as const);

export type AdditionalContributionScopeBlocker =
  | "aggregate_target_policy_not_defined"
  | "portfolio_group_target_policy_not_defined"
  | "account_target_policy_model_unsupported";

export type AdditionalContributionScopeResolution =
  | Readonly<{
      state: "ready";
      account: TargetPolicyUniverseAccount;
    }>
  | Readonly<{
      state: "blocked";
      reason: AdditionalContributionScopeBlocker;
    }>;

export function resolveAdditionalContributionScope(
  scope: PortfolioAnalysisScope,
): AdditionalContributionScopeResolution {
  if (scope.kind === "all") {
    return Object.freeze({
      state: "blocked",
      reason: "aggregate_target_policy_not_defined",
    });
  }
  if (scope.kind === "portfolio_group") {
    return Object.freeze({
      state: "blocked",
      reason: "portfolio_group_target_policy_not_defined",
    });
  }

  const account = normalizeTargetPolicyUniverseAccount(scope.accountCode);
  if (!account) {
    return Object.freeze({
      state: "blocked",
      reason: "account_target_policy_model_unsupported",
    });
  }
  return Object.freeze({ state: "ready", account });
}
