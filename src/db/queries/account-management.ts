import "server-only";

import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assets,
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
} from "@/db/schema";
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
    const [accountRows, holdingRows, accountMembershipRows, assetMembershipRows] =
      await Promise.all([
        db
          .select({
            id: accounts.id,
            code: accounts.code,
            name: accounts.name,
            accountType: accounts.accountType,
            currency: accounts.currency,
            isActive: accounts.isActive,
            sortOrder: accounts.sortOrder,
            updatedAt: accounts.updatedAt,
          })
          .from(accounts)
          .where(eq(accounts.canonicalOwnerUserId, ownerUserId))
          .orderBy(
            desc(accounts.isActive),
            asc(accounts.sortOrder),
            asc(accounts.name),
          ),
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
            updatedAt: row.updatedAt.toISOString(),
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

function countByAccount(rows: readonly { accountId: string | null }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.accountId === null) continue;
    counts.set(row.accountId, (counts.get(row.accountId) ?? 0) + 1);
  }
  return counts;
}
