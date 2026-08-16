import "server-only";

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  assets,
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
} from "@/db/schema";
import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type AccountManagementModel = Readonly<{
  state: "ready";
  accounts: readonly Readonly<{
    id: string;
    code: string;
    name: string;
    accountType: string;
    currency: string;
    isActive: boolean;
    updatedAt: string;
    activeHoldingCount: number;
    openGroupReferenceCount: number;
  }>[];
}>;

export type AccountManagementModelResult =
  | AccountManagementModel
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantAccountManagementModel({
  serviceDate,
  tenantContext,
}: {
  serviceDate: string;
  tenantContext: TenantContext;
}): Promise<AccountManagementModelResult> {
  const ownerUserId = tenantContext.ownerUserId;
  const openPeriod = or(
    isNull(portfolioGroupAccountMemberships.validTo),
    gt(portfolioGroupAccountMemberships.validTo, serviceDate),
  );
  const openAssetPeriod = or(
    isNull(portfolioGroupAssetMemberships.validTo),
    gt(portfolioGroupAssetMemberships.validTo, serviceDate),
  );

  try {
    const [
      accountResultSets,
      holdingRows,
      accountMembershipRows,
      assetMembershipRows,
    ] = await Promise.all([
      runTenantReadTransaction(ownerUserId, (transaction) => [
        transaction.query(ACCOUNT_MANAGEMENT_ACCOUNT_ROWS_SQL),
      ]),
      db
        .select({ accountId: assets.accountId })
        .from(assets)
        .where(
          and(
            eq(assets.canonicalOwnerUserId, ownerUserId),
            sql`${assets.accountId} is not null`,
            sql`${assets.quantity} > 0`,
          ),
        ),
      db
        .select({
          accountId: portfolioGroupAccountMemberships.accountId,
          groupId: portfolioGroupAccountMemberships.portfolioGroupId,
        })
        .from(portfolioGroupAccountMemberships)
        .where(
          and(
            eq(
              portfolioGroupAccountMemberships.canonicalOwnerUserId,
              ownerUserId,
            ),
            openPeriod,
          ),
        ),
      db
        .select({
          accountId: assets.accountId,
          groupId: portfolioGroupAssetMemberships.portfolioGroupId,
        })
        .from(portfolioGroupAssetMemberships)
        .innerJoin(
          assets,
          eq(portfolioGroupAssetMemberships.assetId, assets.id),
        )
        .where(
          and(
            eq(
              portfolioGroupAssetMemberships.canonicalOwnerUserId,
              ownerUserId,
            ),
            eq(assets.canonicalOwnerUserId, ownerUserId),
            sql`${assets.accountId} is not null`,
            openAssetPeriod,
          ),
        ),
    ]);
    const accountRows = accountResultSets[0].map(projectTenantAccountRow);

    const activeHoldingCount = countByAccount(holdingRows);
    const groupReferences = new Map<string, Set<string>>();
    for (const row of [...accountMembershipRows, ...assetMembershipRows]) {
      if (row.accountId === null) continue;
      const groups = groupReferences.get(row.accountId) ?? new Set<string>();
      groups.add(row.groupId);
      groupReferences.set(row.accountId, groups);
    }

    return Object.freeze({
      state: "ready",
      accounts: Object.freeze(
        accountRows.map((row) =>
          Object.freeze({
            id: row.id,
            code: row.code,
            name: row.name,
            accountType: row.accountType,
            currency: row.currency,
            isActive: row.isActive,
            updatedAt: row.updatedAt,
            activeHoldingCount: activeHoldingCount.get(row.id) ?? 0,
            openGroupReferenceCount: groupReferences.get(row.id)?.size ?? 0,
          }),
        ),
      ),
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

const ACCOUNT_MANAGEMENT_ACCOUNT_ROWS_SQL = `
  select
    id::text as id,
    code,
    name,
    account_type,
    currency,
    is_active,
    updated_at::text as updated_at
  from public.accounts
  order by is_active desc, sort_order asc, name asc
`;

function projectTenantAccountRow(row: Record<string, unknown>) {
  return Object.freeze({
    id: requiredString(row.id),
    code: requiredString(row.code),
    name: requiredString(row.name),
    accountType: requiredString(row.account_type),
    currency: requiredString(row.currency),
    isActive: requiredBoolean(row.is_active),
    updatedAt: requiredTimestamp(row.updated_at),
  });
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Tenant account row is invalid");
  }
  return value;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Tenant account row is invalid");
  }
  return value;
}

function requiredTimestamp(value: unknown) {
  const timestamp = requiredString(value);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Tenant account row is invalid");
  }
  return parsed.toISOString();
}

function countByAccount(rows: readonly { accountId: string | null }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.accountId === null) continue;
    counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + 1);
  }
  return counts;
}
