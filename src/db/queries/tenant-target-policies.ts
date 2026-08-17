import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

const MAX_POLICY_ROWS = 64;
const READ_ROW_LIMIT = MAX_POLICY_ROWS * 2 + 2;

type PolicyReadStatus = "available" | "missing" | "conflict";

export type TenantLegacyTargetPolicyVectorRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  targetWeightBps: number;
}>;

export type TenantLegacyTargetPolicyRead =
  | Readonly<{
      status: "available";
      policy: Readonly<{
        policyId: string;
        policyVersion: string;
        effectiveServiceDate: string;
        universeHash: string;
        vectorHash: string;
        vector: readonly TenantLegacyTargetPolicyVectorRow[];
      }>;
    }>
  | UnavailablePolicyRead;

export type TenantPortfolioTargetPolicyRow = Readonly<{
  accountId: string;
  assetId: string;
  assetName: string;
  market: string;
  currency: string;
  ticker: string | null;
  buyability: string;
  targetWeightBps: number;
}>;

export type TenantPortfolioTargetPolicyRead =
  | Readonly<{
      status: "available";
      policy: Readonly<{
        approvalRevision: number;
        policyVersion: string;
        effectiveServiceDate: string;
        universeHash: string;
        vectorHash: string;
        approvedAt: Date;
        rows: readonly TenantPortfolioTargetPolicyRow[];
      }>;
    }>
  | UnavailablePolicyRead;

type UnavailablePolicyRead = Readonly<{
  status: Exclude<PolicyReadStatus, "available">;
  policy: null;
}>;

export async function loadCurrentTenantLegacyTargetPolicy({
  account,
  policyId,
  tenantContext,
}: {
  account: string;
  policyId: string;
  tenantContext: TenantContext;
}): Promise<TenantLegacyTargetPolicyRead> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(LEGACY_TARGET_POLICY_SQL, [
        account,
        policyId,
        READ_ROW_LIMIT,
      ]),
    ],
  );

  return projectLegacyPolicy(rows);
}

export async function loadCurrentTenantPortfolioTargetPolicy({
  scopeAccountId,
  scopeKind,
  scopePortfolioGroupId,
  tenantContext,
}: {
  scopeAccountId: string | null;
  scopeKind: "all" | "account" | "portfolio_group";
  scopePortfolioGroupId: string | null;
  tenantContext: TenantContext;
}): Promise<TenantPortfolioTargetPolicyRead> {
  const [rows] = await runTenantReadTransaction(
    tenantContext.ownerUserId,
    (transaction) => [
      transaction.query(PORTFOLIO_TARGET_POLICY_SQL, [
        scopeKind,
        scopeAccountId,
        scopePortfolioGroupId,
        READ_ROW_LIMIT,
      ]),
    ],
  );

  return projectPortfolioPolicy(rows);
}

const LEGACY_TARGET_POLICY_SQL = `
  select
    revision.id::text as approval_revision_id,
    revision.policy_id,
    revision.policy_version,
    revision.effective_service_date::text as effective_service_date,
    revision.universe_hash,
    revision.vector_hash,
    vector.market as vector_market,
    vector.currency as vector_currency,
    vector.ticker as vector_ticker,
    vector.target_weight_bps as vector_target_weight_bps
  from public.target_policy_approval_revisions as revision
  inner join public.accounts as account
    on account.id = revision.account_id
  left join public.target_policy_approval_vector_rows as vector
    on vector.approval_revision_id = revision.id
  where account.is_active = true
    and account.code = $1::varchar
    and revision.policy_id = $2::varchar
    and revision.lifecycle_status = 'approved'
  order by
    revision.id,
    vector.market,
    vector.currency,
    vector.ticker
  limit $3::integer
`;

const PORTFOLIO_TARGET_POLICY_SQL = `
  select
    revision.id::text as approval_revision_id,
    revision.approval_revision,
    revision.policy_version,
    revision.effective_service_date::text as effective_service_date,
    revision.universe_hash,
    revision.vector_hash,
    revision.approved_at::text as approved_at,
    policy_row.account_id::text as row_account_id,
    policy_row.asset_id::text as row_asset_id,
    policy_row.asset_name as row_asset_name,
    policy_row.market as row_market,
    policy_row.currency as row_currency,
    policy_row.ticker as row_ticker,
    policy_row.buyability as row_buyability,
    policy_row.target_weight_bps as row_target_weight_bps
  from public.portfolio_target_policy_revisions as revision
  left join public.portfolio_target_policy_rows as policy_row
    on policy_row.approval_revision_id = revision.id
  where revision.scope_kind = $1::varchar
    and revision.scope_account_id is not distinct from $2::uuid
    and revision.scope_portfolio_group_id is not distinct from $3::uuid
    and revision.lifecycle_status = 'approved'
  order by
    revision.id,
    policy_row.account_id,
    policy_row.asset_id
  limit $4::integer
`;

function projectLegacyPolicy(
  rows: readonly Record<string, unknown>[],
): TenantLegacyTargetPolicyRead {
  const revisionId = singleRevisionId(rows);
  if (revisionId === null) return unavailable("missing");
  if (revisionId === "conflict") return unavailable("conflict");

  const first = rows[0];
  const vector = rows.flatMap((row) => {
    if (row.vector_market === null) {
      assertAllNull(row, [
        "vector_currency",
        "vector_ticker",
        "vector_target_weight_bps",
      ]);
      return [];
    }
    return [
      Object.freeze({
        market: requiredString(row.vector_market),
        currency: requiredString(row.vector_currency),
        ticker: requiredString(row.vector_ticker),
        targetWeightBps: requiredInteger(row.vector_target_weight_bps),
      }),
    ];
  });
  if (vector.length > MAX_POLICY_ROWS) return unavailable("conflict");

  return Object.freeze({
    status: "available",
    policy: Object.freeze({
      policyId: requiredString(first.policy_id),
      policyVersion: requiredString(first.policy_version),
      effectiveServiceDate: requiredDate(first.effective_service_date),
      universeHash: requiredString(first.universe_hash),
      vectorHash: requiredString(first.vector_hash),
      vector: Object.freeze(vector),
    }),
  });
}

function projectPortfolioPolicy(
  rows: readonly Record<string, unknown>[],
): TenantPortfolioTargetPolicyRead {
  const revisionId = singleRevisionId(rows);
  if (revisionId === null) return unavailable("missing");
  if (revisionId === "conflict") return unavailable("conflict");

  const first = rows[0];
  const policyRows = rows.flatMap((row) => {
    if (row.row_account_id === null) {
      assertAllNull(row, [
        "row_asset_id",
        "row_asset_name",
        "row_market",
        "row_currency",
        "row_ticker",
        "row_buyability",
        "row_target_weight_bps",
      ]);
      return [];
    }
    return [
      Object.freeze({
        accountId: requiredString(row.row_account_id),
        assetId: requiredString(row.row_asset_id),
        assetName: requiredString(row.row_asset_name),
        market: requiredString(row.row_market),
        currency: requiredString(row.row_currency),
        ticker: nullableString(row.row_ticker),
        buyability: requiredString(row.row_buyability),
        targetWeightBps: requiredInteger(row.row_target_weight_bps),
      }),
    ];
  });
  if (policyRows.length > MAX_POLICY_ROWS) return unavailable("conflict");

  return Object.freeze({
    status: "available",
    policy: Object.freeze({
      approvalRevision: requiredInteger(first.approval_revision),
      policyVersion: requiredString(first.policy_version),
      effectiveServiceDate: requiredDate(first.effective_service_date),
      universeHash: requiredString(first.universe_hash),
      vectorHash: requiredString(first.vector_hash),
      approvedAt: requiredTimestamp(first.approved_at),
      rows: Object.freeze(policyRows),
    }),
  });
}

function singleRevisionId(rows: readonly Record<string, unknown>[]) {
  if (rows.length === 0) return null;
  const revisionIds = new Set(
    rows.map((row) => requiredString(row.approval_revision_id)),
  );
  return revisionIds.size === 1 ? [...revisionIds][0] : "conflict";
}

function unavailable(status: "missing" | "conflict") {
  return Object.freeze({ status, policy: null });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant target policy row is invalid");
  }
  return value;
}

function nullableString(value: unknown) {
  return value === null ? null : requiredString(value);
}

function requiredInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Tenant target policy row is invalid");
  }
  return parsed;
}

function requiredDate(value: unknown) {
  const date = requiredString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Tenant target policy row is invalid");
  }
  return date;
}

function requiredTimestamp(value: unknown) {
  const timestamp = new Date(requiredString(value));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Tenant target policy row is invalid");
  }
  return timestamp;
}

function assertAllNull(
  row: Readonly<Record<string, unknown>>,
  keys: readonly string[],
) {
  if (keys.some((key) => row[key] !== null)) {
    throw new Error("Tenant target policy row is invalid");
  }
}
