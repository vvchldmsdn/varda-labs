import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL_OWNER_CONTRACT,
  TENANT_TABLE_POLICIES,
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
      unresolved: 0,
    });
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
  });
});
