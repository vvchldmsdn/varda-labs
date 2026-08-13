import "server-only";

import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  assets,
  portfolioGroupAccountMemberships,
  portfolioGroupAssetMemberships,
  portfolioGroups,
} from "@/db/schema";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type PortfolioGroupManagementModel = Readonly<{
  state: "ready";
  serviceDate: string;
  accounts: readonly Readonly<{
    id: string;
    code: string;
    name: string;
  }>[];
  assets: readonly Readonly<{
    id: string;
    accountId: string;
    accountName: string;
    name: string;
    ticker: string | null;
  }>[];
  groups: readonly Readonly<{
    id: string;
    name: string;
    description: string | null;
    updatedAt: string;
    accountIds: readonly string[];
    assetIds: readonly string[];
  }>[];
}>;

export type PortfolioGroupManagementModelResult =
  | PortfolioGroupManagementModel
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantPortfolioGroupManagementModel({
  serviceDate,
  tenantContext,
}: {
  serviceDate: string;
  tenantContext: TenantContext;
}): Promise<PortfolioGroupManagementModelResult> {
  const ownerUserId = tenantContext.ownerUserId;
  const currentAccountMembership = and(
    eq(portfolioGroupAccountMemberships.canonicalOwnerUserId, ownerUserId),
    lte(portfolioGroupAccountMemberships.validFrom, serviceDate),
    or(
      isNull(portfolioGroupAccountMemberships.validTo),
      gt(portfolioGroupAccountMemberships.validTo, serviceDate),
    ),
  );
  const currentAssetMembership = and(
    eq(portfolioGroupAssetMemberships.canonicalOwnerUserId, ownerUserId),
    lte(portfolioGroupAssetMemberships.validFrom, serviceDate),
    or(
      isNull(portfolioGroupAssetMemberships.validTo),
      gt(portfolioGroupAssetMemberships.validTo, serviceDate),
    ),
  );

  try {
    const [groupRows, accountRows, assetRows, groupAccountRows, groupAssetRows] =
      await Promise.all([
        db
          .select({
            id: portfolioGroups.id,
            name: portfolioGroups.name,
            description: portfolioGroups.description,
            updatedAt: portfolioGroups.updatedAt,
          })
          .from(portfolioGroups)
          .where(
            and(
              eq(portfolioGroups.canonicalOwnerUserId, ownerUserId),
              isNull(portfolioGroups.archivedAt),
            ),
          )
          .orderBy(asc(portfolioGroups.sortOrder), asc(portfolioGroups.name)),
        db
          .select({
            id: accounts.id,
            code: accounts.code,
            name: accounts.name,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.canonicalOwnerUserId, ownerUserId),
              eq(accounts.isActive, true),
            ),
          )
          .orderBy(asc(accounts.sortOrder), asc(accounts.name), asc(accounts.code)),
        db
          .select({
            id: assets.id,
            accountId: accounts.id,
            accountName: accounts.name,
            name: assets.name,
            ticker: assets.ticker,
          })
          .from(assets)
          .innerJoin(accounts, eq(assets.accountId, accounts.id))
          .where(
            and(
              eq(assets.canonicalOwnerUserId, ownerUserId),
              eq(accounts.canonicalOwnerUserId, ownerUserId),
              eq(accounts.isActive, true),
              eq(assets.account, accounts.code),
              sql`${assets.quantity} > 0`,
            ),
          )
          .orderBy(
            asc(accounts.sortOrder),
            asc(accounts.name),
            asc(assets.name),
            asc(assets.ticker),
          ),
        db
          .select({
            groupId: portfolioGroupAccountMemberships.portfolioGroupId,
            accountId: portfolioGroupAccountMemberships.accountId,
          })
          .from(portfolioGroupAccountMemberships)
          .where(currentAccountMembership),
        db
          .select({
            groupId: portfolioGroupAssetMemberships.portfolioGroupId,
            assetId: portfolioGroupAssetMemberships.assetId,
          })
          .from(portfolioGroupAssetMemberships)
          .where(currentAssetMembership),
      ]);

    const accountIdsByGroup = collectMemberships(
      groupAccountRows,
      (row) => row.accountId,
    );
    const assetIdsByGroup = collectMemberships(
      groupAssetRows,
      (row) => row.assetId,
    );

    return Object.freeze({
      state: "ready",
      serviceDate,
      accounts: Object.freeze(accountRows.map((row) => Object.freeze(row))),
      assets: Object.freeze(assetRows.map((row) => Object.freeze(row))),
      groups: Object.freeze(
        groupRows.map((row) =>
          Object.freeze({
            id: row.id,
            name: row.name,
            description: row.description,
            updatedAt: row.updatedAt.toISOString(),
            accountIds: Object.freeze(accountIdsByGroup.get(row.id) ?? []),
            assetIds: Object.freeze(assetIdsByGroup.get(row.id) ?? []),
          }),
        ),
      ),
    });
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}

function collectMemberships<T extends { groupId: string }>(
  rows: readonly T[],
  selectId: (row: T) => string,
) {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const values = result.get(row.groupId) ?? [];
    values.push(selectId(row));
    result.set(row.groupId, values);
  }
  for (const values of result.values()) values.sort();
  return result;
}
