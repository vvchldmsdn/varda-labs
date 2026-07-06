import "server-only";

import { and, desc, eq, inArray, lt, lte } from "drizzle-orm";

import { db } from "@/db/client";
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
  assetMetricKey,
  buildReturnMetricsSummary,
  summarizeRealizedReturnForAccount,
  type AccountRealizedReturnSummary,
  type ReturnMetricsSummary,
} from "@/lib/portfolio-return-metrics";
import {
  normalizeTicker,
  percentOrNull,
  sumBy,
  toNumber,
  uniqueStrings,
} from "@/lib/portfolio-math";
import {
  buildCycleForSnapshotDate,
  closeCalendarReferenceDateForAsset,
  closeMarketKeyForAsset,
  resolveSnapshotCycle,
  type InternalCycle,
} from "@/lib/snapshots/market-calendar";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);
const ACCOUNT_CODES = ["brokerage", "isa", "irp"] as const;
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

export type SnapshotAccount = (typeof ACCOUNT_CODES)[number] | "all";

type TrackedAccount = (typeof ACCOUNT_CODES)[number];
type SnapshotWriteAction = "insert" | "update" | "skip" | "blocked";
type AssetRow = Asset;
type AssetGroupRow = AssetGroup;
type PriceRow = AssetPriceSnapshot;
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
  realizedReturn: RealizedReturnRunSummary;
  plannedWrites: PlannedSnapshotWrites;
  results: Record<string, AccountSnapshotPlan | AllAccountSnapshotPlan>;
  warnings: string[];
};

export type SnapshotCycle = {
  snapshotDate: string;
  capturedAt: string;
  cycleStartAt: string;
  cycleEndAt: string;
};

type ResolvedFxRate = {
  usdKrw: number;
  referenceDate: string | null;
  source: string;
  status: string | null;
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
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
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
  totalCost: number;
  openCostKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
  totalPnl: number;
  totalReturnPct: number | null;
  usdKrw: number;
  blockers: string[];
};

type AllAccountSnapshotPlan = {
  account: "all";
  status: "planned" | "written" | "skipped" | "blocked";
  reason: string | null;
  accountsAggregated: number;
  portfolioAction: SnapshotWriteAction;
  totalMarketValue: number;
  totalCost: number;
  openCostKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
  totalPnl: number;
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
  basis: "close" | "manual_current";
  fromCloseSnapshot: boolean;
};

type AccountComputed = {
  account: TrackedAccount;
  assets: AssetRow[];
  positions: NewDailyPositionSnapshot[];
  totalMarketValue: number;
  totalCost: number;
  totalPnl: number;
  totalReturnPct: number | null;
  investedAmount: number;
  krValue: number;
  usValue: number;
  thematicValue: number;
  usdExposureValue: number;
  topHoldingName: string | null;
  topHoldingWeight: number | null;
  groupCount: number;
  openCostKrw: number;
  unrealizedPnlKrw: number;
  realizedPnlKrw: number;
  realizedCostBasisKrw: number;
  realizedSellEventCount: number;
  unmatchedRealizedSellEventCount: number;
  missingCostRealizedSellEventCount: number;
};

type ExistingRows = {
  portfolios: PortfolioRow[];
  positions: PositionRow[];
  priorPositions: PositionRow[];
};

type RunOptions = {
  dryRun?: boolean;
  snapshotDate?: string;
  account?: SnapshotAccount;
  now?: Date;
};

export async function runDailySnapshot(
  options: RunOptions = {},
): Promise<DailySnapshotRunResult> {
  const dryRun = options.dryRun ?? true;
  const resolvedCycle = resolveSnapshotCycle(options.now);
  const snapshotDate = options.snapshotDate ?? resolvedCycle.snapshotDate;
  const requestedAccount = options.account ?? "all";

  if (!DATE_KEY_PATTERN.test(snapshotDate)) {
    throw new DailySnapshotRequestError(
      "invalid_snapshot_date",
      "date must be YYYY-MM-DD",
      {},
      400,
    );
  }

  if (!dryRun && snapshotDate !== resolvedCycle.snapshotDate) {
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

  const cycle = buildCycleForSnapshotDate(snapshotDate, options.now ?? new Date());
  const targetAccounts = requestedAccount === "all" ? [...ACCOUNT_CODES] : [requestedAccount];
  const context = await loadAccountContext(snapshotDate);
  const allAssetRows = await db.select().from(assets).orderBy(assets.account, assets.name);
  const investmentAssetRows = allAssetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const openInvestmentAssets = investmentAssetRows.filter((asset) =>
    isOpenInvestmentAsset(asset, context.groupsById),
  );
  const selectedAssets = openInvestmentAssets.filter((asset) =>
    targetAccounts.includes(asset.account as TrackedAccount),
  );
  const fx = await resolveSnapshotFx(snapshotDate);
  const eventRows = await loadEventRows(snapshotDate);
  const returnMetrics = buildReturnMetricsSummary(eventRows, investmentAssetRows, fx.usdKrw, {
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
  });
  const freshClose = summarizeFreshClose(selectedAssets, closeContext, snapshotDate);
  const warnings = buildWarnings({ selectedAssets, freshClose, fx });
  const plannedWrites = emptyPlannedWrites();

  if (!dryRun && freshClose.missing.length > 0) {
    throw new DailySnapshotRequestError(
      "missing_fresh_closes",
      "Fresh close prices are required before writing a daily snapshot",
      { snapshotDate, missingCloseAssets: freshClose.missing },
      409,
    );
  }

  const accountBuilds: AccountSnapshotBuild[] = [];

  for (const account of targetAccounts) {
    const accountAssets = selectedAssets.filter((asset) => asset.account === account);
    const existingRows = await loadExistingRows({
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
    });
    const build = buildAccountPlan({
      computed,
      existingRows,
      context,
      fx,
    });

    accumulatePlannedWrites(plannedWrites, build);
    accountBuilds.push(build);
  }

  const resultMap: Record<string, AccountSnapshotPlan | AllAccountSnapshotPlan> =
    Object.fromEntries(
      accountBuilds.map((build) => [build.account, publicAccountPlan(build)]),
    );
  let allBuild: AllAccountSnapshotBuild | null = null;

  if (requestedAccount === "all") {
    const existingAllRows = await loadExistingAllPortfolioRows(snapshotDate);
    allBuild = buildAllAccountPlan({
      accountBuilds,
      existingRows: existingAllRows,
      context,
      fx,
      cycle,
      snapshotDate,
    });
    accumulateAllPlannedWrites(plannedWrites, allBuild);
    resultMap.all = publicAllAccountPlan(allBuild);
  }

  const blockers = [
    ...freshClose.missing.map((asset) => `missing_close:${asset.ticker}`),
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
    await applySnapshotWrites(accountBuilds, allBuild);
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
    realizedReturn,
    plannedWrites,
    results: resultMap,
    warnings,
  };
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

function buildAllAccountPlan({
  accountBuilds,
  existingRows,
  context,
  fx,
  cycle,
  snapshotDate,
}: {
  accountBuilds: AccountSnapshotBuild[];
  existingRows: PortfolioRow[];
  context: AccountContext;
  fx: ResolvedFxRate;
  cycle: InternalCycle;
  snapshotDate: string;
}): AllAccountSnapshotBuild {
  const blockers = findAllAccountWriteBlockers(accountBuilds, existingRows);
  const completed = accountBuilds.filter(
    (build) => build.portfolio && build.status !== "blocked",
  );
  const existingPortfolio = existingRows.find(isVardaGeneratedRow) ?? null;
  const totalMarketValue = sumBy(completed, (build) => build.totalMarketValue);
  const openCostKrw = sumBy(completed, (build) => build.openCostKrw);
  const unrealizedPnlKrw = sumBy(completed, (build) => build.unrealizedPnlKrw);
  const realizedPnlKrw = sumBy(completed, (build) => build.realizedPnlKrw);
  const realizedCostBasisKrw = sumBy(
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
  const totalCost = openCostKrw + realizedCostBasisKrw;
  const totalPnl = unrealizedPnlKrw + realizedPnlKrw;
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
          snapshotDate,
          account: "all",
          accountId: null,
          source: SNAPSHOT_SOURCE,
          ruleVersion: SNAPSHOT_RULE_VERSION,
          description: [
            "snapshot_status=complete",
            `source=${SNAPSHOT_SOURCE}`,
            "source_basis=account_position_sums",
            `accounts=${completed.length}`,
            "valuation_basis=close_price",
            `fx_source=${fx.source}`,
            "return_basis=unrealized_plus_event_ledger_realized_v1",
            `open_cost_krw=${Math.round(openCostKrw)}`,
            `realized_pnl_krw=${Math.round(realizedPnlKrw)}`,
            `realized_cost_basis_krw=${Math.round(realizedCostBasisKrw)}`,
            `realized_sell_events=${realizedSellEventCount}`,
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
  const portfolioAction: SnapshotWriteAction =
    blockers.length > 0 ? "blocked" : existingPortfolio ? "update" : "insert";

  return {
    account: "all",
    status: blockers.length > 0 ? "blocked" : completed.length > 0 ? "planned" : "skipped",
    reason:
      blockers.length > 0
        ? "preflight_blocked"
        : completed.length > 0
          ? null
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
    portfolio,
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
}): AccountComputed {
  const groupValueById = new Map<string, number>();
  const groupMembersById = new Map<string, AssetRow[]>();

  for (const asset of assets) {
    const price = selectPriceForAsset(asset, closeContext);
    const fxRate = asset.currency === "USD" ? fx.usdKrw : 1;
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
    const fxRate = asset.currency === "USD" ? fx.usdKrw : 1;
    return assetValueKrw(asset, price.price, fxRate);
  });
  const priorByAssetId = latestPriorPositionByAssetId(priorPositions, snapshotDate);
  let krValue = 0;
  let usValue = 0;
  let thematicValue = 0;
  let usdExposureValue = 0;

  const positions = assets.map((asset) => {
    const selectedPrice = selectPriceForAsset(asset, closeContext);
    const closePrice = selectedPrice.price;
    const fxRate = asset.currency === "USD" ? fx.usdKrw : 1;
    const quantity = toNumber(asset.quantity) ?? 0;
    const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
    const fractionalAvgCost = toNumber(asset.fractionalAvgCost) ?? 0;
    const estimatedFractionalQuantity =
      fractionalKrwValue > 0 && closePrice > 0 && fxRate > 0
        ? fractionalKrwValue / (closePrice * fxRate)
        : 0;
    const totalQuantity = quantity + estimatedFractionalQuantity;
    const marketValueLocal = totalQuantity * closePrice;
    const marketValueKrw = marketValueLocal * fxRate;
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
    const prior = priorByAssetId.get(asset.id) ?? null;
    const previousUnitPrice =
      toNumber(prior?.unitPrice) ?? toNumber(prior?.closePrice) ?? null;
    const previousFxRate =
      toNumber(prior?.fxRate) ?? (asset.currency === "USD" ? null : 1);
    const previousUnitValueKrw =
      toNumber(prior?.unitValueKrw) ??
      (previousUnitPrice && previousFxRate
        ? previousUnitPrice * previousFxRate
        : null);
    const previousMarketValueKrw = toNumber(prior?.marketValueKrw);
    const unitValueKrw = closePrice * fxRate;
    const unitValueChangeKrw =
      previousUnitValueKrw && previousUnitValueKrw > 0
        ? unitValueKrw - previousUnitValueKrw
        : null;
    const unitValueChangePct =
      unitValueChangeKrw !== null && previousUnitValueKrw && previousUnitValueKrw > 0
        ? (unitValueChangeKrw / previousUnitValueKrw) * 100
        : null;
    const marketValueChangeKrw =
      previousMarketValueKrw && previousMarketValueKrw > 0
        ? marketValueKrw - previousMarketValueKrw
        : null;
    const marketValueChangePct =
      marketValueChangeKrw !== null && previousMarketValueKrw && previousMarketValueKrw > 0
        ? (marketValueChangeKrw / previousMarketValueKrw) * 100
        : null;
    const priceChangeKrw =
      previousUnitPrice && previousUnitPrice > 0
        ? totalQuantity *
          (closePrice - previousUnitPrice) *
          (asset.currency === "USD" ? previousFxRate ?? fxRate : 1)
        : null;
    const fxChangeKrw =
      asset.currency === "USD" && previousFxRate && previousFxRate > 0
        ? totalQuantity * closePrice * (fxRate - previousFxRate)
        : 0;
    const costKrw = costBasisKrw(asset, fx.usdKrw);
    const pnlKrw = marketValueKrw - costKrw;
    const belowMa =
      (toNumber(asset.ma120) ?? 0) > 0 && closePrice <= (toNumber(asset.ma120) ?? 0);
    const exposureType = getFxExposureType(asset);

    if (asset.market === "korea") krValue += marketValueKrw;
    if (asset.market === "us") usValue += marketValueKrw;
    if (asset.maAssetClass === "thematic") thematicValue += marketValueKrw;
    if (exposureType === "US_LISTED") usdExposureValue += marketValueKrw;
    if (exposureType === "KR_UNHEDGED_GLOBAL") usdExposureValue += marketValueKrw * 0.5;

    if (!asset.legacyBase44Id) {
      throw new DailySnapshotRequestError(
        "missing_legacy_asset_id",
        "daily_position_snapshots.legacy_asset_id is required by the current schema",
        { assetId: asset.id, assetName: asset.name },
        409,
      );
    }

    const legacyGroup = asset.groupId ? context.groupsById.get(asset.groupId) : null;

    return {
      legacyBase44Id: null,
      snapshotDate,
      assetId: asset.id,
      legacyAssetId: asset.legacyBase44Id,
      ticker: asset.ticker,
      assetName: asset.name,
      account,
      accountId: context.accountRowsByCode.get(account) ?? null,
      source: SNAPSHOT_SOURCE,
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
        `source=${SNAPSHOT_SOURCE}`,
        `price_basis=${selectedPrice.basis}`,
        `price_source=${selectedPrice.source}${selectedPrice.referenceDate ? `@${selectedPrice.referenceDate}` : ""}`,
        `fx_source=${fx.source}`,
        "cost_basis_source=asset_average_cost_fallback",
      ].join("; "),
      belowMa,
      isSample: false,
      quantity: decimal(quantity, 8),
      totalQuantity: decimal(totalQuantity, 8),
      estimatedFractionalQuantity: decimal(estimatedFractionalQuantity, 8),
      avgCost: decimal(toNumber(asset.averageCost)),
      currentPrice: decimal(closePrice),
      closePrice: decimal(closePrice),
      unitPrice: decimal(closePrice),
      unitValueKrw: decimal(unitValueKrw),
      marketValueLocal: decimal(marketValueLocal),
      marketValueKrw: decimal(marketValueKrw),
      costKrw: decimal(costKrw),
      pnlKrw: decimal(pnlKrw),
      pnlPct: decimal(percentOrZero(pnlKrw, costKrw)),
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
      ma120: decimal(toNumber(asset.ma120)),
      fractionalKrwValue: decimal(fractionalKrwValue),
      fractionalAvgCost: decimal(fractionalAvgCost),
      priceDate: selectedPrice.referenceDate,
      referenceDate: selectedPrice.referenceDate,
      fxReferenceDate: asset.currency === "USD" ? fx.referenceDate : null,
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
  const openCostKrw = sumBy(positions, (position) => toNumber(position.costKrw) ?? 0);
  const unrealizedPnlKrw = sumBy(positions, (position) => toNumber(position.pnlKrw) ?? 0);
  const realizedPnlKrw = accountRealized.realizedPnlKrw;
  const realizedCostBasisKrw = accountRealized.realizedCostBasisKrw;
  const totalCost = openCostKrw + realizedCostBasisKrw;
  const totalPnl = unrealizedPnlKrw + realizedPnlKrw;
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
    snapshotDate: computed.positions[0]?.snapshotDate ?? "",
    account: computed.account,
    accountId: context.accountRowsByCode.get(computed.account) ?? null,
    source: SNAPSHOT_SOURCE,
    ruleVersion: SNAPSHOT_RULE_VERSION,
    description: [
      "snapshot_status=complete",
      `source=${SNAPSHOT_SOURCE}`,
      `expected_positions=${computed.positions.length}`,
      "valuation_basis=close_price",
      `fx_source=${fx.source}`,
      "return_basis=unrealized_plus_event_ledger_realized_v1",
      `open_cost_krw=${Math.round(computed.openCostKrw)}`,
      `realized_pnl_krw=${Math.round(computed.realizedPnlKrw)}`,
      `realized_cost_basis_krw=${Math.round(computed.realizedCostBasisKrw)}`,
      `realized_sell_events=${computed.realizedSellEventCount}`,
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
) {
  const queries: unknown[] = [];

  for (const build of accountBuilds) {
    if (build.status !== "planned" || !build.portfolio) continue;
    pushPortfolioWriteQuery(queries, build.portfolio, build.existingPortfolio);
    pushPositionWriteQueries(queries, build.positions, build.existingPositionsByKey);
  }

  if (allBuild?.status === "planned" && allBuild.portfolio) {
    pushPortfolioWriteQuery(queries, allBuild.portfolio, allBuild.existingPortfolio);
  }

  if (queries.length === 0) return;
  await db.batch(queries as unknown as Parameters<typeof db.batch>[0]);
}

function pushPortfolioWriteQuery(
  queries: unknown[],
  portfolio: NewDailyPortfolioSnapshot,
  existing: PortfolioRow | null,
) {
  if (existing) {
    queries.push(
      db
        .update(dailyPortfolioSnapshots)
        .set({ ...portfolio, updatedAt: new Date() })
        .where(eq(dailyPortfolioSnapshots.id, existing.id)),
    );
    return;
  }

  queries.push(db.insert(dailyPortfolioSnapshots).values(portfolio));
}

function pushPositionWriteQueries(
  queries: unknown[],
  positions: NewDailyPositionSnapshot[],
  existingByKey: Map<string, PositionRow>,
) {
  const inserts: NewDailyPositionSnapshot[] = [];

  for (const position of positions) {
    const existing = existingByKey.get(positionKey(position));
    if (!existing) {
      inserts.push(position);
      continue;
    }

    queries.push(
      db
        .update(dailyPositionSnapshots)
        .set({ ...position, updatedAt: new Date() })
        .where(eq(dailyPositionSnapshots.id, existing.id)),
    );
  }

  if (inserts.length > 0) {
    queries.push(db.insert(dailyPositionSnapshots).values(inserts));
  }
}

async function loadAccountContext(snapshotDate: string): Promise<AccountContext> {
  const [
    accountRows,
    groupRows,
    regimeRows,
    kospiBenchmarkRows,
    vooBenchmarkRows,
  ] = await Promise.all([
    db.select().from(accounts),
    db.select().from(assetGroups),
    db
      .select()
      .from(marketRegimeDaily)
      .where(
        and(
          eq(marketRegimeDaily.account, "all"),
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

async function loadEventRows(snapshotDate: string) {
  return db
    .select()
    .from(eventLedgerEntries)
    .where(lte(eventLedgerEntries.eventDate, snapshotDate))
    .orderBy(eventLedgerEntries.eventDate);
}

function buildRealizedReturnRunSummary(
  summary: ReturnMetricsSummary,
  targetAccounts: TrackedAccount[],
  selectedAssets: AssetRow[],
  snapshotDate: string,
): RealizedReturnRunSummary {
  const assetsByAccount = new Map<TrackedAccount, Set<string>>();
  for (const account of targetAccounts) {
    assetsByAccount.set(account, new Set<string>());
  }
  for (const asset of selectedAssets) {
    if (targetAccounts.includes(asset.account as TrackedAccount)) {
      assetsByAccount.get(asset.account as TrackedAccount)?.add(assetMetricKey(asset));
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
    realizedPnlKrw: sumBy(accountSummaries, (account) => account.realizedPnlKrw),
    realizedCostBasisKrw: sumBy(
      accountSummaries,
      (account) => account.realizedCostBasisKrw,
    ),
    accounts: accountSummaries,
  };
}

async function resolveSnapshotFx(snapshotDate: string): Promise<ResolvedFxRate> {
  const [row] = await db
    .select()
    .from(fxRates)
    .where(lte(fxRates.rateDate, snapshotDate))
    .orderBy(desc(fxRates.rateDate))
    .limit(1);

  const usdKrw = toNumber(row?.usdKrw);
  if (!row || usdKrw === null || usdKrw <= 0) {
    throw new DailySnapshotRequestError(
      "missing_fx_rate",
      "A USD/KRW FX rate is required before writing a daily snapshot",
      { snapshotDate },
      409,
    );
  }

  return {
    usdKrw,
    referenceDate: row.rateDate,
    source: row.source ? `fx_rates:${row.source}@${row.rateDate}` : `fx_rates@${row.rateDate}`,
    status: row.status,
  };
}

type CloseContext = {
  rowsByTicker: Map<string, PriceRow[]>;
  selectedByAssetId: Map<string, PriceSelection>;
  referencesByMarket: Map<string, CloseReferenceSummary>;
  closeReferences: CloseReferenceSummary[];
};

async function buildCloseContext({
  snapshotDate,
  assets: targetAssets,
}: {
  snapshotDate: string;
  assets: AssetRow[];
}): Promise<CloseContext> {
  const tickers = uniqueStrings(
    targetAssets
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const priceRows =
    tickers.length > 0
      ? await db
          .select()
          .from(assetPriceSnapshots)
          .where(inArray(assetPriceSnapshots.ticker, tickers))
          .orderBy(desc(assetPriceSnapshots.priceDate))
          .limit(Math.max(400, tickers.length * 40))
      : [];
  const rowsByTicker = new Map<string, PriceRow[]>();

  for (const row of priceRows) {
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;
    const rows = rowsByTicker.get(ticker) ?? [];
    rows.push(row);
    rowsByTicker.set(ticker, rows);
  }

  const closeReferences = buildCloseReferences(targetAssets, rowsByTicker, snapshotDate);
  const referencesByMarket = new Map(
    closeReferences.map((reference) => [reference.market, reference]),
  );
  const selectedByAssetId = new Map<string, PriceSelection>();
  for (const asset of targetAssets) {
    selectedByAssetId.set(
      asset.id,
      selectClosePriceForAsset(asset, snapshotDate, rowsByTicker, referencesByMarket),
    );
  }

  return { rowsByTicker, selectedByAssetId, referencesByMarket, closeReferences };
}

function buildCloseReferences(
  targetAssets: AssetRow[],
  rowsByTicker: Map<string, PriceRow[]>,
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

        for (const row of rowsByTicker.get(ticker) ?? []) {
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
  rowsByTicker: Map<string, PriceRow[]>,
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
    };
  }

  const closeReference =
    referencesByMarket.get(closeMarketKeyForAsset(asset)) ??
    fallbackCloseReferenceForAsset(asset, snapshotDate);
  const referenceDate = closeReference.expectedCloseDate;
  const row = (rowsByTicker.get(ticker) ?? [])
    .filter((item) => item.priceDate <= referenceDate)
    .filter((item) => (toNumber(item.adjustedClosePrice) ?? toNumber(item.closePrice) ?? 0) > 0)
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
    price: toNumber(row.adjustedClosePrice) ?? toNumber(row.closePrice) ?? fallbackPrice,
    source: row.source ?? "asset_price_snapshots",
    referenceDate: row.priceDate,
    calendarReferenceDate: closeReference.calendarReferenceDate,
    expectedCloseDate: referenceDate,
    basis: "close",
    fromCloseSnapshot: true,
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

async function loadExistingRows({
  account,
  snapshotDate,
  assetCount,
}: {
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
          eq(dailyPortfolioSnapshots.snapshotDate, snapshotDate),
          eq(dailyPortfolioSnapshots.account, account),
        ),
      ),
    db
      .select()
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
          eq(dailyPositionSnapshots.account, account),
        ),
      ),
    db
      .select()
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.account, account),
          lt(dailyPositionSnapshots.snapshotDate, snapshotDate),
        ),
      )
      .orderBy(desc(dailyPositionSnapshots.snapshotDate))
      .limit(Math.max(assetCount * 12, 120)),
  ]);

  return { portfolios, positions, priorPositions };
}

async function loadExistingAllPortfolioRows(snapshotDate: string) {
  return db
    .select()
    .from(dailyPortfolioSnapshots)
    .where(
      and(
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

function isOpenInvestmentAsset(asset: AssetRow, groupsById: Map<string, AssetGroupRow>) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  const groupTargetWeight = asset.groupId
    ? toNumber(groupsById.get(asset.groupId)?.targetWeight) ?? 0
    : 0;
  return (
    (quantity > 0 || fractionalKrwValue > 0) &&
    (INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf") || groupTargetWeight > 0)
  );
}

function selectPriceForAsset(asset: AssetRow, closeContext: CloseContext) {
  return (
    closeContext.selectedByAssetId.get(asset.id) ?? {
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

function assetValueKrw(asset: AssetRow, price: number, fxRate: number) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  return quantity * price * fxRate + fractionalKrwValue;
}

function costBasisKrw(asset: AssetRow, usdKrw: number) {
  const quantity = toNumber(asset.quantity) ?? 0;
  const averageCost = toNumber(asset.averageCost) ?? toNumber(asset.currentPrice) ?? 0;
  const fractionalAvgCost = toNumber(asset.fractionalAvgCost) ?? 0;
  const fxRate = asset.currency === "USD" ? usdKrw : 1;
  return quantity * averageCost * fxRate + fractionalAvgCost;
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
  return (toNumber(row.adjustedClosePrice) ?? toNumber(row.closePrice) ?? 0) > 0;
}

function closeSnapshotScore(row: PriceRow) {
  let score = 0;
  const source = row.source?.toLowerCase() ?? "";
  if (source.includes("quote_close") || source.includes("latest_close_fallback")) {
    score += 10;
  }
  if (source.includes("kis")) score += 4;
  if ((toNumber(row.closePriceKrw) ?? 0) > 0) score += 2;
  if ((toNumber(row.adjustedClosePrice) ?? 0) > 0) score += 1;
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
  fx,
}: {
  selectedAssets: AssetRow[];
  freshClose: FreshCloseSummary;
  fx: ResolvedFxRate;
}) {
  const warnings: string[] = [];
  const manualAssets = selectedAssets.filter((asset) => !normalizeTicker(asset.ticker));

  if (manualAssets.length > 0) {
    warnings.push(
      `${manualAssets.length} tickerless investment assets use current_price fallback`,
    );
  }

  if (freshClose.missingCount > 0) {
    warnings.push("fresh close coverage is incomplete; write is blocked");
  }

  if (fx.referenceDate === null) {
    warnings.push("fx reference date is missing");
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
