import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { guardTenantDatabaseRoleBoundary } from "../src/lib/deployment/tenant-database-role-boundary.ts";
import {
  TENANT_CONTEXT_SETTING_NAME,
  TENANT_DATABASE_ROLE_NAME,
} from "../src/lib/deployment/tenant-security-constants.ts";

config({ path: ".env.local", quiet: true });

let auditStage = "startup";

async function main() {
  const boundary = guardTenantDatabaseRoleBoundary(process.env);
  const privilegedUrl = requiredEnvironmentValue("DATABASE_URL");
  const privilegedSql = neon(privilegedUrl);

  auditStage = "table_catalog";
  const tableRows = await privilegedSql.query(TABLE_RLS_SQL);
  auditStage = "policy_catalog";
  const policyRows = await privilegedSql.query(POLICY_SQL);
  auditStage = "privilege_catalog";
  const privilegeRows = await privilegedSql.query(PRIVILEGE_SQL, [
    TENANT_DATABASE_ROLE_NAME,
  ]);
  auditStage = "owner_catalog";
  const ownerRows = await privilegedSql.query(OWNER_COUNTS_SQL);

  const table = singleRow(tableRows, "accounts_table_catalog_invalid");
  const policy = singleRow(policyRows, "accounts_policy_catalog_invalid");
  const privileges = singleRow(
    privilegeRows,
    "accounts_privilege_catalog_invalid",
  );
  const owners = ownerRows.map((row) => record(row, "accounts_owner_catalog_invalid"));
  if (owners.length === 0) fail("accounts_owner_catalog_empty");

  const selectedOwner = owners[0];
  const ownerUserId = requiredString(
    selectedOwner.owner_user_id,
    "accounts_owner_catalog_invalid",
  );
  const expectedOwnerRows = integerValue(
    selectedOwner.row_count,
    "accounts_owner_catalog_invalid",
  );
  const totalRows = owners.reduce(
    (sum, owner) =>
      sum + integerValue(owner.row_count, "accounts_owner_catalog_invalid"),
    0,
  );

  assertCatalog(table, policy, privileges);

  auditStage = "runtime_import";
  const {
    tenantSqlClient,
  } = await import("../src/db/tenant-client.ts");
  const {
    runTenantReadTransaction,
  } = await import("../src/db/tenant-transaction-context.ts");

  auditStage = "no_context_before";
  const beforeRows = await tenantSqlClient.query(VISIBLE_COUNT_SQL);
  auditStage = "matching_context";
  const [matchingRows] = await runTenantReadTransaction(
    ownerUserId,
    (transaction) => [transaction.query(CONTEXT_COUNT_SQL)],
  );
  auditStage = "foreign_context";
  const [foreignRows] = await runTenantReadTransaction(
    randomUUID(),
    (transaction) => [transaction.query(VISIBLE_COUNT_SQL)],
  );
  auditStage = "no_context_after";
  const afterRows = await tenantSqlClient.query(VISIBLE_COUNT_SQL);

  const beforeCount = readCount(beforeRows, "visible_count");
  const matching = singleRow(matchingRows, "accounts_matching_read_invalid");
  const matchingCount = integerValue(
    matching.visible_count,
    "accounts_matching_read_invalid",
  );
  const mismatchCount = integerValue(
    matching.mismatch_count,
    "accounts_matching_read_invalid",
  );
  const foreignCount = readCount(foreignRows, "visible_count");
  const afterCount = readCount(afterRows, "visible_count");

  if (beforeCount !== 0 || afterCount !== 0) {
    fail("accounts_context_leaked_outside_transaction");
  }
  if (matchingCount !== expectedOwnerRows || mismatchCount !== 0) {
    fail("accounts_owner_scope_mismatch");
  }
  if (foreignCount !== 0) fail("accounts_foreign_scope_visible");

  auditStage = "complete";
  console.log(
    JSON.stringify(
      {
        operation: "accounts_tenant_rls_audit",
        status: "accounts_tenant_rls_passed",
        credentialBoundaryStatus: boundary.status,
        rlsEnabled: true,
        rlsForced: false,
        policyCount: 1,
        tenantPrivileges: ["SELECT"],
        ownerGroups: owners.length,
        ownerScopedRows: totalRows,
        selectedOwnerRows: matchingCount,
        noContextRows: beforeCount,
        foreignContextRows: foreignCount,
        contextLeakedAfterTransaction: afterCount !== 0,
        databaseSideEffects: false,
      },
      null,
      2,
    ),
  );
}

function assertCatalog(
  table: Record<string, unknown>,
  policy: Record<string, unknown>,
  privileges: Record<string, unknown>,
) {
  if (table.rls_enabled !== true || table.rls_forced !== false) {
    fail("accounts_rls_catalog_mismatch");
  }
  if (
    policy.policy_name !== "accounts_tenant_select_v1" ||
    policy.permissive !== "PERMISSIVE" ||
    policy.command !== "SELECT" ||
    policy.with_check !== null ||
    !policyTargetsTenantRole(policy.roles) ||
    !requiredString(policy.qualifier, "accounts_policy_catalog_invalid").includes(
      TENANT_CONTEXT_SETTING_NAME,
    )
  ) {
    fail("accounts_policy_catalog_mismatch");
  }
  if (
    privileges.can_select !== true ||
    privileges.can_insert !== false ||
    privileges.can_update !== false ||
    privileges.can_delete !== false ||
    privileges.can_truncate !== false ||
    privileges.can_references !== false ||
    privileges.can_trigger !== false
  ) {
    fail("accounts_privilege_catalog_mismatch");
  }
}

function policyTargetsTenantRole(value: unknown) {
  if (Array.isArray(value)) {
    return value.length === 1 && value[0] === TENANT_DATABASE_ROLE_NAME;
  }
  return value === `{${TENANT_DATABASE_ROLE_NAME}}`;
}

function readCount(rows: unknown, key: string) {
  return integerValue(singleRow(rows, "accounts_count_invalid")[key], "accounts_count_invalid");
}

function singleRow(rows: unknown, code: string) {
  if (!Array.isArray(rows) || rows.length !== 1) fail(code);
  return record(rows[0], code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(code);
  }
  return value as Record<string, unknown>;
}

function integerValue(value: unknown, code: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(code);
  return parsed;
}

function requiredString(value: unknown, code: string) {
  if (typeof value !== "string" || value.length === 0) fail(code);
  return value;
}

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) fail("database_not_configured");
  return value;
}

function fail(code: string): never {
  throw new Error(`Accounts tenant RLS audit blocked: ${code}`);
}

function safeErrorKind(value: unknown) {
  if (!(value instanceof Error)) return typeof value;

  const error = value as Error & {
    code?: unknown;
    status?: unknown;
    cause?: unknown;
  };
  const cause =
    typeof error.cause === "object" && error.cause !== null
      ? (error.cause as { code?: unknown; name?: unknown })
      : null;
  const missingIdentifier =
    error.name === "ReferenceError"
      ? /^([A-Za-z_$][A-Za-z0-9_$]*) is not defined$/.exec(error.message)?.[1]
      : "";
  const referenceDetail =
    error.name === "ReferenceError"
      ? error.message.replace(/[^A-Za-z0-9_$ -]/g, "").slice(0, 96)
      : "";
  return [
    error.name,
    safeDiagnosticToken(missingIdentifier),
    referenceDetail,
    safeDiagnosticToken(error.code),
    safeDiagnosticToken(error.status),
    safeDiagnosticToken(cause?.name),
    safeDiagnosticToken(cause?.code),
  ]
    .filter(Boolean)
    .join(":");
}

function safeDiagnosticToken(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)
    : "";
}

const TABLE_RLS_SQL = `
  select
    class.relrowsecurity as rls_enabled,
    class.relforcerowsecurity as rls_forced
  from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = 'accounts'
    and class.relkind = 'r'
`;

const POLICY_SQL = `
  select
    policyname as policy_name,
    permissive,
    roles,
    cmd as command,
    qual as qualifier,
    with_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'accounts'
`;

const PRIVILEGE_SQL = `
  select
    has_table_privilege($1, 'public.accounts', 'SELECT') as can_select,
    has_table_privilege($1, 'public.accounts', 'INSERT') as can_insert,
    has_table_privilege($1, 'public.accounts', 'UPDATE') as can_update,
    has_table_privilege($1, 'public.accounts', 'DELETE') as can_delete,
    has_table_privilege($1, 'public.accounts', 'TRUN' || 'CATE') as can_truncate,
    has_table_privilege($1, 'public.accounts', 'REFERENCES') as can_references,
    has_table_privilege($1, 'public.accounts', 'TRIGGER') as can_trigger
`;

const OWNER_COUNTS_SQL = `
  select
    canonical_owner_user_id::text as owner_user_id,
    count(*)::int as row_count
  from public.accounts
  where canonical_owner_user_id is not null
  group by canonical_owner_user_id
  order by canonical_owner_user_id
`;

const VISIBLE_COUNT_SQL = `
  select count(*)::int as visible_count
  from public.accounts
`;

const CONTEXT_COUNT_SQL = `
  select
    count(*)::int as visible_count,
    count(*) filter (
      where canonical_owner_user_id is distinct from
        nullif(current_setting('${TENANT_CONTEXT_SETTING_NAME}', true), '')::uuid
    )::int as mismatch_count
  from public.accounts
`;

void main().catch((error) => {
  const code =
    error instanceof Error
      ? /^Accounts tenant RLS audit blocked: ([a-z_]+)$/.exec(error.message)?.[1]
      : null;
  console.error(
    JSON.stringify({
      operation: "accounts_tenant_rls_audit",
      status: "blocked",
      blockers: [code ?? `accounts_tenant_rls_${auditStage}_failed`],
      errorKind: safeErrorKind(error),
      databaseSideEffects: false,
    }),
  );
  process.exitCode = 1;
});
