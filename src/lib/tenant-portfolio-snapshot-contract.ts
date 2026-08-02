import type {
  NamedPortfolioAccount,
  PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type TenantPortfolioSnapshotAccountRow = Readonly<{
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
}>;

export type TenantPortfolioSnapshotReadRow = Readonly<{
  snapshotDate: string;
  source: string;
  ruleVersion: string | null;
  isSample: boolean;
  snapshotAccountId: string | null;
  ownedAccountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
  legacyAccountCode: string;
  cashValue: string | null;
  investedAmount: string | null;
  totalCost: string | null;
  totalMarketValue: string | null;
  totalPnl: string | null;
  totalReturnPct: string | null;
  fxRate: string | null;
  usdKrw: string | null;
  krWeight: string | null;
  usWeight: string | null;
  usdExposurePct: string | null;
  numAssets: number | null;
  numGroups: number | null;
  topHoldingName: string | null;
  topHoldingWeight: string | null;
  capturedAt: Date | null;
}>;

export type TenantPortfolioSnapshotDto = Readonly<{
  accountCode: NamedPortfolioAccount;
  accountName: string;
  ruleVersion: string | null;
  cashValue: string | null;
  investedAmount: string | null;
  totalCost: string | null;
  totalMarketValue: string | null;
  totalPnl: string | null;
  totalReturnPct: string | null;
  fxRate: string | null;
  usdKrw: string | null;
  krWeight: string | null;
  usWeight: string | null;
  usdExposurePct: string | null;
  numAssets: number | null;
  numGroups: number | null;
  topHoldingName: string | null;
  topHoldingWeight: string | null;
  capturedAt: string | null;
}>;

export type TenantPortfolioSnapshotAggregate = Readonly<{
  evidenceKind: "complete_total" | "available_subtotal";
  accountCount: number;
  cashValue: string | null;
  investedAmount: string | null;
  totalCost: string | null;
  totalMarketValue: string | null;
  totalPnl: string | null;
  totalReturnPct: string | null;
  numAssets: number | null;
}>;

export type TenantPortfolioSnapshotReadResult =
  | Readonly<{
      state: "ready" | "partial";
      scope: PortfolioAccountScope;
      snapshotDate: string;
      source: string;
      ruleVersions: readonly (string | null)[];
      expectedAccounts: readonly NamedPortfolioAccount[];
      coveredAccounts: readonly NamedPortfolioAccount[];
      missingAccounts: readonly NamedPortfolioAccount[];
      snapshots: readonly TenantPortfolioSnapshotDto[];
      aggregate: TenantPortfolioSnapshotAggregate | null;
      excludedSnapshotCount: number;
      incompleteCoreSnapshotCount: number;
      hasMixedRuleVersions: boolean;
    }>
  | Readonly<{
      state: "no_data";
      scope: PortfolioAccountScope;
      snapshotDate: string | null;
      expectedAccounts: readonly NamedPortfolioAccount[];
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "invalid_account_metadata"
        | "duplicate_account_relation"
        | "account_scope_mismatch"
        | "invalid_account_relation"
        | "snapshot_date_mismatch"
        | "mixed_snapshot_sources"
        | "sample_row_admitted"
        | "duplicate_account_snapshot";
    }>;
