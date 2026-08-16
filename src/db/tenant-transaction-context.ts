import "server-only";

import type {
  NeonQueryFunctionInTransaction,
  NeonQueryInTransaction,
} from "@neondatabase/serverless";

import {
  assessTenantTransactionContext,
  normalizeTenantContextOwnerUserId,
  TENANT_TRANSACTION_CONTEXT_POLICY,
  TenantTransactionContextError,
  type TenantTransactionContextAssessment,
} from "@/lib/deployment/tenant-transaction-context";

import { getTenantSqlClient } from "./tenant-client";

type TransactionSql = NeonQueryFunctionInTransaction<false, false>;
type TenantReadQueryFactory = (
  transaction: TransactionSql,
) => NeonQueryInTransaction[];
type QueryRows = readonly Record<string, unknown>[];

const READ_CONTEXT_SQL = `
  select current_setting($1, true) as tenant_context_value
`;
const CONFIGURE_CONTEXT_SQL = `
  select set_config($1, $2, true) as tenant_context_value
`;

export async function runTenantReadTransaction(
  ownerUserId: string,
  buildQueries: TenantReadQueryFactory,
): Promise<readonly QueryRows[]> {
  const execution = await executeTenantReadTransaction(
    ownerUserId,
    buildQueries,
  );
  if (execution.attestation.status !== "transaction_context_passed") {
    throw new TenantTransactionContextError("context_attestation_failed");
  }
  return execution.queryResults;
}

export async function auditTenantTransactionContextIsolation(): Promise<
  TenantTransactionContextAssessment
> {
  const ownerUserId = crypto.randomUUID();
  const beforeTransaction = await readStandaloneContext();
  const execution = await executeTenantReadTransaction(
    ownerUserId,
    (transaction) => [transaction.query(READ_CONTEXT_SQL, [settingName()])],
  );
  const insideTransaction = readSingleContextValue(
    execution.queryResults[0],
  );
  const tenantSqlClient = getTenantSqlClient();
  const [nextTransactionRows] = await tenantSqlClient.transaction(
    (transaction) => [
      transaction.query(READ_CONTEXT_SQL, [settingName()]),
    ],
    transactionOptions(),
  );
  const nextTransaction = readSingleContextValue(nextTransactionRows);
  const afterTransaction = await readStandaloneContext();

  return assessTenantTransactionContext({
    expectedOwnerUserId: ownerUserId,
    beforeTransaction,
    configuredValue: execution.configuredValue,
    insideTransaction,
    nextTransaction,
    afterTransaction,
  });
}

async function executeTenantReadTransaction(
  ownerUserId: string,
  buildQueries: TenantReadQueryFactory,
) {
  const canonicalOwnerUserId = normalizeTenantContextOwnerUserId(ownerUserId);
  const tenantSqlClient = getTenantSqlClient();
  let requestedQueryCount = 0;
  const results = await tenantSqlClient.transaction(
    (transaction) => {
      const requestedQueries = buildQueries(transaction);
      if (!Array.isArray(requestedQueries) || requestedQueries.length === 0) {
        throw new TenantTransactionContextError("invalid_query_batch");
      }
      requestedQueryCount = requestedQueries.length;
      return [
        transaction.query(CONFIGURE_CONTEXT_SQL, [
          settingName(),
          canonicalOwnerUserId,
        ]),
        transaction.query(READ_CONTEXT_SQL, [settingName()]),
        ...requestedQueries,
      ];
    },
    transactionOptions(),
  );

  if (results.length !== requestedQueryCount + 2) {
    throw new TenantTransactionContextError("invalid_transaction_result");
  }
  const configuredValue = readSingleContextValue(results[0]);
  const insideTransaction = readSingleContextValue(results[1]);
  const attestation = assessTenantTransactionContext({
    expectedOwnerUserId: canonicalOwnerUserId,
    beforeTransaction: null,
    configuredValue,
    insideTransaction,
    nextTransaction: null,
    afterTransaction: null,
  });

  return Object.freeze({
    configuredValue,
    attestation,
    queryResults: Object.freeze(results.slice(2) as QueryRows[]),
  });
}

async function readStandaloneContext() {
  const tenantSqlClient = getTenantSqlClient();
  const rows = await tenantSqlClient.query(READ_CONTEXT_SQL, [settingName()]);
  return readSingleContextValue(rows);
}

function readSingleContextValue(rows: unknown): unknown {
  if (!Array.isArray(rows) || rows.length !== 1 || !isRecord(rows[0])) {
    throw new TenantTransactionContextError("invalid_transaction_result");
  }
  return rows[0].tenant_context_value;
}

function settingName() {
  return TENANT_TRANSACTION_CONTEXT_POLICY.settingName;
}

function transactionOptions() {
  return {
    isolationLevel: TENANT_TRANSACTION_CONTEXT_POLICY.isolationLevel,
    readOnly: TENANT_TRANSACTION_CONTEXT_POLICY.readOnly,
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
