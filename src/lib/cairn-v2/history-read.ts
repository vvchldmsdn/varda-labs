import "server-only";

import { loadTenantPortfolioGroupMemberships } from "@/db/queries/tenant-group-reads";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import { buildPortfolioHistoryDisplayRows, type PortfolioHistoryRawRow, type PortfolioHistoryDisplayRow } from "@/lib/history-balance";
import { buildPortfolioGroupHistoryRows, type HistoryPositionScopeCandidate, type HistoryMembershipPeriod } from "@/lib/history-portfolio-scope";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { betaHistoryValuationDate, commonBetaHistoryValuationDate } from "./history-date";
import { BETA_HISTORY_PORTFOLIO_ROWS_SQL, BETA_HISTORY_GROUP_POSITION_ROWS_SQL } from "./history-read-sql";

type DatedRawRow = PortfolioHistoryRawRow & { valuationDate: string | null };
type DatedPositionRow = HistoryPositionScopeCandidate & { valuationDate: string | null };
export type BetaHistoryReadRow = PortfolioHistoryDisplayRow & {
  valuationDate: string | null;
  storageSnapshotDate: string;
};
export type BetaHistoryRead = Pick<ReadOnlyHistoryBalance, "selectedScope" | "readStatus"> & {
  observationPolicy: "production_observed_v1";
  portfolioRows: BetaHistoryReadRow[];
};
type ReadArgs = {
  analysisScopes: readonly PortfolioAnalysisScope[];
  tenantContext: TenantContext;
  scope: PortfolioAnalysisScope;
};

/** Called only after the existing active-session and owned-scope resolver.
 * Reuses the original aggregate calculations; this port adds the current
 * stored-row validity filters and separate valuation-date metadata only.
 * Missing SELECT privileges fail this history read, never remove the filters.
 */
export async function getBetaHistoryRead(args: ReadArgs): Promise<BetaHistoryRead> {
  try {
    assertResolvedScope(args.scope, args.analysisScopes);
    const rawRows = args.scope.kind === "portfolio_group"
      ? await loadGroupRows(args.tenantContext, args.scope)
      : await loadAccountRows(args.tenantContext, args.scope);
    const account = args.scope.kind === "account" ? args.scope.accountCode : args.scope.key;
    const expectedAccounts = args.analysisScopes.flatMap(row => row.kind === "account" ? [row.accountCode] : []);
    const displayRows = buildPortfolioHistoryDisplayRows({ rows: rawRows, account, expectedAccounts });
    const safeSources = publicSourceKeys(rawRows.map(row => row.source));
    const portfolioRows = displayRows.map(row => {
      const candidates = rawRows.filter(raw => raw.snapshotDate === row.snapshotDate && raw.source === row.source);
      const included = row.account === "all" && row.rowKind !== "stored"
        ? candidates.filter(raw => row.derivedFromAccounts.includes(raw.account))
        : candidates.filter(raw => raw.account === row.account);
      return {
        ...row,
        source: safeSources.get(row.source)!,
        storageSnapshotDate: row.snapshotDate,
        valuationDate: commonBetaHistoryValuationDate(included),
      };
    });
    return { observationPolicy: "production_observed_v1", selectedScope: args.scope, readStatus: portfolioRows.some(row => row.valuationDate === null) ? "partial" : "ready", portfolioRows };
  } catch {
    return { observationPolicy: "production_observed_v1", selectedScope: args.scope, readStatus: "unavailable", portfolioRows: [] };
  }
}

async function loadAccountRows(tenant: TenantContext, scope: Exclude<PortfolioAnalysisScope, { kind: "portfolio_group" }>): Promise<DatedRawRow[]> {
  const [rows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [
    tx.query(BETA_HISTORY_PORTFOLIO_ROWS_SQL, [scope.kind === "account" ? [scope.accountId] : null]),
  ]);
  return rows.map(projectPortfolioRow);
}

async function loadGroupRows(tenant: TenantContext, scope: Extract<PortfolioAnalysisScope, { kind: "portfolio_group" }>): Promise<DatedRawRow[]> {
  const memberships = await loadTenantPortfolioGroupMemberships({ mode: "all", portfolioGroupId: scope.portfolioGroupId, tenantContext: tenant });
  const accountIds = [...new Set(memberships.accountMemberships.map(row => row.targetId))];
  const assetIds = [...new Set(memberships.assetMemberships.map(row => row.targetId))];
  if (!accountIds.length && !assetIds.length) return [];
  const start = [...memberships.accountMemberships, ...memberships.assetMemberships].map(row => row.validFrom).sort()[0]!;
  const [sqlRows] = await runTenantReadTransaction(tenant.ownerUserId, tx => [
    tx.query(BETA_HISTORY_GROUP_POSITION_ROWS_SQL, [start, accountIds, assetIds]),
  ]);
  const rows = sqlRows.map(projectPositionRow);
  const aggregate = buildPortfolioGroupHistoryRows({ ...memberships, rows, scopeKey: scope.key });
  return aggregate.map(row => ({
    ...row,
    valuationDate: commonBetaHistoryValuationDate(rows.filter(input => input.snapshotDate === row.snapshotDate && input.source === row.source && memberAtDate(input, memberships.accountMemberships, memberships.assetMemberships))),
  }));
}

// Mirrors only the existing effective-dated membership inclusion for metadata;
// amounts, duplicate handling and all financial sums remain in the old helper.
function memberAtDate(row: DatedPositionRow, accounts: readonly HistoryMembershipPeriod[], assets: readonly HistoryMembershipPeriod[]) {
  const at = (m: HistoryMembershipPeriod, id: string | null) => id !== null && m.targetId === id && m.validFrom <= row.snapshotDate && (m.validTo === null || row.snapshotDate < m.validTo);
  return accounts.some(m => at(m, row.accountId)) || assets.some(m => at(m, row.assetId));
}

function projectPortfolioRow(row: Readonly<Record<string, unknown>>): DatedRawRow {
  const snapshotDate = requiredString(row.snapshot_date), source = requiredString(row.source);
  return {
    snapshotDate, source,
    valuationDate: betaHistoryValuationDate({ snapshotDate, source, cycleEndAt: nullableString(row.cycle_end_at ?? null) }),
    account: requiredString(row.account), cashValue: nullableString(row.cash_value),
    investedAmount: nullableString(row.invested_amount), totalCost: nullableString(row.total_cost),
    totalMarketValue: nullableString(row.total_market_value), totalPnl: nullableString(row.total_pnl), totalReturnPct: nullableString(row.total_return_pct),
  };
}

function projectPositionRow(row: Readonly<Record<string, unknown>>): DatedPositionRow {
  const snapshotDate = requiredString(row.snapshot_date), source = requiredString(row.source);
  return {
    snapshotDate, source,
    valuationDate: betaHistoryValuationDate({ snapshotDate, source, cycleEndAt: nullableString(row.cycle_end_at ?? null) }),
    account: requiredString(row.account), accountId: nullableString(row.account_id), assetId: nullableString(row.asset_id),
    marketValueKrw: nullableString(row.market_value_krw), costKrw: nullableString(row.cost_krw), pnlKrw: nullableString(row.pnl_krw),
  };
}

/** Opaque revision ordinals preserve original lexical precedence within this
 * owner-scoped read without sending private evidence hashes to the client.
 * They are presentation identities, never account ownership or global IDs.
 */
function publicSourceKeys(sources: readonly string[]) {
  const result = new Map<string, string>();
  let reconstruction = 0, unknown = 0;
  for (const source of [...new Set(sources)].sort()) {
    const key = ["varda_manual_daily_snapshot", "varda_daily_snapshot_v1", "base44_import"].includes(source) ? source
      : source.startsWith("broker_reconstructed_close_v1:") ? "broker_reconstructed_close_v1:revision-" + String(++reconstruction).padStart(4, "0")
      : "saved_source:revision-" + String(++unknown).padStart(4, "0");
    result.set(source, key);
  }
  return result;
}

function assertResolvedScope(scope: PortfolioAnalysisScope, catalog: readonly PortfolioAnalysisScope[]) {
  const resolved = catalog.find(row => row.key === scope.key);
  if (!resolved || resolved.kind !== scope.kind) throw new Error("beta_history_scope_not_resolved");
  if (scope.kind === "account" && (resolved.kind !== "account" || resolved.accountId !== scope.accountId || resolved.accountCode !== scope.accountCode)) throw new Error("beta_history_account_scope_mismatch");
  if (scope.kind === "portfolio_group" && (resolved.kind !== "portfolio_group" || resolved.portfolioGroupId !== scope.portfolioGroupId)) throw new Error("beta_history_group_scope_mismatch");
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || !value.length) throw new Error("beta_history_row_invalid");
  return value;
}
function nullableString(value: unknown) { return value === null ? null : requiredString(value); }
