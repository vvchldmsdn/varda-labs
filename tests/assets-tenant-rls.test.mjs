import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "drizzle/0029_swift_wilson_fisk.sql",
  "utf8",
);
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe("assets tenant RLS", () => {
  it("contains only RLS enablement, one SELECT policy, and one SELECT grant", () => {
    assert.deepEqual(statements, [
      'ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY "assets_tenant_select_v1" ON "assets" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("assets"."canonical_owner_user_id" = nullif(current_setting(\'app.current_user_id\', true), \'\')::uuid);',
      'GRANT SELECT ON TABLE "assets" TO "varda_tenant_app";',
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
    assert.doesNotMatch(migration, /ALTER TABLE "(?!assets")/i);
  });

  it("keeps the Drizzle assets schema aligned with the migration", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const assetsSection = schema.match(
      /export const assets = pgTable\([\s\S]*?(?=export type Asset =)/,
    )?.[0];

    assert.ok(assetsSection);
    assert.match(assetsSection, /pgPolicy\("assets_tenant_select_v1"/);
    assert.match(assetsSection, /for: "select"/);
    assert.match(
      assetsSection,
      /using: currentTenantOwns\(table\.canonicalOwnerUserId\)/,
    );
    assert.match(assetsSection, /\)\.enableRLS\(\);/);
  });

  it("uses the shared SELECT-only runtime audit without duplicating it", () => {
    const wrapper = readFileSync("scripts/audit-assets-tenant-rls.ts", "utf8");
    const accountWrapper = readFileSync(
      "scripts/audit-accounts-tenant-rls.ts",
      "utf8",
    );
    const audit = readFileSync(
      "scripts/lib/audit-tenant-table-rls.ts",
      "utf8",
    );

    assert.match(wrapper, /policyName: "assets_tenant_select_v1"/);
    assert.match(wrapper, /tableName: "assets"/);
    assert.match(accountWrapper, /runTenantTableRlsAudit/);
    assert.equal(accountWrapper.split("\n").length < 15, true);
    assert.match(audit, /runTenantReadTransaction/);
    assert.match(audit, /unownedRows !== 0/);
    assert.match(audit, /databaseSideEffects: false/);
    assert.doesNotMatch(audit, /console\.log\(process\.env/);
  });

  it("routes holdings through account and asset RLS in one read transaction", () => {
    const query = readFileSync("src/db/queries/tenant-holdings.ts", "utf8");
    const holdingSql = query.match(
      /const TENANT_HOLDING_ROWS_SQL = `([\s\S]*?)`;/,
    )?.[1];

    assert.match(query, /runTenantReadTransaction/);
    assert.match(query, /tenantContext\.ownerUserId/);
    assert.ok(holdingSql);
    assert.match(holdingSql, /from public\.assets as asset/);
    assert.match(
      holdingSql,
      /inner join public\.accounts as account on asset\.account_id = account\.id/,
    );
    assert.match(holdingSql, /account\.is_active = true/);
    assert.match(holdingSql, /asset\.account = account\.code/);
    assert.doesNotMatch(
      holdingSql,
      /canonical_owner_user_id|owner_user_id|app\.current_user_id/,
    );
    assert.match(query, /getPortfolioAnalysisScopeTargets/);
    assert.match(query, /wholeAccountIds\.has/);
    assert.match(query, /directAssetIds\.has/);
  });
});
