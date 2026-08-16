import { TENANT_CONTEXT_SETTING_NAME } from "./tenant-security-constants.ts";

export const TENANT_TRANSACTION_CONTEXT_POLICY = Object.freeze({
  policyId: "tenant_transaction_context_v1",
  settingName: TENANT_CONTEXT_SETTING_NAME,
  isolationLevel: "ReadCommitted",
  readOnly: true,
});

export type TenantTransactionContextBlocker =
  | "context_present_before_transaction"
  | "context_configuration_mismatch"
  | "context_not_visible_inside_transaction"
  | "context_present_in_next_transaction"
  | "context_present_after_transaction";

export type TenantTransactionContextAssessment = Readonly<{
  policyId: typeof TENANT_TRANSACTION_CONTEXT_POLICY.policyId;
  status: "transaction_context_passed" | "blocked";
  configuredValueMatched: boolean;
  insideTransactionMatched: boolean;
  absentBeforeTransaction: boolean;
  absentInNextTransaction: boolean;
  absentAfterTransaction: boolean;
  blockers: readonly TenantTransactionContextBlocker[];
}>;

export class TenantTransactionContextError extends Error {
  readonly code:
    | "invalid_owner_user_id"
    | "invalid_query_batch"
    | "invalid_transaction_result"
    | "context_attestation_failed";

  constructor(code: TenantTransactionContextError["code"]) {
    super(`Tenant transaction context rejected: ${code}`);
    this.name = "TenantTransactionContextError";
    this.code = code;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTenantContextOwnerUserId(value: unknown): string {
  if (typeof value !== "string") {
    throw new TenantTransactionContextError("invalid_owner_user_id");
  }

  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new TenantTransactionContextError("invalid_owner_user_id");
  }

  return normalized;
}

export function assessTenantTransactionContext(input: {
  expectedOwnerUserId: string;
  beforeTransaction: unknown;
  configuredValue: unknown;
  insideTransaction: unknown;
  nextTransaction: unknown;
  afterTransaction: unknown;
}): TenantTransactionContextAssessment {
  const expectedOwnerUserId = normalizeTenantContextOwnerUserId(
    input.expectedOwnerUserId,
  );
  const beforeTransaction = normalizeObservedContext(input.beforeTransaction);
  const configuredValue = normalizeObservedContext(input.configuredValue);
  const insideTransaction = normalizeObservedContext(input.insideTransaction);
  const nextTransaction = normalizeObservedContext(input.nextTransaction);
  const afterTransaction = normalizeObservedContext(input.afterTransaction);

  const absentBeforeTransaction = beforeTransaction === null;
  const configuredValueMatched = configuredValue === expectedOwnerUserId;
  const insideTransactionMatched = insideTransaction === expectedOwnerUserId;
  const absentInNextTransaction = nextTransaction === null;
  const absentAfterTransaction = afterTransaction === null;
  const blockers: TenantTransactionContextBlocker[] = [];

  if (!absentBeforeTransaction) {
    blockers.push("context_present_before_transaction");
  }
  if (!configuredValueMatched) {
    blockers.push("context_configuration_mismatch");
  }
  if (!insideTransactionMatched) {
    blockers.push("context_not_visible_inside_transaction");
  }
  if (!absentInNextTransaction) {
    blockers.push("context_present_in_next_transaction");
  }
  if (!absentAfterTransaction) {
    blockers.push("context_present_after_transaction");
  }

  return Object.freeze({
    policyId: TENANT_TRANSACTION_CONTEXT_POLICY.policyId,
    status: blockers.length === 0 ? "transaction_context_passed" : "blocked",
    configuredValueMatched,
    insideTransactionMatched,
    absentBeforeTransaction,
    absentInNextTransaction,
    absentAfterTransaction,
    blockers: Object.freeze(blockers),
  });
}

function normalizeObservedContext(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TenantTransactionContextError("invalid_transaction_result");
  }

  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if (!UUID_PATTERN.test(normalized)) {
    throw new TenantTransactionContextError("invalid_transaction_result");
  }
  return normalized.toLowerCase();
}
