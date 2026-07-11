import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OWNER_IN_SCOPE_USER_TABLE_NAMES,
  CANONICAL_OWNER_CONTRACT,
  CANONICAL_OWNER_ROLLOUT_SCOPES,
  EXPANDED_TENANT_TABLE_POLICIES,
  IDENTITY_SYSTEM_TABLE_POLICIES,
  LEGACY_EXCLUDED_USER_TABLE_NAMES,
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

  it("prepares an atomic identity-system expansion", () => {
    const currentNames = TENANT_TABLE_POLICIES.map((policy) => policy.table);
    const expandedNames = EXPANDED_TENANT_TABLE_POLICIES.map(
      (policy) => policy.table,
    );

    assert.deepEqual(
      IDENTITY_SYSTEM_TABLE_POLICIES.map((policy) => policy.table),
      ["app_users", "auth_identities"],
    );
    assert.equal(expandedNames.length, 24);
    assert.deepEqual(resolveTenantTablePolicies(currentNames), TENANT_TABLE_POLICIES);
    assert.deepEqual(
      resolveTenantTablePolicies(expandedNames),
      EXPANDED_TENANT_TABLE_POLICIES,
    );
    assert.throws(
      () => resolveTenantTablePolicies([...currentNames, "app_users"]),
      /expanded atomically/,
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
      EXPANDED_TENANT_TABLE_POLICIES.find(
        (policy) => policy.table === "app_users",
      )?.classification,
      "identity_system",
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
