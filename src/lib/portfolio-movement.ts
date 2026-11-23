import {
  calculateClosedPositionMovementKrw,
  calculateFxAwarePositionMovementKrw,
  calculateFxAwareSnapshotMovementKrw,
  diffDays,
  normalizeTicker,
  percentOrNull,
  resolveKrwFxRate,
  sumBy,
  toNumber,
} from "./portfolio-math.ts";
import { portfolioEventAccount } from "./portfolio-return-metrics-core.ts";
import { resolveOperationalClosePrice } from "./market-data/asset-price-consumer-admission.ts";
import { MANUAL_ASSET_PRICE_POLICY } from "./market-data/manual-asset-price.ts";
import { isSamePriceInstrument } from "./market-data/price-instrument-identity.ts";

const MOVEMENT_INVESTMENT_ASSET_TYPES = new Set([
  "etf",
  "stock",
  "pension",
  "commodity",
]);
const DAILY_MOVEMENT_MIN_VALUE_COVERAGE = 0.8;
const DAILY_MOVEMENT_MIN_COUNT_COVERAGE = 0.6;
const PREVIOUS_CLOSE_MAX_AGE_DAYS = 10;
const MOVEMENT_FRESH_PRICE_QUOTE_TYPES = new Set([
  "live",
  "delayed",
  "realtime",
]);

export type PortfolioMovementAccount = "brokerage" | "isa" | "irp";
export type PortfolioMovementSelectedAccount = PortfolioMovementAccount | "all";
export type PortfolioMovementSource =
  | "daily_position_snapshot"
  | "asset_price_snapshot"
  | "trade_execution"
  | null;

export type PortfolioMovementHoldingInput = {
  id: string;
  legacyBase44Id: string | null;
  name: string;
  ticker: string | null;
  assetType: string | null;
  account: string;
  market: string;
  currency: string;
  quantity: number;
  currentPrice: number;
  valueKrw: number;
  priceFetchedAt: Date | string | null;
  priceAsOf: Date | string | null;
  priceQuoteType: string | null;
  priceStatus: string | null;
};

export type PortfolioMovementPositionSnapshotInput = {
  id: string;
  account: string | null;
  assetId: string | null;
  legacyAssetId: string | null;
  ticker: string | null;
  assetName: string | null;
  assetType: string | null;
  marketValueKrw: string | number | null;
  unitPrice: string | number | null;
  closePrice: string | number | null;
  currentPrice: string | number | null;
  fxRate: string | number | null;
  previousFxRate: string | number | null;
  quantity?: string | number | null;
  currency?: string | null;
  capturedAt?: Date | string | null;
  description?: string | null;
};

export type PortfolioMovementEventInput = {
  eventDate: string;
  eventType: string;
  account: string | null;
  assetId: string | null;
  legacyAssetId: string | null;
  ticker: string | null;
  assetName: string | null;
  amountKrw: string | number | null;
  beforeValue: unknown;
  afterValue: unknown;
  quantityDelta?: string | number | null;
  price?: string | number | null;
  fxRate?: string | number | null;
  memo?: string | null;
  recordedAt?: Date | string | null;
  createdAt?: Date | string;
  movementEffectiveAt?: string;
  movementEvidence?: "unresolved";
  movementWindowResolved?: boolean;
};

export type PortfolioMovementPriceSnapshotInput = {
  market: string | null;
  currency: string | null;
  ticker: string | null;
  priceDate: string;
  adjustedClosePrice: string | number | null;
  closePrice: string | number | null;
  closePriceKrw: string | number | null;
  fxRate: string | number | null;
};

export type PortfolioMovementCycle = {
  snapshotDate: string;
  liveWindowStartAt: Date;
  liveWindowEndAt: Date;
};

export type PortfolioMovementContribution = {
  holdingId: string;
  previousValueKrw: number;
  changeKrw: number;
  returnPct: number | null;
  tradeFlowKrw: number;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  previousPrice: number;
  currentPrice: number;
  previousFxRate: number;
  currentFxRate: number;
  execution?: {
    openingQuantity: number;
    boughtQuantity: number;
    soldQuantity: number;
    openingMarkChangeKrw: number;
    buyMarkChangeKrw: number;
    sellAdjustmentKrw: number;
    buyAmountKrw: number;
    sellAmountKrw: number;
    averageBuyPrice: number | null;
    buyPriceChangeLocal: number;
    buyPriceReturnPctLocal: number | null;
    openingPriceChangeLocal: number | null;
    totalPriceChangeLocal: number | null;
  };
  source: Exclude<PortfolioMovementSource, null>;
};

export type PortfolioMovementExclusionReason =
  | "missing_quoted_instrument"
  | "unsupported_asset_type"
  | "missing_comparison_evidence"
  | "missing_baseline_snapshot"
  | "stale_baseline_snapshot"
  | "missing_fresh_live_prices"
  | "manual_valuation_not_updated_in_cycle"
  | "missing_previous_close_fallback"
  | "unsupported_currency"
  | "missing_current_fx"
  | "missing_trade_fx"
  | "missing_baseline_fx"
  | "missing_baseline_price"
  | "incomplete_trade_attribution"
  | "ambiguous_trade_identity"
  | "ambiguous_baseline_identity"
  | "missing_trade_amount"
  | "coverage_below_threshold";

export type PortfolioMovementExclusion = {
  subject: "holding" | "snapshot" | "aggregate";
  reason: PortfolioMovementExclusionReason;
  source: PortfolioMovementSource;
  holdingId: string | null;
  snapshotId: string | null;
  ticker: string | null;
  assetName: string | null;
  account: string | null;
  currency: string | null;
  valueKrw: number | null;
  localPurchases?: {
    currency: "USD";
    boughtQuantity: number;
    averageBuyPrice: number;
    currentPrice: number;
    buyPriceChangeLocal: number;
    buyPriceReturnPctLocal: number | null;
    openingQuantity: number | null;
    openingPriceChangeLocal: number | null;
    totalPriceChangeLocal: number | null;
  };
};

export type PortfolioMovementCoverage = {
  currentCoveragePct: number | null;
  snapshotCoveragePct: number | null;
  countCoveragePct: number | null;
  previousCloseCoveragePct: number | null;
};

export type PortfolioMovementResult = {
  ready: boolean;
  source: PortfolioMovementSource;
  reason: string | null;
  previousTotalKrw: number;
  changeKrw: number | null;
  returnPct: number | null;
  tradeFlowKrw: number;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
  contributions: Map<string, PortfolioMovementContribution>;
  contributionRows: PortfolioMovementContribution[];
  exclusions: PortfolioMovementExclusion[];
  coverage: PortfolioMovementCoverage;
};

export function isPortfolioMovementEligibleHolding(
  holding: Pick<PortfolioMovementHoldingInput, "assetType" | "ticker">,
) {
  const assetType = holding.assetType?.trim().toLowerCase() ?? "";
  const ticker = normalizeTicker(holding.ticker);
  const hasQuotedInstrument = ticker !== null && ticker !== "-";

  return MOVEMENT_INVESTMENT_ASSET_TYPES.has(assetType) && hasQuotedInstrument;
}

export function buildDailyPositionMovement({
  holdings,
  positionRows,
  eventRows,
  selectedAccount,
  baselineDate,
  usdKrwRate,
  movementCycle,
}: {
  holdings: PortfolioMovementHoldingInput[];
  positionRows: PortfolioMovementPositionSnapshotInput[];
  eventRows: PortfolioMovementEventInput[];
  selectedAccount: PortfolioMovementSelectedAccount;
  baselineDate: string | null;
  usdKrwRate: number;
  movementCycle: PortfolioMovementCycle;
}): PortfolioMovementResult {
  const movementHoldings = holdings.filter(holding => isPortfolioMovementEligibleHolding(holding) &&
    (holding.quantity !== 0 || holding.valueKrw !== 0));
  const emptyCoverage = {
    currentCoveragePct: null,
    snapshotCoveragePct: null,
    countCoveragePct: null,
    previousCloseCoveragePct: null,
  };

  if (!baselineDate) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage, {
      exclusions: movementHoldings.map((holding) =>
        holdingExclusion(
          holding,
          "missing_baseline_snapshot",
          "daily_position_snapshot",
        ),
      ),
    });
  }

  const accountRows = positionRows
    .filter(
      (row) =>
        (selectedAccount === "all" || row.account === selectedAccount) &&
        isInvestmentSnapshot(row),
    )
    .filter((row) => isPortfolioMovementEligibleSnapshot(row, holdings));
  const snapshotTotalValue = sumBy(accountRows, snapshotMarketValue);
  const currentTotalValue = sumBy(
    movementHoldings,
    (holding) => holding.valueKrw,
  );

  if (accountRows.length === 0 || snapshotTotalValue <= 0) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage, {
      exclusions: movementHoldings.map((holding) =>
        holdingExclusion(
          holding,
          "missing_baseline_snapshot",
          "daily_position_snapshot",
        ),
      ),
    });
  }

  const contributions = new Map<string, PortfolioMovementContribution>();
  const exclusions: PortfolioMovementExclusion[] = [];
  const ambiguousBaseline = accountRows.some((row) =>
    movementHoldings.filter((holding) => positionSnapshotMatchesHolding(row, holding)).length > 1,
  ) || movementHoldings.some((holding) =>
    accountRows.filter((row) => positionSnapshotMatchesHolding(row, holding)).length > 1,
  );
  if (ambiguousBaseline) {
    return emptyMovement("ambiguous_baseline_identity", emptyCoverage, {
      previousTotalKrw: snapshotTotalValue,
      exclusions: [aggregateExclusion("ambiguous_baseline_identity", "daily_position_snapshot")],
    });
  }
  const tradeIndex = indexMovementTrades(eventRows, movementHoldings, accountRows, selectedAccount, baselineDate);
  if ("reason" in tradeIndex) {
    return emptyMovement(tradeIndex.reason, emptyCoverage, {
      previousTotalKrw: snapshotTotalValue,
      exclusions: [aggregateExclusion(tradeIndex.reason, "daily_position_snapshot")],
    });
  }
  const matchedSnapshotIds = new Set<string>();
  const currentHoldingSnapshotIds = new Set<string>();
  let matchedCurrentValue = 0;
  let matchedSnapshotValue = 0;
  let matchedCount = 0;
  let tradeFlowKrw = 0;
  let priceChangeKrw = 0;
  let fxChangeKrw = 0;
  let completeAttribution = true;
  let fxEvidenceChangeKrw = 0;
  let fxEvidenceRequiredValueKrw = 0;
  let fxEvidenceMatchedValueKrw = 0;
  let fxEvidenceRequiredCount = 0;
  let fxEvidenceMatchedCount = 0;

  for (const holding of movementHoldings) {
    const snapshot = findPositionSnapshotForHolding(holding, accountRows);
    if (snapshot) currentHoldingSnapshotIds.add(snapshot.id);

    const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
    const requiresFxEvidence = holding.currency.trim().toUpperCase() !== "KRW";
    if (requiresFxEvidence) {
      fxEvidenceRequiredValueKrw += Math.max(holding.valueKrw, 0);
      fxEvidenceRequiredCount += 1;
    }
    if (!currentFx.ok) {
      exclusions.push(
        holdingExclusion(
          holding,
          currentFx.reason === "unsupported_currency"
            ? "unsupported_currency"
            : "missing_current_fx",
          "daily_position_snapshot",
        ),
      );
      continue;
    }

    if (!snapshot) {
      exclusions.push(
        holdingExclusion(
          holding,
          "missing_baseline_snapshot",
          "daily_position_snapshot",
        ),
      );
      continue;
    }

    const previousValueKrw = snapshotMarketValue(snapshot);
    if (previousValueKrw <= 0) {
      exclusions.push(
        snapshotExclusion(
          snapshot,
          "missing_baseline_snapshot",
          "daily_position_snapshot",
        ),
      );
      continue;
    }
    const holdingTrades = tradeIndex.byHolding.get(holding.id) ?? [];
    const holdingTradeFlowKrw = sumTradeFlows(holdingTrades);
    const previousFxRate =
      currentFx.requiresFx
        ? toNumber(snapshot.fxRate) ?? toNumber(snapshot.previousFxRate)
        : 1;
    const hasSnapshotFxBasis =
      !currentFx.requiresFx || (previousFxRate !== null && previousFxRate > 0);
    if (currentFx.requiresFx && !hasSnapshotFxBasis) {
      exclusions.push(
        holdingExclusion(holding, "missing_baseline_fx", "daily_position_snapshot"),
      );
      continue;
    }
    const effectivePreviousFxRate =
      previousFxRate !== null && previousFxRate > 0
        ? previousFxRate
        : currentFx.rate;
    if (
      currentFx.requiresFx &&
      holdingTrades.length === 0 &&
      Number.isFinite(holding.currentPrice) &&
      holding.currentPrice > 0
    ) {
      fxEvidenceChangeKrw +=
        holding.quantity *
        holding.currentPrice *
        (currentFx.rate - effectivePreviousFxRate);
      fxEvidenceMatchedValueKrw += Math.max(holding.valueKrw, 0);
      fxEvidenceMatchedCount += 1;
    }
    if (!hasFreshMovementPrice(holding, movementCycle)) {
      exclusions.push(
        holdingExclusion(
          holding,
          movementPriceExclusionReason(holding),
          "daily_position_snapshot",
        ),
      );
      continue;
    }
    const previousPrice = snapshotPositionPrice(snapshot);
    if (previousPrice === null) {
      exclusions.push(holdingExclusion(holding, "missing_baseline_price", "daily_position_snapshot"));
      continue;
    }
    const movement = calculateFxAwareSnapshotMovementKrw({
      quantity: holding.quantity,
      previousQuantity: toNumber(snapshot.quantity),
      trades: movementTradeLegs(holdingTrades, currentFx.requiresFx),
      currentPrice: holding.currentPrice,
      currentValueKrw: holding.valueKrw,
      previousPrice,
      previousValueKrw,
      currentFxRate: currentFx.rate,
      previousFxRate: effectivePreviousFxRate,
      tradeFlowKrw: holdingTradeFlowKrw,
    });
    const holdingFxChangeKrw = movement.fxChangeKrw;
    if (movement.priceChangeKrw === null || holdingFxChangeKrw === null) {
      completeAttribution = false;
      exclusions.push(holdingExclusion(holding, "incomplete_trade_attribution", "daily_position_snapshot"));
    }

    contributions.set(holding.id, {
      holdingId: holding.id,
      previousValueKrw,
      changeKrw: movement.changeKrw,
      returnPct: percentOrNull(movement.changeKrw, previousValueKrw),
      tradeFlowKrw: holdingTradeFlowKrw,
      priceChangeKrw: movement.priceChangeKrw,
      fxChangeKrw: holdingFxChangeKrw,
      previousPrice,
      currentPrice: holding.currentPrice,
      previousFxRate: effectivePreviousFxRate,
      currentFxRate: currentFx.rate,
      source: "daily_position_snapshot",
    });
    matchedSnapshotIds.add(snapshot.id);
    matchedCurrentValue += holding.valueKrw;
    matchedSnapshotValue += previousValueKrw;
    matchedCount += 1;
    tradeFlowKrw += holdingTradeFlowKrw;
    priceChangeKrw += movement.priceChangeKrw ?? 0;
    fxChangeKrw += holdingFxChangeKrw ?? 0;
  }

  let closedChangeKrw = 0;
  let provenExits = 0;
  for (const row of accountRows) {
    if (currentHoldingSnapshotIds.has(row.id)) continue;
    const previousValue = snapshotMarketValue(row);
    if (previousValue <= 0) continue;
    const trades = tradeIndex.bySnapshot.get(row.id) ?? [];
    const flow = sumTradeFlows(trades);
    const movement = calculateExitedPositionAttribution(row, trades, previousValue, flow);
    if (!movement) {
      exclusions.push(snapshotExclusion(row, "incomplete_trade_attribution", "daily_position_snapshot"));
      continue;
    }
    provenExits += 1;
    matchedSnapshotIds.add(row.id);
    matchedSnapshotValue += previousValue;
    closedChangeKrw += movement.changeKrw;
    if (movement.attribution) {
      priceChangeKrw += movement.attribution.priceKrw;
      fxChangeKrw += movement.attribution.fxKrw;
    } else {
      completeAttribution = false;
      exclusions.push(snapshotExclusion(row, "incomplete_trade_attribution", "daily_position_snapshot"));
    }
    tradeFlowKrw += flow;
  }
  const verifiedEmptyClose = movementHoldings.length === 0 && provenExits > 0 ? 1 : 0;
  const currentCoverage = currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : verifiedEmptyClose;
  const snapshotCoverage =
    snapshotTotalValue > 0 ? matchedSnapshotValue / snapshotTotalValue : 0;
  const countCoverage =
    movementHoldings.length > 0 ? matchedCount / movementHoldings.length : verifiedEmptyClose;
  const matchedSnapshotCountCoverage =
    accountRows.length > 0 ? matchedSnapshotIds.size / accountRows.length : 0;
  const coverage = {
    currentCoveragePct: currentCoverage * 100,
    snapshotCoveragePct: snapshotCoverage * 100,
    countCoveragePct: Math.min(countCoverage, matchedSnapshotCountCoverage) * 100,
    previousCloseCoveragePct: null,
  };
  const hasEnoughCoverage =
    currentCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    snapshotCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    countCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE &&
    matchedSnapshotCountCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE;
  const independentFxChangeKrw = resolveIndependentFxEvidence({
    matchedCount: fxEvidenceMatchedCount,
    matchedValueKrw: fxEvidenceMatchedValueKrw,
    requiredCount: fxEvidenceRequiredCount,
    requiredValueKrw: fxEvidenceRequiredValueKrw,
    valueKrw: fxEvidenceChangeKrw,
  });

  if (!hasEnoughCoverage) {
    return emptyMovement("missing_fresh_live_prices", coverage, {
      contributionRows: [...contributions.values()],
      fxChangeKrw: independentFxChangeKrw,
      previousTotalKrw: snapshotTotalValue,
      exclusions: [
        ...exclusions,
        aggregateExclusion("coverage_below_threshold", "daily_position_snapshot"),
      ],
    });
  }

  const comparablePreviousTotalKrw = matchedSnapshotValue;
  const changeKrw = sumBy([...contributions.values()], (row) => row.changeKrw) + closedChangeKrw;

  return {
    ready: true,
    source: "daily_position_snapshot",
    reason: null,
    previousTotalKrw: comparablePreviousTotalKrw,
    changeKrw,
    returnPct: percentOrNull(changeKrw, comparablePreviousTotalKrw),
    tradeFlowKrw,
    priceChangeKrw: completeAttribution ? priceChangeKrw : null,
    fxChangeKrw: completeAttribution ? fxChangeKrw : null,
    contributions,
    contributionRows: [...contributions.values()],
    exclusions,
    coverage,
  };
}

export function buildPreviousCloseMovement({
  holdings,
  priceRows,
  referenceDate,
  usdKrwRate,
  movementCycle,
}: {
  holdings: PortfolioMovementHoldingInput[];
  priceRows: PortfolioMovementPriceSnapshotInput[];
  referenceDate: string | null;
  usdKrwRate: number;
  movementCycle: PortfolioMovementCycle;
}): PortfolioMovementResult {
  const movementHoldings = holdings.filter(isPortfolioMovementEligibleHolding);
  const contributions = new Map<string, PortfolioMovementContribution>();
  const exclusions: PortfolioMovementExclusion[] = [];
  const currentTotalValue = sumBy(
    movementHoldings,
    (holding) => holding.valueKrw,
  );
  let matchedCurrentValue = 0;
  let matchedCount = 0;
  let previousTotalKrw = 0;
  let changeKrw = 0;
  let priceChangeKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of movementHoldings) {
    const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
    if (!currentFx.ok) {
      exclusions.push(
        holdingExclusion(
          holding,
          currentFx.reason === "unsupported_currency"
            ? "unsupported_currency"
            : "missing_current_fx",
          "asset_price_snapshot",
        ),
      );
      continue;
    }
    if (!hasFreshMovementPrice(holding, movementCycle)) {
      exclusions.push(
        holdingExclusion(
          holding,
          movementPriceExclusionReason(holding),
          "asset_price_snapshot",
        ),
      );
      continue;
    }

    const previous = calculatePreviousCloseContribution(
      holding,
      priceRows,
      referenceDate,
      usdKrwRate,
    );
    if (typeof previous === "string") {
      exclusions.push(
        holdingExclusion(
          holding,
          previous,
          "asset_price_snapshot",
        ),
      );
      continue;
    }

    contributions.set(holding.id, previous);
    matchedCurrentValue += holding.valueKrw;
    matchedCount += 1;
    previousTotalKrw += previous.previousValueKrw;
    changeKrw += previous.changeKrw;
    priceChangeKrw += previous.priceChangeKrw ?? 0;
    fxChangeKrw += previous.fxChangeKrw ?? 0;
  }

  const valueCoverage =
    currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : 0;
  const countCoverage =
    movementHoldings.length > 0 ? matchedCount / movementHoldings.length : 0;
  const coverage = {
    currentCoveragePct: null,
    snapshotCoveragePct: null,
    countCoveragePct: countCoverage * 100,
    previousCloseCoveragePct: valueCoverage * 100,
  };
  const ready =
    previousTotalKrw > 0 &&
    valueCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE &&
    countCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE;

  if (!ready) {
    return {
      ready: false,
      source: null,
      reason: "missing_previous_close_fallback",
      previousTotalKrw,
      changeKrw: null,
      returnPct: null,
      tradeFlowKrw: 0,
      priceChangeKrw: null,
      fxChangeKrw: null,
      contributions,
      contributionRows: [...contributions.values()],
      exclusions: [
        ...exclusions,
        aggregateExclusion("coverage_below_threshold", "asset_price_snapshot"),
      ],
      coverage,
    };
  }

  return {
    ready: true,
    source: "asset_price_snapshot",
    reason: null,
    previousTotalKrw,
    changeKrw,
    returnPct: percentOrNull(changeKrw, previousTotalKrw),
    tradeFlowKrw: 0,
    priceChangeKrw,
    fxChangeKrw,
    contributions,
    contributionRows: [...contributions.values()],
    exclusions,
    coverage,
  };
}

export function hasFreshMovementPrice(
  holding: PortfolioMovementHoldingInput,
  movementCycle: PortfolioMovementCycle,
) {
  const quoteType = holding.priceQuoteType?.trim().toLowerCase() ?? "";
  if (quoteType === MANUAL_ASSET_PRICE_POLICY.quoteType) {
    const priceTimestampMs = timestampMs(holding.priceAsOf);
    return (
      holding.priceStatus === MANUAL_ASSET_PRICE_POLICY.status &&
      Number.isFinite(holding.currentPrice) &&
      holding.currentPrice > 0 &&
      priceTimestampMs >= movementCycle.liveWindowStartAt.getTime() &&
      priceTimestampMs < movementCycle.liveWindowEndAt.getTime()
    );
  }
  if (!MOVEMENT_FRESH_PRICE_QUOTE_TYPES.has(quoteType)) return false;
  if (holding.priceStatus && holding.priceStatus !== "ok") return false;

  const priceTimestampMs = Math.max(
    timestampMs(holding.priceFetchedAt),
    timestampMs(holding.priceAsOf),
  );
  return (
    priceTimestampMs >= movementCycle.liveWindowStartAt.getTime() &&
    priceTimestampMs < movementCycle.liveWindowEndAt.getTime()
  );
}

function movementPriceExclusionReason(
  holding: PortfolioMovementHoldingInput,
): PortfolioMovementExclusionReason {
  return holding.priceQuoteType?.trim().toLowerCase() ===
    MANUAL_ASSET_PRICE_POLICY.quoteType
    ? "manual_valuation_not_updated_in_cycle"
    : "missing_fresh_live_prices";
}

function calculatePreviousCloseContribution(
  holding: PortfolioMovementHoldingInput,
  priceRows: PortfolioMovementPriceSnapshotInput[],
  referenceDate: string | null,
  usdKrwRate: number,
) {
  const ticker = normalizeTicker(holding.ticker);
  if (!ticker || !referenceDate) return "missing_previous_close_fallback" as const;

  const previousRow = findPreviousClosePriceRow(
    priceRows,
    holding,
    referenceDate,
  );
  if (!previousRow) return "missing_previous_close_fallback" as const;

  const closePrice = resolveOperationalClosePrice(previousRow);
  if (closePrice === null || closePrice <= 0) return "missing_previous_close_fallback" as const;

  const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
  if (!currentFx.ok) return "missing_current_fx" as const;

  const previousFxRate = currentFx.requiresFx
    ? positiveNumber(previousRow.fxRate) ?? inferFxRateFromClose(previousRow)
    : 1;
  if (previousFxRate === null || previousFxRate <= 0) return "missing_baseline_fx" as const;
  const currentBaseValueKrw =
    holding.quantity * holding.currentPrice * currentFx.rate;
  const fractionalKrwValue = Math.max(holding.valueKrw - currentBaseValueKrw, 0);
  const movement = calculateFxAwarePositionMovementKrw({
    marketExposedQuantity: holding.quantity,
    currentPrice: holding.currentPrice,
    previousPrice: closePrice,
    currentFxRate: currentFx.rate,
    previousFxRate,
    fixedKrwValue: fractionalKrwValue,
  });

  return {
    holdingId: holding.id,
    previousValueKrw: movement.previousValueKrw,
    changeKrw: movement.changeKrw,
    returnPct: percentOrNull(movement.changeKrw, movement.previousValueKrw),
    tradeFlowKrw: 0,
    priceChangeKrw: movement.priceChangeKrw,
    fxChangeKrw: currentFx.requiresFx ? movement.fxChangeKrw : 0,
    previousPrice: closePrice,
    currentPrice: holding.currentPrice,
    previousFxRate,
    currentFxRate: currentFx.rate,
    source: "asset_price_snapshot" as const,
  };
}

function findPreviousClosePriceRow(
  rows: PortfolioMovementPriceSnapshotInput[],
  holding: PortfolioMovementHoldingInput,
  referenceDate: string,
) {
  return rows
    .filter((row) => isSamePriceInstrument(row, holding))
    .filter((row) => row.priceDate <= referenceDate)
    .filter((row) => {
      const ageDays = diffDays(referenceDate, row.priceDate);
      return ageDays >= 0 && ageDays <= PREVIOUS_CLOSE_MAX_AGE_DAYS;
    })
    .sort((a, b) => b.priceDate.localeCompare(a.priceDate))[0];
}

function emptyMovement(
  reason: string,
  coverage: PortfolioMovementCoverage,
  details: {
    contributionRows?: PortfolioMovementContribution[];
    exclusions?: PortfolioMovementExclusion[];
    priceChangeKrw?: number | null;
    fxChangeKrw?: number | null;
    previousTotalKrw?: number;
  } = {},
): PortfolioMovementResult {
  return {
    ready: false,
    source: null,
    reason,
    previousTotalKrw: details.previousTotalKrw ?? 0,
    changeKrw: null,
    returnPct: null,
    tradeFlowKrw: 0,
    priceChangeKrw: details.priceChangeKrw ?? null,
    fxChangeKrw: details.fxChangeKrw ?? null,
    contributions: new Map(),
    contributionRows: details.contributionRows ?? [],
    exclusions: details.exclusions ?? [],
    coverage,
  };
}

function resolveIndependentFxEvidence({
  matchedCount,
  matchedValueKrw,
  requiredCount,
  requiredValueKrw,
  valueKrw,
}: {
  matchedCount: number;
  matchedValueKrw: number;
  requiredCount: number;
  requiredValueKrw: number;
  valueKrw: number;
}) {
  if (requiredCount === 0) return 0;
  const countCoverage = matchedCount / requiredCount;
  const valueCoverage =
    requiredValueKrw > 0 ? matchedValueKrw / requiredValueKrw : 0;
  return countCoverage >= DAILY_MOVEMENT_MIN_COUNT_COVERAGE &&
    valueCoverage >= DAILY_MOVEMENT_MIN_VALUE_COVERAGE
    ? valueKrw
    : null;
}

function holdingExclusion(
  holding: PortfolioMovementHoldingInput,
  reason: PortfolioMovementExclusionReason,
  source: Exclude<PortfolioMovementSource, null>,
): PortfolioMovementExclusion {
  return {
    subject: "holding",
    reason,
    source,
    holdingId: holding.id,
    snapshotId: null,
    ticker: holding.ticker,
    assetName: holding.name,
    account: holding.account,
    currency: holding.currency,
    valueKrw: holding.valueKrw,
  };
}

function snapshotExclusion(
  snapshot: PortfolioMovementPositionSnapshotInput,
  reason: PortfolioMovementExclusionReason,
  source: Exclude<PortfolioMovementSource, null>,
): PortfolioMovementExclusion {
  return {
    subject: "snapshot",
    reason,
    source,
    holdingId: snapshot.assetId,
    snapshotId: snapshot.id,
    ticker: snapshot.ticker,
    assetName: snapshot.assetName,
    account: snapshot.account,
    currency: null,
    valueKrw: snapshotMarketValue(snapshot),
  };
}

function aggregateExclusion(
  reason: PortfolioMovementExclusionReason,
  source: Exclude<PortfolioMovementSource, null>,
): PortfolioMovementExclusion {
  return {
    subject: "aggregate",
    reason,
    source,
    holdingId: null,
    snapshotId: null,
    ticker: null,
    assetName: null,
    account: null,
    currency: null,
    valueKrw: null,
  };
}

function findPositionSnapshotForHolding(
  holding: PortfolioMovementHoldingInput,
  rows: PortfolioMovementPositionSnapshotInput[],
) {
  const matches = rows.filter((row) => positionSnapshotMatchesHolding(row, holding));
  return matches.length === 1 ? matches[0] : undefined;
}

function isPortfolioMovementEligibleSnapshot(
  row: PortfolioMovementPositionSnapshotInput,
  holdings: PortfolioMovementHoldingInput[],
) {
  const currentHolding = holdings.find((holding) =>
    positionSnapshotMatchesHolding(row, holding),
  );

  return isPortfolioMovementEligibleHolding(currentHolding ?? row);
}

export function positionSnapshotMatchesHolding(
  row: PortfolioMovementPositionSnapshotInput,
  holding: PortfolioMovementHoldingInput,
) {
  if (row.account !== holding.account) return false;
  if (row.assetId) return row.assetId === holding.id;
  if (row.legacyAssetId) return row.legacyAssetId === holding.legacyBase44Id;
  const holdingTicker = normalizeTicker(holding.ticker);
  if (holdingTicker && normalizeTicker(row.ticker) === holdingTicker) return true;
  return row.assetName === holding.name;
}

export function eventMatchesHolding(
  event: PortfolioMovementEventInput,
  holding: PortfolioMovementHoldingInput,
  selectedAccount: PortfolioMovementSelectedAccount,
) {
  if (!eventMatchesSelectedAccount(event, selectedAccount, holding.account)) {
    return false;
  }
  if (event.assetId) return event.assetId === holding.id;
  if (event.legacyAssetId) return event.legacyAssetId === holding.legacyBase44Id;
  const eventTicker = normalizeTicker(event.ticker);
  const holdingTicker = normalizeTicker(holding.ticker);
  if (eventTicker) return eventTicker === holdingTicker;
  return event.assetName === holding.name;
}

function eventMatchesSnapshot(
  event: PortfolioMovementEventInput,
  snapshot: PortfolioMovementPositionSnapshotInput,
  selectedAccount: PortfolioMovementSelectedAccount,
) {
  if (!eventMatchesSelectedAccount(event, selectedAccount, snapshot.account)) {
    return false;
  }
  if (event.assetId && snapshot.assetId) return event.assetId === snapshot.assetId;
  if (event.legacyAssetId) return event.legacyAssetId === snapshot.legacyAssetId;
  if (event.assetId) return false;
  const eventTicker = normalizeTicker(event.ticker);
  const snapshotTicker = normalizeTicker(snapshot.ticker);
  if (eventTicker) return eventTicker === snapshotTicker;
  return event.assetName === snapshot.assetName;
}

function eventMatchesSelectedAccount(
  event: PortfolioMovementEventInput,
  selectedAccount: PortfolioMovementSelectedAccount,
  fallbackAccount: string | null,
) {
  const eventAccount = portfolioEventAccount({
    ...event,
    legacyAssetId: event.legacyAssetId ?? "",
    assetName: event.assetName ?? "",
    quantityDelta: event.quantityDelta ?? null,
    price: event.price ?? null,
    fxRate: event.fxRate ?? null,
    memo: event.memo ?? null,
    recordedAt: event.recordedAt ?? null,
    createdAt: event.createdAt ?? new Date(0).toISOString(),
  });
  if (selectedAccount !== "all" && fallbackAccount !== selectedAccount) return false;
  if (eventAccount) return eventAccount === fallbackAccount;
  // The caller admits an accountless event only when its identity has one candidate.
  return true;
}

function snapshotMarketValue(row: PortfolioMovementPositionSnapshotInput) {
  return toNumber(row.marketValueKrw) ?? 0;
}

function snapshotPositionPrice(
  row: PortfolioMovementPositionSnapshotInput,
) {
  return (
    positiveNumber(row.unitPrice) ??
    positiveNumber(row.closePrice) ??
    positiveNumber(row.currentPrice)
  );
}

function positiveNumber(value: unknown) {
  const number = toNumber(value);
  return number !== null && number > 0 ? number : null;
}

function isMovementTrade(event: PortfolioMovementEventInput, baselineDate: string) {
  return event.eventDate > baselineDate && (event.eventType === "buy" || event.eventType === "sell" ||
    (event.movementWindowResolved && (event.movementEvidence === "unresolved" || event.eventType === "split")));
}

type ResolvedMovementTrade = PortfolioMovementEventInput & { amountKrw: number };

function indexMovementTrades(
  events: PortfolioMovementEventInput[],
  holdings: PortfolioMovementHoldingInput[],
  snapshots: PortfolioMovementPositionSnapshotInput[],
  selectedAccount: PortfolioMovementSelectedAccount,
  baselineDate: string,
): { byHolding: Map<string, ResolvedMovementTrade[]>; bySnapshot: Map<string, ResolvedMovementTrade[]> } |
   { reason: "ambiguous_trade_identity" | "missing_trade_amount" | "incomplete_trade_attribution" } {
  const byHolding = new Map<string, ResolvedMovementTrade[]>();
  const bySnapshot = new Map<string, ResolvedMovementTrade[]>();
  const exitedSnapshots = snapshots.filter((snapshot) =>
    !holdings.some((holding) => positionSnapshotMatchesHolding(snapshot, holding)),
  );
  for (const event of events.filter((row) => isMovementTrade(row, baselineDate))) {
    const unresolved = event.movementWindowResolved && (event.movementEvidence === "unresolved" || event.eventType === "split");
    if (unresolved && !event.assetId && !event.legacyAssetId && !normalizeTicker(event.ticker) && !event.assetName &&
        (selectedAccount === "all" || !event.account || selectedAccount === event.account)) return { reason: "incomplete_trade_attribution" };
    const holdingMatches = holdings.filter((holding) => eventMatchesHolding(event, holding, selectedAccount));
    const snapshotMatches = exitedSnapshots.filter((snapshot) => eventMatchesSnapshot(event, snapshot, selectedAccount));
    if (holdingMatches.length + snapshotMatches.length > 1) return { reason: "ambiguous_trade_identity" };
    if (holdingMatches.length + snapshotMatches.length === 0) continue;
    if (unresolved) return { reason: "incomplete_trade_attribution" };
    const baseline = holdingMatches.length === 1
      ? snapshots.find((snapshot) => positionSnapshotMatchesHolding(snapshot, holdingMatches[0]))
      : snapshotMatches[0];
    if (!event.movementWindowResolved && baseline?.description?.split(/;\s*/).includes("valuation_policy=execution_collection_v1")) {
      const capturedAt = baseline.capturedAt == null ? NaN : new Date(baseline.capturedAt).getTime();
      // A backdated event recorded after capture was not included in that
      // snapshot. Creation time is the ledger inclusion boundary, not its date.
      const includedAt = event.createdAt ?? event.recordedAt;
      const recordedAt = includedAt == null ? NaN : new Date(includedAt).getTime();
      if (!Number.isFinite(capturedAt) || !Number.isFinite(recordedAt)) return { reason: "incomplete_trade_attribution" };
      if (recordedAt <= capturedAt) continue;
    }
    const amountKrw = resolveMovementTradeAmount(event, holdingMatches[0]?.currency ?? snapshotMatches[0]?.currency);
    if (amountKrw === null) return { reason: "missing_trade_amount" };
    const resolvedEvent = { ...event, amountKrw };
    if (holdingMatches.length === 1) {
      const id = holdingMatches[0].id;
      byHolding.set(id, [...(byHolding.get(id) ?? []), resolvedEvent]);
      continue;
    }
    if (snapshotMatches.length === 1) {
      const id = snapshotMatches[0].id;
      bySnapshot.set(id, [...(bySnapshot.get(id) ?? []), resolvedEvent]);
    }
  }
  return { byHolding, bySnapshot };
}

function sumTradeFlows(events: ResolvedMovementTrade[]) {
  return sumBy(events, (event) => Math.abs(event.amountKrw) * (event.eventType === "sell" ? -1 : 1));
}

function resolveMovementTradeAmount(event: PortfolioMovementEventInput, currency: string | null | undefined) {
  const explicitAmount = toNumber(event.amountKrw);
  if (explicitAmount !== null) return Math.abs(explicitAmount);
  const code = currency?.trim().toUpperCase();
  if (code !== "KRW" && code !== "USD") return null;
  const leg = movementTradeLegs([event], code === "USD")?.[0];
  if (!leg) return null;
  const amount = Math.abs(leg.quantityDelta * leg.price * leg.fxRate);
  return Number.isFinite(amount) ? amount : null;
}

function movementTradeQuantity(event: PortfolioMovementEventInput) {
  const before = toNumber(parseMovementObject(event.beforeValue).quantity);
  const after = toNumber(parseMovementObject(event.afterValue).quantity);
  return Math.abs(toNumber(event.quantityDelta) ?? (before !== null && after !== null ? after - before : 0));
}

function movementTradeLegs(events: PortfolioMovementEventInput[], requiresFx: boolean) {
  const legs: { quantityDelta: number; price: number; fxRate: number }[] = [];
  for (const event of events) {
    const quantity = movementTradeQuantity(event);
    const price = positiveNumber(event.price);
    const fxRate = requiresFx ? positiveNumber(event.fxRate) : 1;
    if (!(quantity > 0) || price === null || fxRate === null) return null;
    legs.push({ quantityDelta: quantity * (event.eventType === "sell" ? -1 : 1), price, fxRate });
  }
  return legs;
}

function hasPostTradeQuote(holding: PortfolioMovementHoldingInput, events: PortfolioMovementEventInput[], cycle: PortfolioMovementCycle) {
  const quoteTime = holding.priceAsOf == null ? NaN : new Date(holding.priceAsOf).getTime();
  const start = cycle.liveWindowStartAt.getTime();
  return hasFreshMovementPrice(holding, cycle) && holding.currentPrice > 0 && quoteTime >= start &&
    quoteTime < cycle.liveWindowEndAt.getTime() && events.every(event => {
      const knownBy = event.movementEffectiveAt ?? event.createdAt;
      if (knownBy == null) return false;
      const bound = new Date(knownBy).getTime();
      return bound >= start && bound <= quoteTime;
    });
}

function openingQuantityBeforePurchases(events: PortfolioMovementEventInput[]) {
  const knownBefore = events.map(event => toNumber(parseMovementObject(event.beforeValue).quantity));
  if (knownBefore.includes(0)) return 0;
  return knownBefore.length && knownBefore.every((q): q is number => q !== null && q >= 0) ? Math.min(...knownBefore) : null;
}

/** Local-currency P&L of the identified purchases survives missing execution
 * FX. Never treat it as KRW, or guess the remaining lots after a sale. */
export function currentLocalPurchaseMovement(
  holding: PortfolioMovementHoldingInput, snapshot: PortfolioMovementPositionSnapshotInput | undefined,
  events: PortfolioMovementEventInput[], cycle: PortfolioMovementCycle,
): PortfolioMovementExclusion["localPurchases"] {
  if (holding.currency.trim().toUpperCase() !== "USD" || (snapshot?.currency && snapshot.currency.trim().toUpperCase() !== "USD") ||
    !events.length || events.some(event => event.eventType !== "buy" || event.movementEvidence === "unresolved") ||
    !hasPostTradeQuote(holding, events, cycle)) return;
  // Only the quantity and original unit price are needed here.
  const legs = movementTradeLegs(events, false);
  if (!legs) return;
  const boughtQuantity = sumBy(legs, leg => leg.quantityDelta);
  // With buys only, the smallest confirmed pre-fill quantity is the opening
  // if all fills carry it. An incomplete sequence is not a quantity anchor.
  const fillOpening = openingQuantityBeforePurchases(events);
  const opening = toNumber(snapshot?.quantity) ?? fillOpening;
  const tolerance = Math.max(1e-8, holding.quantity * 1e-10);
  if (boughtQuantity > holding.quantity + tolerance || (opening !== null &&
    (opening < 0 || (fillOpening !== null && Math.abs(fillOpening - opening) > tolerance) ||
    Math.abs(opening + boughtQuantity - holding.quantity) > tolerance))) return;
  const localCost = sumBy(legs, leg => leg.quantityDelta * leg.price);
  const buyPriceChangeLocal = boughtQuantity * holding.currentPrice - localCost;
  const openingPrice = snapshot && snapshotPositionPrice(snapshot);
  const openingPriceChangeLocal = opening === 0 ? 0 :
    opening !== null && openingPrice ? opening * (holding.currentPrice - openingPrice) : null;
  return { currency: "USD", boughtQuantity, averageBuyPrice: localCost / boughtQuantity, currentPrice: holding.currentPrice,
    buyPriceChangeLocal, buyPriceReturnPctLocal: percentOrNull(buyPriceChangeLocal, localCost),
    openingQuantity: opening, openingPriceChangeLocal,
    totalPriceChangeLocal: openingPriceChangeLocal === null ? null : openingPriceChangeLocal + buyPriceChangeLocal };
}

/** Mark verified effective fills against the latest quote. Both the position
 * quantity and its change net of gross trade consideration must reconcile. */
export function currentExecutionContribution(
  holding: PortfolioMovementHoldingInput,
  snapshot: PortfolioMovementPositionSnapshotInput | undefined,
  events: PortfolioMovementEventInput[],
  usdKrwRate: number,
  cycle: PortfolioMovementCycle,
): PortfolioMovementContribution | PortfolioMovementExclusionReason {
  const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
  if (!currentFx.ok) return currentFx.reason === "unsupported_currency" ? "unsupported_currency" : "missing_current_fx";
  if (events.some(event => event.movementEvidence === "unresolved" || !["buy", "sell"].includes(event.eventType))) {
    return "incomplete_trade_attribution";
  }
  // A provider fetch after a purchase can still carry a pre-purchase quote.
  if (!hasPostTradeQuote(holding, events, cycle)) return movementPriceExclusionReason(holding);
  if (snapshot?.currency && snapshot.currency.trim().toUpperCase() !== currentFx.currency) return "incomplete_trade_attribution";
  if (currentFx.requiresFx && events.some(event => positiveNumber(event.fxRate) === null)) return "missing_trade_fx";
  const legs = movementTradeLegs(events, currentFx.requiresFx);
  const first = legs?.[0];
  if (!legs || !first) return "incomplete_trade_attribution";
  const amounts = events.map(event => resolveMovementTradeAmount(event, holding.currency));
  if (amounts.some(amount => amount === null || amount <= 0)) return "missing_trade_amount";
  let boughtQuantity = 0, soldQuantity = 0, localBuyCost = 0, buyAmountKrw = 0, sellAmountKrw = 0;
  for (const [i, leg] of legs.entries()) {
    const gross = amounts[i]!;
    if (Math.abs(Math.abs(leg.quantityDelta) * leg.price * leg.fxRate - gross) > Math.max(.01, gross * 1e-10)) {
      return "incomplete_trade_attribution";
    }
    if (leg.quantityDelta > 0) {
      boughtQuantity += leg.quantityDelta;
      localBuyCost += leg.quantityDelta * leg.price;
      buyAmountKrw += gross;
    } else {
      soldQuantity -= leg.quantityDelta;
      sellAmountKrw += gross;
    }
  }
  const tolerance = Math.max(1e-8, holding.quantity * 1e-10);
  // Without a saved opening, admit only a fully evidenced new buy. The first
  // observed fill isn't a zero opening for a top-up to an existing position.
  const openingQuantity = snapshot ? toNumber(snapshot.quantity) : 0;
  if (openingQuantity === null || openingQuantity < 0 ||
      Math.abs(openingQuantity + boughtQuantity - soldQuantity - holding.quantity) > tolerance) return "incomplete_trade_attribution";
  const fillOpening = soldQuantity ? null : openingQuantityBeforePurchases(events);
  if (fillOpening !== null && Math.abs(openingQuantity - fillOpening) > tolerance) return "incomplete_trade_attribution";
  if (!snapshot) {
    if (fillOpening !== 0) return "missing_baseline_snapshot";
  }
  const previousValueKrw = snapshot ? toNumber(snapshot.marketValueKrw) : 0;
  if (previousValueKrw === null || previousValueKrw < 0 || (openingQuantity === 0) !== (previousValueKrw === 0)) return "missing_baseline_snapshot";
  const previousPrice = openingQuantity && snapshot ? snapshotPositionPrice(snapshot) : first.price;
  if (previousPrice === null) return "missing_baseline_price";
  const previousFxRate = !currentFx.requiresFx ? 1 : openingQuantity && snapshot ?
    positiveNumber(snapshot.fxRate) ?? positiveNumber(snapshot.previousFxRate) : first.fxRate;
  if (previousFxRate === null) return "missing_baseline_fx";
  const tradeFlowKrw = buyAmountKrw - sellAmountKrw;
  const movement = calculateFxAwareSnapshotMovementKrw({ quantity: holding.quantity, previousQuantity: openingQuantity,
    trades: legs, currentPrice: holding.currentPrice, currentValueKrw: holding.valueKrw, previousPrice, previousValueKrw,
    currentFxRate: currentFx.rate, previousFxRate, tradeFlowKrw });
  if (movement.priceChangeKrw === null || movement.fxChangeKrw === null) return "incomplete_trade_attribution";
  const mark = holding.currentPrice * currentFx.rate;
  const openingPriceChangeLocal = soldQuantity ? null : openingQuantity * (holding.currentPrice - previousPrice);
  const buyPriceChangeLocal = boughtQuantity * holding.currentPrice - localBuyCost;
  return { holdingId: holding.id, previousValueKrw, changeKrw: movement.changeKrw,
    returnPct: percentOrNull(movement.changeKrw, previousValueKrw), tradeFlowKrw,
    priceChangeKrw: movement.priceChangeKrw, fxChangeKrw: movement.fxChangeKrw,
    previousPrice, currentPrice: holding.currentPrice, previousFxRate, currentFxRate: currentFx.rate,
    source: openingQuantity > 0 ? "daily_position_snapshot" : "trade_execution",
    execution: { openingQuantity, boughtQuantity, soldQuantity, buyAmountKrw, sellAmountKrw,
      openingMarkChangeKrw: openingQuantity * (mark - previousPrice * previousFxRate),
      buyMarkChangeKrw: boughtQuantity * mark - buyAmountKrw,
      sellAdjustmentKrw: sellAmountKrw - soldQuantity * mark,
      averageBuyPrice: boughtQuantity ? localBuyCost / boughtQuantity : null,
      buyPriceChangeLocal, buyPriceReturnPctLocal: percentOrNull(buyPriceChangeLocal, localBuyCost), openingPriceChangeLocal,
      totalPriceChangeLocal: openingPriceChangeLocal === null ? null : openingPriceChangeLocal + buyPriceChangeLocal } };
}

function calculateExitedPositionAttribution(
  snapshot: PortfolioMovementPositionSnapshotInput,
  events: PortfolioMovementEventInput[],
  previousValueKrw: number,
  tradeFlowKrw: number,
) {
  const currency = snapshot.currency?.trim().toUpperCase();
  const openingQuantity = positiveNumber(snapshot.quantity);
  if (!events.length || !openingQuantity || events.some(event => movementTradeQuantity(event) === 0 || !(Number(event.amountKrw) > 0))) return null;
  const closingQuantity = openingQuantity + sumBy(events, event => movementTradeQuantity(event) * (event.eventType === "sell" ? -1 : 1));
  if (Math.abs(closingQuantity) > Math.max(1e-8, openingQuantity * 1e-10)) return null;
  // Complete quantity closure and verified KRW consideration prove the net
  // result even when the instruments' local prices or FX decomposition do not.
  const changeKrw = -tradeFlowKrw - previousValueKrw;
  if (currency !== "KRW" && currency !== "USD") return { changeKrw, attribution: null };
  const trades = movementTradeLegs(events, currency === "USD");
  const previousPrice = snapshotPositionPrice(snapshot);
  const previousFxRate = currency === "KRW" ? 1 : positiveNumber(snapshot.fxRate) ?? positiveNumber(snapshot.previousFxRate);
  if (!trades || previousPrice === null || previousFxRate === null) return { changeKrw, attribution: null };
  const movement = calculateClosedPositionMovementKrw(trades, tradeFlowKrw, openingQuantity * previousPrice, previousValueKrw, previousFxRate);
  return typeof movement === "string" ? null : { changeKrw, attribution: movement };
}

function parseMovementObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return parseMovementObject(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function isInvestmentSnapshot(row: PortfolioMovementPositionSnapshotInput) {
  if (!row.assetType) return true;
  return MOVEMENT_INVESTMENT_ASSET_TYPES.has(row.assetType);
}

function inferFxRateFromClose(row: PortfolioMovementPriceSnapshotInput) {
  const closePriceKrw = toNumber(row.closePriceKrw);
  const closePrice = toNumber(row.closePrice);
  if (closePriceKrw === null || closePrice === null || closePrice <= 0) return null;
  return closePriceKrw / closePrice;
}

function timestampMs(value: Date | string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}
