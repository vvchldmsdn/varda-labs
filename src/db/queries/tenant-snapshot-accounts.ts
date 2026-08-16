import "server-only";

import { and, asc, eq, gt, inArray, ne, or } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, assets } from "@/db/schema";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { SNAPSHOT_INVESTMENT_ASSET_TYPES } from "@/lib/snapshots/investment-eligibility";

export type TenantSnapshotAccountRow = Readonly<{
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
}>;

export async function loadOwnedActiveSnapshotAccounts(
  tenantContext: TenantContext,
): Promise<TenantSnapshotAccountRow[]> {
  return db
    .selectDistinct({
      accountId: accounts.id,
      accountCode: accounts.code,
      accountName: accounts.name,
      accountSortOrder: accounts.sortOrder,
    })
    .from(accounts)
    .innerJoin(
      assets,
      and(
        eq(assets.accountId, accounts.id),
        eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
        inArray(assets.assetType, SNAPSHOT_INVESTMENT_ASSET_TYPES),
        or(gt(assets.quantity, "0"), gt(assets.fractionalKrwValue, "0")),
      ),
    )
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
        eq(accounts.isActive, true),
        ne(accounts.accountType, "cash"),
      ),
    )
    .orderBy(
      asc(accounts.sortOrder),
      asc(accounts.name),
      asc(accounts.code),
    );
}
