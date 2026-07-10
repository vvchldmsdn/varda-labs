export const TENANT_CLASSIFICATIONS = Object.freeze([
  "user_owned",
  "shared_reference",
  "admin_system",
  "unresolved",
]);

export const CANONICAL_OWNER_CONTRACT = Object.freeze({
  userTable: "app_users",
  userPrimaryKey: "id",
  userPrimaryKeyType: "uuid",
  ownerColumn: "owner_user_id",
  ownerColumnType: "uuid",
  ownerNullable: false,
  accountIsTenant: false,
  basicAuthProvidesIdentity: false,
});

export const TENANT_TABLE_POLICIES = Object.freeze([
  userOwned("assets", "created_by_id"),
  userOwned("accounts", "owner_user_id"),
  userOwned("asset_groups", "owner_user_id"),
  userOwned("asset_group_members", "owner_user_id"),
  sharedReference("fx_rates"),
  sharedReference("asset_price_snapshots"),
  adminSystem("market_data_sync_runs"),
  sharedReference("live_price_quotes"),
  sharedReference("benchmark_snapshots"),
  sharedReference("etf_masters"),
  sharedReference("etf_holdings"),
  userOwned("event_ledger_entries"),
  userOwned("market_regime_daily"),
  sharedReference("global_market_factors"),
  userOwned("goals", "owner_user_id"),
  userOwned("transactions", "owner_user_id"),
  userOwned("fixed_transactions", "owner_user_id"),
  userOwned("monthly_incomes", "owner_user_id"),
  userOwned("account_balance_snapshots"),
  userOwned("daily_portfolio_snapshots"),
  userOwned("daily_position_snapshots"),
  userOwned("settings"),
]);

export function summarizeTenantClassifications(policies = TENANT_TABLE_POLICIES) {
  const summary = Object.fromEntries(
    TENANT_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const policy of policies) {
    summary[policy.classification] += 1;
  }

  return summary;
}

function userOwned(table, currentOwnerColumn = null) {
  return Object.freeze({
    table,
    classification: "user_owned",
    currentOwnerColumn,
    canonicalOwnerRequired: true,
  });
}

function sharedReference(table) {
  return Object.freeze({
    table,
    classification: "shared_reference",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
  });
}

function adminSystem(table) {
  return Object.freeze({
    table,
    classification: "admin_system",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
  });
}
