import { holdingsPortfolioSql } from "@/lib/portfolio-presentation-policy";
import "server-only";
import { loadNativeLegacyTrades } from "@/db/queries/native-legacy-trades";
import { resolveStoredManualCutoffCarry } from "./manual-cutoff-carry";
import { brokerRecoveryBaselinePredicate, brokerRecoverySnapshotPredicate } from "@/db/queries/broker-recovery-snapshot-scope";
import { readSnapshotCutoffObservations } from "@/db/queries/snapshot-cutoff-observations";

import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db, sqlClient } from "@/db/client";
import { snapshotFence } from "@/lib/snapshots/write-context";
import { assetPriceSnapshotInstrumentCondition } from "@/db/queries/asset-price-snapshot-scope";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";
import {
  accounts,
  assetGroups,
  assetPriceSnapshots,
  assets,
  benchmarkSnapshots,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
  fxRates,
  livePriceQuotes,
  marketRegimeDaily,
  type Asset,
  type AssetGroup,
  type AssetPriceSnapshot,
  type BenchmarkSnapshot,
  type DailyPortfolioSnapshot,
  type DailyPositionSnapshot,
  type MarketRegimeDaily,
  type NewDailyPortfolioSnapshot,
  type NewDailyPositionSnapshot,
} from "@/db/schema";
import {
  groupPriceRowsByInstrument,
  priceRowsForInstrument,
} from "@/lib/market-data/price-instrument-identity";
import { resolveOperationalClosePrice } from "@/lib/market-data/asset-price-consumer-admission";
import {
  assetMetricKey,
  buildReturnMetricsSummary,
  getAssetReturnMetrics,
  summarizeRealizedReturnForAccount,
  type AccountRealizedReturnSummary,
  type ReturnMetricsSummary,
} from "@/lib/portfolio-return-metrics";
import {
  calculateFxAwarePositionMovementKrw,
  normalizeTicker,
  normalizeCurrencyCode,
  percentOrNull,
  resolveKrwFxRate,
  sumBy,
  sumComplete,
  toNumber,
  uniqueStrings,
} from "@/lib/portfolio-math";
import { snapshotPositionCostBasisKrw, summarizeSnapshotCostEvidence } from "@/lib/snapshots/cost-evidence";
import { selectSnapshotCutoffFx, selectSnapshotExecutionFx } from "@/lib/snapshots/cutoff-fx";
import { eventsChangedAfterCutoff, holdingsChangedAfterCutoff } from "@/lib/snapshots/cutoff-holdings";
import {
  buildCycleForSnapshotDate,
  closeCalendarReferenceDateForAsset,
  closeMarketKeyForAsset,
  resolveSnapshotCycle,
  type InternalCycle,
} from "@/lib/snapshots/market-calendar";
import {
  previousCalendarDate,
  SNAPSHOT_GAP_BACKFILL_POLICY,
  validateSnapshotGapBackfillAuthorization,
  type SnapshotGapBackfillAuthorization,
} from "@/lib/snapshots/gap-backfill";
import {
  ALL_SNAPSHOT_ACCOUNTS,
  resolveSnapshotAccountTargets,
  type SnapshotAccount,
} from "@/lib/snapshots/account-target";
import { isSnapshotInvestmentAssetType } from "@/lib/snapshots/investment-eligibility";
import {
  SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS,
  isSnapshotCutoffOfficialClose,
  selectSnapshotCutoffValuation,
} from "@/lib/snapshots/cutoff-valuation";
import type { TenantContext } from "@/lib/session-resolver-contract";

const SNAPSHOT_SOURCE = "varda_manual_daily_snapshot";
const SNAPSHOT_RULE_VERSION = "varda-manual-daily-snapshot-v1";
const FRESH_CLOSE_MAX_AGE_DAYS = 7;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KOREA_UNHEDGED_GLOBAL_CATEGORIES = new Set([
  "\ubbf8\uad6d\uc8fc\uc2dd",
  "\uc120\uc9c4\uad6d\uc8fc\uc2dd",
  "\uc2e0\ud765\uad6d\uc8fc\uc2dd",
  "\uae00\ub85c\ubc8c\ucc44\uad8c",
  "\uc6d0\uc790\uc7ac",
  "\uae08/\uadc0\uae08\uc18d",
]);

export type { SnapshotAccount } from "@/lib/snapshots/account-target";

type TrackedAccount = string;
type SnapshotWriteAction = "insert" | "update" | "skip" | "blocked";
type AssetRow = Asset;
type AssetGroupRow = AssetGroup;
type PriceRow = AssetPriceSnapshot;
type LivePriceRow = typeof livePriceQuotes.$inferSelect;
type PositionRow = DailyPositionSnapshot;
type PortfolioRow = DailyPortfolioSnapshot;

export type DailySnapshotRunResult = {
  ok: boolean;
  dryRun: boolean;
  writeReady: boolean;
  snapshotDate: string;
  requestedAccount: SnapshotAccount;
  accounts: TrackedAccount[];
  cycle: SnapshotCycle;
  fx: ResolvedFxRate;
  closeReferences: CloseReferenceSummary[];
  freshClose: FreshCloseSummary;
  closeSyncPlan: CloseSyncPlan;
  cutoffValuation: CutoffValuationSummary;
  realizedReturn: RealizedReturnRunSummary | null;
  plannedWrites: PlannedSnapshotWrites;
  results: Record<string, AccountSnapshotPlan | AllAccountSnapshotPlan>;
  warnings: string[];
  writePolicy: SnapshotWritePolicySummary;
};

type SnapshotWritePolicySummary = Readonly<{
  mode: "current_cycle" | "historical_unchanged_holdings_backfill";
  source: typeof SNAPSHOT_SOURCE;
  ruleVersion: string;
  insertOnly: boolean;
  fxAsOfDate: string;
  manualValuation: "asset_current" | "latest_prior_generated_snapshot_carry";
}>;

export type SnapshotCycle = {
  snapshotDate: string;
  capturedAt: string;
  cycleStartAt: string;
  cycleEndAt: string;
};

type ResolvedFxRate = {
  usdKrw: number | null;
  referenceDate: string | null;
  source: string;
  status: string | null;
  observedAt: string | null;
  fetchedAt: string | null;
  rateKind: string | null;
  referenceAt?: string | null;
  timestampBasis?: "collection" | "provider";
};

type RealizedReturnRunSummary = {
  asOfDate: string;
  tradeEventCount: number;
  buyEventCount: number;
  sellEventCount: number;
  realizedSellEventCount: number;
  skippedBuyEventCount: number;
  unmatchedSellEventCount: number;
  missingCostSellEventCount: number;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  accounts: AccountRealizedReturnSummary[];
};

type FreshCloseSummary = {
  requiredCount: number;
  satisfiedCount: number;
  missingCount: number;
  rowsUsedCount: number;
  closeReferences: CloseReferenceSummary[];
  coverage: CloseCoverageAsset[];
  missing: MissingCloseAsset[];
};

type CutoffValuationSummary = {
  policy: "pre_cutoff_kis_quote_else_exact_official_close" | "execution_quote_else_exact_official_close";
  maxQuoteAgeMinutes: number;
  requiredCount: number;
  observedCount: number;
  fallbackCount: number;
  missing: ReadonlyArray<{
    assetId: string;
    ticker: string;
    name: string;
    account: string;
    market: string;
    currency: string;
  }>;
};

type CloseReferenceSummary = {
  market: string;
  requiredCount: number;
  requiredTickerCount: number;
  calendarReferenceDate: string;
  expectedCloseDate: string;
  latestAvailableCloseDate: string | null;
  exactReferenceRows: number;
  selectedReferenceRows: number;
  status: "ready" | "partial" | "missing";
  reason: string;
};

type CloseCoverageAsset = {
  id: string;
  legacyBase44Id: string | null;
  ticker: string | null;
  name: string;
  account: string;
  market: string;
  currency: string;
  calendarReferenceDate: string;
  expectedCloseDate: string;
  selectedCloseDate: string | null;
  selectedSource: string | null;
  status: "satisfied" | "missing" | "stale";
  reason: string;
};

type MissingCloseAsset = {
  id: string;
  legacyBase44Id: string | null;
  ticker: string | null;
  name: string;
  account: string;
  market: string;
  calendarReferenceDate: string;
  expectedCloseDate: string;
  actualCloseDate: string | null;
  reason: string;
};

type CloseSyncPlanAction =
  | "covered"
  | "missing"
  | "stale"
  | "manual_current_not_syncable";

type CloseSyncPlanTarget = {
  id: string;
  legacyBase44Id: string | null;
  ticker: string | null;
  name: string;
  account: string;
  market: string;
  currency: string;
  expectedCloseDate: string | null;
  selectedCloseDate: string | null;
  selectedSource: string | null;
  action: CloseSyncPlanAction;
  reason: string;
};

type CloseSyncPlanMarket = {
  market: string;
  expectedCloseDate: string | null;
  requiredCount: number;
  requiredTickerCount: number;
  coveredCount: number;
  missingCount: number;
  staleCount: number;
  targets: CloseSyncPlanTarget[];
};

type CloseSyncPlanBatch = {
  market: string;
  expectedCloseDate: string;
  tickers: string[];
  count: number;
  maxBatchSize: number;
  dryRunQuery: string;
  manualWriteRequired: boolean;
  writeRequiresConfirmWrite: boolean;
  suggestedWriteParams: {
    provider: "kis";
    mode: "close";
    market: string;
    date: string;
    tickers: string[];
    limit: number;
  };
};

type CloseSyncPlan = {
  snapshotDate: string;
  canProceedToSnapshotWrite: boolean;
  requiredCount: number;
  coveredCount: number;
  missingCount: number;
  staleCount: number;
  manualCurrentNotSyncableCount: number;
  markets: CloseSyncPlanMarket[];
  manualCurrentNotSyncable: CloseSyncPlanTarget[];
  suggestedKisBatches: CloseSyncPlanBatch[];
};

type PlannedSnapshotWrites = {
  dailyPortfolioSnapshots: {
    insert: number;
    update: number;
    skip: number;
    blocked: number;
  };
  dailyPositionSnapshots: {
    insert: number;
    update: number;
    skip: number;
    blocked: number;
  };
};

type AccountSnapshotPlan = {
  account: TrackedAccount;
  status: "planned" | "written" | "skipped" | "blocked";
  reason: string | null;
  positionCount: number;
  portfolioAction: SnapshotWriteAction;
  positionActions: Record<SnapshotWriteAction, number>;
  totalMarketValue: number;
  totalCost: number | null;
  openCostKrw: number | null;
  unrealizedPnlKrw: number | null;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
  usdKrw: number | null;
  blockers: string[];
};

type AllAccountSnapshotPlan = {
  account: "all";
  status: "planned" | "written" | "skipped" | "blocked";
  reason: string | null;
  accountsAggregated: number;
  portfolioAction: SnapshotWriteAction;
  totalMarketValue: number;
  totalCost: number | null;
  openCostKrw: number | null;
  unrealizedPnlKrw: number | null;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
  totalPnl: number | null;
  totalReturnPct: number | null;
  blockers: string[];
};

type AccountSnapshotBuild = AccountSnapshotPlan & {
  portfolio: NewDailyPortfolioSnapshot | null;
  positions: NewDailyPositionSnapshot[];
  existingPortfolio: PortfolioRow | null;
  existingPositionsByKey: Map<string, PositionRow>;
};

type AllAccountSnapshotBuild = AllAccountSnapshotPlan & {
  portfolio: NewDailyPortfolioSnapshot | null;
  existingPortfolio: PortfolioRow | null;
};

type AccountContext = {
  ownerUserId: string;
  activeAccountCodes: readonly string[];
  accountRowsByCode: Map<string, string>;
  groupsById: Map<string, AssetGroupRow>;
  latestRegime: MarketRegimeDaily | null;
  benchmarkByTicker: Map<string, BenchmarkSnapshot>;
};

type PriceSelection = {
  row: PriceRow | null;
  price: number;
  source: string;
  referenceDate: string | null;
  calendarReferenceDate: string | null;
  expectedCloseDate: string | null;
  basis: "cutoff_live" | "close" | "manual_current";
  fromCloseSnapshot: boolean;
  manualCarryCapturedAt?: string;
  manualCarrySnapshotId?: string;
  manualInputRecordedAt?: string | null;
  observedAt?: string | null;
  fetchedAt?: string | null;
  quoteType?: string | null;
  referenceAt?: string | null;
  timestampBasis?: "collection" | "provider" | "manual_input";
};

type AccountComputed = {
  account: TrackedAccount;
  assets: AssetRow[];
  positions: NewDailyPositionSnapshot[];
  totalMarketValue: number;
  totalCost: number | null;
  totalPnl: number | null;
  totalReturnPct: number | null;
  investedAmount: number | null;
  krValue: number;
  usValue: number;
  thematicValue: number;
  usdExposureValue: number;
  topHoldingName: string | null;
  topHoldingWeight: number | null;
  groupCount: number;
  openCostKrw: number | null;
  unrealizedPnlKrw: number | null;
  realizedPnlKrw: number | null;
  realizedCostBasisKrw: number | null;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
  provenance: SnapshotProvenance;
};

type SnapshotProvenance = SnapshotWritePolicySummary &
  Readonly<{ descriptionTags: readonly string[] }>;

type ExistingRows = {
  portfolios: PortfolioRow[];
  positions: PositionRow[];
  priorPositions: PositionRow[];
};

type RunOptions = {
  tenantContext: TenantContext;
  dryRun?: boolean;
  snapshotDate?: string;
  account?: SnapshotAccount;
  now?: Date;
  historicalWriteAuthorization?: SnapshotGapBackfillAuthorization;
};

export async function runDailySnapshot(
  options: RunOptions,
): Promise<DailySnapshotRunResult> {
  const dryRun = options.dryRun ?? true;
  const executionAt = options.now ?? new Date();
  const resolvedCycle = resolveSnapshotCycle(executionAt);
  const snapshotDate = options.snapshotDate ?? resolvedCycle.snapshotDate;
  const requestedAccount = options.account ?? ALL_SNAPSHOT_ACCOUNTS;

  if (!DATE_KEY_PATTERN.test(snapshotDate)) {
    throw new DailySnapshotRequestError(
      "invalid_snapshot_date",
      "date must be YYYY-MM-DD",
      {},
      400,
    );
  }

  const historicalAuthorization = options.historicalWriteAuthorization;
  const historicalValidation = historicalAuthorization
    ? validateSnapshotGapBackfillAuthorization({
        authorization: historicalAuthorization,
        requestedDate: snapshotDate,
        requestedOwnerUserId: options.tenantContext.ownerUserId,
        currentCycleDate: resolvedCycle.snapshotDate,
      })
    : null;

  if (historicalValidation && !historicalValidation.ok) {
    throw new DailySnapshotRequestError(
      "invalid_historical_write_authorization",
      "Historical snapshot backfill authorization is invalid",
      { snapshotDate, reason: historicalValidation.reason },
      400,
    );
  }

  if (
    !dryRun &&
    snapshotDate !== resolvedCycle.snapshotDate &&
    !historicalValidation?.ok && !snapshotFence.getStore()
  ) {
    throw new DailySnapshotRequestError(
      "historical_write_not_enabled",
      "daily snapshot writes are only enabled for the current resolved cycle date",
      {
        requestedDate: snapshotDate,
        allowedSnapshotDate: resolvedCycle.snapshotDate,
      },
      400,
    );
  }

  const executionValuation = snapshotDate === resolvedCycle.snapshotDate && !historicalValidation?.ok;
  const provenance = buildSnapshotProvenance({
    snapshotDate,
    historicalBackfill: historicalValidation?.ok === true,
    executionFx: executionValuation,
  });

  const scheduledCycle = buildCycleForSnapshotDate(snapshotDate, executionAt);
  // 07:00 determines the service date. A current daily run records the actual
  // execution valuation; it does not reconstruct a price or holding at 07:00.
  const cycle = executionValuation
    ? { ...scheduledCycle, cycleEndAt: executionAt }
    : scheduledCycle;
  const ownerUserId = options.tenantContext.ownerUserId;
  const context = await loadAccountContext(snapshotDate, ownerUserId);
  if (!provenance.insertOnly) {
    const completed = await readCompletedDailyResult({ context, cycle, provenance, requestedAccount, dryRun });
    if (completed) return completed;
  }
  const allAssetRows = await db
    .select({
      ...getTableColumns(assets),
      revisionToken: sql<string>`${assets.updatedAt}::text`,
      account: accounts.code,
    })
    .from(assets)
    .innerJoin(
      accounts,
      eq(assets.accountId, accounts.id),
    )
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, ownerUserId),
        eq(accounts.isActive, true),
        ne(accounts.accountType, "cash"),
        or(isNull(assets.archivedAt), gt(assets.archivedAt, cycle.cycleEndAt)),
      ),
    )
    .orderBy(accounts.code, assets.name);
  const investmentAssetRows = allAssetRows.filter((asset) =>
    isSnapshotInvestmentAssetType(asset.assetType),
  );
  const changedAfterCutoff = provenance.insertOnly ? []
    : holdingsChangedAfterCutoff(investmentAssetRows.filter((asset) =>
      requestedAccount === ALL_SNAPSHOT_ACCOUNTS || asset.account === requestedAccount,
    ), cycle.cycleEndAt);
  if (changedAfterCutoff.length > 0) {
    throw new DailySnapshotRequestError(
      "holdings_changed_after_cutoff",
      "Holdings changed after the cutoff; their earlier quantities and costs cannot be assumed",
      { snapshotDate, assetIds: changedAfterCutoff }, 409,
    );
  }
  const openInvestmentAssets = investmentAssetRows.filter((asset) =>
    !asset.archivedAt && isOpenInvestmentAsset(asset),
  );
  const targetResolution = resolveSnapshotAccountTargets({
    activeAccountCodes: context.activeAccountCodes,
    openInvestmentAccountCodes: new Set(
      openInvestmentAssets.map((asset) => asset.account),
    ),
    requestedAccount,
  });
  if (!targetResolution.ok) {
    throw new DailySnapshotRequestError(
      targetResolution.reason,
      "No owned active investment account matches the snapshot request",
      { snapshotDate, requestedAccount },
      409,
    );
  }
  const targetAccounts = [...targetResolution.targetAccounts];
  const selectedAssets = openInvestmentAssets.filter((asset) =>
    targetAccounts.includes(asset.account),
  );
  const retainedObservations = provenance.insertOnly ? null : await readSnapshotCutoffObservations(snapshotDate);
  const fx = await resolveSnapshotFx(snapshotDate, provenance.fxAsOfDate,
    provenance.insertOnly ? null : cycle.cycleEndAt, retainedObservations?.fxRows ?? [],
    selectedAssets.some(asset => normalizeCurrencyCode(asset.currency) !== "KRW"),
    !provenance.insertOnly && snapshotDate === resolvedCycle.snapshotDate ? cycle.capturedAt : null);
  const unsupportedCurrencyAssets = selectedAssets.filter(
    (asset) => !resolveKrwFxRate(asset.currency, fx.usdKrw).ok,
  );
  const eventRows = await loadEventRows(snapshotDate, ownerUserId);
  const changedEventsAfterCutoff = provenance.insertOnly ? []
    : eventsChangedAfterCutoff(eventRows.filter((event) =>
      event.account !== null && targetAccounts.includes(event.account),
    ), cycle.cycleEndAt);
  if (changedEventsAfterCutoff.length > 0) {
    throw new DailySnapshotRequestError(
      "event_changed_after_cutoff",
      "Portfolio events changed after the cutoff; their earlier state cannot be assumed",
      { snapshotDate, eventIds: changedEventsAfterCutoff }, 409,
    );
  }
  const nativeTrades = eventRows.some(row => row.nativeData != null) ? await loadNativeLegacyTrades(options.tenantContext) : [];
  const calculationEvents = [...eventRows.filter(row => row.nativeData == null), ...nativeTrades.filter(row => row.eventDate <= snapshotDate)];
  const returnMetrics = buildReturnMetricsSummary(calculationEvents, investmentAssetRows, fx.usdKrw ?? 0, {
    asOfDate: snapshotDate,
  });
  const realizedReturn = buildRealizedReturnRunSummary(
    returnMetrics,
    targetAccounts,
    selectedAssets,
    snapshotDate,
  );
  const closeContext = await buildCloseContext({
    snapshotDate,
    assets: selectedAssets,
    ownerUserId,
    manualValuation: provenance.manualValuation,
    capturedAt: cycle.capturedAt,
    cycleEndAt: cycle.cycleEndAt,
    useCutoffValuation: !provenance.insertOnly,
    useExecutionValuation: executionValuation,
    retainedQuotes: retainedObservations?.quotes ?? [],
  });
  const freshClose = summarizeFreshClose(selectedAssets, closeContext, snapshotDate);
  const cutoffValuation = summarizeCutoffValuation({
    selectedAssets,
    closeContext,
    required: !provenance.insertOnly,
    cycleEndAt: cycle.cycleEndAt,
    executionValuation,
  });
  const closeSyncPlan = buildCloseSyncPlan({
    snapshotDate,
    selectedAssets,
    freshClose,
    cutoffValuation: provenance.insertOnly ? null : cutoffValuation,
  });
  const warnings = buildWarnings({
    selectedAssets,
    freshClose,
    cutoffValuation: provenance.insertOnly ? null : cutoffValuation,
    fx,
    unsupportedCurrencyAssets,
  });
  const plannedWrites = emptyPlannedWrites();

  if (!dryRun && provenance.insertOnly && freshClose.missing.length > 0) {
    throw new DailySnapshotRequestError(
      "missing_fresh_closes",
      "Fresh close prices are required before writing a daily snapshot",
      { snapshotDate, missingCloseAssets: freshClose.missing },
      409,
    );
  }

  if (!dryRun && cutoffValuation.missing.length > 0) {
    throw new DailySnapshotRequestError(
      "missing_cutoff_price_evidence",
      "An admissible quote at the valuation time or the exact official close is required before writing the daily snapshot",
      { snapshotDate, missingCutoffAssets: cutoffValuation.missing },
      409,
    );
  }

  const accountBuilds = await mapWithConcurrency(
    targetAccounts,
    2,
    async (account): Promise<AccountSnapshotBuild> => {
      const accountAssets = selectedAssets.filter(
        (asset) => asset.account === account,
      );
      const existingRows = await loadExistingRows({
        ownerUserId,
        account,
        snapshotDate,
        assetCount: accountAssets.length,
      });
      const computed = computeAccountSnapshot({
        account,
        assets: accountAssets,
        context,
        fx,
        closeContext,
        cycle,
        snapshotDate,
        returnMetrics,
        priorPositions: existingRows.priorPositions,
        provenance,
      });
      const build = buildAccountPlan({
        computed,
        existingRows,
        context,
        fx,
      });

      return build;
    },
  );

  for (const build of accountBuilds) {
    accumulatePlannedWrites(plannedWrites, build);
  }

  const resultMap: Record<string, AccountSnapshotPlan | AllAccountSnapshotPlan> =
    Object.fromEntries(
      accountBuilds.map((build) => [build.account, publicAccountPlan(build)]),
    );
  let allBuild: AllAccountSnapshotBuild | null = null;

  if (requestedAccount === ALL_SNAPSHOT_ACCOUNTS) {
    const existingAllRows = await loadExistingAllPortfolioRows(
      snapshotDate,
      ownerUserId,
    );
    allBuild = buildAllAccountPlan({
      accountBuilds,
      existingRows: existingAllRows,
      context,
      fx,
      cycle,
      snapshotDate,
      provenance,
    });
    accumulateAllPlannedWrites(plannedWrites, allBuild);
    resultMap.all = publicAllAccountPlan(allBuild);
  }

  const insertOnlyCollisionBlockers = provenance.insertOnly
    ? buildInsertOnlyCollisionBlockers(plannedWrites)
    : [];
  const blockers = [
    ...unsupportedCurrencyAssets.map(
      (asset) =>
        `unsupported_currency:${normalizeTicker(asset.ticker) ?? asset.name}:${normalizeCurrencyCode(asset.currency)}`,
    ),
    ...(provenance.insertOnly
      ? freshClose.missing.map((asset) => `missing_close:${asset.ticker}`)
      : cutoffValuation.missing.map((asset) => `missing_cutoff_price_evidence:${asset.ticker}`)),
    ...closeContext.manualCarryMissing.map(
      (asset) => `missing_manual_carry:${asset.account}:${asset.assetName}`,
    ),
    ...insertOnlyCollisionBlockers,
    ...accountBuilds.flatMap((build) => build.blockers),
    ...(allBuild?.blockers ?? []),
  ];
  const writeReady = blockers.length === 0;

  if (!dryRun && !writeReady) {
    throw new DailySnapshotRequestError(
      "snapshot_write_blocked",
      "Daily snapshot write was blocked by preflight validation",
      {
        snapshotDate,
        blockers,
        results: resultMap,
        freshClose,
      },
      409,
    );
  }

  if (!dryRun) {
    await applySnapshotWrites(accountBuilds, allBuild, provenance.insertOnly, allAssetRows.filter(a=>targetAccounts.includes(a.account)),cycle.cycleEndAt,eventRows.filter(e=>e.account!==null && targetAccounts.includes(e.account)),snapshotDate);
    for (const build of accountBuilds) {
      build.status = build.status === "planned" ? "written" : build.status;
    }
    if (allBuild) {
      allBuild.status = allBuild.status === "planned" ? "written" : allBuild.status;
      resultMap.all = publicAllAccountPlan(allBuild);
    }
    for (const build of accountBuilds) {
      resultMap[build.account] = publicAccountPlan(build);
    }
  }

  return {
    ok: writeReady,
    dryRun,
    writeReady,
    snapshotDate,
    requestedAccount,
    accounts: targetAccounts,
    cycle: {
      snapshotDate: cycle.snapshotDate,
      capturedAt: cycle.capturedAt.toISOString(),
      cycleStartAt: cycle.cycleStartAt.toISOString(),
      cycleEndAt: cycle.cycleEndAt.toISOString(),
    },
    fx,
    closeReferences: closeContext.closeReferences,
    freshClose,
    closeSyncPlan,
    cutoffValuation,
    realizedReturn,
    plannedWrites,
    results: resultMap,
    warnings,
    writePolicy: publicWritePolicy(provenance),
  };
}

/** Completed daily values are authoritative even after the live cache expires
 * or holdings change. The first completed owned account/service-date is frozen. */
async function readCompletedDailyResult({ context, cycle, provenance, requestedAccount, dryRun }: {
  context: AccountContext; cycle: InternalCycle; provenance: SnapshotProvenance; requestedAccount: SnapshotAccount; dryRun: boolean;
}): Promise<DailySnapshotRunResult | null> {
  const codes = requestedAccount === ALL_SNAPSHOT_ACCOUNTS ? [...context.activeAccountCodes] : [requestedAccount];
  if (!codes.length || codes.some(code => !context.accountRowsByCode.has(code))) return null;
  const [portfolios, positions] = await Promise.all([
    db.select().from(dailyPortfolioSnapshots).where(and(eq(dailyPortfolioSnapshots.canonicalOwnerUserId, context.ownerUserId), eq(dailyPortfolioSnapshots.snapshotDate, cycle.snapshotDate))),
    db.select().from(dailyPositionSnapshots).where(and(eq(dailyPositionSnapshots.canonicalOwnerUserId, context.ownerUserId), eq(dailyPositionSnapshots.snapshotDate, cycle.snapshotDate))),
  ]);
  const results: DailySnapshotRunResult["results"] = {};
  const used: PositionRow[] = [];
  const selected: PortfolioRow[] = [];
  for (const code of codes) {
    const accountId = context.accountRowsByCode.get(code);
    const candidates = portfolios.filter(row => row.canonicalOwnerUserId === context.ownerUserId && row.account === code && row.accountId === accountId && row.snapshotDate === cycle.snapshotDate && isCompletedDailyPortfolio(row, row.cycleEndAt));
    if (candidates.length !== 1) return null;
    const row = candidates[0];
    const holdings = positions.filter(p => p.canonicalOwnerUserId === context.ownerUserId && p.account === code && p.accountId === accountId && p.snapshotDate === cycle.snapshotDate && isVardaGeneratedRow(p) && !p.isSample && sameCutoff(p.cycleEndAt, row.cycleEndAt));
    if (holdings.length !== row.numAssets || new Set(holdings.map(positionKey)).size !== holdings.length) return null;
    selected.push(row); used.push(...holdings);
    results[code] = publicAccountPlan({ ...emptyAccountPlan(code), ...frozenPortfolioTotals(row), reason: "completed_cutoff_preserved", positionCount: holdings.length,
      positionActions: { insert: 0, update: 0, skip: holdings.length, blocked: 0 }, usdKrw: toNumber(row.usdKrw),
      openCostKrw: sumComplete(holdings, p => toNumber(p.costKrw)), unrealizedPnlKrw: sumComplete(holdings, p => toNumber(p.pnlKrw)),
      realizedPnlKrw: descriptionNumber(row.description, "realized_pnl_krw"), realizedCostBasisKrw: descriptionNumber(row.description, "realized_cost_basis_krw"),
      realizedSellEventCount: descriptionNumber(row.description, "realized_sell_events") ?? 0,
    });
  }
  if (requestedAccount === ALL_SNAPSHOT_ACCOUNTS) {
    const all = portfolios.filter(row => row.canonicalOwnerUserId === context.ownerUserId && row.account === "all" && row.snapshotDate === cycle.snapshotDate && isCompletedDailyPortfolio(row, row.cycleEndAt));
    if (all.length !== 1 || all[0].numAssets !== used.length) return null;
    results.all = { ...results[codes[0]], ...frozenPortfolioTotals(all[0]), account: "all", accountsAggregated: codes.length, portfolioAction: "skip", blockers: [] };
  }
  const first = selected[0];
  const observedCount = used.filter(row => row.priceBasis === "cutoff_live").length;
  return {
    ok: true, dryRun, writeReady: true, snapshotDate: cycle.snapshotDate, requestedAccount, accounts: codes,
    cycle: { snapshotDate: cycle.snapshotDate, capturedAt: isoTimestamp(first.capturedAt) ?? cycle.capturedAt.toISOString(), cycleStartAt: isoTimestamp(first.cycleStartAt) ?? cycle.cycleStartAt.toISOString(), cycleEndAt: isoTimestamp(first.cycleEndAt) ?? cycle.cycleEndAt.toISOString() },
    fx: { usdKrw: toNumber(first.usdKrw), referenceDate: used[0]?.fxReferenceDate ?? null, source: "stored_daily_snapshot", status: "stored",
      observedAt: descriptionValue(used[0]?.description, "fx_observed_at"), fetchedAt: descriptionValue(used[0]?.description, "fx_fetched_at"), rateKind: descriptionValue(used[0]?.description, "fx_rate_kind") },
    closeReferences: [], freshClose: { requiredCount: 0, satisfiedCount: 0, missingCount: 0, rowsUsedCount: 0, closeReferences: [], coverage: [], missing: [] },
    closeSyncPlan: { snapshotDate: cycle.snapshotDate, canProceedToSnapshotWrite: true, requiredCount: 0, coveredCount: 0, missingCount: 0, staleCount: 0, manualCurrentNotSyncableCount: 0, markets: [], manualCurrentNotSyncable: [], suggestedKisBatches: [] },
    cutoffValuation: { policy: first.description?.includes("valuation_policy=execution_collection_v1") ? "execution_quote_else_exact_official_close" : "pre_cutoff_kis_quote_else_exact_official_close", maxQuoteAgeMinutes: SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS / 60000, requiredCount: used.length, observedCount, fallbackCount: used.length - observedCount, missing: [] },
    // No current-ledger calculation is substituted for the frozen record.
    realizedReturn: null, plannedWrites: { dailyPortfolioSnapshots: { insert: 0, update: 0, skip: selected.length, blocked: 0 }, dailyPositionSnapshots: { insert: 0, update: 0, skip: used.length, blocked: 0 } },
    results, warnings: ["completed_cutoff_preserved"], writePolicy: publicWritePolicy(provenance),
  };
}

function descriptionValue(description: string | null | undefined, key: string) {
  const value = description?.split("; ").find(part => part.startsWith(`${key}=`))?.slice(key.length + 1);
  return value && value !== "unknown" ? value : null;
}
function descriptionNumber(description: string | null, key: string) { return toNumber(descriptionValue(description, key)); }

function buildSnapshotProvenance({
  snapshotDate,
  historicalBackfill,
  executionFx,
}: {
  snapshotDate: string;
  historicalBackfill: boolean;
  executionFx: boolean;
}): SnapshotProvenance {
  if (!historicalBackfill) {
    return Object.freeze({
      mode: "current_cycle" as const,
      source: SNAPSHOT_SOURCE,
      ruleVersion: SNAPSHOT_RULE_VERSION,
      insertOnly: false,
      fxAsOfDate: snapshotDate,
      manualValuation: "asset_current" as const,
      descriptionTags: Object.freeze(executionFx ? ["fx_valuation_policy=execution_collection_v1", "valuation_policy=execution_collection_v1"] : []),
    });
  }

  return Object.freeze({
    mode: "historical_unchanged_holdings_backfill" as const,
    source: SNAPSHOT_SOURCE,
    ruleVersion: SNAPSHOT_GAP_BACKFILL_POLICY.ruleVersion,
    insertOnly: true,
    fxAsOfDate: previousCalendarDate(snapshotDate),
    manualValuation: "latest_prior_generated_snapshot_carry" as const,
    descriptionTags: Object.freeze([
      `backfill_policy=${SNAPSHOT_GAP_BACKFILL_POLICY.id}`,
      "write_mode=historical_insert_only",
      "holdings_basis=operator_confirmed_unchanged",
      "event_ledger_basis=no_events_in_range",
      `manual_valuation_basis=${SNAPSHOT_GAP_BACKFILL_POLICY.manualValuation}`,
      "fractional_quantity_basis=latest_prior_generated_snapshot_carry",
      `fx_as_of_policy=${SNAPSHOT_GAP_BACKFILL_POLICY.fxAsOf}`,
    ]),
  });
}

function publicWritePolicy(
  provenance: SnapshotProvenance,
): SnapshotWritePolicySummary {
  return {
    mode: provenance.mode,
    source: provenance.source,
    ruleVersion: provenance.ruleVersion,
    insertOnly: provenance.insertOnly,
    fxAsOfDate: provenance.fxAsOfDate,
    manualValuation: provenance.manualValuation,
  };
}

function buildInsertOnlyCollisionBlockers(
  plannedWrites: PlannedSnapshotWrites,
) {
  const blockers: string[] = [];
  if (plannedWrites.dailyPortfolioSnapshots.update > 0) {
    blockers.push("insert_only_portfolio_collision");
  }
  if (plannedWrites.dailyPositionSnapshots.update > 0) {
    blockers.push("insert_only_position_collision");
  }
  return blockers;
}

function buildAccountPlan({
  computed,
  existingRows,
  context,
  fx,
}: {
  computed: AccountComputed;
  existingRows: ExistingRows;
  context: AccountContext;
  fx: ResolvedFxRate;
}): AccountSnapshotBuild {
  const blockers = findAccountWriteBlockers(computed, existingRows);

  if (computed.assets.length === 0) {
    return {
      ...emptyAccountPlan(computed.account),
      status: "skipped",
      reason: "no_open_investment_positions",
      portfolio: null,
      positions: [],
      existingPortfolio: null,
      existingPositionsByKey: new Map(),
    };
  }

  const existingPortfolio = existingRows.portfolios.find(isVardaGeneratedRow) ?? null;
  const existingPositionsByKey = new Map<string, PositionRow>();
  for (const row of existingRows.positions.filter(isVardaGeneratedRow)) {
    existingPositionsByKey.set(positionKey(row), row);
  }

  // Re-reading live evidence must never revalue a completed daily record. This
  // check also applies to direct/admin writers, not only durable-job retries.
  if (blockers.length === 0 && existingPortfolio && isCompletedDailyPortfolio(existingPortfolio, existingPortfolio.cycleEndAt) &&
      existingPositionsByKey.size === existingPortfolio.numAssets &&
      [...existingPositionsByKey.values()].every(row => sameCutoff(row.cycleEndAt, existingPortfolio.cycleEndAt))) {
    const frozenPositions = [...existingPositionsByKey.values()];
    return {
      ...computed, account: computed.account, status: "skipped", reason: "completed_cutoff_preserved",
      ...frozenPortfolioTotals(existingPortfolio), positionCount: frozenPositions.length,
      portfolioAction: "skip", positionActions: { insert: 0, update: 0, skip: frozenPositions.length, blocked: 0 },
      usdKrw: toNumber(existingPortfolio.usdKrw) ?? toNumber(existingPortfolio.fxRate) ?? fx.usdKrw,
      blockers: [], portfolio: existingPortfolio, positions: frozenPositions, existingPortfolio, existingPositionsByKey,
    };
  }

  const positionActions =
    blockers.length > 0
      ? { insert: 0, update: 0, skip: 0, blocked: computed.positions.length }
      : summarizePositionActions(computed.positions, existingPositionsByKey);
  const portfolioAction: SnapshotWriteAction =
    blockers.length > 0 ? "blocked" : existingPortfolio ? "update" : "insert";

  return {
    account: computed.account,
    status: blockers.length > 0 ? "blocked" : "planned",
    reason: blockers.length > 0 ? "preflight_blocked" : null,
    positionCount: computed.positions.length,
    portfolioAction,
    positionActions,
    totalMarketValue: computed.totalMarketValue,
    totalCost: computed.totalCost,
    openCostKrw: computed.openCostKrw,
    unrealizedPnlKrw: computed.unrealizedPnlKrw,
    realizedPnlKrw: computed.realizedPnlKrw,
    realizedCostBasisKrw: computed.realizedCostBasisKrw,
    realizedSellEventCount: computed.realizedSellEventCount,
    unmatchedRealizedSellEventCount: computed.unmatchedRealizedSellEventCount,
    missingCostRealizedSellEventCount: computed.missingCostRealizedSellEventCount,
    totalPnl: computed.totalPnl,
    totalReturnPct: computed.totalReturnPct,
    usdKrw: fx.usdKrw,
    blockers,
    portfolio:
      computed.positions.length > 0
        ? buildPortfolioSnapshot(computed, context, fx)
        : null,
    positions: computed.positions,
    existingPortfolio,
    existingPositionsByKey,
  };
}

function sameCutoff(left: Date | string | null | undefined, right: Date | string | null | undefined) {
  const a = left == null ? NaN : new Date(left).getTime();
  const b = right == null ? NaN : new Date(right).getTime();
  return Number.isFinite(a) && a === b;
}

function isCompletedDailyPortfolio(row: PortfolioRow, cutoff: Date | string | null | undefined) {
  return isVardaGeneratedRow(row) && !row.isSample && (row.numAssets ?? 0) > 0 &&
    row.description?.includes("snapshot_status=complete") === true && sameCutoff(row.cycleEndAt, cutoff);
}

function frozenPortfolioTotals(row: PortfolioRow) {
  return {
    totalMarketValue: toNumber(row.totalMarketValue) ?? 0,
    totalCost: toNumber(row.totalCost), totalPnl: toNumber(row.totalPnl), totalReturnPct: toNumber(row.totalReturnPct),
  };
}

function buildAllAccountPlan({
  accountBuilds,
  existingRows,
  context,
  fx,
  cycle,
  snapshotDate,
  provenance,
}: {
  accountBuilds: AccountSnapshotBuild[];
  existingRows: PortfolioRow[];
  context: AccountContext;
  fx: ResolvedFxRate;
  cycle: InternalCycle;
  snapshotDate: string;
  provenance: SnapshotProvenance;
}): AllAccountSnapshotBuild {
  const blockers = findAllAccountWriteBlockers(accountBuilds, existingRows);
  const completed = accountBuilds.filter(
    (build) => build.portfolio && build.status !== "blocked",
  );
  const existingPortfolio = existingRows.find(isVardaGeneratedRow) ?? null;
  const totalMarketValue = sumBy(completed, (build) => build.totalMarketValue);
  const realizedPnlKrw = sumComplete(completed, (build) => build.realizedPnlKrw);
  const realizedCostBasisKrw = sumComplete(
    completed,
    (build) => build.realizedCostBasisKrw,
  );
  const realizedSellEventCount = sumBy(
    completed,
    (build) => build.realizedSellEventCount,
  );
  const unmatchedRealizedSellEventCount = sumBy(
    completed,
    (build) => build.unmatchedRealizedSellEventCount,
  );
  const missingCostRealizedSellEventCount = sumBy(
    completed,
    (build) => build.missingCostRealizedSellEventCount,
  );
  const { openCostKrw, unrealizedPnlKrw, totalCost, totalPnl } = summarizeSnapshotCostEvidence(
    completed.map((build) => ({ costKrw: build.openCostKrw, pnlKrw: build.unrealizedPnlKrw })),
    realizedCostBasisKrw, realizedPnlKrw,
  );
  const investedAmount = totalCost;
  const topHolding = findTopHolding(
    accountBuilds.flatMap((build) => build.positions),
    totalMarketValue,
  );
  const krValue = sumBy(completed, (build) => {
    const value = toNumber(build.portfolio?.krWeight);
    return value === null ? 0 : (build.totalMarketValue * value) / 100;
  });
  const usValue = sumBy(completed, (build) => {
    const value = toNumber(build.portfolio?.usWeight);
    return value === null ? 0 : (build.totalMarketValue * value) / 100;
  });
  const thematicValue = sumBy(completed, (build) => {
    const value = toNumber(build.portfolio?.thematicWeight);
    return value === null ? 0 : (build.totalMarketValue * value) / 100;
  });
  const usdExposureValue = sumBy(completed, (build) => {
    const value = toNumber(build.portfolio?.usdExposurePct);
    return value === null ? 0 : (build.totalMarketValue * value) / 100;
  });
  const benchmark = getBenchmarkFields(context);
  const portfolio: NewDailyPortfolioSnapshot | null =
    completed.length > 0
      ? {
          legacyBase44Id: null,
          canonicalOwnerUserId: context.ownerUserId,
          snapshotDate,
          account: "all",
          accountId: null,
          source: provenance.source,
          ruleVersion: provenance.ruleVersion,
          description: [
            "snapshot_status=complete",
            `source=${provenance.source}`,
            "source_basis=account_position_sums",
            `accounts=${completed.length}`,
            `valuation_basis=${portfolioValuationBasis(provenance)}`,
            `fx_source=${fx.source}`,
            "return_basis=unrealized_plus_event_ledger_realized_v1",
            `open_cost_krw=${openCostKrw === null ? "unknown" : Math.round(openCostKrw)}`,
            `realized_pnl_krw=${realizedPnlKrw === null ? "unknown" : Math.round(realizedPnlKrw)}`,
            `realized_cost_basis_krw=${realizedCostBasisKrw === null ? "unknown" : Math.round(realizedCostBasisKrw)}`,
            `realized_sell_events=${realizedSellEventCount}`,
            ...provenance.descriptionTags,
          ].join("; "),
          isSample: false,
          cashValue: decimal(0),
          investedAmount: decimal(investedAmount),
          totalCost: decimal(totalCost),
          totalMarketValue: decimal(totalMarketValue),
          totalPnl: decimal(totalPnl),
          totalReturnPct: decimal(percentOrNull(totalPnl, investedAmount)),
          fxRate: decimal(fx.usdKrw),
          usdKrw: decimal(fx.usdKrw),
          krWeight: decimal(percentOrZero(krValue, totalMarketValue)),
          usWeight: decimal(percentOrZero(usValue, totalMarketValue)),
          usdExposurePct: decimal(percentOrZero(usdExposureValue, totalMarketValue)),
          thematicWeight: decimal(percentOrZero(thematicValue, totalMarketValue)),
          numAssets: sumBy(completed, (build) => build.positionCount),
          numGroups: new Set(
            accountBuilds.flatMap((build) =>
              build.positions
                .map((position) => position.legacyGroupId)
                .filter((groupId): groupId is string => Boolean(groupId)),
            ),
          ).size,
          topHoldingName: topHolding.name,
          topHoldingWeight: decimal(topHolding.weight),
          ...benchmark,
          capturedAt: cycle.capturedAt,
          cycleStartAt: cycle.cycleStartAt,
          cycleEndAt: cycle.cycleEndAt,
          base44CreatedAt: null,
          base44UpdatedAt: null,
        }
      : null;
  const preserveCompleted = existingPortfolio && isCompletedDailyPortfolio(existingPortfolio, existingPortfolio.cycleEndAt);
  const portfolioAction: SnapshotWriteAction =
    blockers.length > 0
      ? "blocked"
      : completed.length === 0
        ? "skip"
        : preserveCompleted
          ? "skip"
        : existingPortfolio
          ? "update"
          : "insert";

  return {
    account: "all",
    status: blockers.length > 0 ? "blocked" : preserveCompleted ? "skipped" : completed.length > 0 ? "planned" : "skipped",
    reason:
      blockers.length > 0
        ? "preflight_blocked"
        : completed.length > 0
          ? preserveCompleted ? "completed_cutoff_preserved" : null
          : "no_account_snapshots",
    accountsAggregated: completed.length,
    portfolioAction,
    totalMarketValue,
    totalCost,
    openCostKrw,
    unrealizedPnlKrw,
    realizedPnlKrw,
    realizedCostBasisKrw,
    realizedSellEventCount,
    unmatchedRealizedSellEventCount,
    missingCostRealizedSellEventCount,
    totalPnl,
    totalReturnPct: percentOrNull(totalPnl, investedAmount),
    blockers,
    portfolio: preserveCompleted ? existingPortfolio : portfolio,
    ...(preserveCompleted ? frozenPortfolioTotals(existingPortfolio) : {}),
    existingPortfolio,
  };
}

function computeAccountSnapshot({
  account,
  assets,
  context,
  fx,
  closeContext,
  cycle,
  snapshotDate,
  returnMetrics,
  priorPositions,
  provenance,
}: {
  account: TrackedAccount;
  assets: AssetRow[];
  context: AccountContext;
  fx: ResolvedFxRate;
  closeContext: CloseContext;
  cycle: InternalCycle;
  snapshotDate: string;
  returnMetrics: ReturnMetricsSummary;
  priorPositions: PositionRow[];
  provenance: SnapshotProvenance;
}): AccountComputed {
  const groupValueById = new Map<string, number>();
  const groupMembersById = new Map<string, AssetRow[]>();

  for (const asset of assets) {
    const price = selectPriceForAsset(asset, closeContext);
    const fxRate = assetFxRate(asset, fx);
    const value = assetValueKrw(asset, price.price, fxRate);
    if (asset.groupId) {
      groupValueById.set(asset.groupId, (groupValueById.get(asset.groupId) ?? 0) + value);
      const members = groupMembersById.get(asset.groupId) ?? [];
      members.push(asset);
      groupMembersById.set(asset.groupId, members);
    }
  }

  const totalMarketValue = sumBy(assets, (asset) => {
    const price = selectPriceForAsset(asset, closeContext);
    const fxRate = assetFxRate(asset, fx);
    return assetValueKrw(asset, price.price, fxRate);
  });
  const priorByAssetId = latestPriorPositionByAssetId(priorPositions, snapshotDate);
  let krValue = 0;
  let usValue = 0;
  let thematicValue = 0;
  let usdExposureValue = 0;

  const positions = assets.map((asset) => {
    const selectedPrice = selectPriceForAsset(asset, closeContext);
    const selectedClose = selectOfficialCloseForAsset(asset, closeContext);
    const valuationPrice = selectedPrice.price;
    const officialClosePrice =
      selectedClose.fromCloseSnapshot && selectedClose.price > 0 ? selectedClose.price : null;
    const fxResolution = resolveKrwFxRate(asset.currency, fx.usdKrw);
    const fxRate = fxResolution.ok ? fxResolution.rate : 0;
    const prior = priorByAssetId.get(asset.id) ?? null;
    const quantity = toNumber(asset.quantity) ?? 0;
    const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
    const fractionalAvgCost = toNumber(asset.fractionalAvgCost) ?? (fractionalKrwValue === 0 ? 0 : null);
    // A legacy entered KRW amount is not a fractional quantity. Preserve that
    // fixed input separately; only actual recorded shares receive price returns.
    const estimatedFractionalQuantity = fractionalKrwValue > 0 ? null : 0;
    const totalQuantity = quantity;
    const marketValueKrw = quantity * valuationPrice * fxRate + fractionalKrwValue;
    const marketValueLocal = fxRate > 0 ? marketValueKrw / fxRate : 0;
    const currentWeight = percentOrZero(marketValueKrw, totalMarketValue);
    const group = asset.groupId ? context.groupsById.get(asset.groupId) : null;
    const groupValue = asset.groupId ? groupValueById.get(asset.groupId) ?? 0 : 0;
    const groupMembers = asset.groupId ? groupMembersById.get(asset.groupId) ?? [] : [];
    const targetWeightRaw = toNumber(asset.targetWeight) ?? 0;
    const targetWeightEffective =
      group && toNumber(group.targetWeight) !== null
        ? groupValue > 0
          ? (marketValueKrw / groupValue) * (toNumber(group.targetWeight) ?? 0)
          : (toNumber(group.targetWeight) ?? 0) / Math.max(1, groupMembers.length)
        : targetWeightRaw;
    const previousUnitPrice =
      toNumber(prior?.unitPrice) ?? toNumber(prior?.closePrice) ?? null;
    const previousFxRate =
      toNumber(prior?.fxRate) ?? (fxResolution.ok && !fxResolution.requiresFx ? 1 : null);
    const previousUnitValueKrw =
      toNumber(prior?.unitValueKrw) ??
      (previousUnitPrice && previousFxRate
        ? previousUnitPrice * previousFxRate
        : null);
    const previousMarketValueKrw = toNumber(prior?.marketValueKrw);
    const unitValueKrw = valuationPrice * fxRate;
    const unitValueChangeKrw =
      previousUnitValueKrw && previousUnitValueKrw > 0
        ? unitValueKrw - previousUnitValueKrw
        : null;
    const unitValueChangePct =
      unitValueChangeKrw !== null && previousUnitValueKrw && previousUnitValueKrw > 0
        ? (unitValueChangeKrw / previousUnitValueKrw) * 100
        : null;
    const movementQuantity = quantity;
    const movementFixedKrwValue = fractionalKrwValue;
    const unchangedHolding = prior !== null &&
      toNumber(prior.quantity) === quantity &&
      (toNumber(prior.fractionalKrwValue) ?? 0) === fractionalKrwValue;
    const movement =
      unchangedHolding && previousUnitPrice && previousUnitPrice > 0 && previousFxRate && previousFxRate > 0
        ? calculateFxAwarePositionMovementKrw({
            marketExposedQuantity: movementQuantity,
            currentPrice: valuationPrice,
            previousPrice: previousUnitPrice,
            currentFxRate: fxRate,
            previousFxRate,
            fixedKrwValue: movementFixedKrwValue,
            previousMarketValueKrw,
          })
        : null;
    const marketValueChangeKrw =
      movement?.changeKrw ??
      (previousMarketValueKrw && previousMarketValueKrw > 0
        ? marketValueKrw - previousMarketValueKrw
        : null);
    const marketValueChangePct =
      marketValueChangeKrw !== null && previousMarketValueKrw && previousMarketValueKrw > 0
        ? (marketValueChangeKrw / previousMarketValueKrw) * 100
        : null;
    const priceChangeKrw = movement?.priceChangeKrw ?? null;
    const fxChangeKrw =
      fxResolution.ok && fxResolution.requiresFx
        ? movement?.fxChangeKrw ?? null
        : unchangedHolding ? 0 : null;
    const assetReturnMetrics = getAssetReturnMetrics(returnMetrics, asset, fx.usdKrw ?? 0);
    const costKrw = assetReturnMetrics.nativeCostBasis ? assetReturnMetrics.costBasisKrw : snapshotPositionCostBasisKrw(asset, fx.usdKrw ?? 0);
    const pnlKrw = costKrw === null ? null : marketValueKrw - costKrw;
    const exposureType = getFxExposureType(asset);

    if (asset.market === "korea") krValue += marketValueKrw;
    if (asset.market === "us") usValue += marketValueKrw;
    if (asset.maAssetClass === "thematic") thematicValue += marketValueKrw;
    if (exposureType === "US_LISTED") usdExposureValue += marketValueKrw;
    if (exposureType === "KR_UNHEDGED_GLOBAL") usdExposureValue += marketValueKrw * 0.5;

    const legacyGroup = asset.groupId ? context.groupsById.get(asset.groupId) : null;

    return {
      legacyBase44Id: null,
      canonicalOwnerUserId: context.ownerUserId,
      snapshotDate,
      assetId: asset.id,
      legacyAssetId: asset.legacyBase44Id,
      ticker: asset.ticker,
      assetName: asset.name,
      account,
      accountId: context.accountRowsByCode.get(account) ?? null,
      source: provenance.source,
      market: asset.market,
      currency: asset.currency,
      assetStatus: "active",
      assetType: asset.assetType,
      category: asset.category,
      sector: asset.category,
      sourceType: asset.ticker ? "broker" : "manual",
      exposureType,
      legacyGroupId: legacyGroup?.legacyBase44Id ?? null,
      groupName: legacyGroup?.name ?? null,
      priceSource: selectedPrice.source,
      priceBasis: selectedPrice.basis,
      description: [
        `source=${provenance.source}`,
        `price_basis=${selectedPrice.basis}`,
        ...(selectedPrice.manualCarrySnapshotId?[`manual_carry_snapshot=${selectedPrice.manualCarrySnapshotId}`,`manual_carry_captured_at=${selectedPrice.manualCarryCapturedAt}`]:[]),
        ...(selectedPrice.manualInputRecordedAt ? [`manual_input_recorded_at=${selectedPrice.manualInputRecordedAt}`] : []),
        `price_source=${selectedPrice.source}${selectedPrice.referenceDate ? `@${selectedPrice.referenceDate}` : ""}`,
        `close_source=${selectedClose.source}${selectedClose.referenceDate ? `@${selectedClose.referenceDate}` : ""}`,
        `fx_source=${fx.source}`,
        `price_observed_at=${selectedPrice.observedAt ?? "unknown"}`,
        `price_reference_at=${selectedPrice.referenceAt ?? selectedPrice.observedAt ?? "unknown"}`,
        `price_timestamp_basis=${selectedPrice.timestampBasis ?? "unknown"}`,
        `price_fetched_at=${selectedPrice.fetchedAt ?? "unknown"}`,
        `price_quote_type=${selectedPrice.quoteType ?? selectedPrice.basis}`,
        `fx_observed_at=${fx.observedAt ?? "unknown"}`,
        `fx_reference_at=${fx.referenceAt ?? fx.observedAt ?? "unknown"}`,
        `fx_timestamp_basis=${fx.timestampBasis ?? "unknown"}`,
        `fx_fetched_at=${fx.fetchedAt ?? "unknown"}`,
        `fx_rate_kind=${fx.rateKind ?? "unknown"}`,
        `cost_basis_source=${costKrw === null ? "unknown" : assetReturnMetrics.nativeCostBasis ? "native_remaining_cost" : "asset_average_cost"}`,
        ...(prior && !unchangedHolding ? ["movement_attribution=holdings_change_without_trade_bridge"] : []),
        ...(fractionalKrwValue > 0 ? ["fractional_value_basis=entered_krw_amount", "fractional_quantity_basis=unknown"] : []),
        ...provenance.descriptionTags,
      ].join("; "),
      belowMa: false,
      isSample: false,
      quantity: decimal(quantity, 8),
      totalQuantity: decimal(totalQuantity, 8),
      estimatedFractionalQuantity: decimal(estimatedFractionalQuantity, 8),
      avgCost: assetReturnMetrics.nativeCostBasis
        ? asset.currency === "KRW" && costKrw !== null && quantity > 0 ? decimal(costKrw / quantity) : null
        : decimal(toNumber(asset.averageCost)),
      currentPrice: decimal(valuationPrice),
      closePrice: decimal(officialClosePrice),
      unitPrice: decimal(valuationPrice),
      unitValueKrw: decimal(unitValueKrw),
      marketValueLocal: decimal(marketValueLocal),
      marketValueKrw: decimal(marketValueKrw),
      costKrw: decimal(costKrw),
      pnlKrw: decimal(pnlKrw),
      pnlPct: decimal(percentOrNull(pnlKrw, costKrw)),
      currentWeight: decimal(currentWeight),
      targetWeight: decimal(targetWeightRaw),
      targetWeightRaw: decimal(targetWeightRaw),
      targetWeightEffective: decimal(targetWeightEffective),
      trimTargetWeight: decimal(targetWeightEffective),
      driftPct: decimal(
        targetWeightEffective > 0
          ? ((currentWeight - targetWeightEffective) / targetWeightEffective) * 100
          : 0,
      ),
      fxRate: decimal(fxRate),
      previousFxRate: decimal(previousFxRate),
      previousQuantity: decimal(
        toNumber(prior?.totalQuantity) ?? toNumber(prior?.quantity),
        8,
      ),
      previousUnitPrice: decimal(previousUnitPrice),
      previousUnitValueKrw: decimal(previousUnitValueKrw),
      previousMarketValueKrw: decimal(previousMarketValueKrw),
      priceChangeKrw: decimal(priceChangeKrw),
      fxChangeKrw: decimal(fxChangeKrw),
      marketValueChangeKrw: decimal(marketValueChangeKrw),
      marketValueChangePct: decimal(marketValueChangePct),
      unitValueChangeKrw: decimal(unitValueChangeKrw),
      unitValueChangePct: decimal(unitValueChangePct),
      ma120: null,
      fractionalKrwValue: decimal(fractionalKrwValue),
      fractionalAvgCost: decimal(fractionalAvgCost),
      priceDate: selectedPrice.referenceDate,
      referenceDate: selectedPrice.referenceDate,
      fxReferenceDate:
        fxResolution.ok && fxResolution.requiresFx ? fx.referenceDate : null,
      previousReferenceDate: prior?.referenceDate ?? prior?.priceDate ?? null,
      previousSnapshotDate: prior?.snapshotDate ?? null,
      capturedAt: cycle.capturedAt,
      cycleStartAt: cycle.cycleStartAt,
      cycleEndAt: cycle.cycleEndAt,
      sourceCreatedAt: cycle.capturedAt,
      base44CreatedAt: null,
      base44UpdatedAt: null,
    };
  });

  const selectedAssetKeys = new Set(assets.map((asset) => assetMetricKey(asset)));
  const accountRealized = summarizeRealizedReturnForAccount(
    returnMetrics,
    account,
    selectedAssetKeys,
  );
  const realizedPnlKrw = accountRealized.realizedPnlKrw;
  const realizedCostBasisKrw = accountRealized.realizedCostBasisKrw;
  const { openCostKrw, unrealizedPnlKrw, totalCost, totalPnl } = summarizeSnapshotCostEvidence(
    positions.map((position) => ({ costKrw: toNumber(position.costKrw), pnlKrw: toNumber(position.pnlKrw) })),
    realizedCostBasisKrw, realizedPnlKrw,
  );
  const topHolding = findTopHolding(positions, totalMarketValue);

  return {
    account,
    assets,
    positions,
    totalMarketValue,
    totalCost,
    totalPnl,
    totalReturnPct: percentOrNull(totalPnl, totalCost),
    investedAmount: totalCost,
    openCostKrw,
    unrealizedPnlKrw,
    realizedPnlKrw,
    realizedCostBasisKrw,
    realizedSellEventCount: accountRealized.realizedSellEventCount,
    unmatchedRealizedSellEventCount: accountRealized.unmatchedSellEventCount,
    missingCostRealizedSellEventCount: accountRealized.missingCostSellEventCount,
    krValue,
    usValue,
    thematicValue,
    usdExposureValue,
    topHoldingName: topHolding.name,
    topHoldingWeight: topHolding.weight,
    groupCount: new Set(assets.map((asset) => asset.groupId).filter(Boolean)).size,
    provenance,
  };
}

function buildPortfolioSnapshot(
  computed: AccountComputed,
  context: AccountContext,
  fx: ResolvedFxRate,
): NewDailyPortfolioSnapshot {
  const benchmark = getBenchmarkFields(context);
  return {
    legacyBase44Id: null,
    canonicalOwnerUserId: context.ownerUserId,
    snapshotDate: computed.positions[0]?.snapshotDate ?? "",
    account: computed.account,
    accountId: context.accountRowsByCode.get(computed.account) ?? null,
    source: computed.provenance.source,
    ruleVersion: computed.provenance.ruleVersion,
    description: [
      "snapshot_status=complete",
      `source=${computed.provenance.source}`,
      `expected_positions=${computed.positions.length}`,
      `valuation_basis=${portfolioValuationBasis(computed.provenance)}`,
      `fx_source=${fx.source}`,
      "return_basis=unrealized_plus_event_ledger_realized_v1",
      `open_cost_krw=${computed.openCostKrw === null ? "unknown" : Math.round(computed.openCostKrw)}`,
      `realized_pnl_krw=${computed.realizedPnlKrw === null ? "unknown" : Math.round(computed.realizedPnlKrw)}`,
      `realized_cost_basis_krw=${computed.realizedCostBasisKrw === null ? "unknown" : Math.round(computed.realizedCostBasisKrw)}`,
      `realized_sell_events=${computed.realizedSellEventCount}`,
      ...computed.provenance.descriptionTags,
    ].join("; "),
    isSample: false,
    cashValue: decimal(0),
    investedAmount: decimal(computed.investedAmount),
    totalCost: decimal(computed.totalCost),
    totalMarketValue: decimal(computed.totalMarketValue),
    totalPnl: decimal(computed.totalPnl),
    totalReturnPct: decimal(computed.totalReturnPct),
    fxRate: decimal(fx.usdKrw),
    usdKrw: decimal(fx.usdKrw),
    krWeight: decimal(percentOrZero(computed.krValue, computed.totalMarketValue)),
    usWeight: decimal(percentOrZero(computed.usValue, computed.totalMarketValue)),
    usdExposurePct: decimal(
      percentOrZero(computed.usdExposureValue, computed.totalMarketValue),
    ),
    thematicWeight: decimal(
      percentOrZero(computed.thematicValue, computed.totalMarketValue),
    ),
    numAssets: computed.positions.length,
    numGroups: computed.groupCount,
    topHoldingName: computed.topHoldingName,
    topHoldingWeight: decimal(computed.topHoldingWeight),
    ...benchmark,
    regimeLabel: context.latestRegime?.label ?? null,
    regimeScore: decimal(toNumber(context.latestRegime?.regimeScore)),
    avgCorrelation: decimal(toNumber(context.latestRegime?.avgCorrelation)),
    enb: decimal(toNumber(context.latestRegime?.enb)),
    portfolioVolatility: decimal(toNumber(context.latestRegime?.portfolioVolatility)),
    capturedAt: computed.positions[0]?.capturedAt ?? null,
    cycleStartAt: computed.positions[0]?.cycleStartAt ?? null,
    cycleEndAt: computed.positions[0]?.cycleEndAt ?? null,
    base44CreatedAt: null,
    base44UpdatedAt: null,
  };
}

async function applySnapshotWrites(
  accountBuilds: AccountSnapshotBuild[],
  allBuild: AllAccountSnapshotBuild | null,
  insertOnly: boolean,
  expectedAssets:(Asset & { revisionToken: string })[],
  cutoff:Date,
  expectedEvents:Awaited<ReturnType<typeof loadEventRows>>,
  snapshotDate:string,
) {
  const queries: unknown[] = [];

  for (const build of accountBuilds) {
    if (build.status !== "planned" || !build.portfolio) continue;
    pushPositionWriteQueries(
      queries,
      build.positions,
      build.existingPositionsByKey,
      insertOnly,
    );
    pushPortfolioWriteQuery(
      queries,
      build.portfolio,
      build.existingPortfolio,
      insertOnly,
    );
  }

  if (allBuild?.status === "planned" && allBuild.portfolio) {
    pushPortfolioWriteQuery(
      queries,
      allBuild.portfolio,
      allBuild.existingPortfolio,
      insertOnly,
    );
  }

  if (queries.length === 0) return;
  const fence=snapshotFence.getStore();
  const owner=accountBuilds.find(b=>b.portfolio)?.portfolio?.canonicalOwnerUserId ?? allBuild?.portfolio?.canonicalOwnerUserId;
  if(!owner) throw new Error("snapshot_owner_missing");
  await sqlClient.transaction(tx=>[
    tx.query("select set_config('lock_timeout','2s',true),set_config('app.trade_reliability_version','0059',true)"),tx.query("set local statement_timeout='15s'"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`varda.portfolio_mutation.v1:${owner}`]),
    ...(fence ? [tx.query("select assert_daily_snapshot_fence($1::uuid,$2)",[fence.id,fence.generation])] : []),
    // A second writer may have completed this cutoff after planning but before
    // the owner lock. Abort atomically; its retry will reuse the completed row.
    tx.query(`select 1/(case when not exists(select 1 from daily_portfolio_snapshots s
      where s.canonical_owner_user_id=$1::uuid and s.snapshot_date=$2::date and s.account=any($3::text[])
       and s.source=$4 and not s.is_sample and s.description like '%snapshot_status=complete%'
       and s.cycle_end_at is not null and s.num_assets>0
       and (s.account='all' or s.num_assets=(select count(*) from daily_position_snapshots p where p.canonical_owner_user_id=s.canonical_owner_user_id
         and p.account_id=s.account_id and p.snapshot_date=s.snapshot_date and p.source=s.source and not p.is_sample and p.cycle_end_at=s.cycle_end_at)))
      then 1 else 0 end)`,[owner,snapshotDate,[...accountBuilds.filter(b=>b.status==="planned"&&b.portfolio).map(b=>b.account),...(allBuild?.status==="planned"&&allBuild.portfolio?["all"]:[])],SNAPSHOT_SOURCE]),
    tx.query(`with expected as (select * from jsonb_to_recordset($2::jsonb) as x(id uuid,quantity numeric,"updatedAt" timestamptz)), actual as (
      select h.id,h.quantity,h.updated_at from assets h join accounts a on a.id=h.account_id
      where a.canonical_owner_user_id=$1::uuid and a.is_active and ${holdingsPortfolioSql("a")} and a.code=any($3::text[]) and (h.archived_at is null or h.archived_at>$4::timestamptz)
    ) select 1/(case when not exists(select 1 from expected e full join actual a on a.id=e.id where e.id is null or a.id is null or a.quantity is distinct from e.quantity or a.updated_at is distinct from e."updatedAt") then 1 else 0 end)`,[owner,JSON.stringify(expectedAssets.map(a=>({id:a.id,quantity:a.quantity,updatedAt:a.revisionToken}))),accountBuilds.map(b=>b.account),cutoff.toISOString()]),
    tx.query(`with expected as (select * from jsonb_to_recordset($2::jsonb) as x(id uuid,"updatedAt" timestamptz)), actual as (
      select e.id,e.updated_at from event_ledger_entries e join accounts a on a.id=e.account_id and a.code=e.account
      where a.canonical_owner_user_id=$1::uuid and a.is_active and a.code=any($3::text[]) and e.event_date<=$4::date
    ) select 1/(case when not exists(select 1 from expected e full join actual a on a.id=e.id where e.id is null or a.id is null or a.updated_at is distinct from e."updatedAt") then 1 else 0 end)`,[owner,JSON.stringify(expectedEvents.map(e=>({id:e.id,updatedAt:e.revisionToken}))),accountBuilds.map(b=>b.account),snapshotDate]),
    ...queries.map(q=>{ const statement=(q as {toSQL:()=>{sql:string;params:unknown[]}}).toSQL(); return tx.query(statement.sql,statement.params); }),
  ],{isolationLevel:"ReadCommitted"});
}

function pushPortfolioWriteQuery(
  queries: unknown[],
  portfolio: NewDailyPortfolioSnapshot,
  existing: PortfolioRow | null,
  insertOnly: boolean,
) {
  if (existing) {
    if (insertOnly) {
      throw new Error("insert-only snapshot backfill cannot update a portfolio row");
    }
    queries.push(
      db
        .update(dailyPortfolioSnapshots)
        .set({ ...portfolio, updatedAt: new Date() })
        .where(
          and(
            eq(dailyPortfolioSnapshots.id, existing.id),
            eq(
              dailyPortfolioSnapshots.canonicalOwnerUserId,
              portfolio.canonicalOwnerUserId!,
            ),
          ),
        ),
    );
    return;
  }

  queries.push(db.insert(dailyPortfolioSnapshots).values(portfolio));
}

function pushPositionWriteQueries(
  queries: unknown[],
  positions: NewDailyPositionSnapshot[],
  existingByKey: Map<string, PositionRow>,
  insertOnly: boolean,
) {
  const inserts: NewDailyPositionSnapshot[] = [];

  for (const position of positions) {
    const existing = existingByKey.get(positionKey(position));
    if (!existing) {
      inserts.push(position);
      continue;
    }

    if (insertOnly) {
      throw new Error("insert-only snapshot backfill cannot update a position row");
    }

    queries.push(
      db
        .update(dailyPositionSnapshots)
        .set({ ...position, updatedAt: new Date() })
        .where(
          and(
            eq(dailyPositionSnapshots.id, existing.id),
            eq(
              dailyPositionSnapshots.canonicalOwnerUserId,
              position.canonicalOwnerUserId!,
            ),
          ),
        ),
    );
  }

  if (inserts.length > 0) {
    queries.push(db.insert(dailyPositionSnapshots).values(inserts));
  }
}

async function loadAccountContext(
  snapshotDate: string,
  ownerUserId: string,
): Promise<AccountContext> {
  const [
    accountRows,
    groupRows,
    regimeRows,
    kospiBenchmarkRows,
    vooBenchmarkRows,
  ] = await Promise.all([
    db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.canonicalOwnerUserId, ownerUserId),
          eq(accounts.isActive, true),
          ne(accounts.accountType, "cash"),
        ),
      )
      .orderBy(asc(accounts.sortOrder), asc(accounts.code)),
    db
      .selectDistinct(getTableColumns(assetGroups))
      .from(assetGroups)
      .innerJoin(assets, eq(assets.groupId, assetGroups.id))
      .innerJoin(accounts, eq(assets.accountId, accounts.id))
      .where(
        and(
          eq(accounts.canonicalOwnerUserId, ownerUserId),
          eq(accounts.isActive, true),
          isNull(assets.archivedAt),
        ),
      ),
    db
      .select()
      .from(marketRegimeDaily)
      .where(
        and(
          eq(marketRegimeDaily.account, "all"),
          eq(marketRegimeDaily.canonicalOwnerUserId, ownerUserId),
          lte(marketRegimeDaily.regimeDate, snapshotDate),
        ),
      )
      .orderBy(desc(marketRegimeDaily.regimeDate))
      .limit(1),
    db
      .select()
      .from(benchmarkSnapshots)
      .where(
        and(
          eq(benchmarkSnapshots.benchmarkTicker, "069500"),
          lte(benchmarkSnapshots.benchmarkDate, snapshotDate),
        ),
      )
      .orderBy(desc(benchmarkSnapshots.benchmarkDate))
      .limit(1),
    db
      .select()
      .from(benchmarkSnapshots)
      .where(
        and(
          eq(benchmarkSnapshots.benchmarkTicker, "VOO"),
          lte(benchmarkSnapshots.benchmarkDate, snapshotDate),
        ),
      )
      .orderBy(desc(benchmarkSnapshots.benchmarkDate))
      .limit(1),
  ]);

  return {
    ownerUserId,
    activeAccountCodes: Object.freeze(accountRows.map((account) => account.code)),
    accountRowsByCode: new Map(accountRows.map((account) => [account.code, account.id])),
    groupsById: new Map(groupRows.map((group) => [group.id, group])),
    latestRegime: regimeRows[0] ?? null,
    benchmarkByTicker: new Map(
      [kospiBenchmarkRows[0], vooBenchmarkRows[0]]
        .filter((row): row is BenchmarkSnapshot => Boolean(row))
        .map((row) => [row.benchmarkTicker, row]),
    ),
  };
}

async function loadEventRows(snapshotDate: string, ownerUserId: string) {
  return db
    .select({ ...getTableColumns(eventLedgerEntries), revisionToken: sql<string>`${eventLedgerEntries.updatedAt}::text` })
    .from(eventLedgerEntries)
    .innerJoin(
      accounts,
      and(
        eq(eventLedgerEntries.accountId, accounts.id),
        eq(eventLedgerEntries.account, accounts.code),
      ),
    )
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, ownerUserId),
        eq(accounts.isActive, true),
        lte(eventLedgerEntries.eventDate, snapshotDate),
      ),
    )
    .orderBy(eventLedgerEntries.eventDate);
}

function buildRealizedReturnRunSummary(
  summary: ReturnMetricsSummary,
  targetAccounts: TrackedAccount[],
  selectedAssets: AssetRow[],
  snapshotDate: string,
): RealizedReturnRunSummary {
  const assetsByAccount = new Map<string, Set<string>>();
  for (const account of targetAccounts) {
    assetsByAccount.set(account, new Set<string>());
  }
  for (const asset of selectedAssets) {
    if (targetAccounts.includes(asset.account)) {
      assetsByAccount.get(asset.account)?.add(assetMetricKey(asset));
    }
  }

  const accountSummaries = targetAccounts.map((account) =>
    summarizeRealizedReturnForAccount(
      summary,
      account,
      assetsByAccount.get(account) ?? new Set<string>(),
    ),
  );

  return {
    asOfDate: summary.asOfDate ?? snapshotDate,
    tradeEventCount: summary.tradeEventCount,
    buyEventCount: summary.buyEventCount,
    sellEventCount: summary.sellEventCount,
    realizedSellEventCount: summary.realizedSellEventCount,
    skippedBuyEventCount: summary.skippedBuyEventCount,
    unmatchedSellEventCount: summary.unmatchedSellEventCount,
    missingCostSellEventCount: summary.missingCostSellEventCount,
    realizedPnlKrw: sumComplete(accountSummaries, (account) => account.realizedPnlKrw),
    realizedCostBasisKrw: sumComplete(
      accountSummaries,
      (account) => account.realizedCostBasisKrw,
    ),
    accounts: accountSummaries,
  };
}

async function resolveSnapshotFx(
  snapshotDate: string,
  fxAsOfDate = snapshotDate,
  cutoffAt: Date | null = null,
  retainedRows: Awaited<ReturnType<typeof readSnapshotCutoffObservations>>["fxRows"] = [],
  required = true,
  executionAt: Date | null = null,
): Promise<ResolvedFxRate> {
  const rows = await db
    .select()
    .from(fxRates)
    .where(and(
      lte(fxRates.rateDate, fxAsOfDate),
      eq(fxRates.isSample, false),
      eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
      sql`${fxRates.usdKrw} > 0 and ${fxRates.usdKrw} < 'Infinity'::numeric`,
      executionAt ? lte(fxRates.fetchedAt, executionAt) : cutoffAt ? lte(fxRates.fetchedAt, cutoffAt) : undefined,
    ))
    .orderBy(desc(fxRates.rateDate), desc(fxRates.fetchedAt), desc(fxRates.createdAt))
    .limit(32);
  const row = executionAt
    ? selectSnapshotExecutionFx(rows, fxAsOfDate, executionAt)
    : selectSnapshotCutoffFx([...rows, ...retainedRows], fxAsOfDate, cutoffAt);

  const usdKrw = toNumber(row?.usdKrw);
  if (!row || usdKrw === null || usdKrw <= 0) {
    if (!required) return { usdKrw: null, referenceDate: null, source: "not_required_for_krw_valuation", status: "not_required", observedAt: null, fetchedAt: null, rateKind: null };
    throw new DailySnapshotRequestError(
      "missing_fx_rate",
      "A USD/KRW FX rate is required before writing a daily snapshot",
      { snapshotDate, fxAsOfDate, cutoffAt: cutoffAt?.toISOString() ?? null },
      409,
    );
  }

  return {
    usdKrw,
    referenceDate: row.rateDate,
    source: row.source ? `fx_rates:${row.source}@${row.rateDate}` : `fx_rates@${row.rateDate}`,
    status: row.status,
    observedAt: "providerObservedAt" in row ? isoTimestamp(row.providerObservedAt) : isoTimestamp(row.observedAt),
    fetchedAt: isoTimestamp(row.fetchedAt),
    rateKind: row.rateKind,
    referenceAt: executionAt ? isoTimestamp(row.fetchedAt) : isoTimestamp(row.observedAt),
    timestampBasis: executionAt ? "collection" : "timestampBasis" in row && row.timestampBasis === "collection" ? "collection" : "provider",
  };
}

type CloseContext = {
  rowsByInstrument: Map<string, PriceRow[]>;
  selectedByAssetId: Map<string, PriceSelection>;
  valuationByAssetId: Map<string, PriceSelection>;
  referencesByMarket: Map<string, CloseReferenceSummary>;
  closeReferences: CloseReferenceSummary[];
  manualCarryMissing: ReadonlyArray<{
    assetId: string;
    assetName: string;
    account: string;
  }>;
};

async function buildCloseContext({
  snapshotDate,
  assets: targetAssets,
  ownerUserId,
  manualValuation,
  capturedAt,
  cycleEndAt,
  useCutoffValuation,
  useExecutionValuation,
  retainedQuotes,
}: {
  snapshotDate: string;
  assets: AssetRow[];
  ownerUserId: string;
  manualValuation: SnapshotWritePolicySummary["manualValuation"];
  capturedAt: Date;
  cycleEndAt: Date;
  useCutoffValuation: boolean;
  useExecutionValuation: boolean;
  retainedQuotes: Awaited<ReturnType<typeof readSnapshotCutoffObservations>>["quotes"];
}): Promise<CloseContext> {
  const instruments = targetAssets.map(({ market, currency, ticker }) => ({
    market,
    currency,
    ticker,
  }));
  const priceRows =
    instruments.length > 0
      ? await db
          .select()
          .from(assetPriceSnapshots)
          .where(and(
            assetPriceSnapshotInstrumentCondition(instruments),
            eq(assetPriceSnapshots.isSample, false),
          ))
          .orderBy(desc(assetPriceSnapshots.priceDate))
          .limit(Math.max(400, instruments.length * 40))
      : [];
  const rowsByInstrument = groupPriceRowsByInstrument(priceRows);
  const liveTickers = uniqueStrings(
    targetAssets
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const liveRows: LivePriceRow[] =
    useCutoffValuation && liveTickers.length > 0
      ? await db
          .select()
          .from(livePriceQuotes)
          .where(
            and(
              eq(livePriceQuotes.provider, "kis"),
              eq(livePriceQuotes.status, "ok"),
              inArray(livePriceQuotes.ticker, liveTickers),
              lte(livePriceQuotes.fetchedAt, cycleEndAt),
            ),
          )
          .orderBy(desc(livePriceQuotes.fetchedAt))
          .limit(Math.max(100, liveTickers.length * 4))
      : [];

  const closeReferences = buildCloseReferences(
    targetAssets,
    rowsByInstrument,
    snapshotDate,
  );
  const referencesByMarket = new Map(
    closeReferences.map((reference) => [reference.market, reference]),
  );
  const manualCarryByAssetId =
    manualValuation === "latest_prior_generated_snapshot_carry"
      ? await loadManualCarrySelections({
          ownerUserId,
          snapshotDate,
          assets: targetAssets,
        })
      : useCutoffValuation && !useExecutionValuation ? await loadStoredManualCutoffSelections(ownerUserId,snapshotDate,targetAssets,cycleEndAt) : new Map<string, PriceSelection>();
  const manualCarryMissing =
    manualValuation === "latest_prior_generated_snapshot_carry"
      ? targetAssets
          .filter((asset) => !normalizeTicker(asset.ticker))
          .filter((asset) => !manualCarryByAssetId.has(asset.id))
          .map((asset) => ({
            assetId: asset.id,
            assetName: asset.name,
            account: asset.account,
          }))
      : [];
  const selectedByAssetId = new Map<string, PriceSelection>();
  const valuationByAssetId = new Map<string, PriceSelection>();
  for (const asset of targetAssets) {
    const closeSelection =
      manualCarryByAssetId.get(asset.id) ??
        selectClosePriceForAsset(
          asset,
          snapshotDate,
          rowsByInstrument,
          referencesByMarket,
        );
    if (useExecutionValuation && !normalizeTicker(asset.ticker) && asset.priceAsOf == null) {
      // This is the saved manual input, not a newly observed market quote.
      closeSelection.manualInputRecordedAt = isoTimestamp(asset.updatedAt ?? asset.createdAt);
      closeSelection.referenceAt = closeSelection.manualInputRecordedAt;
    }
    selectedByAssetId.set(asset.id, closeSelection);

    const cutoffValuation = useCutoffValuation
      ? selectSnapshotCutoffValuation({
          instrument: asset,
          rows: [...liveRows, ...retainedQuotes],
          capturedAt,
          cycleEndAt,
          officialClose: closeSelection,
        })
      : null;
    const cutoffQuote = cutoffValuation?.basis === "cutoff_live"
      ? cutoffValuation.quote
      : null;
    valuationByAssetId.set(
      asset.id,
      cutoffQuote
        ? {
            row: null,
            price: cutoffQuote.price,
            source: cutoffQuote.row.source,
            referenceDate: dateFromTimestamp(cutoffQuote.referenceAt),
            calendarReferenceDate: closeSelection.calendarReferenceDate,
            expectedCloseDate: closeSelection.expectedCloseDate,
            basis: "cutoff_live",
            fromCloseSnapshot: false,
            observedAt: "observedAt" in cutoffQuote.row ? isoTimestamp(cutoffQuote.row.observedAt) : null,
            fetchedAt: cutoffQuote.fetchedAt.toISOString(),
            quoteType: cutoffQuote.row.quoteType,
            referenceAt: cutoffQuote.referenceAt.toISOString(),
            timestampBasis: "timestampBasis" in cutoffQuote.row && cutoffQuote.row.timestampBasis === "provider" ? "provider" : "collection",
          }
        : cutoffValuation?.basis === "close"
          ? cutoffValuation.close
          : closeSelection,
    );
  }

  return {
    rowsByInstrument,
    selectedByAssetId,
    valuationByAssetId,
    referencesByMarket,
    closeReferences,
    manualCarryMissing,
  };
}

function summarizeCutoffValuation({
  selectedAssets,
  closeContext,
  required,
  cycleEndAt,
  executionValuation,
}: {
  selectedAssets: AssetRow[];
  closeContext: CloseContext;
  required: boolean;
  cycleEndAt: Date;
  executionValuation: boolean;
}): CutoffValuationSummary {
  const requiredAssets = required ? selectedAssets : [];
  const observedCount = selectedAssets.filter(
    (asset) => closeContext.valuationByAssetId.get(asset.id)?.basis === "cutoff_live",
  ).length;
  const missing = requiredAssets
    .filter(
      (asset) => {
        const selected = closeContext.valuationByAssetId.get(asset.id);
        if (!normalizeTicker(asset.ticker)) {
          return !hasRecordedManualValuation(asset, selected, cycleEndAt, executionValuation);
        }
        return !selected || (
          selected.basis !== "cutoff_live" &&
          !isSnapshotCutoffOfficialClose(selected, cycleEndAt)
        );
      },
    )
    .map((asset) => ({
      assetId: asset.id,
      ticker: normalizeTicker(asset.ticker) ?? "",
      name: asset.name,
      account: asset.account,
      market: asset.market,
      currency: asset.currency,
    }));

  return {
    policy: executionValuation ? "execution_quote_else_exact_official_close" : "pre_cutoff_kis_quote_else_exact_official_close",
    maxQuoteAgeMinutes: SNAPSHOT_CUTOFF_QUOTE_MAX_AGE_MS / 60_000,
    requiredCount: requiredAssets.length,
    observedCount,
    fallbackCount: selectedAssets.length - observedCount - missing.length,
    missing,
  };
}

function hasRecordedManualValuation(asset: AssetRow, selected: PriceSelection | undefined, cutoffAt: Date, executionValuation: boolean) {
  if (!selected || selected.basis !== "manual_current") return false;
  if(selected.manualCarryCapturedAt)return new Date(selected.manualCarryCapturedAt)<cutoffAt;
  const quantity = toNumber(asset.quantity) ?? 0;
  // Amount-only legacy holdings retain the input timestamp and amount; they
  // neither acquire invented shares nor require a market quote for that amount.
  const recordedAt = quantity === 0 && (toNumber(asset.fractionalKrwValue) ?? 0) > 0
    ? isoTimestamp(asset.updatedAt ?? asset.createdAt)
    : isoTimestamp(asset.priceAsOf) ?? (executionValuation && asset.priceAsOf == null ? selected.manualInputRecordedAt ?? null : null);
  return recordedAt !== null && new Date(recordedAt) < cutoffAt &&
    (quantity === 0 || selected.price > 0);
}

async function loadStoredManualCutoffSelections(ownerUserId:string,snapshotDate:string,targetAssets:AssetRow[],cutoff:Date){
 const selections=new Map<string,PriceSelection>();
 const manual=targetAssets.filter(a=>!normalizeTicker(a.ticker)&&!a.priceAsOf);
 if(!manual.length)return selections;
 const rows=await db.select().from(dailyPositionSnapshots).where(and(
  eq(dailyPositionSnapshots.canonicalOwnerUserId,ownerUserId),inArray(dailyPositionSnapshots.assetId,manual.map(a=>a.id)),
  lt(dailyPositionSnapshots.snapshotDate,snapshotDate),eq(dailyPositionSnapshots.isSample,false),
  brokerRecoverySnapshotPredicate("daily_position_snapshots"),
 )).orderBy(desc(dailyPositionSnapshots.snapshotDate),desc(dailyPositionSnapshots.capturedAt));
 for(const row of rows){const asset=manual.find(a=>a.id===row.assetId);if(!asset||selections.has(asset.id))continue;
  const carry=resolveStoredManualCutoffCarry(asset,row,snapshotDate,cutoff);
  if(carry)selections.set(asset.id,{...carry,row:null,calendarReferenceDate:null,expectedCloseDate:null,basis:"manual_current",fromCloseSnapshot:false,quoteType:"stored_manual_carry"});
 }
 return selections;
}

async function loadManualCarrySelections({
  ownerUserId,
  snapshotDate,
  assets: targetAssets,
}: {
  ownerUserId: string;
  snapshotDate: string;
  assets: AssetRow[];
}) {
  const manualAssetIds = targetAssets
    .filter((asset) => !normalizeTicker(asset.ticker))
    .map((asset) => asset.id);
  const selections = new Map<string, PriceSelection>();
  if (manualAssetIds.length === 0) return selections;

  const rows = await db
    .select()
    .from(dailyPositionSnapshots)
    .where(
      and(
        eq(dailyPositionSnapshots.canonicalOwnerUserId, ownerUserId),
        eq(dailyPositionSnapshots.source, SNAPSHOT_SOURCE),
        lt(dailyPositionSnapshots.snapshotDate, snapshotDate),
        inArray(dailyPositionSnapshots.assetId, manualAssetIds),
        brokerRecoverySnapshotPredicate("daily_position_snapshots"),
      ),
    )
    .orderBy(desc(dailyPositionSnapshots.snapshotDate));

  for (const row of rows) {
    if (!row.assetId || selections.has(row.assetId)) continue;
    const price =
      toNumber(row.currentPrice) ??
      toNumber(row.unitPrice) ??
      toNumber(row.closePrice);
    const referenceDate = row.referenceDate ?? row.priceDate ?? row.snapshotDate;
    if (price === null || price <= 0 || referenceDate > snapshotDate) continue;
    selections.set(row.assetId, {
      row: null,
      price,
      source: row.priceSource ?? "stored_manual_snapshot",
      referenceDate,
      calendarReferenceDate: null,
      expectedCloseDate: null,
      basis: "manual_current",
      fromCloseSnapshot: false,
    });
  }

  return selections;
}

function buildCloseReferences(
  targetAssets: AssetRow[],
  rowsByInstrument: Map<string, PriceRow[]>,
  snapshotDate: string,
): CloseReferenceSummary[] {
  const requiredAssets = targetAssets.filter((asset) => normalizeTicker(asset.ticker));
  const assetsByMarket = new Map<string, AssetRow[]>();

  for (const asset of requiredAssets) {
    const market = closeMarketKeyForAsset(asset);
    const rows = assetsByMarket.get(market) ?? [];
    rows.push(asset);
    assetsByMarket.set(market, rows);
  }

  return Array.from(assetsByMarket.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([market, marketAssets]) => {
      const calendarReferenceDate = closeCalendarReferenceDateForAsset(
        marketAssets[0],
        snapshotDate,
      );
      const requiredTickerCount = uniqueStrings(
        marketAssets
          .map((asset) => normalizeTicker(asset.ticker))
          .filter((ticker): ticker is string => Boolean(ticker)),
      ).length;
      const availableTickersByDate = new Map<string, Set<string>>();

      for (const asset of marketAssets) {
        const ticker = normalizeTicker(asset.ticker);
        if (!ticker) continue;

        for (const row of priceRowsForInstrument(rowsByInstrument, asset)) {
          if (row.priceDate > calendarReferenceDate) continue;
          if (!isPositiveCloseRow(row)) continue;
          if (!isFreshCloseRow(row.priceDate, calendarReferenceDate)) continue;

          const tickers = availableTickersByDate.get(row.priceDate) ?? new Set<string>();
          tickers.add(ticker);
          availableTickersByDate.set(row.priceDate, tickers);
        }
      }

      const latestAvailableCloseDate =
        Array.from(availableTickersByDate.keys()).sort((left, right) =>
          right.localeCompare(left),
        )[0] ?? null;
      const exactReferenceRows =
        availableTickersByDate.get(calendarReferenceDate)?.size ?? 0;
      const selectedReferenceRows =
        availableTickersByDate.get(calendarReferenceDate)?.size ?? 0;
      const status =
        exactReferenceRows >= requiredTickerCount
          ? "ready"
          : exactReferenceRows > 0
            ? "partial"
            : "missing";

      return {
        market,
        requiredCount: marketAssets.length,
        requiredTickerCount,
        calendarReferenceDate,
        expectedCloseDate: calendarReferenceDate,
        latestAvailableCloseDate,
        exactReferenceRows,
        selectedReferenceRows,
        status,
        reason:
          status === "ready"
            ? "calendar_reference_has_close_rows"
            : status === "partial"
              ? "calendar_reference_has_partial_close_rows"
            : "no_close_rows_on_expected_market_reference_date",
      };
    });
}

function fallbackCloseReferenceForAsset(
  asset: Pick<AssetRow, "market" | "currency">,
  snapshotDate: string,
): CloseReferenceSummary {
  const market = closeMarketKeyForAsset(asset);
  const calendarReferenceDate = closeCalendarReferenceDateForAsset(asset, snapshotDate);

  return {
    market,
    requiredCount: 1,
    requiredTickerCount: 1,
    calendarReferenceDate,
    expectedCloseDate: calendarReferenceDate,
    latestAvailableCloseDate: null,
    exactReferenceRows: 0,
    selectedReferenceRows: 0,
    status: "missing",
    reason: "no_close_reference_context",
  };
}

function selectClosePriceForAsset(
  asset: AssetRow,
  snapshotDate: string,
  rowsByInstrument: Map<string, PriceRow[]>,
  referencesByMarket: Map<string, CloseReferenceSummary>,
): PriceSelection {
  const ticker = normalizeTicker(asset.ticker);
  const fallbackPrice = toNumber(asset.currentPrice) ?? 0;
  if (!ticker) {
    return {
      row: null,
      price: fallbackPrice,
      source: asset.priceSource ?? "asset_current_price",
      referenceDate: dateFromTimestamp(asset.priceAsOf),
      calendarReferenceDate: null,
      expectedCloseDate: null,
      basis: "manual_current",
      fromCloseSnapshot: false,
      observedAt: isoTimestamp(asset.priceAsOf),
      fetchedAt: isoTimestamp(asset.priceFetchedAt),
      quoteType: asset.priceQuoteType ?? "manual_valuation",
      timestampBasis: "manual_input",
    };
  }

  const closeReference =
    referencesByMarket.get(closeMarketKeyForAsset(asset)) ??
    fallbackCloseReferenceForAsset(asset, snapshotDate);
  const referenceDate = closeReference.expectedCloseDate;
  const row = priceRowsForInstrument(rowsByInstrument, asset)
    .filter((item) => item.priceDate <= referenceDate)
    .filter((item) => resolveOperationalClosePrice(item) !== null)
    .filter((item) => isFreshCloseRow(item.priceDate, referenceDate))
    .sort((left, right) => {
      const dateCompare = right.priceDate.localeCompare(left.priceDate);
      if (dateCompare !== 0) return dateCompare;
      return closeSnapshotScore(right) - closeSnapshotScore(left);
    })[0];

  if (!row) {
    return {
      row: null,
      price: fallbackPrice,
      source: asset.priceSource ?? "asset_current_price",
      referenceDate: dateFromTimestamp(asset.priceAsOf),
      calendarReferenceDate: closeReference.calendarReferenceDate,
      expectedCloseDate: referenceDate,
      basis: "manual_current",
      fromCloseSnapshot: false,
    };
  }

  return {
    row,
    price: resolveOperationalClosePrice(row) ?? fallbackPrice,
    source: row.source ?? "asset_price_snapshots",
    referenceDate: row.priceDate,
    calendarReferenceDate: closeReference.calendarReferenceDate,
    expectedCloseDate: referenceDate,
    basis: "close",
    fromCloseSnapshot: true,
    fetchedAt: isoTimestamp(row.fetchedAt),
    quoteType: "close",
  };
}

function summarizeFreshClose(
  targetAssets: AssetRow[],
  closeContext: CloseContext,
  snapshotDate: string,
): FreshCloseSummary {
  const requiredAssets = targetAssets.filter((asset) => normalizeTicker(asset.ticker));
  const missing: MissingCloseAsset[] = [];
  const coverage: CloseCoverageAsset[] = [];
  let satisfiedCount = 0;
  const usedRows = new Set<string>();

  for (const asset of requiredAssets) {
    const selected = closeContext.selectedByAssetId.get(asset.id);
    const fallbackReference = fallbackCloseReferenceForAsset(asset, snapshotDate);
    const calendarReferenceDate =
      selected?.calendarReferenceDate ?? fallbackReference.calendarReferenceDate;
    const expectedCloseDate = selected?.expectedCloseDate ?? fallbackReference.expectedCloseDate;
    const actualCloseDate = selected?.referenceDate ?? null;

    if (selected?.row) usedRows.add(selected.row.id);

    if (selected?.fromCloseSnapshot && actualCloseDate === expectedCloseDate) {
      satisfiedCount += 1;
      coverage.push({
        id: asset.id,
        legacyBase44Id: asset.legacyBase44Id,
        ticker: asset.ticker,
        name: asset.name,
        account: asset.account,
        market: asset.market,
        currency: asset.currency,
        calendarReferenceDate,
        expectedCloseDate,
        selectedCloseDate: actualCloseDate,
        selectedSource: selected.source,
        status: "satisfied",
        reason: "selected_expected_close",
      });
      continue;
    }

    const reason = selected?.fromCloseSnapshot ? "stale_close" : "missing_close";
    coverage.push({
      id: asset.id,
      legacyBase44Id: asset.legacyBase44Id,
      ticker: asset.ticker,
      name: asset.name,
      account: asset.account,
      market: asset.market,
      currency: asset.currency,
      calendarReferenceDate,
      expectedCloseDate,
      selectedCloseDate: actualCloseDate,
      selectedSource: selected?.source ?? null,
      status: selected?.fromCloseSnapshot ? "stale" : "missing",
      reason,
    });
    missing.push({
      id: asset.id,
      legacyBase44Id: asset.legacyBase44Id,
      ticker: asset.ticker,
      name: asset.name,
      account: asset.account,
      market: asset.market,
      calendarReferenceDate,
      expectedCloseDate,
      actualCloseDate,
      reason,
    });
  }

  return {
    requiredCount: requiredAssets.length,
    satisfiedCount,
    missingCount: missing.length,
    rowsUsedCount: usedRows.size,
    closeReferences: closeContext.closeReferences,
    coverage,
    missing,
  };
}

function buildCloseSyncPlan({
  snapshotDate,
  selectedAssets,
  freshClose,
  cutoffValuation,
}: {
  snapshotDate: string;
  selectedAssets: AssetRow[];
  freshClose: FreshCloseSummary;
  cutoffValuation: CutoffValuationSummary | null;
}): CloseSyncPlan {
  const missingCutoffIds = cutoffValuation ? new Set(cutoffValuation.missing.map(row => row.assetId)) : null;
  // Close collection is a fallback for missing cutoff valuation, not a second
  // prerequisite once an eligible latest quote has already supplied the price.
  const targets = freshClose.coverage.map(coverage => {
    const target = closeCoverageToSyncTarget(coverage);
    return missingCutoffIds && !missingCutoffIds.has(coverage.id)
      ? { ...target, action: "covered" as const, reason: "cutoff_valuation_available" }
      : target;
  });
  const manualCurrentNotSyncable = selectedAssets
    .filter((asset) => !normalizeTicker(asset.ticker))
    .map((asset) => ({
      id: asset.id,
      legacyBase44Id: asset.legacyBase44Id,
      ticker: null,
      name: asset.name,
      account: asset.account,
      market: asset.market,
      currency: asset.currency,
      expectedCloseDate: null,
      selectedCloseDate: dateFromTimestamp(asset.priceAsOf),
      selectedSource: asset.priceSource ?? "asset_current_price",
      action: "manual_current_not_syncable" as const,
      reason: "tickerless_current_price_fallback",
    }));

  const markets = buildCloseSyncMarkets(targets, freshClose.closeReferences);
  const suggestedKisBatches = buildSuggestedKisBatches(targets);
  const missingCount = targets.filter((target) => target.action === "missing").length;
  const staleCount = targets.filter((target) => target.action === "stale").length;

  return {
    snapshotDate,
    canProceedToSnapshotWrite: missingCount === 0 && staleCount === 0,
    requiredCount: targets.length,
    coveredCount: targets.filter((target) => target.action === "covered").length,
    missingCount,
    staleCount,
    manualCurrentNotSyncableCount: manualCurrentNotSyncable.length,
    markets,
    manualCurrentNotSyncable,
    suggestedKisBatches,
  };
}

function closeCoverageToSyncTarget(
  coverage: CloseCoverageAsset,
): CloseSyncPlanTarget {
  const ticker = normalizeTicker(coverage.ticker);
  const action: CloseSyncPlanAction =
    coverage.status === "satisfied" &&
    coverage.selectedCloseDate === coverage.expectedCloseDate
      ? "covered"
      : coverage.status === "stale"
        ? "stale"
        : "missing";

  return {
    id: coverage.id,
    legacyBase44Id: coverage.legacyBase44Id,
    ticker,
    name: coverage.name,
    account: coverage.account,
    market: coverage.market,
    currency: coverage.currency,
    expectedCloseDate: coverage.expectedCloseDate,
    selectedCloseDate: coverage.selectedCloseDate,
    selectedSource: coverage.selectedSource,
    action,
    reason: coverage.reason,
  };
}

function buildCloseSyncMarkets(
  targets: CloseSyncPlanTarget[],
  closeReferences: CloseReferenceSummary[],
) {
  const referencesByMarket = new Map(
    closeReferences.map((reference) => [reference.market, reference]),
  );
  const markets = new Map<string, CloseSyncPlanMarket>();

  for (const target of targets) {
    const reference = referencesByMarket.get(target.market);
    const market = markets.get(target.market) ?? {
      market: target.market,
      expectedCloseDate: reference?.expectedCloseDate ?? target.expectedCloseDate,
      requiredCount: 0,
      requiredTickerCount: 0,
      coveredCount: 0,
      missingCount: 0,
      staleCount: 0,
      targets: [],
    };

    market.requiredCount += 1;
    if (target.action === "covered") market.coveredCount += 1;
    if (target.action === "missing") market.missingCount += 1;
    if (target.action === "stale") market.staleCount += 1;
    market.targets.push(target);
    markets.set(target.market, market);
  }

  return Array.from(markets.values())
    .map((market) => ({
      ...market,
      requiredTickerCount: uniqueStrings(
        market.targets
          .map((target) => target.ticker)
          .filter((ticker): ticker is string => Boolean(ticker)),
      ).length,
      targets: market.targets.sort((left, right) =>
        `${left.account}:${left.ticker ?? left.name}`.localeCompare(
          `${right.account}:${right.ticker ?? right.name}`,
        ),
      ),
    }))
    .sort((left, right) => left.market.localeCompare(right.market));
}

function buildSuggestedKisBatches(targets: CloseSyncPlanTarget[]) {
  const pendingByMarketDate = new Map<string, Set<string>>();

  for (const target of targets) {
    if (target.action !== "missing" && target.action !== "stale") continue;
    if (!target.ticker || !target.expectedCloseDate) continue;

    const key = `${target.market}|${target.expectedCloseDate}`;
    const tickers = pendingByMarketDate.get(key) ?? new Set<string>();
    tickers.add(target.ticker);
    pendingByMarketDate.set(key, tickers);
  }

  const batches: CloseSyncPlanBatch[] = [];
  for (const [key, tickerSet] of pendingByMarketDate.entries()) {
    const [market, expectedCloseDate] = key.split("|");
    const tickers = Array.from(tickerSet).sort();

    for (let index = 0; index < tickers.length; index += 5) {
      const batchTickers = tickers.slice(index, index + 5);
      const params = new URLSearchParams({
        provider: "kis",
        mode: "close",
        dryRun: "true",
        market,
        date: expectedCloseDate,
        tickers: batchTickers.join(","),
        limit: String(batchTickers.length),
      });
      batches.push({
        market,
        expectedCloseDate,
        tickers: batchTickers,
        count: batchTickers.length,
        maxBatchSize: 5,
        dryRunQuery: `/api/admin/market/prices/sync?${params.toString()}`,
        manualWriteRequired: true,
        writeRequiresConfirmWrite: true,
        suggestedWriteParams: {
          provider: "kis",
          mode: "close",
          market,
          date: expectedCloseDate,
          tickers: batchTickers,
          limit: batchTickers.length,
        },
      });
    }
  }

  return batches.sort((left, right) =>
    `${left.market}:${left.expectedCloseDate}:${left.tickers.join(",")}`.localeCompare(
      `${right.market}:${right.expectedCloseDate}:${right.tickers.join(",")}`,
    ),
  );
}

async function loadExistingRows({
  ownerUserId,
  account,
  snapshotDate,
  assetCount,
}: {
  ownerUserId: string;
  account: TrackedAccount;
  snapshotDate: string;
  assetCount: number;
}): Promise<ExistingRows> {
  const [portfolios, positions, priorPositions] = await Promise.all([
    db
      .select()
      .from(dailyPortfolioSnapshots)
      .where(
        and(
          eq(dailyPortfolioSnapshots.canonicalOwnerUserId, ownerUserId),
          eq(dailyPortfolioSnapshots.snapshotDate, snapshotDate),
          eq(dailyPortfolioSnapshots.account, account),
        ),
      ),
    db
      .select()
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.canonicalOwnerUserId, ownerUserId),
          eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
          eq(dailyPositionSnapshots.account, account),
        ),
      ),
    db
      .select()
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.canonicalOwnerUserId, ownerUserId),
          eq(dailyPositionSnapshots.account, account),
          brokerRecoveryBaselinePredicate(snapshotDate),
          lt(dailyPositionSnapshots.snapshotDate, snapshotDate),
        ),
      )
      .orderBy(desc(dailyPositionSnapshots.snapshotDate))
      .limit(Math.max(assetCount * 12, 120)),
  ]);

  return { portfolios, positions, priorPositions };
}

async function loadExistingAllPortfolioRows(
  snapshotDate: string,
  ownerUserId: string,
) {
  return db
    .select()
    .from(dailyPortfolioSnapshots)
    .where(
      and(
        eq(dailyPortfolioSnapshots.canonicalOwnerUserId, ownerUserId),
        eq(dailyPortfolioSnapshots.snapshotDate, snapshotDate),
        eq(dailyPortfolioSnapshots.account, "all"),
      ),
    );
}

function findAccountWriteBlockers(
  computed: AccountComputed,
  existingRows: ExistingRows,
) {
  const blockers: string[] = [];

  if (computed.totalMarketValue <= 0 && computed.assets.length > 0) {
    blockers.push("zero_account_valuation");
  }

  const expectedAccountId = computed.positions[0]?.accountId ?? null;
  if (computed.assets.length > 0 && expectedAccountId === null) {
    blockers.push("owned_account_row_missing");
  }
  if (
    expectedAccountId !== null &&
    computed.assets.some((asset) => asset.accountId !== expectedAccountId)
  ) {
    blockers.push("asset_account_owner_mismatch");
  }

  const importedPortfolioRows = existingRows.portfolios.filter(
    (row) => row.legacyBase44Id !== null,
  );
  const importedPositionRows = existingRows.positions.filter(
    (row) => row.legacyBase44Id !== null,
  );
  if (importedPortfolioRows.length > 0) blockers.push("imported_portfolio_snapshot_exists");
  if (importedPositionRows.length > 0) blockers.push("imported_position_snapshot_exists");

  const generatedPortfolioRows = existingRows.portfolios.filter(isVardaGeneratedRow);
  const unmanagedPortfolioRows = existingRows.portfolios.filter(
    (row) => row.legacyBase44Id === null && !isVardaGeneratedRow(row),
  );
  if (generatedPortfolioRows.length > 1) blockers.push("duplicate_varda_portfolio_rows");
  if (unmanagedPortfolioRows.length > 0) blockers.push("unmanaged_portfolio_rows_exist");

  const expectedPositionKeys = new Set(computed.positions.map(positionKey));
  const generatedPositionRows = existingRows.positions.filter(isVardaGeneratedRow);
  const unmanagedPositionRows = existingRows.positions.filter(
    (row) => row.legacyBase44Id === null && !isVardaGeneratedRow(row),
  );
  const duplicateKeys = findDuplicateKeys(generatedPositionRows, positionKey);
  const unexpectedKeys = generatedPositionRows
    .map(positionKey)
    .filter((key) => !expectedPositionKeys.has(key));

  if (unmanagedPositionRows.length > 0) blockers.push("unmanaged_position_rows_exist");
  if (duplicateKeys.length > 0) blockers.push("duplicate_varda_position_rows");
  if (unexpectedKeys.length > 0) blockers.push("unexpected_varda_position_rows");

  return blockers;
}

function findAllAccountWriteBlockers(
  accountBuilds: AccountSnapshotBuild[],
  existingRows: PortfolioRow[],
) {
  const blockers: string[] = [];
  const blockedAccounts = accountBuilds
    .filter((build) => build.status === "blocked")
    .map((build) => build.account);

  if (blockedAccounts.length > 0) {
    blockers.push(`blocked_account_snapshots:${blockedAccounts.join(",")}`);
  }

  if (existingRows.some((row) => row.legacyBase44Id !== null)) {
    blockers.push("imported_all_portfolio_snapshot_exists");
  }

  const generatedRows = existingRows.filter(isVardaGeneratedRow);
  const unmanagedRows = existingRows.filter(
    (row) => row.legacyBase44Id === null && !isVardaGeneratedRow(row),
  );
  if (generatedRows.length > 1) blockers.push("duplicate_varda_all_portfolio_rows");
  if (unmanagedRows.length > 0) blockers.push("unmanaged_all_portfolio_rows_exist");

  return blockers;
}

function emptyAccountPlan(account: TrackedAccount): AccountSnapshotBuild {
  return {
    account,
    status: "skipped",
    reason: null,
    positionCount: 0,
    portfolioAction: "skip",
    positionActions: { insert: 0, update: 0, skip: 0, blocked: 0 },
    totalMarketValue: 0,
    totalCost: 0,
    openCostKrw: 0,
    unrealizedPnlKrw: 0,
    realizedPnlKrw: 0,
    realizedCostBasisKrw: 0,
    realizedSellEventCount: 0,
    unmatchedRealizedSellEventCount: 0,
    missingCostRealizedSellEventCount: 0,
    totalPnl: 0,
    totalReturnPct: null,
    usdKrw: 0,
    blockers: [],
    portfolio: null,
    positions: [],
    existingPortfolio: null,
    existingPositionsByKey: new Map(),
  };
}

function summarizePositionActions(
  positions: NewDailyPositionSnapshot[],
  existingByKey: Map<string, PositionRow>,
): Record<SnapshotWriteAction, number> {
  const summary: Record<SnapshotWriteAction, number> = {
    insert: 0,
    update: 0,
    skip: 0,
    blocked: 0,
  };

  for (const position of positions) {
    if (existingByKey.has(positionKey(position))) summary.update += 1;
    else summary.insert += 1;
  }

  return summary;
}

function accumulatePlannedWrites(
  plannedWrites: PlannedSnapshotWrites,
  build: AccountSnapshotBuild,
) {
  plannedWrites.dailyPortfolioSnapshots[build.portfolioAction] +=
    build.portfolioAction === "skip" ? 0 : 1;

  for (const [action, count] of Object.entries(build.positionActions)) {
    plannedWrites.dailyPositionSnapshots[action as SnapshotWriteAction] += count;
  }
}

function accumulateAllPlannedWrites(
  plannedWrites: PlannedSnapshotWrites,
  build: AllAccountSnapshotBuild,
) {
  plannedWrites.dailyPortfolioSnapshots[build.portfolioAction] +=
    build.portfolioAction === "skip" ? 0 : 1;
}

function emptyPlannedWrites(): PlannedSnapshotWrites {
  return {
    dailyPortfolioSnapshots: { insert: 0, update: 0, skip: 0, blocked: 0 },
    dailyPositionSnapshots: { insert: 0, update: 0, skip: 0, blocked: 0 },
  };
}

function publicAccountPlan(build: AccountSnapshotBuild): AccountSnapshotPlan {
  return {
    account: build.account,
    status: build.status,
    reason: build.reason,
    positionCount: build.positionCount,
    portfolioAction: build.portfolioAction,
    positionActions: build.positionActions,
    totalMarketValue: build.totalMarketValue,
    totalCost: build.totalCost,
    openCostKrw: build.openCostKrw,
    unrealizedPnlKrw: build.unrealizedPnlKrw,
    realizedPnlKrw: build.realizedPnlKrw,
    realizedCostBasisKrw: build.realizedCostBasisKrw,
    realizedSellEventCount: build.realizedSellEventCount,
    unmatchedRealizedSellEventCount: build.unmatchedRealizedSellEventCount,
    missingCostRealizedSellEventCount: build.missingCostRealizedSellEventCount,
    totalPnl: build.totalPnl,
    totalReturnPct: build.totalReturnPct,
    usdKrw: build.usdKrw,
    blockers: build.blockers,
  };
}

function publicAllAccountPlan(build: AllAccountSnapshotBuild): AllAccountSnapshotPlan {
  return {
    account: build.account,
    status: build.status,
    reason: build.reason,
    accountsAggregated: build.accountsAggregated,
    portfolioAction: build.portfolioAction,
    totalMarketValue: build.totalMarketValue,
    totalCost: build.totalCost,
    openCostKrw: build.openCostKrw,
    unrealizedPnlKrw: build.unrealizedPnlKrw,
    realizedPnlKrw: build.realizedPnlKrw,
    realizedCostBasisKrw: build.realizedCostBasisKrw,
    realizedSellEventCount: build.realizedSellEventCount,
    unmatchedRealizedSellEventCount: build.unmatchedRealizedSellEventCount,
    missingCostRealizedSellEventCount: build.missingCostRealizedSellEventCount,
    totalPnl: build.totalPnl,
    totalReturnPct: build.totalReturnPct,
    blockers: build.blockers,
  };
}

function isOpenInvestmentAsset(asset: AssetRow) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  return quantity > 0 || fractionalKrwValue > 0;
}

function selectPriceForAsset(asset: AssetRow, closeContext: CloseContext) {
  return (
    closeContext.valuationByAssetId.get(asset.id) ?? {
      row: null,
      price: toNumber(asset.currentPrice) ?? 0,
      source: asset.priceSource ?? "asset_current_price",
      referenceDate: dateFromTimestamp(asset.priceAsOf),
      calendarReferenceDate: null,
      expectedCloseDate: null,
      basis: "manual_current" as const,
      fromCloseSnapshot: false,
    }
  );
}

function selectOfficialCloseForAsset(
  asset: AssetRow,
  closeContext: CloseContext,
) {
  return closeContext.selectedByAssetId.get(asset.id) ?? selectPriceForAsset(asset, closeContext);
}

function portfolioValuationBasis(provenance: SnapshotProvenance) {
  return provenance.insertOnly
    ? "historical_close_or_manual_carry"
    : provenance.descriptionTags.includes("valuation_policy=execution_collection_v1")
      ? "execution_quote_or_exact_official_close"
      : "pre_cutoff_quote_or_exact_official_close";
}

function assetValueKrw(asset: AssetRow, price: number, fxRate: number) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  return quantity * price * fxRate + fractionalKrwValue;
}

function assetFxRate(asset: AssetRow, fx: ResolvedFxRate) {
  return resolveKrwFxRate(asset.currency, fx.usdKrw).rate ?? 0;
}

function getFxExposureType(asset: AssetRow) {
  if (asset.market === "us" || asset.currency === "USD") return "US_LISTED";
  const ticker = normalizeTicker(asset.ticker) ?? "";
  const name = asset.name.toLowerCase();
  if (
    ticker.endsWith("(H)") ||
    name.includes("(h)") ||
    name.includes("hedged")
  ) {
    return "HEDGED";
  }
  if (
    asset.market === "korea" &&
    KOREA_UNHEDGED_GLOBAL_CATEGORIES.has(asset.category ?? "")
  ) {
    return "KR_UNHEDGED_GLOBAL";
  }
  return "DOMESTIC";
}

function isFreshCloseRow(actualDate: string, referenceDate: string) {
  const ageDays = diffDays(referenceDate, actualDate);
  return ageDays >= 0 && ageDays <= FRESH_CLOSE_MAX_AGE_DAYS;
}

function isPositiveCloseRow(row: PriceRow) {
  return resolveOperationalClosePrice(row) !== null;
}

function closeSnapshotScore(row: PriceRow) {
  let score = 0;
  const source = row.source?.toLowerCase() ?? "";
  if (source.includes("quote_close") || source.includes("latest_close_fallback")) {
    score += 10;
  }
  if (source.includes("kis")) score += 4;
  if ((toNumber(row.closePriceKrw) ?? 0) > 0) score += 2;
  if (resolveOperationalClosePrice(row) !== null) score += 1;
  return score;
}

function latestPriorPositionByAssetId(rows: PositionRow[], snapshotDate: string) {
  const sorted = rows
    .filter((row) => row.assetId && row.snapshotDate < snapshotDate)
    .sort((left, right) => right.snapshotDate.localeCompare(left.snapshotDate));
  const byAssetId = new Map<string, PositionRow>();

  for (const row of sorted) {
    if (row.assetId && !byAssetId.has(row.assetId)) byAssetId.set(row.assetId, row);
  }

  return byAssetId;
}

function getBenchmarkFields(context: AccountContext) {
  const kospi = context.benchmarkByTicker.get("069500") ?? null;
  const voo = context.benchmarkByTicker.get("VOO") ?? null;

  return {
    benchmarkValue: decimal(toNumber(kospi?.closePrice)),
    benchmarkIndexValue: decimal(toNumber(kospi?.normalizedIndexValue)),
    kodex200Value: decimal(toNumber(kospi?.closePrice)),
    kospi200Value: decimal(toNumber(kospi?.closePrice)),
    kospi200Index: decimal(toNumber(kospi?.normalizedIndexValue)),
    sp500Index: decimal(toNumber(voo?.normalizedIndexValue)),
    vooValue: decimal(toNumber(voo?.closePrice)),
  };
}

function findTopHolding(positions: NewDailyPositionSnapshot[], totalMarketValue: number) {
  const top = positions
    .map((position) => ({
      name: position.assetName,
      value: toNumber(position.marketValueKrw) ?? 0,
    }))
    .sort((left, right) => right.value - left.value)[0];

  return {
    name: top?.name ?? null,
    weight: top && totalMarketValue > 0 ? (top.value / totalMarketValue) * 100 : null,
  };
}

function buildWarnings({
  selectedAssets,
  freshClose,
  cutoffValuation,
  fx,
  unsupportedCurrencyAssets,
}: {
  selectedAssets: AssetRow[];
  freshClose: FreshCloseSummary;
  cutoffValuation: CutoffValuationSummary | null;
  fx: ResolvedFxRate;
  unsupportedCurrencyAssets: AssetRow[];
}) {
  const warnings: string[] = [];
  const manualAssets = selectedAssets.filter((asset) => !normalizeTicker(asset.ticker));

  if (manualAssets.length > 0) {
    warnings.push(
      `${manualAssets.length} tickerless investment assets use current_price fallback`,
    );
  }

  if (cutoffValuation?.missing.length) {
    warnings.push("cutoff valuation evidence is incomplete; write is blocked");
  } else if (!cutoffValuation && freshClose.missingCount > 0) {
    warnings.push("fresh close coverage is incomplete; write is blocked");
  }

  if (fx.referenceDate === null && fx.status !== "not_required") {
    warnings.push("fx reference date is missing");
  }

  if (unsupportedCurrencyAssets.length > 0) {
    warnings.push(
      `${unsupportedCurrencyAssets.length} assets use unsupported valuation currencies: ${uniqueStrings(
        unsupportedCurrencyAssets.map((asset) => normalizeCurrencyCode(asset.currency)),
      )
        .sort()
        .join(", ")}`,
    );
  }

  return warnings;
}

function isVardaGeneratedRow(
  row: Pick<PortfolioRow | PositionRow, "legacyBase44Id" | "source" | "description">,
) {
  return (
    row.legacyBase44Id === null &&
    (row.source === SNAPSHOT_SOURCE ||
      (row.source === null &&
        (row.description ?? "").includes(`source=${SNAPSHOT_SOURCE}`)))
  );
}

function positionKey(
  row:
    | Pick<PositionRow, "assetId" | "legacyAssetId" | "ticker" | "account">
    | Pick<NewDailyPositionSnapshot, "assetId" | "legacyAssetId" | "ticker" | "account">,
) {
  if (row.assetId) return `asset:${row.account}:${row.assetId}`;
  if (row.legacyAssetId) return `legacy:${row.account}:${row.legacyAssetId}`;
  return `ticker:${row.account}:${normalizeTicker(row.ticker) ?? ""}`;
}

function findDuplicateKeys<T>(rows: T[], keyFn: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

function isoTimestamp(value: unknown) {
  const parsed = value instanceof Date || typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function dateFromTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function percentOrZero(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function decimal(value: number | string | null | undefined, scale = 6) {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  return parsed.toFixed(scale);
}

function diffDays(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return Number.POSITIVE_INFINITY;
  return Math.floor((later - earlier) / 86_400_000);
}

export class DailySnapshotRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "DailySnapshotRequestError";
  }
}
