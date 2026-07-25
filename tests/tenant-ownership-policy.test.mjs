import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OWNER_IN_SCOPE_USER_TABLE_NAMES,
  CANONICAL_OWNER_CONTRACT,
  CANONICAL_OWNER_ROLLOUT_SCOPES,
  CORE_IDENTITY_SYSTEM_TABLE_POLICIES,
  EXPANDED_TENANT_TABLE_POLICIES,
  FULLY_EXPANDED_TENANT_TABLE_POLICIES,
  IDENTITY_SYSTEM_TABLE_POLICIES,
  LEGACY_EXCLUDED_USER_TABLE_NAMES,
  PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES,
  SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES,
  SIMULATION_APPROVAL_USER_TABLE_POLICIES,
  TENANT_TABLE_POLICIES,
  TRANSITIONAL_OWNER_TABLE_NAMES,
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

  it("resolves each deployed schema expansion atomically", () => {
    const currentNames = TENANT_TABLE_POLICIES.map((policy) => policy.table);
    const expandedNames = EXPANDED_TENANT_TABLE_POLICIES.map(
      (policy) => policy.table,
    );
    const simulationExpandedNames =
      SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES.map(
        (policy) => policy.table,
      );
    const fullyExpandedNames = FULLY_EXPANDED_TENANT_TABLE_POLICIES.map(
      (policy) => policy.table,
    );

    assert.deepEqual(
      IDENTITY_SYSTEM_TABLE_POLICIES.map((policy) => policy.table),
      [
        "app_users",
        "auth_identities",
        "identity_pairing_intents",
        "identity_pairing_intent_events",
      ],
    );
    assert.deepEqual(
      CORE_IDENTITY_SYSTEM_TABLE_POLICIES.map((policy) => policy.table),
      ["app_users", "auth_identities"],
    );
    assert.deepEqual(
      PAIRING_IDENTITY_SYSTEM_TABLE_POLICIES.map((policy) => policy.table),
      ["identity_pairing_intents", "identity_pairing_intent_events"],
    );
    assert.deepEqual(
      SIMULATION_APPROVAL_USER_TABLE_POLICIES.map((policy) => policy.table),
      [
        "simulation_scenario_approval_revisions",
        "simulation_scenario_approval_vector_rows",
        "simulation_scenario_approval_lifecycle_events",
      ],
    );
    assert.equal(expandedNames.length, 24);
    assert.equal(simulationExpandedNames.length, 27);
    assert.equal(fullyExpandedNames.length, 29);
    assert.deepEqual(resolveTenantTablePolicies(currentNames), TENANT_TABLE_POLICIES);
    assert.deepEqual(
      resolveTenantTablePolicies(expandedNames),
      EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(simulationExpandedNames),
      SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.deepEqual(
      resolveTenantTablePolicies(fullyExpandedNames),
      FULLY_EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.throws(
      () => resolveTenantTablePolicies([...currentNames, "app_users"]),
      /core identity system tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...expandedNames,
          "simulation_scenario_approval_revisions",
        ]),
      /simulation approval tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...currentNames,
          ...SIMULATION_APPROVAL_USER_TABLE_POLICIES.map(
            (policy) => policy.table,
          ),
        ]),
      /simulation approval tables require core identity tables/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...simulationExpandedNames,
          "identity_pairing_intents",
        ]),
      /pairing identity system tables must be expanded atomically/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...currentNames,
          "identity_pairing_intents",
          "identity_pairing_intent_events",
        ]),
      /pairing identity system requires core identity tables/,
    );
    assert.throws(
      () =>
        resolveTenantTablePolicies([
          ...expandedNames,
          "identity_pairing_intents",
          "identity_pairing_intent_events",
        ]),
      /pairing identity system requires simulation approval tables/,
    );
    assert.deepEqual(
      summarizeTenantClassifications(EXPANDED_TENANT_TABLE_POLICIES),
      {
        user_owned: 14,
        shared_reference: 7,
        admin_system: 1,
        identity_system: 2,
        unresolved: 0,
      },
    );
    assert.deepEqual(
      summarizeTenantClassifications(
        SIMULATION_APPROVAL_EXPANDED_TENANT_TABLE_POLICIES,
      ),
      {
        user_owned: 17,
        shared_reference: 7,
        admin_system: 1,
        identity_system: 2,
        unresolved: 0,
      },
    );
    assert.deepEqual(
      summarizeTenantClassifications(FULLY_EXPANDED_TENANT_TABLE_POLICIES),
      {
        user_owned: 17,
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
    assert.equal(
      FULLY_EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) => policy.table === "app_users",
      )?.classification,
      "identity_system",
    );
    assert.equal(
      FULLY_EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) => policy.table === "identity_pairing_intents",
      )?.classification,
      "identity_system",
    );
    assert.equal(
      FULLY_EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) => policy.table === "simulation_scenario_approval_revisions",
      )?.classification,
      "user_owned",
    );
    assert.deepEqual(
      FULLY_EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) =>
          policy.table === "simulation_scenario_approval_vector_rows",
      )?.ownerVia,
      {
        kind: "parent_foreign_key",
        column: "approval_revision_id",
        parentTable: "simulation_scenario_approval_revisions",
        parentColumn: "id",
      },
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
    assert.equal(TRANSITIONAL_OWNER_TABLE_NAMES.length, 14);
    assert.ok(
      !TRANSITIONAL_OWNER_TABLE_NAMES.includes(
        "simulation_scenario_approval_revisions",
      ),
    );

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
