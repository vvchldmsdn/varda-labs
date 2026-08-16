import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  CANONICAL_OWNER_CONTRACT,
  EXPANDED_TENANT_TABLE_POLICIES,
  resolveTenantTablePolicies,
  summarizeTenantClassifications,
} from "./lib/tenant-ownership-policy.mjs";
import {
  buildTenantOwnershipAudit,
  collectAuditedOwnerColumns,
} from "./lib/tenant-ownership-audit.mjs";

config({ path: ".env.local", quiet: true });

if (process.argv.length > 2) {
  throw new Error("This audit accepts no arguments and never writes");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

for (const policy of EXPANDED_TENANT_TABLE_POLICIES) {
  assert.match(policy.table, /^[a-z][a-z0-9_]*$/);
  if (policy.currentOwnerColumn) {
    assert.match(policy.currentOwnerColumn, /^[a-z][a-z0-9_]*$/);
  }
}

const sql = neon(process.env.DATABASE_URL);
const publicTables = await sql.query(`
  select table_name
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
  order by table_name
`);
const publicTableNames = publicTables.map((row) => row.table_name);
const activePolicies = resolveTenantTablePolicies(publicTableNames);
const expectedTables = activePolicies.map((policy) => policy.table).sort();
assert.deepEqual(
  publicTableNames,
  expectedTables,
  "tenant policy must classify every public base table exactly once",
);

const ownerColumns = await sql.query(`
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and column_name in (
      'owner_user_id',
      'canonical_owner_user_id',
      'created_by_id'
    )
  order by table_name, column_name
`);

const foreignKeys = await sql.query(`
  select table_name, constraint_name
  from information_schema.table_constraints
  where table_schema = 'public'
    and constraint_type = 'FOREIGN KEY'
  order by table_name, constraint_name
`);

const rowCounts = await sql.query(
  activePolicies.map(
    ({ table }) =>
      `select '${table}'::text as table_name, count(*)::int as row_count from "${table}"`,
  ).join(" union all "),
);

const auditedOwnerColumns = collectAuditedOwnerColumns(
  activePolicies,
  ownerColumns,
);
const ownerStats = await sql.query(
  auditedOwnerColumns
    .map(
      ({ table, columnName }) => `
        select
          '${table}'::text as table_name,
          '${columnName}'::text as column_name,
          count(*) filter (where "${columnName}" is null)::int as null_rows,
          count(*) filter (where "${columnName}" is not null)::int as non_null_rows,
          count(distinct "${columnName}")::int as distinct_values
        from "${table}"
      `,
    )
    .join(" union all "),
);
const ownershipAudit = buildTenantOwnershipAudit({
  policies: activePolicies,
  ownerColumns,
  ownerStats,
  rowCounts,
});

console.log(
  JSON.stringify(
    {
      audit: "tenant_ownership_preflight",
      readOnly: true,
      databaseSideEffects: false,
      selectCount: 5,
      canonicalOwnerContract: CANONICAL_OWNER_CONTRACT,
      classificationCounts: summarizeTenantClassifications(activePolicies),
      foreignKeyCount: foreignKeys.length,
      ...ownershipAudit.ownershipSummary,
      tables: ownershipAudit.tables,
    },
    null,
    2,
  ),
);
