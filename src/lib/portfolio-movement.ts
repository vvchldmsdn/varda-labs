import {
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

const MOVEMENT_INVESTMENT_ASSET_TYPES = new Set([
  "etf",
  "stock",
  "pension",
  "commodity",
]);
const DAILY_MOVEMENT_MIN_VALUE_COVERAGE = 0.8;
const DAILY_MOVEMENT_MIN_COUNT_COVERAGE = 0.6;
const PREVIOUS_CLOSE_MAX_AGE_DAYS = 10;
const MOVEMENT_FRESH_PRICE_QUOTE_TYPES = new Set(["live", "delayed", "realtime"]);

export type PortfolioMovementAccount = "brokerage" | "isa" | "irp";
export type PortfolioMovementSelectedAccount = PortfolioMovementAccount | "all";
export type PortfolioMovementSource =
  | "daily_position_snapshot"
  | "asset_price_snapshot"
  | null;

export type PortfolioMovementHoldingInput = {
  id: string;
  legacyBase44Id: string | null;
  name: string;
  ticker: string | null;
  account: string;
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
};

export type PortfolioMovementPriceSnapshotInput = {
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
  fxChangeKrw: number;
  source: Exclude<PortfolioMovementSource, null>;
};

export type PortfolioMovementExclusionReason =
  | "missing_baseline_snapshot"
  | "missing_fresh_live_prices"
  | "missing_previous_close_fallback"
  | "unsupported_currency"
  | "missing_current_fx"
  | "missing_baseline_fx"
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
  fxChangeKrw: number | null;
  contributions: Map<string, PortfolioMovementContribution>;
  contributionRows: PortfolioMovementContribution[];
  exclusions: PortfolioMovementExclusion[];
  coverage: PortfolioMovementCoverage;
};

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
  const emptyCoverage = {
    currentCoveragePct: null,
    snapshotCoveragePct: null,
    countCoveragePct: null,
    previousCloseCoveragePct: null,
  };

  if (!baselineDate) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage, {
      exclusions: holdings.map((holding) =>
        holdingExclusion(
          holding,
          "missing_baseline_snapshot",
          "daily_position_snapshot",
        ),
      ),
    });
  }

  const accountRows = positionRows.filter(
    (row) =>
      (selectedAccount === "all" || row.account === selectedAccount) &&
      isInvestmentSnapshot(row),
  );
  const snapshotTotalValue = sumBy(accountRows, snapshotMarketValue);
  const currentTotalValue = sumBy(holdings, (holding) => holding.valueKrw);

  if (accountRows.length === 0 || snapshotTotalValue <= 0 || currentTotalValue <= 0) {
    return emptyMovement("missing_baseline_snapshot", emptyCoverage, {
      exclusions: holdings.map((holding) =>
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
  const matchedSnapshotIds = new Set<string>();
  let matchedCurrentValue = 0;
  let matchedSnapshotValue = 0;
  let matchedCount = 0;
  let tradeFlowKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of holdings) {
    const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
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
    if (!hasFreshMovementPrice(holding, movementCycle)) {
      exclusions.push(
        holdingExclusion(
          holding,
          "missing_fresh_live_prices",
          "daily_position_snapshot",
        ),
      );
      continue;
    }

    const snapshot = findPositionSnapshotForHolding(holding, accountRows);
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
    const holdingTradeFlowKrw = calculateTradeFlowForHolding(
      eventRows,
      holding,
      selectedAccount,
      baselineDate,
    );
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
    const movement = calculateFxAwareSnapshotMovementKrw({
      quantity: holding.quantity,
      currentPrice: holding.currentPrice,
      currentValueKrw: holding.valueKrw,
      previousPrice: snapshotPositionPrice(snapshot, holding.currentPrice),
      previousValueKrw,
      currentFxRate: currentFx.rate,
      previousFxRate: effectivePreviousFxRate,
      tradeFlowKrw: holdingTradeFlowKrw,
    });
    const holdingFxChangeKrw =
      currentFx.requiresFx ? movement.fxChangeKrw : 0;

    contributions.set(holding.id, {
      holdingId: holding.id,
      previousValueKrw,
      changeKrw: movement.changeKrw,
      returnPct: percentOrNull(movement.changeKrw, previousValueKrw),
      tradeFlowKrw: holdingTradeFlowKrw,
      fxChangeKrw: holdingFxChangeKrw,
      source: "daily_position_snapshot",
    });
    matchedSnapshotIds.add(snapshot.id);
    matchedCurrentValue += holding.valueKrw;
    matchedSnapshotValue += previousValueKrw;
    matchedCount += 1;
    tradeFlowKrw += holdingTradeFlowKrw;
    fxChangeKrw += holdingFxChangeKrw;
  }

  const currentCoverage = currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : 0;
  const snapshotCoverage =
    snapshotTotalValue > 0 ? matchedSnapshotValue / snapshotTotalValue : 0;
  const countCoverage = holdings.length > 0 ? matchedCount / holdings.length : 0;
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

  if (!hasEnoughCoverage) {
    return emptyMovement("missing_fresh_live_prices", coverage, {
      contributionRows: [...contributions.values()],
      exclusions: [
        ...exclusions,
        aggregateExclusion("coverage_below_threshold", "daily_position_snapshot"),
      ],
    });
  }

  let changeKrw = sumBy([...contributions.values()], (row) => row.changeKrw);
  for (const row of accountRows) {
    if (matchedSnapshotIds.has(row.id)) continue;
    const previousValueKrw = snapshotMarketValue(row);
    if (previousValueKrw <= 0) continue;
    const removedTradeFlowKrw = calculateTradeFlowForSnapshot(
      eventRows,
      row,
      selectedAccount,
      baselineDate,
    );
    changeKrw += -previousValueKrw - removedTradeFlowKrw;
    tradeFlowKrw += removedTradeFlowKrw;
  }

  return {
    ready: true,
    source: "daily_position_snapshot",
    reason: null,
    previousTotalKrw: snapshotTotalValue,
    changeKrw,
    returnPct: percentOrNull(changeKrw, snapshotTotalValue),
    tradeFlowKrw,
    fxChangeKrw,
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
  const contributions = new Map<string, PortfolioMovementContribution>();
  const exclusions: PortfolioMovementExclusion[] = [];
  const currentTotalValue = sumBy(holdings, (holding) => holding.valueKrw);
  let matchedCurrentValue = 0;
  let matchedCount = 0;
  let previousTotalKrw = 0;
  let changeKrw = 0;
  let fxChangeKrw = 0;

  for (const holding of holdings) {
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
          "missing_fresh_live_prices",
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
    if (!previous) {
      exclusions.push(
        holdingExclusion(
          holding,
          "missing_previous_close_fallback",
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
    fxChangeKrw += previous.fxChangeKrw;
  }

  const valueCoverage =
    currentTotalValue > 0 ? matchedCurrentValue / currentTotalValue : 0;
  const countCoverage = holdings.length > 0 ? matchedCount / holdings.length : 0;
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

function calculatePreviousCloseContribution(
  holding: PortfolioMovementHoldingInput,
  priceRows: PortfolioMovementPriceSnapshotInput[],
  referenceDate: string | null,
  usdKrwRate: number,
) {
  const ticker = normalizeTicker(holding.ticker);
  if (!ticker || !referenceDate) return null;

  const previousRow = findPreviousClosePriceRow(priceRows, ticker, referenceDate);
  if (!previousRow) return null;

  const closePrice =
    toNumber(previousRow.adjustedClosePrice) ?? toNumber(previousRow.closePrice);
  if (closePrice === null || closePrice <= 0) return null;

  const currentFx = resolveKrwFxRate(holding.currency, usdKrwRate);
  if (!currentFx.ok) return null;

  const previousFxRate = currentFx.requiresFx
    ? toNumber(previousRow.fxRate) ?? inferFxRateFromClose(previousRow) ?? currentFx.rate
    : 1;
  const currentBaseValueKrw =
    holding.quantity * holding.currentPrice * currentFx.rate;
  const fractionalKrwValue = Math.max(holding.valueKrw - currentBaseValueKrw, 0);
  const movement = calculateFxAwarePositionMovementKrw({
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    previousPrice: closePrice,
    currentFxRate: currentFx.rate,
    previousFxRate,
    fractionalKrwValue,
  });

  return {
    holdingId: holding.id,
    previousValueKrw: movement.previousValueKrw,
    changeKrw: movement.changeKrw,
    returnPct: percentOrNull(movement.changeKrw, movement.previousValueKrw),
    tradeFlowKrw: 0,
    fxChangeKrw: currentFx.requiresFx ? movement.fxChangeKrw : 0,
    source: "asset_price_snapshot" as const,
  };
}

function findPreviousClosePriceRow(
  rows: PortfolioMovementPriceSnapshotInput[],
  ticker: string,
  referenceDate: string,
) {
  return rows
    .filter((row) => normalizeTicker(row.ticker) === ticker)
    .filter((row) => row.priceDate < referenceDate)
    .filter((row) => {
      const ageDays = diffDays(referenceDate, row.priceDate);
      return ageDays >= 1 && ageDays <= PREVIOUS_CLOSE_MAX_AGE_DAYS;
    })
    .sort((a, b) => b.priceDate.localeCompare(a.priceDate))[0];
}

function emptyMovement(
  reason: string,
  coverage: PortfolioMovementCoverage,
  details: {
    contributionRows?: PortfolioMovementContribution[];
    exclusions?: PortfolioMovementExclusion[];
  } = {},
): PortfolioMovementResult {
  return {
    ready: false,
    source: null,
    reason,
    previousTotalKrw: 0,
    changeKrw: null,
    returnPct: null,
    tradeFlowKrw: 0,
    fxChangeKrw: null,
    contributions: new Map(),
    contributionRows: details.contributionRows ?? [],
    exclusions: details.exclusions ?? [],
    coverage,
  };
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
  const holdingTicker = normalizeTicker(holding.ticker);

  return rows.find((row) => {
    if (row.account !== holding.account) return false;
    if (row.assetId && row.assetId === holding.id) return true;
    if (row.legacyAssetId && row.legacyAssetId === holding.legacyBase44Id) {
      return true;
    }
    if (holdingTicker && normalizeTicker(row.ticker) === holdingTicker) return true;
    return row.assetName === holding.name;
  });
}

function calculateTradeFlowForHolding(
  events: PortfolioMovementEventInput[],
  holding: PortfolioMovementHoldingInput,
  selectedAccount: PortfolioMovementSelectedAccount,
  baselineDate: string,
) {
  return events
    .filter((event) => event.eventDate > baselineDate)
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .filter((event) => eventMatchesHolding(event, holding, selectedAccount))
    .reduce((sum, event) => {
      const amount = toNumber(event.amountKrw) ?? 0;
      if (event.eventType === "buy") return sum + Math.abs(amount);
      if (event.eventType === "sell") return sum - Math.abs(amount);
      return sum;
    }, 0);
}

function calculateTradeFlowForSnapshot(
  events: PortfolioMovementEventInput[],
  snapshot: PortfolioMovementPositionSnapshotInput,
  selectedAccount: PortfolioMovementSelectedAccount,
  baselineDate: string,
) {
  return events
    .filter((event) => event.eventDate > baselineDate)
    .filter((event) => event.eventType === "buy" || event.eventType === "sell")
    .filter((event) => eventMatchesSnapshot(event, snapshot, selectedAccount))
    .reduce((sum, event) => {
      const amount = toNumber(event.amountKrw) ?? 0;
      if (event.eventType === "buy") return sum + Math.abs(amount);
      if (event.eventType === "sell") return sum - Math.abs(amount);
      return sum;
    }, 0);
}

function eventMatchesHolding(
  event: PortfolioMovementEventInput,
  holding: PortfolioMovementHoldingInput,
  selectedAccount: PortfolioMovementSelectedAccount,
) {
  if (!eventMatchesSelectedAccount(event, selectedAccount, holding.account)) {
    return false;
  }
  if (event.assetId && event.assetId === holding.id) return true;
  if (event.legacyAssetId && event.legacyAssetId === holding.legacyBase44Id) {
    return true;
  }
  const eventTicker = normalizeTicker(event.ticker);
  const holdingTicker = normalizeTicker(holding.ticker);
  if (eventTicker && holdingTicker && eventTicker === holdingTicker) return true;
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
  if (event.assetId && snapshot.assetId && event.assetId === snapshot.assetId) {
    return true;
  }
  if (event.legacyAssetId && event.legacyAssetId === snapshot.legacyAssetId) {
    return true;
  }
  const eventTicker = normalizeTicker(event.ticker);
  const snapshotTicker = normalizeTicker(snapshot.ticker);
  if (eventTicker && snapshotTicker && eventTicker === snapshotTicker) return true;
  return event.assetName === snapshot.assetName;
}

function eventMatchesSelectedAccount(
  event: PortfolioMovementEventInput,
  selectedAccount: PortfolioMovementSelectedAccount,
  fallbackAccount: string | null,
) {
  if (selectedAccount === "all") return true;
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
  if (eventAccount) return eventAccount === selectedAccount;
  if (fallbackAccount) return fallbackAccount === selectedAccount;
  return selectedAccount === "brokerage";
}

function snapshotMarketValue(row: PortfolioMovementPositionSnapshotInput) {
  return toNumber(row.marketValueKrw) ?? 0;
}

function snapshotPositionPrice(
  row: PortfolioMovementPositionSnapshotInput,
  fallbackPrice: number,
) {
  return (
    toNumber(row.unitPrice) ??
    toNumber(row.closePrice) ??
    toNumber(row.currentPrice) ??
    fallbackPrice
  );
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
