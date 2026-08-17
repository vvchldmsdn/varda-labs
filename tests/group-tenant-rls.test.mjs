import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "drizzle/0033_lucky_ben_grimm.sql",
  "utf8",
);
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const tables = [
  "asset_group_members",
  "asset_groups",
  "portfolio_group_account_memberships",
  "portfolio_group_asset_memberships",
  "portfolio_groups",
];

describe("group tenant RLS", () => {
  it("contains only five RLS enablements, SELECT policies, and SELECT grants", () => {
    assert.deepEqual(statements, [
      ...tables.map(
        (table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      ),
      ...tables.map(
        (table) =>
          `CREATE POLICY "${table}_tenant_select_v1" ON "${table}" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("${table}"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);`,
      ),
      ...tables.map(
        (table) =>
          `GRANT SELECT ON TABLE "${table}" TO "varda_tenant_app";`,
      ),
    ]);
  });

  it("does not force RLS, grant writes, or mutate data", () => {
    assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/i);
    assert.doesNotMatch(migration, /WITH CHECK/i);
    assert.doesNotMatch(
      migration,
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)/i,
    );
    assert.doesNotMatch(
      migration,
      /^\s*(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|DROP|CREATE ROLE|ALTER ROLE)\b/gim,
    );
  });

  it("keeps all five Drizzle policies aligned with the migration", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    for (const table of tables) {
      assert.match(schema, new RegExp(`${table}_tenant_select_v1`));
    }
    assert.equal(
      [...schema.matchAll(/using: currentTenantOwns\(table\.canonicalOwnerUserId\)/g)]
        .length >= 11,
      true,
    );
  });

  it("uses one RLS-backed group DAL without owner predicates in its SQL", () => {
    const query = readFileSync(
      "src/db/queries/tenant-group-reads.ts",
      "utf8",
    );
    const sqlBlocks = [...query.matchAll(/const [A-Z_]+_SQL = `([\s\S]*?)`;/g)]
      .map((match) => match[1])
      .join("\n");

    assert.match(query, /runTenantReadTransaction/);
    for (const table of tables) {
      assert.match(sqlBlocks, new RegExp(`public\\.${table}`));
    }
    assert.doesNotMatch(
      sqlBlocks,
      /canonical_owner_user_id\s*=|owner_user_id\s*=/,
    );
    assert.match(query, /type MembershipMode = "all" \| "effective" \| "open"/);
    assert.match(query, /valid_from <= \$3::date/);
    assert.match(query, /valid_to > \$3::date/);
  });

  it("audits empty dynamic group tables without claiming a row canary", () => {
    const wrapper = readFileSync("scripts/audit-group-tenant-rls.ts", "utf8");
    const audit = readFileSync(
      "scripts/lib/audit-tenant-table-rls.ts",
      "utf8",
    );

    for (const table of tables) assert.match(wrapper, new RegExp(table));
    assert.match(wrapper, /allowEmptyTable: true/);
    assert.match(audit, /empty_table_no_matching_owner_row/);
    assert.match(audit, /context_leaked_outside_transaction/);
    assert.match(audit, /foreign_scope_visible/);
    assert.match(audit, /databaseSideEffects: false/);
  });
});
