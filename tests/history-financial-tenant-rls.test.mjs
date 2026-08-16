import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = read("drizzle/0032_boring_jimmy_woo.sql");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("history financial tenant RLS", () => {
  it("contains only RLS enablement, SELECT policies, and SELECT grants", () => {
    assert.deepEqual(statements, [
      'ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "event_ledger_entries" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "account_balance_snapshots_tenant_select_v1" ON "account_balance_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("account_balance_snapshots"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'CREATE POLICY "event_ledger_entries_tenant_select_v1" ON "event_ledger_entries" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("event_ledger_entries"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'GRANT SELECT ON TABLE "account_balance_snapshots" TO "varda_tenant_app";',
      'GRANT SELECT ON TABLE "event_ledger_entries" TO "varda_tenant_app";',
    ]);
  });

  it("does not force RLS, grant writes, mutate rows, or alter other tables", () => {
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
    assert.doesNotMatch(
      migration,
      /ALTER TABLE "(?!(?:account_balance_snapshots|event_ledger_entries)")/i,
    );
  });

  it("keeps both Drizzle schemas aligned with the migration", () => {
    const schema = read("src/db/schema.ts");

    for (const [exportName, policyName] of [
      ["accountBalanceSnapshots", "account_balance_snapshots_tenant_select_v1"],
      ["eventLedgerEntries", "event_ledger_entries_tenant_select_v1"],
    ]) {
      const section = schema.match(
        new RegExp(
          `export const ${exportName} = pgTable\\([\\s\\S]*?\\)\\.enableRLS\\(\\);`,
        ),
      )?.[0];

      assert.ok(section);
      assert.match(section, new RegExp(`pgPolicy\\(\\s*"${policyName}"`));
      assert.match(section, /for: "select"/);
      assert.match(
        section,
        /using: currentTenantOwns\(table\.canonicalOwnerUserId\)/,
      );
    }
  });

  it("uses the shared SELECT-only runtime audit for both tables", () => {
    const packageJson = read("package.json");
    const audit = read("scripts/lib/audit-tenant-table-rls.ts");

    for (const [path, tableName, policyName, scriptName] of [
      [
        "scripts/audit-account-balance-snapshots-tenant-rls.ts",
        "account_balance_snapshots",
        "account_balance_snapshots_tenant_select_v1",
        "audit:account-balance-snapshots-tenant-rls",
      ],
      [
        "scripts/audit-event-ledger-tenant-rls.ts",
        "event_ledger_entries",
        "event_ledger_entries_tenant_select_v1",
        "audit:event-ledger-tenant-rls",
      ],
    ]) {
      const wrapper = read(path);
      assert.match(wrapper, new RegExp(`tableName: "${tableName}"`));
      assert.match(wrapper, new RegExp(`policyName: "${policyName}"`));
      assert.match(wrapper, /runTenantTableRlsAudit/);
      assert.match(packageJson, new RegExp(`"${scriptName}"`));
    }

    assert.match(audit, /runTenantReadTransaction/);
    assert.match(audit, /unownedRows !== 0/);
    assert.match(audit, /databaseSideEffects: false/);
  });

  it("routes event and balance reads through tenant-role transactions", () => {
    const eventSource = read("src/db/queries/tenant-events.ts");
    const balanceSource = read("src/db/queries/history-balance.ts");

    assert.match(eventSource, /runTenantReadTransaction/);
    assert.match(eventSource, /tenantContext\.ownerUserId/);
    assert.match(eventSource, /from public\.event_ledger_entries as event/);
    assert.match(eventSource, /inner join public\.accounts as account/);
    assert.doesNotMatch(eventSource, /from "@\/db\/client"/);

    assert.match(balanceSource, /runTenantReadTransaction/);
    assert.match(balanceSource, /transaction\.query\(TENANT_BALANCE_ROWS_SQL\)/);
    assert.match(
      balanceSource,
      /from public\.account_balance_snapshots as snapshot/,
    );
    assert.doesNotMatch(balanceSource, /accountBalanceSnapshots/);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}
