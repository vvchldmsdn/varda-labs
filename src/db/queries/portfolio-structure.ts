import "server-only";

import { and, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import {
  assetGroupMembers,
  assetGroups,
  accounts,
  assets,
  fxRates,
  livePriceQuotes,
  settings,
} from "@/db/schema";
import {
  buildPortfolioStructure,
  normalizeStructureAccount,
  type PortfolioStructureAccount,
  type PortfolioStructureResult,
} from "@/lib/portfolio-structure";
import { NAMED_PORTFOLIO_ACCOUNTS } from "@/lib/portfolio-account-scope";
import { normalizeTicker, toNumber, uniqueStrings } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);

export type ReadOnlyTenantPortfolioStructureOptions = {
  account?: string | string[] | null;
  tenantContext: TenantContext;
};

export async function getReadOnlyTenantPortfolioStructure({
  account,
  tenantContext,
}: ReadOnlyTenantPortfolioStructureOptions): Promise<PortfolioStructureResult> {
  const selectedAccount = normalizePortfolioStructureAccount(account);
  return loadReadOnlyTenantPortfolioStructure(
    tenantContext,
    selectedAccount,
  );
}

const loadReadOnlyTenantPortfolioStructure = cache(
  loadTenantPortfolioStructure,
);

async function loadTenantPortfolioStructure(
  tenantContext: TenantContext,
  selectedAccount: PortfolioStructureAccount,
): Promise<PortfolioStructureResult> {
  const [assetRows, groupRows, memberRows, latestFxRows, settingsRows] =
    await Promise.all([
      db
        .select(getTableColumns(assets))
        .from(assets)
        .innerJoin(accounts, eq(assets.accountId, accounts.id))
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            eq(assets.account, accounts.code),
          ),
        ),
      db
        .select()
        .from(assetGroups)
        .where(
          and(
            eq(assetGroups.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(assetGroups.isActive, true),
          ),
        ),
      db
        .select(getTableColumns(assetGroupMembers))
        .from(assetGroupMembers)
        .innerJoin(assetGroups, eq(assetGroupMembers.groupId, assetGroups.id))
        .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
        .innerJoin(accounts, eq(assets.accountId, accounts.id))
        .where(
          and(
            ...activeOwnedAccountPredicates(tenantContext),
            eq(assets.account, accounts.code),
            eq(assetGroupMembers.groupId, assets.groupId),
            eq(
              assetGroupMembers.canonicalOwnerUserId,
              tenantContext.ownerUserId,
            ),
            eq(assetGroupMembers.isActive, true),
            eq(assetGroups.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(assetGroups.isActive, true),
          ),
        ),
      db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
      db
        .select()
        .from(settings)
        .where(
          and(
            eq(settings.canonicalOwnerUserId, tenantContext.ownerUserId),
            eq(settings.isSample, false),
          ),
        )
        .orderBy(desc(settings.createdAt))
        .limit(1),
    ]);

  return buildStructureFromRows({
    assetRows,
    groupRows,
    memberRows,
    latestFxRows,
    settingsRows,
    selectedAccount,
  });
}

export function normalizePortfolioStructureAccount(
  account: string | string[] | null | undefined,
): PortfolioStructureAccount {
  const rawAccount = Array.isArray(account) ? account[0] : account;
  return normalizeStructureAccount(rawAccount);
}

async function buildStructureFromRows({
  assetRows,
  groupRows,
  memberRows,
  latestFxRows,
  settingsRows,
  selectedAccount,
}: {
  assetRows: (typeof assets.$inferSelect)[];
  groupRows: (typeof assetGroups.$inferSelect)[];
  memberRows: (typeof assetGroupMembers.$inferSelect)[];
  latestFxRows: (typeof fxRates.$inferSelect)[];
  settingsRows: (typeof settings.$inferSelect)[];
  selectedAccount: PortfolioStructureAccount;
}) {
  const structureAssetRows = assetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const quoteRows = await loadLiveQuoteRows(structureAssetRows);
  const usdKrwRate =
    toNumber(latestFxRows[0]?.usdKrw) ??
    toNumber(settingsRows[0]?.usdKrwRate) ??
    null;

  return buildPortfolioStructure({
    assets: structureAssetRows,
    groups: groupRows,
    groupMembers: memberRows,
    liveQuotes: quoteRows,
    usdKrwRate,
    selectedAccount,
  });
}

async function loadLiveQuoteRows(
  assetRows: (typeof assets.$inferSelect)[],
): Promise<(typeof livePriceQuotes.$inferSelect)[]> {
  const tickers = uniqueStrings(
    assetRows
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );

  if (tickers.length === 0) return [];

  return db
    .select()
    .from(livePriceQuotes)
    .where(inArray(livePriceQuotes.ticker, tickers))
    .orderBy(
      desc(livePriceQuotes.fetchedAt),
      desc(livePriceQuotes.priceAsOf),
      desc(livePriceQuotes.updatedAt),
    )
    .limit(Math.max(100, tickers.length * 4));
}

function activeOwnedAccountPredicates(tenantContext: TenantContext) {
  return [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
  ];
}
