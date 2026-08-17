import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OWNER_IN_SCOPE_USER_TABLE_NAMES,
  CANONICAL_OWNER_CONTRACT,
  CANONICAL_OWNER_ROLLOUT_SCOPES,
  CORE_EXPANDED_TENANT_TABLE_POLICIES,
  EXPANDED_TENANT_TABLE_POLICIES,
  IDENTITY_CORE_TABLE_POLICIES,
  IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES,
  IDENTITY_PAIRING_TABLE_POLICIES,
  IDENTITY_SYSTEM_TABLE_POLICIES,
  HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES,
  HOLDING_ONBOARDING_TABLE_POLICIES,
  HOLDING_LIFECYCLE_TABLE_POLICIES,
  HOLDING_STATE_CORRECTION_EXPANDED_TENANT_TABLE_POLICIES,
  HOLDING_STATE_CORRECTION_TABLE_POLICIES,
  LEGACY_EXCLUDED_USER_TABLE_NAMES,
  PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES,
  PORTFOLIO_TARGET_POLICY_TABLE_POLICIES,
  PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
  PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES,
  SIMULATION_APPROVAL_TABLE_POLICIES,
  SIMULATION_EXPANDED_TENANT_TABLE_POLICIES,
  TARGET_POLICY_APPROVAL_TABLE_POLICIES,
  TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
  TENANT_TABLE_POLICIES,
  resolveTenantTablePolicies,
  summarizeTenantClassifications,
} from "../scripts/lib/tenant-ownership-policy.mjs";

describe("tenant ownership policy", () => {
  it("classifies every current table exactly once", () => {
    const names = TENANT_TABLE_POLICIES.map((policy) => policy.table);

    assert.equal(names.length, 22);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(summarizeTenantClassifications(), {
      user_owned: 14,
      shared_reference: 7,
      admin_system: 1,
      identity_system: 0,
      unresolved: 0,
    });
  });

  it("resolves the staged atomic identity-system expansions", () => {
    const currentNames = TENANT_TABLE_POLICIES.map((policy) => policy.table);
    const coreExpandedNames = CORE_EXPANDED_TENANT_TABLE_POLICIES.map(
      (policy) => policy.table,
    );
    const simulationExpandedNames =
      SIMULATION_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const expandedNames = EXPANDED_TENANT_TABLE_POLICIES.map(
      (policy) => policy.table,
    );
    const pairingExpandedNames =
      IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const targetPolicyExpandedNames =
      TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const portfolioScopeExpandedNames =
      PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const holdingOnboardingExpandedNames =
      HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const portfolioTargetPolicyExpandedNames =
      PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const holdingStateCorrectionExpandedNames =
      HOLDING_STATE_CORRECTION_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );

    assert.deepEqual(
      IDENTITY_CORE_TABLE_POLICIES.map((policy) => policy.table),
      ["app_users", "auth_identities"],
    );
    assert.deepEqual(
      IDENTITY_PAIRING_TABLE_POLICIES.map((policy) => policy.table),
      ["identity_pairing_intents", "identity_pairing_intent_events"],
    );
    assert.equal(IDENTITY_SYSTEM_TABLE_POLICIES.length, 4);
    assert.equal(coreExpandedNames.length, 24);
    assert.equal(simulationExpandedNames.length, 27);
    assert.equal(pairingExpandedNames.length, 29);
    assert.equal(targetPolicyExpandedNames.length, 32);
    assert.equal(portfolioScopeExpandedNames.length, 35);
    assert.equal(holdingOnboardingExpandedNames.length, 36);
    assert.equal(portfolioTargetPolicyExpandedNames.length, 39);
    assert.equal(holdingStateCorrectionExpandedNames.length, 40);
    assert.equal(expandedNames.length, 41);
    assert.deepEqual(resolveTenantTablePolicies(currentNames), TENANT_TABLE_POLICIES);
    assert.deepEqual(
      resolveTenantTablePolicies(coreExpandedNames),
      CORE_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(simulationExpandedNames),
      SIMULATION_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(pairingExpandedNames),
      IDENTITY_PAIRING_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(targetPolicyExpandedNames),
      TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(portfolioScopeExpandedNames),
      PORTFOLIO_SCOPE_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(holdingOnboardingExpandedNames),
      HOLDING_ONBOARDING_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(portfolioTargetPolicyExpandedNames),
      PORTFOLIO_TARGET_POLICY_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(holdingStateCorrectionExpandedNames),
      HOLDING_STATE_CORRECTION_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(expandedNames),
      EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.throws(
      () => resolveTenantTablePolicies([...currentNames, "app_users"]),
      /identity core tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...simulationExpandedNames,
          "identity_pairing_intents",
        ]),
      /identity pairing tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...currentNames,
          "identity_pairing_intents",
        ]),
      /require the complete identity core/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...coreExpandedNames,
          "simulation_scenario_approval_revisions",
        ]),
      /simulation approval tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...coreExpandedNames,
          ...IDENTITY_PAIRING_TABLE_POLICIES.map(({ table }) => table),
        ]),
      /require the simulation approval expansion/,
    );
    assert.deepEqual(
      summarizeTenantClassifications(EXPANDED_TENANT_TABLE_POLICIES),
      {
        user_owned: 29,
        shared_reference: 7,
        admin_system: 1,
        identity_system: 4,
        unresolved: 0,
      },
    );
  });

  it("keeps account labels separate from the tenant boundary", () => {
    assert.equal(CANONICAL_OWNER_CONTRACT.accountIsTenant, false);
    assert.equal(CANONICAL_OWNER_CONTRACT.basicAuthProvidesIdentity, false);
    assert.equal(CANONICAL_OWNER_CONTRACT.userTable, "app_users");
    assert.equal(CANONICAL_OWNER_CONTRACT.ownerColumn, "owner_user_id");
    assert.equal(CANONICAL_OWNER_CONTRACT.ownerColumnType, "uuid");
    assert.equal(CANONICAL_OWNER_CONTRACT.ownerNullable, false);
  });

  it("separates user, shared-reference, and admin-system tables", () => {
    const classification = (table) =>
      TENANT_TABLE_POLICIES.find((policy) => policy.table === table)
        ?.classification;

    assert.equal(classification("assets"), "user_owned");
    assert.equal(classification("market_regime_daily"), "user_owned");
    assert.equal(classification("asset_price_snapshots"), "shared_reference");
    assert.equal(classification("live_price_quotes"), "shared_reference");
    assert.equal(classification("market_data_sync_runs"), "admin_system");
    assert.deepEqual(
      PORTFOLIO_ANALYSIS_SCOPE_TABLE_POLICIES.map(({ table }) => table),
      [
        "portfolio_groups",
        "portfolio_group_account_memberships",
        "portfolio_group_asset_memberships",
      ],
    );
    assert.deepEqual(
      HOLDING_ONBOARDING_TABLE_POLICIES.map(({ table }) => table),
      ["holding_onboarding_evidence"],
    );
    assert.deepEqual(
      HOLDING_STATE_CORRECTION_TABLE_POLICIES.map(({ table }) => table),
      ["holding_state_corrections"],
    );
    assert.deepEqual(
      HOLDING_LIFECYCLE_TABLE_POLICIES.map(({ table }) => table),
      ["holding_lifecycle_events"],
    );
    assert.deepEqual(
      PORTFOLIO_TARGET_POLICY_TABLE_POLICIES.map(({ table }) => table),
      [
        "portfolio_target_policy_revisions",
        "portfolio_target_policy_rows",
        "portfolio_target_policy_lifecycle_events",
      ],
    );
    assert.equal(
      EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) => policy.table === "app_users",
      )?.classification,
      "identity_system",
    );
    assert.deepEqual(
      SIMULATION_APPROVAL_TABLE_POLICIES.map(
        ({
          table,
          classification,
          ownershipPath,
          parentTable,
        }) => ({
          table,
          classification,
          ownershipPath,
          parentTable: parentTable ?? null,
        }),
      ),
      [
        {
          table: "simulation_scenario_approval_revisions",
          classification: "user_owned",
          ownershipPath: "direct_column",
          parentTable: null,
        },
        {
          table: "simulation_scenario_approval_vector_rows",
          classification: "user_owned",
          ownershipPath: "parent_fk",
          parentTable: "simulation_scenario_approval_revisions",
        },
        {
          table: "simulation_scenario_approval_lifecycle_events",
          classification: "user_owned",
          ownershipPath: "parent_fk",
          parentTable: "simulation_scenario_approval_revisions",
        },
      ],
    );
    assert.deepEqual(
      TARGET_POLICY_APPROVAL_TABLE_POLICIES.map(
        ({ table, ownershipPath, parentTable }) => ({
          table,
          ownershipPath,
          parentTable: parentTable ?? null,
        }),
      ),
      [
        {
          table: "target_policy_approval_revisions",
          ownershipPath: "direct_column",
          parentTable: null,
        },
        {
          table: "target_policy_approval_vector_rows",
          ownershipPath: "parent_fk",
          parentTable: "target_policy_approval_revisions",
        },
        {
          table: "target_policy_approval_lifecycle_events",
          ownershipPath: "parent_fk",
          parentTable: "target_policy_approval_revisions",
        },
      ],
    );
  });

  it("separates product owner rollout from preserved legacy tables", () => {
    assert.deepEqual(CANONICAL_OWNER_ROLLOUT_SCOPES, [
      "in_scope",
      "intentionally_skipped_legacy",
      "not_applicable",
    ]);
    assert.deepEqual(CANONICAL_OWNER_IN_SCOPE_USER_TABLE_NAMES, [
      "assets",
      "accounts",
      "asset_groups",
      "asset_group_members",
      "event_ledger_entries",
      "market_regime_daily",
      "account_balance_snapshots",
      "daily_portfolio_snapshots",
      "daily_position_snapshots",
      "settings",
    ]);
    assert.deepEqual(LEGACY_EXCLUDED_USER_TABLE_NAMES, [
      "goals",
      "transactions",
      "fixed_transactions",
      "monthly_incomes",
    ]);

    for (const policy of TENANT_TABLE_POLICIES) {
      assert.ok(
        CANONICAL_OWNER_ROLLOUT_SCOPES.includes(
          policy.canonicalOwnerRolloutScope,
        ),
        policy.table,
      );
    }
  });
});
