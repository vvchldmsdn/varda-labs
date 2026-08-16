import type { PortfolioAnalysisScope } from "./portfolio-analysis-scope.ts";

export type TenantSnapshotScope = Extract<
  PortfolioAnalysisScope,
  Readonly<{ kind: "all" | "account" }>
>;

export function isTenantSnapshotScope(
  scope: PortfolioAnalysisScope,
): scope is TenantSnapshotScope {
  return scope.kind === "all" || scope.kind === "account";
}

export function tenantSnapshotScopeMatchesAccount(
  scope: TenantSnapshotScope,
  account: Readonly<{ accountId: string; accountCode: string }>,
) {
  return (
    scope.kind === "all" ||
    (scope.accountId === account.accountId &&
      scope.accountCode === account.accountCode)
  );
}
