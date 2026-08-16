import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { config as loadEnvironment } from "dotenv";

import { guardTenantDatabaseRoleBoundary } from "../../src/lib/deployment/tenant-database-role-boundary.ts";
import {
  TENANT_CONTEXT_SETTING_NAME,
  TENANT_DATABASE_ROLE_NAME,
} from "../../src/lib/deployment/tenant-security-constants.ts";

loadEnvironment({ path: ".env.local", quiet: true });

type TenantTableRlsAuditConfig = Readonly<{
  operation: string;
  policyName: string;
  successStatus: string;
  tableName:
    | "account_balance_snapshots"
    | "accounts"
    | "assets"
    | "daily_portfolio_snapshots"
    | "daily_position_snapshots"
    | "event_ledger_entries";
}>;

export async function runTenantTableRlsAudit(
  auditConfig: TenantTableRlsAuditConfig,
) {
  let auditStage = "startup";
  const tableName = safeIdentifier(auditConfig.tableName);
  const policyName = safeIdentifier(auditConfig.policyName);

  try {
    const boundary = guardTenantDatabaseRoleBoundary(process.env);
    const privilegedSql = neon(requiredEnvironmentValue("DATABASE_URL"));

    auditStage = "table_catalog";
    const tableRows = await privilegedSql.query(TABLE_RLS_SQL, [tableName]);
    auditStage = "policy_catalog";
    const policyRows = await privilegedSql.query(POLICY_SQL, [tableName]);
    auditStage = "privilege_catalog";
    const privilegeRows = await privilegedSql.query(PRIVILEGE_SQL, [
      TENANT_DATABASE_ROLE_NAME,
      `public.${tableName}`,
    ]);
    auditStage = "owner_catalog";
    const ownerRows = await privilegedSql.query(ownerCountsSql(tableName));
    const totalRows = await privilegedSql.query(totalCountsSql(tableName));

    const table = singleRow(tableRows, code(tableName, "table_catalog_invalid"));
    const policy = singleRow(
      policyRows,
      code(tableName, "policy_catalog_invalid"),
    );
    const privileges = singleRow(
      privilegeRows,
      code(tableName, "privilege_catalog_invalid"),
    );
    const owners = ownerRows.map((row) =>
      record(row, code(tableName, "owner_catalog_invalid")),
    );
    const totals = singleRow(
      totalRows,
      code(tableName, "total_catalog_invalid"),
    );
    if (owners.length === 0) fail(code(tableName, "owner_catalog_empty"));

    const selectedOwner = owners[0];
    const ownerUserId = requiredString(
      selectedOwner.owner_user_id,
      code(tableName, "owner_catalog_invalid"),
    );
    const expectedOwnerRows = integerValue(
      selectedOwner.row_count,
      code(tableName, "owner_catalog_invalid"),
    );
    const ownedRows = owners.reduce(
      (sum, owner) =>
        sum +
        integerValue(
          owner.row_count,
          code(tableName, "owner_catalog_invalid"),
        ),
      0,
    );
    const catalogRows = integerValue(
      totals.total_count,
      code(tableName, "total_catalog_invalid"),
    );
    const unownedRows = integerValue(
      totals.unowned_count,
      code(tableName, "total_catalog_invalid"),
    );

    if (unownedRows !== 0 || ownedRows !== catalogRows) {
      fail(code(tableName, "unowned_rows_present"));
    }
    assertCatalog({
      policy,
      policyName,
      privileges,
      table,
      tableName,
    });

    auditStage = "runtime_import";
    const { getTenantSqlClient } = await import(
      "../../src/db/tenant-client.ts"
    );
    const { runTenantReadTransaction } = await import(
      "../../src/db/tenant-transaction-context.ts"
    );
    const tenantSqlClient = getTenantSqlClient();
    const visibleCountSql = visibleCountSqlFor(tableName);
    const contextCountSql = contextCountSqlFor(tableName);

    auditStage = "no_context_before";
    const beforeRows = await tenantSqlClient.query(visibleCountSql);
    auditStage = "matching_context";
    const [matchingRows] = await runTenantReadTransaction(
      ownerUserId,
      (transaction) => [transaction.query(contextCountSql)],
    );
    auditStage = "foreign_context";
    const [foreignRows] = await runTenantReadTransaction(
      randomUUID(),
      (transaction) => [transaction.query(visibleCountSql)],
    );
    auditStage = "no_context_after";
    const afterRows = await tenantSqlClient.query(visibleCountSql);

    const beforeCount = readCount(
      beforeRows,
      "visible_count",
      code(tableName, "count_invalid"),
    );
    const matching = singleRow(
      matchingRows,
      code(tableName, "matching_read_invalid"),
    );
    const matchingCount = integerValue(
      matching.visible_count,
      code(tableName, "matching_read_invalid"),
    );
    const mismatchCount = integerValue(
      matching.mismatch_count,
      code(tableName, "matching_read_invalid"),
    );
    const foreignCount = readCount(
      foreignRows,
      "visible_count",
      code(tableName, "count_invalid"),
    );
    const afterCount = readCount(
      afterRows,
      "visible_count",
      code(tableName, "count_invalid"),
    );

    if (beforeCount !== 0 || afterCount !== 0) {
      fail(code(tableName, "context_leaked_outside_transaction"));
    }
    if (matchingCount !== expectedOwnerRows || mismatchCount !== 0) {
      fail(code(tableName, "owner_scope_mismatch"));
    }
    if (foreignCount !== 0) fail(code(tableName, "foreign_scope_visible"));

    auditStage = "complete";
    console.log(
      JSON.stringify(
        {
          operation: auditConfig.operation,
          status: auditConfig.successStatus,
          credentialBoundaryStatus: boundary.status,
          table: tableName,
          rlsEnabled: true,
          rlsForced: false,
          policyCount: 1,
          tenantPrivileges: ["SELECT"],
          ownerGroups: owners.length,
          ownerScopedRows: ownedRows,
          unownedRows,
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
  } catch (error) {
    const errorCode =
      error instanceof Error
        ? /^Tenant table RLS audit blocked: ([a-z0-9_]+)$/.exec(
            error.message,
          )?.[1]
        : null;
    console.error(
      JSON.stringify({
        operation: auditConfig.operation,
        status: "blocked",
        blockers: [errorCode ?? code(tableName, `${auditStage}_failed`)],
        errorKind: safeErrorKind(error),
        databaseSideEffects: false,
      }),
    );
    process.exitCode = 1;
  }
}

function assertCatalog({
  policy,
  policyName,
  privileges,
  table,
  tableName,
}: {
  policy: Record<string, unknown>;
  policyName: string;
  privileges: Record<string, unknown>;
  table: Record<string, unknown>;
  tableName: string;
}) {
  if (table.rls_enabled !== true || table.rls_forced !== false) {
    fail(code(tableName, "rls_catalog_mismatch"));
  }
  if (
    policy.policy_name !== policyName ||
    policy.permissive !== "PERMISSIVE" ||
    policy.command !== "SELECT" ||
    policy.with_check !== null ||
    !policyTargetsTenantRole(policy.roles) ||
    !requiredString(
      policy.qualifier,
      code(tableName, "policy_catalog_invalid"),
    ).includes(TENANT_CONTEXT_SETTING_NAME)
  ) {
    fail(code(tableName, "policy_catalog_mismatch"));
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
    fail(code(tableName, "privilege_catalog_mismatch"));
  }
}

function policyTargetsTenantRole(value: unknown) {
  if (Array.isArray(value)) {
    return value.length === 1 && value[0] === TENANT_DATABASE_ROLE_NAME;
  }
  return value === `{${TENANT_DATABASE_ROLE_NAME}}`;
}

function readCount(rows: unknown, key: string, errorCode: string) {
  return integerValue(singleRow(rows, errorCode)[key], errorCode);
}

function singleRow(rows: unknown, errorCode: string) {
  if (!Array.isArray(rows) || rows.length !== 1) fail(errorCode);
  return record(rows[0], errorCode);
}

function record(value: unknown, errorCode: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(errorCode);
  }
  return value as Record<string, unknown>;
}

function integerValue(value: unknown, errorCode: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(errorCode);
  return parsed;
}

function requiredString(value: unknown, errorCode: string) {
  if (typeof value !== "string" || value.length === 0) fail(errorCode);
  return value;
}

function requiredEnvironmentValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) fail("database_not_configured");
  return value;
}

function safeIdentifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) fail("invalid_identifier");
  return value;
}

function code(tableName: string, suffix: string) {
  return `${tableName}_${suffix}`;
}

function fail(errorCode: string): never {
  throw new Error(`Tenant table RLS audit blocked: ${errorCode}`);
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

function ownerCountsSql(tableName: string) {
  return `
    select
      canonical_owner_user_id::text as owner_user_id,
      count(*)::int as row_count
    from public.${tableName}
    where canonical_owner_user_id is not null
    group by canonical_owner_user_id
    order by canonical_owner_user_id
  `;
}

function totalCountsSql(tableName: string) {
  return `
    select
      count(*)::int as total_count,
      count(*) filter (where canonical_owner_user_id is null)::int as unowned_count
    from public.${tableName}
  `;
}

function visibleCountSqlFor(tableName: string) {
  return `select count(*)::int as visible_count from public.${tableName}`;
}

function contextCountSqlFor(tableName: string) {
  return `
    select
      count(*)::int as visible_count,
      count(*) filter (
        where canonical_owner_user_id is distinct from
          nullif(current_setting('${TENANT_CONTEXT_SETTING_NAME}', true), '')::uuid
      )::int as mismatch_count
    from public.${tableName}
  `;
}

const TABLE_RLS_SQL = `
  select
    class.relrowsecurity as rls_enabled,
    class.relforcerowsecurity as rls_forced
  from pg_class as class
  join pg_namespace as namespace on namespace.oid = class.relnamespace
  where namespace.nspname = 'public'
    and class.relname = $1
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
    and tablename = $1
`;

const PRIVILEGE_SQL = `
  select
    has_table_privilege($1, $2, 'SELECT') as can_select,
    has_table_privilege($1, $2, 'INSERT') as can_insert,
    has_table_privilege($1, $2, 'UPDATE') as can_update,
    has_table_privilege($1, $2, 'DELETE') as can_delete,
    has_table_privilege($1, $2, 'TRUN' || 'CATE') as can_truncate,
    has_table_privilege($1, $2, 'REFERENCES') as can_references,
    has_table_privilege($1, $2, 'TRIGGER') as can_trigger
`;
