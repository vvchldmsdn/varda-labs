import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = read("drizzle/0034_fine_ink.sql");
const statements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const tables = ["market_regime_daily", "settings"];

describe("settings and market regime tenant RLS", () => {
  it("contains only two RLS enablements, SELECT policies, and SELECT grants", () => {
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

  it("defines SELECT-only tenant policies on both user-owned tables", () => {
    const schema = read("src/db/schema.ts");

    for (const table of tables) {
      assert.match(schema, new RegExp(`${table}_tenant_select_v1`));
    }
    assert.match(
      schema,
      /export const marketRegimeDaily = pgTable\([\s\S]*?market_regime_daily_tenant_select_v1[\s\S]*?\)\.enableRLS\(\);/,
    );
    assert.match(
      schema,
      /export const settings = pgTable\([\s\S]*?settings_tenant_select_v1[\s\S]*?\)\.enableRLS\(\);/,
    );
  });

  it("reads only narrow settings fields through the tenant transaction", () => {
    const source = read("src/db/queries/tenant-settings.ts");
    const sql = sqlBlock(source, "LATEST_TENANT_SETTINGS_SQL");

    assert.match(source, /^import "server-only";/);
    assert.match(source, /runTenantReadTransaction/);
    assert.match(sql, /from public\.settings/);
    assert.match(sql, /trim_drift_threshold/);
    assert.match(sql, /usd_krw_rate/);
    assert.match(sql, /use_trend_filter/);
    assert.match(sql, /where is_sample = false/);
    assert.match(sql, /limit 1/);
    assert.doesNotMatch(source, /from "@\/db\/client"/);
    assert.doesNotMatch(
      sql,
      /canonical_owner_user_id|owner_user_id|housing_goal|income_/,
    );
  });

  it("reads dynamic-account regime rows through RLS without owner predicates", () => {
    const source = read("src/db/queries/tenant-market-regimes.ts");
    const marketContext = read("src/db/queries/market-context.ts");
    const sql = sqlBlock(source, "TENANT_MARKET_REGIME_ROWS_SQL");

    assert.match(source, /^import "server-only";/);
    assert.match(source, /runTenantReadTransaction/);
    assert.match(sql, /from public\.market_regime_daily as regime/);
    assert.match(sql, /inner join public\.accounts as account/);
    assert.match(sql, /account\.is_active = true/);
    assert.match(sql, /regime\.account = account\.code/);
    assert.match(sql, /regime\.is_sample = false/);
    assert.doesNotMatch(
      sql,
      /canonical_owner_user_id|owner_user_id|brokerage|isa|irp/,
    );
    assert.doesNotMatch(source, /from "@\/db\/client"/);
    assert.match(marketContext, /loadTenantMarketRegimeRows/);
    assert.doesNotMatch(
      marketContext,
      /marketRegimeDaily|NAMED_PORTFOLIO_ACCOUNTS/,
    );
  });

  it("registers one audit command for both table canaries", () => {
    const wrapper = read("scripts/audit-settings-regime-tenant-rls.ts");
    const packageJson = read("package.json");

    assert.match(wrapper, /settings_tenant_select_v1/);
    assert.match(wrapper, /market_regime_daily_tenant_select_v1/);
    assert.match(wrapper, /void runSettingsRegimeTenantRlsAudits\(\);/);
    assert.match(packageJson, /audit:settings-regime-tenant-rls/);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function sqlBlock(source, name) {
  const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  assert.ok(match, `${name} SQL block is missing`);
  return match[1];
}
