export const TENANT_CLASSIFICATIONS = Object.freeze([
  "user_owned",
  "shared_reference",
  "admin_system",
  "identity_system",
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

export const TRANSITIONAL_OWNER_COLUMN = "canonical_owner_user_id";

export const CANONICAL_OWNER_ROLLOUT_SCOPES = Object.freeze([
  "in_scope",
  "intentionally_skipped_legacy",
  "not_applicable",
]);

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
  userOwned("goals", "owner_user_id", "intentionally_skipped_legacy"),
  userOwned("transactions", "owner_user_id", "intentionally_skipped_legacy"),
  userOwned(
    "fixed_transactions",
    "owner_user_id",
    "intentionally_skipped_legacy",
  ),
  userOwned(
    "monthly_incomes",
    "owner_user_id",
    "intentionally_skipped_legacy",
  ),
  userOwned("account_balance_snapshots"),
  userOwned("daily_portfolio_snapshots"),
  userOwned("daily_position_snapshots"),
  userOwned("settings"),
]);

export const TRANSITIONAL_OWNER_TABLE_NAMES = Object.freeze(
  TENANT_TABLE_POLICIES.filter(
    ({ classification }) => classification === "user_owned",
  ).map(({ table }) => table),
);

export const CANONICAL_OWNER_IN_SCOPE_USER_TABLE_NAMES = Object.freeze(
  TENANT_TABLE_POLICIES.filter(
    ({ classification, canonicalOwnerRolloutScope }) =>
      classification === "user_owned" &&
      canonicalOwnerRolloutScope === "in_scope",
  ).map(({ table }) => table),
);

export const LEGACY_EXCLUDED_USER_TABLE_NAMES = Object.freeze(
  TENANT_TABLE_POLICIES.filter(
    ({ canonicalOwnerRolloutScope }) =>
      canonicalOwnerRolloutScope === "intentionally_skipped_legacy",
  ).map(({ table }) => table),
);

export const CORE_IDENTITY_SYSTEM_TABLE_POLICIES = Object.freeze([
  identitySystem("app_users"),
  identitySystem("auth_identities"),
]);

export const SIMULATION_APPROVAL_USER_TABLE_POLICIES = Object.freeze([
  userOwned(
    "simulation_scenario_approval_revisions",
    "owner_user_id",
    "not_applicable",
  ),
  userOwnedViaParent(
    "simulation_scenario_approval_vector_rows",
    "approval_revision_id",
    "simulation_scenario_approval_revisions",
    "id",
  ),
  userOwnedViaParent(
    "simulation_scenario_approval_lifecycle_events",
    "approval_revision_id",
    "simulation_scenario_approval_revisions",
    "id",
  ),
]);

export const PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES = Object.freeze([
  identitySystem("identity_pairing_intents"),
  identitySystem("identity_pairing_intent_events"),
]);

export const IDENTITY_SYSTEM_TABLE_POLICIES = Object.freeze([
  ...CORE_IDENTITY_SYSTEM_TABLE_POLICIES,
  ...PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES,
]);

export const EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...TENANT_TABLE_POLICIES,
  ...CORE_IDENTITY_SYSTEM_TABLE_POLICIES,
]);

export const SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES =
  Object.freeze([
    ...EXPANDED_TENANT_TABLE_POLICIES,
    ...SIMULATION_APPROVAL_USER_TABLE_POLICIES,
  ]);

export const FULLY_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES,
  ...PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES,
]);

export function resolveTenantTablePolicies(publicTableNames) {
  const publicTableSet = new Set(publicTableNames);
  const presentCoreIdentityTables = CORE_IDENTITY_SYSTEM_TABLE_POLICIES.filter(
    ({ table }) => publicTableSet.has(table),
  );
  const presentSimulationApprovalTables =
    SIMULATION_APPROVAL_USER_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentPairingIdentityTables =
    PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );

  if (
    presentCoreIdentityTables.length !== 0 &&
    presentCoreIdentityTables.length !==
      CORE_IDENTITY_SYSTEM_TABLE_POLICIES.length
  ) {
    throw new Error("core identity system tables must be expanded atomically");
  }
  if (
    presentPairingIdentityTables.length !== 0 &&
    presentPairingIdentityTables.length !==
      PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES.length
  ) {
    throw new Error(
      "pairing identity system tables must be expanded atomically",
    );
  }
  if (
    presentSimulationApprovalTables.length !== 0 &&
    presentSimulationApprovalTables.length !==
      SIMULATION_APPROVAL_USER_TABLE_POLICIES.length
  ) {
    throw new Error(
      "simulation approval tables must be expanded atomically",
    );
  }
  if (
    presentSimulationApprovalTables.length !== 0 &&
    presentCoreIdentityTables.length === 0
  ) {
    throw new Error("simulation approval tables require core identity tables");
  }
  if (
    presentPairingIdentityTables.length !== 0 &&
    presentCoreIdentityTables.length === 0
  ) {
    throw new Error("pairing identity system requires core identity tables");
  }
  if (
    presentPairingIdentityTables.length !== 0 &&
    presentSimulationApprovalTables.length === 0
  ) {
    throw new Error(
      "pairing identity system requires simulation approval tables",
    );
  }

  if (presentPairingIdentityTables.length !== 0) {
    return FULLY_EXPANDED_TENANT_TABLE_POLICIES;
  }
  if (presentSimulationApprovalTables.length !== 0) {
    return SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES;
  }
  if (presentCoreIdentityTables.length === 0) return TENANT_TABLE_POLICIES;
  return EXPANDED_TENANT_TABLE_POLICIES;
}

export function summarizeTenantClassifications(policies = TENANT_TABLE_POLICIES) {
  const summary = Object.fromEntries(
    TENANT_CLASSIFICATIONS.map((classification) => [classification, 0]),
  );

  for (const policy of policies) {
    summary[policy.classification] += 1;
  }

  return summary;
}

function userOwned(
  table,
  currentOwnerColumn = null,
  canonicalOwnerRolloutScope = "in_scope",
) {
  return Object.freeze({
    table,
    classification: "user_owned",
    currentOwnerColumn,
    ownerVia: null,
    canonicalOwnerRequired: true,
    canonicalOwnerRolloutScope,
  });
}

function userOwnedViaParent(
  table,
  column,
  parentTable,
  parentColumn,
) {
  return Object.freeze({
    table,
    classification: "user_owned",
    currentOwnerColumn: null,
    ownerVia: Object.freeze({
      kind: "parent_foreign_key",
      column,
      parentTable,
      parentColumn,
    }),
    canonicalOwnerRequired: true,
    canonicalOwnerRolloutScope: "not_applicable",
  });
}

function sharedReference(table) {
  return Object.freeze({
    table,
    classification: "shared_reference",
    currentOwnerColumn: null,
    ownerVia: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
  });
}

function adminSystem(table) {
  return Object.freeze({
    table,
    classification: "admin_system",
    currentOwnerColumn: null,
    ownerVia: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
  });
}

function identitySystem(table) {
  return Object.freeze({
    table,
    classification: "identity_system",
    currentOwnerColumn: null,
    ownerVia: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
  });
}
