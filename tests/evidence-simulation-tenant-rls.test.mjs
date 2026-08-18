import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const schema = read("src/db/schema.ts");
const migration = read("drizzle/0038_cheerful_micromax.sql");
const migrationStatements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);
const tables = [
  "holding_onboarding_evidence",
  "holding_state_corrections",
  "simulation_scenario_approval_lifecycle_events",
  "simulation_scenario_approval_revisions",
  "simulation_scenario_approval_vector_rows",
];

describe("evidence and simulation tenant RLS boundary", () => {
  it("defines direct and parent-derived SELECT policies", () => {
    for (const policyName of [
      "holding_onboarding_evidence_tenant_select_v1",
      "holding_state_corrections_tenant_select_v1",
      "simulation_scenario_events_tenant_select_v1",
      "simulation_scenario_revisions_tenant_select_v1",
      "simulation_scenario_vector_rows_tenant_select_v1",
    ]) {
      assert.match(schema, new RegExp(policyName));
    }

    const simulation = tableFamily(
      schema,
      "export const simulationScenarioApprovalRevisions",
      "export const assets",
    );
    const evidence = tableFamily(
      schema,
      "export const holdingOnboardingEvidence",
      "export const holdingLifecycleEvents",
    );
    assert.equal((simulation.match(/\.enableRLS\(\);/g) ?? []).length, 3);
    assert.equal((evidence.match(/\.enableRLS\(\);/g) ?? []).length, 2);
    assert.match(simulation, /currentTenantOwns\(table\.ownerUserId\)/);
    assert.equal(
      (simulation.match(/from \$\{simulationScenarioApprovalRevisions\}/g) ?? [])
        .length,
      2,
    );
    assert.equal(
      (
        simulation.match(
          /currentTenantOwns\(simulationScenarioApprovalRevisions\.ownerUserId\)/g,
        ) ?? []
      ).length,
      2,
    );
    assert.equal(
      (evidence.match(/currentTenantOwns\(table\.canonicalOwnerUserId\)/g) ?? [])
        .length,
      2,
    );
  });

  it("keeps migration 0038 to five RLS policies and SELECT grants", () => {
    assert.equal(migrationStatements.length, 15);
    assert.deepEqual(
      migrationStatements.slice(0, 5),
      tables.map(
        (table) => `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      ),
    );
    const policies = migrationStatements.slice(5, 10);
    assert.equal(
      policies.filter((statement) => statement.startsWith("CREATE POLICY"))
        .length,
      5,
    );
    for (const table of tables) {
      assert.ok(
        policies.some((statement) => statement.includes(` ON "${table}" `)),
        `${table} policy is missing`,
      );
    }
    assert.deepEqual(
      migrationStatements.slice(10),
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

  it("audits all evidence and simulation policies without granting writes", () => {
    const runner = read("scripts/audit-evidence-simulation-tenant-rls.ts");
    const audit = read("scripts/lib/audit-tenant-table-rls.ts");
    const packageJson = read("package.json");

    assert.equal((runner.match(/tenant_select_v1/g) ?? []).length, 6);
    assert.equal((runner.match(/allowEmptyTable: true/g) ?? []).length, 6);
    assert.match(runner, /ownerScope: "owner_user_id"/);
    assert.equal(
      (
        runner.match(
          /ownerScope: "simulation_scenario_approval_revision"/g,
        ) ?? []
      ).length,
      2,
    );
    assert.match(
      audit,
      /left join public\.simulation_scenario_approval_revisions as revision/,
    );
    assert.match(audit, /revision\.owner_user_id/);
    assert.match(packageJson, /audit:evidence-simulation-tenant-rls/);
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
