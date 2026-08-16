import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTenantOwnershipAudit,
  collectAuditedOwnerColumns,
} from "../scripts/lib/tenant-ownership-audit.mjs";

describe("tenant ownership audit", () => {
  it("separates complete transitional ownership from the final contract", () => {
    const policies = fixturePolicies();
    const ownerColumns = fixtureColumns();
    const result = buildTenantOwnershipAudit({
      policies,
      ownerColumns,
      ownerStats: fixtureStats(),
      rowCounts: [
        rowCount("assets", 17),
        rowCount("accounts", 4),
        rowCount("goals", 1),
        rowCount("target_policy_approval_revisions", 1),
        rowCount("target_policy_approval_vector_rows", 4),
        rowCount("fx_rates", 5),
      ],
    });

    assert.deepEqual(result.ownershipSummary, {
      productScopeTableCount: 4,
      productScopeRows: 26,
      effectiveOwnerReadyRows: 26,
      productScopeRowsWithoutEffectiveOwner: 0,
      finalOwnerContractReadyRows: 5,
      transitionalOwnerReadyRows: 21,
      legacyExcludedTableCount: 1,
      legacyExcludedRows: 1,
    });
    assert.equal(table(result, "assets").ownerContractStatus, "transitional_complete");
    assert.equal(table(result, "accounts").finalOwner, null);
    assert.equal(table(result, "accounts").legacyOwner.type, "character varying");
    assert.equal(table(result, "goals").ownerContractStatus, "intentionally_skipped_legacy");
    assert.equal(
      table(result, "target_policy_approval_revisions").ownerContractStatus,
      "final_contract",
    );
    assert.equal(
      table(result, "target_policy_approval_vector_rows").ownerContractStatus,
      "parent_final_contract",
    );
  });

  it("counts only the missing rows when transitional ownership is partial", () => {
    const result = buildTenantOwnershipAudit({
      policies: [fixturePolicies()[0]],
      ownerColumns: fixtureColumns().filter(
        (column) => column.table_name === "assets",
      ),
      ownerStats: [
        ownerStats("assets", "created_by_id", 17, 0),
        ownerStats("assets", "canonical_owner_user_id", 2, 15),
      ],
      rowCounts: [rowCount("assets", 17)],
    });

    assert.equal(table(result, "assets").ownerContractStatus, "transitional_partial");
    assert.equal(result.ownershipSummary.effectiveOwnerReadyRows, 15);
    assert.equal(result.ownershipSummary.productScopeRowsWithoutEffectiveOwner, 2);
  });

  it("collects each available owner evidence column once", () => {
    assert.deepEqual(
      collectAuditedOwnerColumns(fixturePolicies(), fixtureColumns()),
      [
        { table: "assets", columnName: "created_by_id" },
        { table: "assets", columnName: "canonical_owner_user_id" },
        { table: "accounts", columnName: "owner_user_id" },
        { table: "accounts", columnName: "canonical_owner_user_id" },
        { table: "goals", columnName: "owner_user_id" },
        { table: "goals", columnName: "canonical_owner_user_id" },
        { table: "target_policy_approval_revisions", columnName: "owner_user_id" },
      ],
    );
  });
});

function fixturePolicies() {
  return [
    direct("assets", "created_by_id", "in_scope"),
    direct("accounts", "owner_user_id", "in_scope"),
    direct("goals", "owner_user_id", "intentionally_skipped_legacy"),
    direct("target_policy_approval_revisions", "owner_user_id", "not_applicable"),
    {
      table: "target_policy_approval_vector_rows",
      classification: "user_owned",
      currentOwnerColumn: null,
      canonicalOwnerRequired: false,
      canonicalOwnerRolloutScope: "not_applicable",
      ownershipPath: "parent_fk",
      parentTable: "target_policy_approval_revisions",
      parentForeignKeyColumn: "approval_revision_id",
    },
    {
      table: "fx_rates",
      classification: "shared_reference",
      currentOwnerColumn: null,
      canonicalOwnerRequired: false,
      canonicalOwnerRolloutScope: "not_applicable",
      ownershipPath: "not_applicable",
    },
  ];
}

function fixtureColumns() {
  return [
    column("assets", "created_by_id", "character varying", "YES"),
    column("assets", "canonical_owner_user_id", "uuid", "YES"),
    column("accounts", "owner_user_id", "character varying", "YES"),
    column("accounts", "canonical_owner_user_id", "uuid", "YES"),
    column("goals", "owner_user_id", "character varying", "YES"),
    column("goals", "canonical_owner_user_id", "uuid", "YES"),
    column("target_policy_approval_revisions", "owner_user_id", "uuid", "NO"),
  ];
}

function fixtureStats() {
  return [
    ownerStats("assets", "created_by_id", 17, 0),
    ownerStats("assets", "canonical_owner_user_id", 0, 17),
    ownerStats("accounts", "owner_user_id", 0, 4),
    ownerStats("accounts", "canonical_owner_user_id", 0, 4),
    ownerStats("goals", "owner_user_id", 0, 1),
    ownerStats("goals", "canonical_owner_user_id", 1, 0),
    ownerStats("target_policy_approval_revisions", "owner_user_id", 0, 1),
  ];
}

function direct(table, currentOwnerColumn, scope) {
  return {
    table,
    classification: "user_owned",
    currentOwnerColumn,
    canonicalOwnerRequired: true,
    canonicalOwnerRolloutScope: scope,
    ownershipPath: "direct_column",
  };
}

function column(table_name, column_name, data_type, is_nullable) {
  return { table_name, column_name, data_type, is_nullable };
}

function ownerStats(table_name, column_name, null_rows, non_null_rows) {
  return {
    table_name,
    column_name,
    null_rows,
    non_null_rows,
    distinct_values: non_null_rows > 0 ? 1 : 0,
  };
}

function rowCount(table_name, row_count) {
  return { table_name, row_count };
}

function table(result, name) {
  return result.tables.find((row) => row.table === name);
}
