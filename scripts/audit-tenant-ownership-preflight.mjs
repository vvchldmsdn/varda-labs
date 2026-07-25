import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import {
  CANONICAL_OWNER_CONTRACT,
  FULLY_EXPANDED_TENANT_TABLE_POLICIES,
  resolveTenantTablePolicies,
  summarizeTenantClassifications,
} from "./lib/tenant-ownership-policy.mjs";

config({ path: ".env.local", quiet: true });

if (process.argv.length > 2) {
  throw new Error("This audit accepts no arguments and never writes");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

for (const policy of FULLY_EXPANDED_TENANT_TABLE_POLICIES) {
  assert.match(policy.table, /^[a-z][a-z0-9_]*$/);
  if (policy.currentOwnerColumn) {
    assert.match(policy.currentOwnerColumn, /^[a-z][a-z0-9_]*$/);
  }
  if (policy.ownerVia) {
    assert.equal(policy.ownerVia.kind, "parent_foreign_key");
    assert.match(policy.ownerVia.column, /^[a-z][a-z0-9_]*$/);
    assert.match(policy.ownerVia.parentTable, /^[a-z][a-z0-9_]*$/);
    assert.match(policy.ownerVia.parentColumn, /^[a-z][a-z0-9_]*$/);
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
    and column_name in ('owner_user_id', 'created_by_id')
  order by table_name, column_name
`);

const foreignKeys = await sql.query(`
  select
    constraint_definition.table_name,
    constraint_definition.constraint_name,
    local_column.column_name,
    referenced_column.table_name as foreign_table_name,
    referenced_column.column_name as foreign_column_name
  from information_schema.table_constraints constraint_definition
  join information_schema.key_column_usage local_column
    on local_column.constraint_schema = constraint_definition.constraint_schema
   and local_column.constraint_name = constraint_definition.constraint_name
  join information_schema.constraint_column_usage referenced_column
    on referenced_column.constraint_schema = constraint_definition.constraint_schema
   and referenced_column.constraint_name = constraint_definition.constraint_name
  where constraint_definition.table_schema = 'public'
    and constraint_definition.constraint_type = 'FOREIGN KEY'
  order by
    constraint_definition.table_name,
    constraint_definition.constraint_name,
    local_column.ordinal_position
`);

const rowCounts = await sql.query(
  activePolicies.map(
    ({ table }) =>
      `select '${table}'::text as table_name, count(*)::int as row_count from "${table}"`,
  ).join(" union all "),
);

const legacyOwnerPolicies = activePolicies.filter(
  (policy) => policy.currentOwnerColumn,
);
const ownerStats = await sql.query(
  legacyOwnerPolicies
    .map(
      ({ table, currentOwnerColumn }) => `
        select
          '${table}'::text as table_name,
          '${currentOwnerColumn}'::text as column_name,
          count(*) filter (where "${currentOwnerColumn}" is null)::int as null_rows,
          count(*) filter (where "${currentOwnerColumn}" is not null)::int as non_null_rows,
          count(distinct "${currentOwnerColumn}")::int as distinct_values
        from "${table}"
      `,
    )
    .join(" union all "),
);

const rowCountByTable = new Map(
  rowCounts.map((row) => [row.table_name, Number(row.row_count)]),
);
const columnByKey = new Map(
  ownerColumns.map((column) => [
    `${column.table_name}:${column.column_name}`,
    column,
  ]),
);
const ownerStatsByKey = new Map(
  ownerStats.map((stats) => [
    `${stats.table_name}:${stats.column_name}`,
    stats,
  ]),
);
const foreignKeyByPath = new Map(
  foreignKeys.map((foreignKey) => [
    [
      foreignKey.table_name,
      foreignKey.column_name,
      foreignKey.foreign_table_name,
      foreignKey.foreign_column_name,
    ].join(":"),
    foreignKey,
  ]),
);
const policyByTable = new Map(
  activePolicies.map((policy) => [policy.table, policy]),
);

const tables = activePolicies.map((policy) => {
  const currentColumn = policy.currentOwnerColumn
    ? columnByKey.get(`${policy.table}:${policy.currentOwnerColumn}`)
    : null;
  const currentStats = policy.currentOwnerColumn
    ? ownerStatsByKey.get(`${policy.table}:${policy.currentOwnerColumn}`)
    : null;

  if (policy.currentOwnerColumn) {
    assert.ok(currentColumn, `${policy.table} owner column is missing`);
    assert.ok(currentStats, `${policy.table} owner stats are missing`);
  }
  const ownerViaForeignKey = policy.ownerVia
    ? foreignKeyByPath.get(
        [
          policy.table,
          policy.ownerVia.column,
          policy.ownerVia.parentTable,
          policy.ownerVia.parentColumn,
        ].join(":"),
      )
    : null;
  if (policy.ownerVia) {
    assert.ok(ownerViaForeignKey, `${policy.table} owner path is missing`);
  }
  const parentOwnerPolicy = policy.ownerVia
    ? policyByTable.get(policy.ownerVia.parentTable)
    : null;
  const parentOwnerColumn = parentOwnerPolicy?.currentOwnerColumn
    ? columnByKey.get(
        `${parentOwnerPolicy.table}:${parentOwnerPolicy.currentOwnerColumn}`,
      )
    : null;
  const canonicalOwnerReady =
    (currentColumn?.column_name === CANONICAL_OWNER_CONTRACT.ownerColumn &&
      currentColumn?.data_type === CANONICAL_OWNER_CONTRACT.ownerColumnType &&
      currentColumn?.is_nullable === "NO") ||
    (ownerViaForeignKey !== null &&
      parentOwnerColumn?.column_name ===
        CANONICAL_OWNER_CONTRACT.ownerColumn &&
      parentOwnerColumn?.data_type ===
        CANONICAL_OWNER_CONTRACT.ownerColumnType &&
      parentOwnerColumn?.is_nullable === "NO");

  return {
    table: policy.table,
    classification: policy.classification,
    rows: rowCountByTable.get(policy.table) ?? 0,
    canonicalOwnerRequired: policy.canonicalOwnerRequired,
    ownerVia: policy.ownerVia,
    currentOwner: currentColumn
      ? {
          column: currentColumn.column_name,
          type: currentColumn.data_type,
          nullable: currentColumn.is_nullable === "YES",
          nullRows: Number(currentStats.null_rows),
          nonNullRows: Number(currentStats.non_null_rows),
          distinctValues: Number(currentStats.distinct_values),
        }
      : null,
    canonicalOwnerReady,
  };
});

const userOwnedTables = tables.filter(
  (table) => table.classification === "user_owned",
);
const canonicalOwnerReadyRows = userOwnedTables
  .filter((table) => table.canonicalOwnerReady)
  .reduce((sum, table) => sum + table.rows, 0);
const userOwnedRows = userOwnedTables.reduce(
  (sum, table) => sum + table.rows,
  0,
);

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
      userOwnedRows,
      canonicalOwnerReadyRows,
      userOwnedRowsWithoutCanonicalOwner: userOwnedRows - canonicalOwnerReadyRows,
      tables,
    },
    null,
    2,
  ),
);
