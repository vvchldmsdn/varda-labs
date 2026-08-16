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

export const USER_OWNED_TABLE_NAMES = Object.freeze(
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

export const IDENTITY_CORE_TABLE_POLICIES = Object.freeze([
  identitySystem("app_users"),
  identitySystem("auth_identities"),
]);

export const IDENTITY_PAIRING_TABLE_POLICIES = Object.freeze([
  identitySystem("identity_pairing_intents"),
  identitySystem("identity_pairing_intent_events"),
]);

export const SIMULATION_APPROVAL_TABLE_POLICIES = Object.freeze([
  userOwned(
    "simulation_scenario_approval_revisions",
    "owner_user_id",
    "not_applicable",
  ),
  userOwnedViaParent(
    "simulation_scenario_approval_vector_rows",
    "simulation_scenario_approval_revisions",
    "approval_revision_id",
  ),
  userOwnedViaParent(
    "simulation_scenario_approval_lifecycle_events",
    "simulation_scenario_approval_revisions",
    "approval_revision_id",
  ),
]);

export const TARGET_POLICY_APPROVAL_TABLE_POLICIES = Object.freeze([
  userOwned(
    "target_policy_approval_revisions",
    "owner_user_id",
    "not_applicable",
  ),
  userOwnedViaParent(
    "target_policy_approval_vector_rows",
    "target_policy_approval_revisions",
    "approval_revision_id",
  ),
  userOwnedViaParent(
    "target_policy_approval_lifecycle_events",
    "target_policy_approval_revisions",
    "approval_revision_id",
  ),
]);

export const PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES = Object.freeze([
  userOwned("portfolio_groups"),
  userOwned("portfolio_group_account_memberships"),
  userOwned("portfolio_group_asset_memberships"),
]);

export const HOLDING_ONBOARDING_TABLE_POLICIES = Object.freeze([
  userOwned("holding_onboarding_evidence"),
]);

export const HOLDING_STATE_CORRECTION_TABLE_POLICIES = Object.freeze([
  userOwned("holding_state_corrections"),
]);

export const PORTFOLIO_TARGET_POLICY_TABLE_POLICIES = Object.freeze([
  userOwned("portfolio_target_policy_revisions"),
  userOwned("portfolio_target_policy_rows"),
  userOwned("portfolio_target_policy_lifecycle_events"),
]);

export const IDENTITY_SYSTEM_TABLE_POLICIES = Object.freeze([
  ...IDENTITY_CORE_TABLE_POLICIES,
  ...IDENTITY_PAIRING_TABLE_POLICIES,
]);

export const CORE_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...TENANT_TABLE_POLICIES,
  ...IDENTITY_CORE_TABLE_POLICIES,
]);

export const SIMULATION_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...CORE_EXPANDED_TENANT_TABLE_POLICIES,
  ...SIMULATION_APPROVAL_TABLE_POLICIES,
]);

export const IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...SIMULATION_EXPANDED_TENANT_TABLE_POLICIES,
  ...IDENTITY_PAIRING_TABLE_POLICIES,
]);

export const TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES,
  ...TARGET_POLICY_APPROVAL_TABLE_POLICIES,
]);

export const PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
  ...PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES,
]);

export const HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES,
  ...HOLDING_ONBOARDING_TABLE_POLICIES,
]);

export const PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES,
  ...PORTFOLIO_TARGET_POLICY_TABLE_POLICIES,
]);

export const EXPANDED_TENANT_TABLE_POLICIES = Object.freeze([
  ...PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
  ...HOLDING_STATE_CORRECTION_TABLE_POLICIES,
]);

export function resolveTenantTablePolicies(publicTableNames) {
  const publicTableSet = new Set(publicTableNames);
  const presentCoreTables = IDENTITY_CORE_TABLE_POLICIES.filter(
    ({ table }) => publicTableSet.has(table),
  );
  const presentPairingTables = IDENTITY_PAIRING_TABLE_POLICIES.filter(
    ({ table }) => publicTableSet.has(table),
  );
  const presentSimulationTables =
    SIMULATION_APPROVAL_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentTargetPolicyTables =
    TARGET_POLICY_APPROVAL_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentPortfolioScopeTables =
    PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentHoldingOnboardingTables =
    HOLDING_ONBOARDING_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentPortfolioTargetPolicyTables =
    PORTFOLIO_TARGET_POLICY_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );
  const presentHoldingStateCorrectionTables =
    HOLDING_STATE_CORRECTION_TABLE_POLICIES.filter(({ table }) =>
      publicTableSet.has(table),
    );

  if (
    (presentPairingTables.length > 0 ||
      presentSimulationTables.length > 0 ||
      presentTargetPolicyTables.length > 0 ||
      presentPortfolioScopeTables.length > 0 ||
      presentHoldingOnboardingTables.length > 0 ||
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0) &&
    presentCoreTables.length !== IDENTITY_CORE_TABLE_POLICIES.length
  ) {
    throw new Error(
      "dependent tenant tables require the complete identity core",
    );
  }

  if (presentCoreTables.length === 0) return TENANT_TABLE_POLICIES;

  if (presentCoreTables.length !== IDENTITY_CORE_TABLE_POLICIES.length) {
    throw new Error("identity core tables must be expanded atomically");
  }

  if (presentSimulationTables.length === 0) {
    if (
      presentPairingTables.length > 0 ||
      presentTargetPolicyTables.length > 0 ||
      presentPortfolioScopeTables.length > 0 ||
      presentHoldingOnboardingTables.length > 0 ||
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0
    ) {
      throw new Error(
        "later tenant tables require the simulation approval expansion",
      );
    }
    return CORE_EXPANDED_TENANT_TABLE_POLICIES;
  }

  if (
    presentSimulationTables.length !==
    SIMULATION_APPROVAL_TABLE_POLICIES.length
  ) {
    throw new Error(
      "simulation approval tables must be expanded atomically",
    );
  }

  if (presentPairingTables.length === 0) {
    if (
      presentTargetPolicyTables.length > 0 ||
      presentPortfolioScopeTables.length > 0 ||
      presentHoldingOnboardingTables.length > 0 ||
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0
    ) {
      throw new Error(
        "target policy approval tables require the identity pairing expansion",
      );
    }
    return SIMULATION_EXPANDED_TENANT_TABLE_POLICIES;
  }

  if (
    presentPairingTables.length !== IDENTITY_PAIRING_TABLE_POLICIES.length
  ) {
    throw new Error("identity pairing tables must be expanded atomically");
  }

  if (presentTargetPolicyTables.length === 0) {
    if (
      presentPortfolioScopeTables.length > 0 ||
      presentHoldingOnboardingTables.length > 0 ||
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0
    ) {
      throw new Error(
        "portfolio scope tables require the target policy approval expansion",
      );
    }
    return IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES;
  }

  if (
    presentTargetPolicyTables.length !==
    TARGET_POLICY_APPROVAL_TABLE_POLICIES.length
  ) {
    throw new Error(
      "target policy approval tables must be expanded atomically",
    );
  }

  if (presentPortfolioScopeTables.length === 0) {
    if (
      presentHoldingOnboardingTables.length > 0 ||
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0
    ) {
      throw new Error(
        "holding onboarding tables require the portfolio scope expansion",
      );
    }
    return TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES;
  }

  if (
    presentPortfolioScopeTables.length !==
    PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES.length
  ) {
    throw new Error("portfolio scope tables must be expanded atomically");
  }

  if (presentHoldingOnboardingTables.length === 0) {
    if (
      presentPortfolioTargetPolicyTables.length > 0 ||
      presentHoldingStateCorrectionTables.length > 0
    ) {
      throw new Error(
        "portfolio target policy tables require the holding onboarding expansion",
      );
    }
    return PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES;
  }

  if (
    presentHoldingOnboardingTables.length !==
    HOLDING_ONBOARDING_TABLE_POLICIES.length
  ) {
    throw new Error("holding onboarding tables must be expanded atomically");
  }

  if (presentPortfolioTargetPolicyTables.length === 0) {
    if (presentHoldingStateCorrectionTables.length > 0) {
      throw new Error(
        "holding state correction tables require the portfolio target policy expansion",
      );
    }
    return HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES;
  }
  if (
    presentPortfolioTargetPolicyTables.length !==
    PORTFOLIO_TARGET_POLICY_TABLE_POLICIES.length
  ) {
    throw new Error("portfolio target policy tables must be expanded atomically");
  }

  if (presentHoldingStateCorrectionTables.length === 0) {
    return PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES;
  }
  if (
    presentHoldingStateCorrectionTables.length !==
    HOLDING_STATE_CORRECTION_TABLE_POLICIES.length
  ) {
    throw new Error(
      "holding state correction tables must be expanded atomically",
    );
  }

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
    canonicalOwnerRequired: true,
    canonicalOwnerRolloutScope,
    ownershipPath: "direct_column",
  });
}

function userOwnedViaParent(table, parentTable, parentForeignKeyColumn) {
  return Object.freeze({
    table,
    classification: "user_owned",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
    ownershipPath: "parent_fk",
    parentTable,
    parentForeignKeyColumn,
  });
}

function sharedReference(table) {
  return Object.freeze({
    table,
    classification: "shared_reference",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
    ownershipPath: "not_applicable",
  });
}

function adminSystem(table) {
  return Object.freeze({
    table,
    classification: "admin_system",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
    ownershipPath: "not_applicable",
  });
}

function identitySystem(table) {
  return Object.freeze({
    table,
    classification: "identity_system",
    currentOwnerColumn: null,
    canonicalOwnerRequired: false,
    canonicalOwnerRolloutScope: "not_applicable",
    ownershipPath: "not_applicable",
  });
}
