import "server-only";

import { desc, inArray } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import {
  assetGroupMembers,
  assetGroups,
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
import { normalizeTicker, toNumber, uniqueStrings } from "@/lib/portfolio-math";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);

export type ReadOnlyPortfolioStructureOptions = {
  account?: string | string[] | null;
};

export const getReadOnlyAllPortfolioStructure = cache(
  loadReadOnlyAllPortfolioStructure,
);

export async function getReadOnlyPortfolioStructure({
  account,
}: ReadOnlyPortfolioStructureOptions = {}): Promise<PortfolioStructureResult> {
  const selectedAccount = normalizePortfolioStructureAccount(account);
  const [assetRows, groupRows, memberRows, latestFxRows, settingsRows] =
    await Promise.all([
      db.select().from(assets),
      db.select().from(assetGroups),
      db.select().from(assetGroupMembers),
      db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
      db.select().from(settings).orderBy(desc(settings.createdAt)).limit(1),
    ]);
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

export function normalizePortfolioStructureAccount(
  account: string | string[] | null | undefined,
): PortfolioStructureAccount {
  const rawAccount = Array.isArray(account) ? account[0] : account;
  return normalizeStructureAccount(rawAccount);
}

function loadReadOnlyAllPortfolioStructure() {
  return getReadOnlyPortfolioStructure({ account: "all" });
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
