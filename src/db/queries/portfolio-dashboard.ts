import "server-only";

import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
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
import { loadActiveTenantAllocationGroups } from "@/db/queries/tenant-group-reads";
import { loadLatestTenantPortfolioSettingsRows } from "@/db/queries/tenant-settings";
import { loadUsablePortfolioFxRows } from "@/db/queries/portfolio-fx-rates";
import {
  accounts,
  assetPriceSnapshots,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  livePriceQuotes,
} from "@/db/schema";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { selectDashboardHistoryAssetIds, type PortfolioDashboardDemand } from "@/lib/portfolio-dashboard-demand";
import {
  portfolioDashboardBaselineWindowStart,
  selectLatestPortfolioDashboardBaselineRows,
} from "@/lib/portfolio-dashboard-baseline";
import { normalizeTicker, uniqueStrings } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

const RECENT_PORTFOLIO_DATE_COUNT = 190;
const MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT = 4;
const RECENT_POSITION_DATE_COUNT = 45;
const PORTFOLIO_GROUP_POSITION_DATE_COUNT = 130;
const MAX_RECENT_POSITION_SOURCES_PER_ASSET = 3;
const RECENT_FX_OBSERVATION_LIMIT = 260;

export async function getReadOnlyTenantPortfolioDashboardSources({
  demand = { surface: "home" },
  scope,
  serviceDate,
  tenantContext,
}: {
  demand?: PortfolioDashboardDemand;
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  tenantContext: TenantContext;
}) {
  const targets = await getPortfolioAnalysisScopeTargets({
    scope,
    serviceDate,
    tenantContext,
  });
  const assetScopePredicate = targets.includesAllOwnedAccounts
    ? undefined
    : combineScopePredicates([
        inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
        inArrayWhenPresent(assets.id, targets.directAssetIds),
      ]);

  const assetRowsPromise = Promise.resolve(
    assetScopePredicate === null
      ? []
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
  );
  // Attach both dependent branches immediately, including their rejection handlers.
  // Slow history/settings reads must not postpone asset-dependent market reads.
  const [sources, quotes] = await Promise.all([
    loadDashboardContextSources({ assetRowsPromise, demand, scope, serviceDate, targets, tenantContext }),
    assetRowsPromise.then(loadDashboardQuoteRows),
  ]);
  return { ...sources, ...quotes };
}

async function loadDashboardContextSources({
  assetRowsPromise,
  demand,
  scope,
  serviceDate,
  targets,
  tenantContext,
}: {
  assetRowsPromise: Promise<(typeof assets.$inferSelect)[]>;
  demand: PortfolioDashboardDemand;
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  targets: Awaited<ReturnType<typeof getPortfolioAnalysisScopeTargets>>;
  tenantContext: TenantContext;
}) {
  const [allAccountRows, assetGroupRows, assetRows, settingsRows, recentFxRows] =
    await Promise.all([
      db
        .select()
        .from(accounts)
        .where(and(...activeOwnedAccountPredicates(tenantContext)))
        .orderBy(accounts.sortOrder, accounts.code),
      loadActiveTenantAllocationGroups(tenantContext),
      assetRowsPromise,
      loadLatestTenantPortfolioSettingsRows(tenantContext),
      loadUsablePortfolioFxRows(demand.surface === "home" ? RECENT_FX_OBSERVATION_LIMIT : 1),
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
  const historyAssetIds = selectDashboardHistoryAssetIds(assetRows, demand);
  const historyPositionPredicate = demand.surface === "home"
    ? positionScopePredicate
    : positionScopePredicate && historyAssetIds.length > 0
      ? and(positionScopePredicate, inArray(dailyPositionSnapshots.assetId, historyAssetIds))!
      : null;
  const eventScopePredicate = combineScopePredicates([
    inArrayWhenPresent(eventLedgerEntries.accountId, wholeAccountIds),
    inArrayWhenPresent(eventLedgerEntries.assetId, targets.directAssetIds),
    inArrayWhenPresent(eventLedgerEntries.legacyAssetId, directAssetLegacyIds),
  ]);
  const selectedAccountRowLimit =
    RECENT_PORTFOLIO_DATE_COUNT *
    Math.max(wholeAccountIds.length, 1) *
    MAX_RECENT_SNAPSHOT_SOURCES_PER_ACCOUNT;
  const selectedPositionDateCount =
    demand.surface === "home" && scope.kind === "portfolio_group"
      ? PORTFOLIO_GROUP_POSITION_DATE_COUNT
      : RECENT_POSITION_DATE_COUNT;
  const selectedPositionRowLimit =
    selectedPositionDateCount *
    Math.max(demand.surface === "home" ? assetRows.length : historyAssetIds.length, 1) *
    MAX_RECENT_POSITION_SOURCES_PER_ASSET;
  const baselineWindowStart =
    portfolioDashboardBaselineWindowStart(serviceDate);

  const [
    baselinePositionCandidateRows,
    recentPositionRows,
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
              gte(dailyPositionSnapshots.snapshotDate, baselineWindowStart),
              lte(dailyPositionSnapshots.snapshotDate, serviceDate),
            ),
          )
          .orderBy(
            desc(dailyPositionSnapshots.snapshotDate),
            sql`${dailyPositionSnapshots.capturedAt} desc nulls last`,
            desc(dailyPositionSnapshots.createdAt),
          ),
    historyPositionPredicate === null
      ? Promise.resolve([])
      : db
          .select({
            snapshotDate: dailyPositionSnapshots.snapshotDate,
            cycleEndAt: dailyPositionSnapshots.cycleEndAt,
            assetId: dailyPositionSnapshots.assetId,
            ticker: dailyPositionSnapshots.ticker,
            assetName: dailyPositionSnapshots.assetName,
            account: dailyPositionSnapshots.account,
            unitValueChangePct: dailyPositionSnapshots.unitValueChangePct,
            marketValueChangePct: dailyPositionSnapshots.marketValueChangePct,
            marketValueChangeKrw: dailyPositionSnapshots.marketValueChangeKrw,
            priceChangeKrw: dailyPositionSnapshots.priceChangeKrw,
            fxChangeKrw: dailyPositionSnapshots.fxChangeKrw,
            marketValueKrw: dailyPositionSnapshots.marketValueKrw,
            costKrw: dailyPositionSnapshots.costKrw,
            pnlKrw: dailyPositionSnapshots.pnlKrw,
            source: dailyPositionSnapshots.source,
            capturedAt: dailyPositionSnapshots.capturedAt,
            createdAt: dailyPositionSnapshots.createdAt,
          })
          .from(dailyPositionSnapshots)
          .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
          .where(
            and(
              ...activeOwnedAccountPredicates(tenantContext),
              historyPositionPredicate,
              eq(dailyPositionSnapshots.account, accounts.code),
              eq(dailyPositionSnapshots.isSample, false),
              lte(dailyPositionSnapshots.snapshotDate, serviceDate),
            ),
          )
          .orderBy(
            desc(dailyPositionSnapshots.snapshotDate),
            sql`${dailyPositionSnapshots.capturedAt} desc nulls last`,
            desc(dailyPositionSnapshots.createdAt),
          )
          .limit(selectedPositionRowLimit),
    demand.surface !== "home" || wholeAccountIds.length === 0
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
              lte(eventLedgerEntries.eventDate, serviceDate),
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

  const baselineSelection = selectLatestPortfolioDashboardBaselineRows(
    baselinePositionCandidateRows,
    serviceDate,
  );

  return {
    accountRows,
    assetGroupRows,
    assetRows,
    settingsRows,
    latestFxRows: recentFxRows.slice(0, 1),
    recentFxRows,
    latestPositionRows: baselineSelection.rows,
    baselineReferenceDate: baselineSelection.baselineReferenceDate,
    recentPositionRows,
    historyAssetIds,
    recentPortfolioRows,
    eventRows,
    unmatchedSnapshotCountRows,
  };
}

async function loadDashboardQuoteRows(assetRows: readonly (typeof assets.$inferSelect)[]) {
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

  return { liveQuoteRows, recentPriceRows };
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
