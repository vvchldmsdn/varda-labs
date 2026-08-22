import "server-only";

import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type AnyColumn,
  type GetColumnData,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshotInstrumentCondition } from "@/db/queries/asset-price-snapshot-scope";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import { loadActiveTenantLegacyAssetGroups } from "@/db/queries/tenant-group-reads";
import { loadLatestTenantPortfolioSettingsRows } from "@/db/queries/tenant-settings";
import {
  accounts,
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
  livePriceQuotes,
} from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { normalizeTicker, uniqueStrings } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

const RECENT_PORTFOLIO_DATE_COUNT = 30;
const MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT = 4;

export async function getReadOnlyTenantPortfolioDashboardSources({
  scope,
  snapshotDate,
  tenantContext,
}: {
  scope: PortfolioAnalysisScope;
  snapshotDate: string;
  tenantContext: TenantContext;
}) {
  const targets = await getPortfolioAnalysisScopeTargets({
    scope,
    serviceDate: snapshotDate,
    tenantContext,
  });
  const assetScopePredicate = targets.includesAllOwnedAccounts
    ? undefined
    : combineScopePredicates([
        inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
        inArrayWhenPresent(assets.id, targets.directAssetIds),
      ]);

  const [allAccountRows, assetGroupRows, assetRows, settingsRows, latestFxRows] =
    await Promise.all([
      db
        .select()
        .from(accounts)
        .where(and(...activeOwnedAccountPredicates(tenantContext)))
        .orderBy(accounts.sortOrder, accounts.code),
      loadActiveTenantLegacyAssetGroups(tenantContext),
      assetScopePredicate === null
        ? Promise.resolve([])
        : db
            .select(getTableColumns(assets))
            .from(assets)
            .innerJoin(accounts, eq(assets.accountId, accounts.id))
            .where(
              and(
                ...activeOwnedAccountPredicates(tenantContext),
                eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
                eq(assets.account, accounts.code),
                isNull(assets.archivedAt),
                assetScopePredicate,
              ),
            ),
      loadLatestTenantPortfolioSettingsRows(tenantContext),
      db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
    ]);

  const activeAccountIds = new Set(allAccountRows.map((account) => account.id));
  const wholeAccountIds = targets.includesAllOwnedAccounts
    ? allAccountRows.map((account) => account.id)
    : targets.wholeAccountIds.filter((accountId) =>
        activeAccountIds.has(accountId),
      );
  const directAssetIds = new Set(targets.directAssetIds);
  const directAssetLegacyIds = uniqueStrings(
    assetRows
      .filter((asset) => directAssetIds.has(asset.id))
      .map((asset) => asset.legacyBase44Id)
      .filter((legacyId): legacyId is string => Boolean(legacyId)),
  );
  const visibleAccountIds = new Set([
    ...wholeAccountIds,
    ...assetRows
      .map((asset) => asset.accountId)
      .filter((accountId): accountId is string => Boolean(accountId)),
  ]);
  const accountRows = allAccountRows.filter((account) =>
    visibleAccountIds.has(account.id),
  );

  const positionScopePredicate = combineScopePredicates([
    inArrayWhenPresent(dailyPositionSnapshots.accountId, wholeAccountIds),
    inArrayWhenPresent(dailyPositionSnapshots.assetId, targets.directAssetIds),
  ]);
  const eventScopePredicate = combineScopePredicates([
    inArrayWhenPresent(eventLedgerEntries.accountId, wholeAccountIds),
    inArrayWhenPresent(eventLedgerEntries.assetId, targets.directAssetIds),
    inArrayWhenPresent(eventLedgerEntries.legacyAssetId, directAssetLegacyIds),
  ]);
  const selectedAccountRowLimit =
    RECENT_PORTFOLIO_DATE_COUNT *
    Math.max(wholeAccountIds.length, 1) *
    MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT;

  const [
    latestPositionRows,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
  ] = await Promise.all([
    positionScopePredicate === null
      ? Promise.resolve([])
      : db
          .select(getTableColumns(dailyPositionSnapshots))
          .from(dailyPositionSnapshots)
          .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
          .where(
            and(
              ...activeOwnedAccountPredicates(tenantContext),
              positionScopePredicate,
              eq(dailyPositionSnapshots.account, accounts.code),
              eq(dailyPositionSnapshots.isSample, false),
              eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
            ),
          ),
    wholeAccountIds.length === 0
      ? Promise.resolve([])
      : db
          .select(getTableColumns(dailyPortfolioSnapshots))
          .from(dailyPortfolioSnapshots)
          .innerJoin(accounts, eq(dailyPortfolioSnapshots.accountId, accounts.id))
          .where(
            and(
              ...activeOwnedAccountPredicates(tenantContext),
              inArray(accounts.id, wholeAccountIds),
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
    eventScopePredicate === null
      ? Promise.resolve([])
      : db
          .select(getTableColumns(eventLedgerEntries))
          .from(eventLedgerEntries)
          .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
          .where(
            and(
              ...activeOwnedAccountPredicates(tenantContext),
              eventScopePredicate,
              eq(eventLedgerEntries.account, accounts.code),
              eq(eventLedgerEntries.isSample, false),
              lte(eventLedgerEntries.eventDate, snapshotDate),
            ),
          ),
    positionScopePredicate === null
      ? Promise.resolve([{ count: 0 }])
      : db
          .select({
            count: sql<number>`count(*) filter (where ${dailyPositionSnapshots.assetId} is null)::int`,
          })
          .from(dailyPositionSnapshots)
          .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
          .where(
            and(
              ...activeOwnedAccountPredicates(tenantContext),
              positionScopePredicate,
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
  const selectedPriceInstruments = assetRows.map(
    ({ market, currency, ticker }) => ({ market, currency, ticker }),
  );

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
          .where(assetPriceSnapshotInstrumentCondition(selectedPriceInstruments))
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
  ];
}

function inArrayWhenPresent<TColumn extends AnyColumn>(
  column: TColumn,
  values: ReadonlyArray<GetColumnData<TColumn, "raw">>,
): SQL | null {
  if (values.length === 0) return null;
  return inArray(column, values);
}

function combineScopePredicates(predicates: readonly (SQL | null)[]) {
  const present = predicates.filter((predicate): predicate is SQL => predicate !== null);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return or(...present) ?? null;
}
