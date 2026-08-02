import "server-only";

import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshotInstrumentCondition } from "@/db/queries/asset-price-snapshot-scope";
import {
  accounts,
  assetGroups,
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
  livePriceQuotes,
  settings,
} from "@/db/schema";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";
import { normalizeTicker, uniqueStrings } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

const RECENT_PORTFOLIO_DATE_COUNT = 30;
const MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT = 4;

export async function getReadOnlyTenantPortfolioDashboardSources({
  tenantContext,
  selectedAccount,
  snapshotDate,
}: {
  tenantContext: TenantContext;
  selectedAccount: PortfolioAccountScope;
  snapshotDate: string;
}) {
  const selectedAccountPredicate =
    selectedAccount === "all" ? undefined : eq(accounts.code, selectedAccount);
  const selectedAccountRowLimit =
    RECENT_PORTFOLIO_DATE_COUNT *
    (selectedAccount === "all" ? NAMED_PORTFOLIO_ACCOUNTS.length : 1) *
    MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT;

  const [
    accountRows,
    assetGroupRows,
    assetRows,
    settingsRows,
    latestFxRows,
    latestPositionRows,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
  ] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(and(...activeOwnedAccountPredicates(tenantContext)))
      .orderBy(accounts.sortOrder, accounts.code),
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
      .from(settings)
      .where(
        and(
          eq(settings.canonicalOwnerUserId, tenantContext.ownerUserId),
          eq(settings.isSample, false),
        ),
      )
      .orderBy(desc(settings.createdAt))
      .limit(1),
    db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
    db
      .select(getTableColumns(dailyPositionSnapshots))
      .from(dailyPositionSnapshots)
      .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          selectedAccountPredicate,
          eq(dailyPositionSnapshots.account, accounts.code),
          eq(dailyPositionSnapshots.isSample, false),
          eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
        ),
      ),
    db
      .select(getTableColumns(dailyPortfolioSnapshots))
      .from(dailyPortfolioSnapshots)
      .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          selectedAccountPredicate,
          eq(dailyPortfolioSnapshots.account, accounts.code),
          eq(dailyPortfolioSnapshots.isSample, false),
        ),
      )
      .orderBy(
        desc(dailyPortfolioSnapshots.snapshotDate),
        sql`${dailyPortfolioSnapshots.capturedAt} desc nulls last`,
        desc(dailyPortfolioSnapshots.createdAt),
      )
      .limit(selectedAccountRowLimit),
    db
      .select(getTableColumns(eventLedgerEntries))
      .from(eventLedgerEntries)
      .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          eq(eventLedgerEntries.account, accounts.code),
          eq(eventLedgerEntries.isSample, false),
        ),
      ),
    db
      .select({
        count: sql<number>`count(*) filter (where ${dailyPositionSnapshots.assetId} is null)::int`,
      })
      .from(dailyPositionSnapshots)
      .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
      .where(
        and(
          ...activeOwnedAccountPredicates(tenantContext),
          selectedAccountPredicate,
          eq(dailyPositionSnapshots.account, accounts.code),
          eq(dailyPositionSnapshots.isSample, false),
        ),
      ),
  ]);

  const quoteTickers = uniqueStrings(
    assetRows
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const selectedPriceInstruments = assetRows
    .filter(
      (asset) =>
        selectedAccount === "all" || asset.account === selectedAccount,
    )
    .map(({ market, currency, ticker }) => ({ market, currency, ticker }));

  const [liveQuoteRows, recentPriceRows] = await Promise.all([
    quoteTickers.length > 0
      ? db
          .select()
          .from(livePriceQuotes)
          .where(inArray(livePriceQuotes.ticker, quoteTickers))
          .orderBy(desc(livePriceQuotes.fetchedAt))
          .limit(Math.max(100, quoteTickers.length * 4))
      : Promise.resolve([]),
    selectedPriceInstruments.length > 0
      ? db
          .select()
          .from(assetPriceSnapshots)
          .where(
            assetPriceSnapshotInstrumentCondition(selectedPriceInstruments),
          )
          .orderBy(desc(assetPriceSnapshots.priceDate))
          .limit(Math.max(200, selectedPriceInstruments.length * 20))
      : Promise.resolve([]),
  ]);

  return {
    accountRows,
    assetGroupRows,
    assetRows,
    settingsRows,
    latestFxRows,
    latestPositionRows,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
    liveQuoteRows,
    recentPriceRows,
  };
}

function activeOwnedAccountPredicates(tenantContext: TenantContext) {
  return [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
    inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS),
  ];
}
