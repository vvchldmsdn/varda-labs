import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const schema = read("src/db/schema.ts");
const migration = read("drizzle/0035_worthless_thor.sql");
const migrationStatements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const tables = [
  "portfolio_target_policy_lifecycle_events",
  "portfolio_target_policy_revisions",
  "portfolio_target_policy_rows",
  "target_policy_approval_lifecycle_events",
  "target_policy_approval_revisions",
  "target_policy_approval_vector_rows",
];

describe("target policy tenant RLS boundary", () => {
  it("defines SELECT-only tenant policies on both target-policy models", () => {
    for (const policyName of [
      "target_policy_revisions_tenant_select_v1",
      "target_policy_vector_rows_tenant_select_v1",
      "target_policy_events_tenant_select_v1",
      "portfolio_target_policy_revisions_tenant_select_v1",
      "portfolio_target_policy_rows_tenant_select_v1",
      "portfolio_target_policy_events_tenant_select_v1",
    ]) {
      assert.match(schema, new RegExp(policyName));
    }

    const legacy = tableFamily(
      schema,
      "export const targetPolicyApprovalRevisions",
      "export const portfolioTargetPolicyRevisions",
    );
    const portfolio = tableFamily(
      schema,
      "export const portfolioTargetPolicyRevisions",
      "export const assetGroups",
    );
    assert.equal((legacy.match(/\.enableRLS\(\);/g) ?? []).length, 3);
    assert.equal((portfolio.match(/\.enableRLS\(\);/g) ?? []).length, 3);
    assert.match(legacy, /currentTenantOwns\(table\.ownerUserId\)/);
    assert.equal(
      (legacy.match(/from \$\{targetPolicyApprovalRevisions\}/g) ?? [])
        .length,
      2,
    );
    assert.equal(
      (
        legacy.match(
          /currentTenantOwns\(targetPolicyApprovalRevisions\.ownerUserId\)/g,
        ) ?? []
      ).length,
      2,
    );
    assert.equal(
      (portfolio.match(/currentTenantOwns\(table\.canonicalOwnerUserId\)/g) ?? [])
        .length,
      3,
    );
  });

  it("keeps migration 0035 to six RLS policies and SELECT grants", () => {
    assert.equal(migrationStatements.length, 18);
    assert.deepEqual(
      migrationStatements.slice(0, 6),
      tables.map(
        (table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      ),
    );
    const policies = migrationStatements.slice(6, 12);
    assert.equal(policies.filter((statement) => statement.startsWith("CREATE POLICY")).length, 6);
    for (const table of tables) {
      assert.ok(
        policies.some((statement) => statement.includes(` ON "${table}" `)),
        `${table} policy is missing`,
      );
    }
    assert.deepEqual(
      migrationStatements.slice(12),
      tables.map(
        (table) =>
          `GRANT SELECT ON TABLE "${table}" TO "varda_tenant_app";`,
      ),
    );
    assert.equal((migration.match(/exists \(/g) ?? []).length, 2);
    assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY|WITH CHECK/i);
    assert.doesNotMatch(
      migration,
      /GRANT\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)/i,
    );
    assert.doesNotMatch(
      migration,
      /^\s*(?:INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE|DROP)\b/gim,
    );
  });

  it("loads current policy rows through one tenant transaction without owner predicates", () => {
    const source = read("src/db/queries/tenant-target-policies.ts");
    const legacySql = sqlBlock(source, "LEGACY_TARGET_POLICY_SQL");
    const portfolioSql = sqlBlock(source, "PORTFOLIO_TARGET_POLICY_SQL");

    assert.match(source, /^import "server-only";/);
    assert.match(source, /runTenantReadTransaction/);
    assert.doesNotMatch(source, /from "@\/db\/client"/);
    assert.match(legacySql, /from public\.target_policy_approval_revisions as revision/);
    assert.match(legacySql, /inner join public\.accounts as account/);
    assert.match(legacySql, /left join public\.target_policy_approval_vector_rows as vector/);
    assert.match(legacySql, /account\.is_active = true/);
    assert.match(portfolioSql, /from public\.portfolio_target_policy_revisions as revision/);
    assert.match(portfolioSql, /left join public\.portfolio_target_policy_rows as policy_row/);
    assert.match(portfolioSql, /scope_account_id is not distinct from \$2::uuid/);
    assert.match(portfolioSql, /scope_portfolio_group_id is not distinct from \$3::uuid/);
    assert.doesNotMatch(
      `${legacySql}\n${portfolioSql}`,
      /canonical_owner_user_id|owner_user_id|app\.current_user_id/,
    );
  });

  it("routes both policy consumers through the tenant adapter", () => {
    const legacyConsumer = read("src/db/queries/target-policy.ts");
    const portfolioConsumer = read("src/db/queries/portfolio-target-policy.ts");

    assert.match(legacyConsumer, /loadCurrentTenantLegacyTargetPolicy/);
    assert.doesNotMatch(legacyConsumer, /from "@\/db\/client"/);
    assert.doesNotMatch(
      legacyConsumer,
      /targetPolicyApprovalRevisions|targetPolicyApprovalVectorRows/,
    );
    assert.match(portfolioConsumer, /loadCurrentTenantPortfolioTargetPolicy/);
    assert.doesNotMatch(
      portfolioConsumer,
      /portfolioTargetPolicyRevisions|portfolioTargetPolicyRows/,
    );
  });

  it("audits direct and parent-derived ownership without granting writes", () => {
    const runner = read("scripts/audit-target-policy-tenant-rls.ts");
    const audit = read("scripts/lib/audit-tenant-table-rls.ts");
    const packageJson = read("package.json");

    assert.equal((runner.match(/tenant_select_v1/g) ?? []).length, 6);
    assert.equal((runner.match(/allowEmptyTable: true/g) ?? []).length, 3);
    assert.match(runner, /ownerScope: "owner_user_id"/);
    assert.equal(
      (runner.match(/ownerScope: "target_policy_approval_revision"/g) ?? [])
        .length,
      2,
    );
    assert.match(audit, /left join public\.target_policy_approval_revisions as revision/);
    assert.match(audit, /revision\.owner_user_id/);
    assert.match(audit, /audited\.\$\{safeIdentifier\(ownerScope\)\}/);
    assert.match(packageJson, /audit:target-policy-tenant-rls/);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function tableFamily(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} family is missing`);
  return source.slice(start, end);
}

function sqlBlock(source, name) {
  const match = source.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  assert.ok(match, `${name} SQL block is missing`);
  return match[1];
}
