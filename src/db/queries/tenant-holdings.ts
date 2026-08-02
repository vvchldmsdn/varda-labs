import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, assets } from "@/db/schema";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import {
  projectTenantHoldingRows,
  type TenantHoldingReadResult,
} from "@/lib/tenant-holding-read-model";
import type { TenantContext } from "@/lib/session-resolver-contract";

export type TenantHoldingQueryResult =
  | TenantHoldingReadResult
  | Readonly<{ state: "unavailable" }>;

export async function getReadOnlyTenantHoldings({
  tenantContext,
  scope,
}: {
  tenantContext: TenantContext;
  scope: PortfolioAccountScope;
}): Promise<TenantHoldingQueryResult> {
  try {
    const predicates = [
      eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
      eq(accounts.isActive, true),
      inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
      eq(assets.account, accounts.code),
    ];
    if (scope !== "all") predicates.push(eq(accounts.code, scope));

    const rows = await db
      .select({
        assetId: assets.id,
        assetAccountId: assets.accountId,
        ownedAccountId: accounts.id,
        accountCode: accounts.code,
        accountName: accounts.name,
        accountSortOrder: accounts.sortOrder,
        legacyAccountCode: assets.account,
        name: assets.name,
        ticker: assets.ticker,
        assetType: assets.assetType,
        market: assets.market,
        currency: assets.currency,
        quantity: assets.quantity,
        currentPrice: assets.currentPrice,
        priceSource: assets.priceSource,
        priceAsOf: assets.priceAsOf,
        priceStatus: assets.priceStatus,
      })
      .from(assets)
      .innerJoin(accounts, eq(assets.accountId, accounts.id))
      .where(and(...predicates))
      .orderBy(
        asc(accounts.sortOrder),
        asc(accounts.code),
        asc(assets.name),
        asc(assets.ticker),
      );

    return projectTenantHoldingRows(rows, scope);
  } catch {
    return Object.freeze({ state: "unavailable" });
  }
}
