import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync("drizzle/0031_third_penance.sql", "utf8");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("snapshot tenant RLS", () => {
  it("contains only RLS enablement, SELECT policies, and SELECT grants", () => {
    assert.deepEqual(statements, [
      'ALTER TABLE "daily_portfolio_snapshots" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "daily_position_snapshots" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "daily_portfolio_snapshots_tenant_select_v1" ON "daily_portfolio_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("daily_portfolio_snapshots"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'CREATE POLICY "daily_position_snapshots_tenant_select_v1" ON "daily_position_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("daily_position_snapshots"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'GRANT SELECT ON TABLE "daily_portfolio_snapshots" TO "varda_tenant_app";',
      'GRANT SELECT ON TABLE "daily_position_snapshots" TO "varda_tenant_app";',
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
      /ALTER TABLE "(?!daily_(?:portfolio|position)_snapshots")/i,
    );
  });

  it("keeps both Drizzle snapshot schemas aligned with the migration", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");

    for (const [exportName, policyName] of [
      ["dailyPortfolioSnapshots", "daily_portfolio_snapshots_tenant_select_v1"],
      ["dailyPositionSnapshots", "daily_position_snapshots_tenant_select_v1"],
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
    const audit = readFileSync("scripts/lib/audit-tenant-table-rls.ts", "utf8");

    for (const [path, tableName, policyName] of [
      [
        "scripts/audit-daily-portfolio-snapshots-tenant-rls.ts",
        "daily_portfolio_snapshots",
        "daily_portfolio_snapshots_tenant_select_v1",
      ],
      [
        "scripts/audit-daily-position-snapshots-tenant-rls.ts",
        "daily_position_snapshots",
        "daily_position_snapshots_tenant_select_v1",
      ],
    ]) {
      const wrapper = readFileSync(path, "utf8");
      assert.match(wrapper, new RegExp(`tableName: "${tableName}"`));
      assert.match(wrapper, new RegExp(`policyName: "${policyName}"`));
      assert.match(wrapper, /runTenantTableRlsAudit/);
    }

    assert.match(audit, /runTenantReadTransaction/);
    assert.match(audit, /unownedRows !== 0/);
    assert.match(audit, /databaseSideEffects: false/);
    assert.doesNotMatch(audit, /console\.log\(process\.env/);
  });

  it("routes both snapshot canaries through tenant-role transactions", () => {
    for (const [path, tableName] of [
      [
        "src/db/queries/tenant-portfolio-snapshots.ts",
        "daily_portfolio_snapshots",
      ],
      [
        "src/db/queries/tenant-position-snapshots.ts",
        "daily_position_snapshots",
      ],
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /runTenantReadTransaction/);
      assert.match(source, /tenantContext\.ownerUserId/);
      assert.match(source, new RegExp(`from public\\.${tableName} as snapshot`));
      assert.match(source, /inner join public\.accounts as account/);
      assert.doesNotMatch(source, /from "@\/db\/client"/);
    }
  });

  it("reads the physical portfolio snapshot USD/KRW column", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const source = readFileSync(
      "src/db/queries/tenant-portfolio-snapshots.ts",
      "utf8",
    );

    assert.match(schema, /usdKrw:\s*decimal\("usdkrw"/);
    assert.match(source, /snapshot\.usdkrw::text as usd_krw/);
    assert.doesNotMatch(source, /snapshot\.usd_krw/);
  });
});
