import { availableHoldingValueKrw } from "../home-metrics.ts";
import { isKrxGoldManualInstrumentCandidate } from "../market-data/manual-asset-price.ts";
import { calculateFxAwarePositionMovementKrw, percentOrNull, resolveKrwFxRate } from "../portfolio-math.ts";
import type { OriginalCurrentValuePresentation } from "./current-value-presentation.ts";
import { currentHistoryValuation, reviewedLiveBaseline, todayChangeForHistory } from "./history-current.ts";
import type { BetaView } from "./read-contract.ts";
import { reviewedPositionKey, type ReviewedHistoryPosition } from "./reviewed-history-positions.ts";

type LivePosition = Omit<ReviewedHistoryPosition, "market" | "currency"> & {
  market: string;
  currency: string;
  account: string | null;
};

export type ReviewedCurrentMovementRow = {
  key: string;
  name: string;
  ticker: string | null;
  market: string;
  currency: string;
  account: string | null;
  previousValueKrw: number;
  currentValueKrw: number;
  changeKrw: number;
  returnPct: number | null;
  priceChangeKrw: number;
  fxChangeKrw: number;
  quantityChangeKrw: number;
};

export type ReviewedCurrentMovement = {
  cutoffDate: string;
  asOf: string;
  previousValueKrw: number;
  currentValueKrw: number;
  priceChangeKrw: number;
  fxChangeKrw: number;
  quantityChangeKrw: number;
  rows: ReviewedCurrentMovementRow[];
};

const withinCent = (a: number, b: number) => Math.abs(a - b) <= 0.01;
const separateRounding = (value: number) => Math.abs(value) <= 1e-8 ? 0 : value;

function legacyPositions(read: Extract<OriginalCurrentValuePresentation, { kind: "legacy" }>) {
  const positions = new Map<string, LivePosition>();
  for (const holding of read.data.holdings) {
    const { name, account, market, currency, quantity, currentPrice: price } = holding;
    const ticker = holding.ticker?.trim().toUpperCase() || null;
    const key = ticker || isKrxGoldManualInstrumentCandidate(holding)
      ? reviewedPositionKey(ticker, market ?? "", currency)
      : null;
    const valueKrw = availableHoldingValueKrw(holding, read.data.usdKrwRate);
    const fx = resolveKrwFxRate(currency, read.data.usdKrwRate);
    if (!key || !market || !fx.ok || valueKrw === null || valueKrw < 0 || !Number.isFinite(quantity) || quantity < 0) return null;
    const prior = positions.get(key);
    if (prior && prior.price !== price) return null;
    positions.set(key, {
      key, name, account: !prior || prior.account === account ? account : null, ticker, market, currency, price,
      quantity: quantity + (prior?.quantity ?? 0), fxRate: fx.rate, valueKrw: valueKrw + (prior?.valueKrw ?? 0),
    });
  }
  return positions;
}

/** Decompose the same endpoint valuations as the history headline. Match common
 * shares for repricing, and leave changed quantities and fixed values explicit. */
export function projectReviewedCurrentMovement(view: BetaView): ReviewedCurrentMovement | null {
  const baseline = reviewedLiveBaseline(view);
  const current = currentHistoryValuation(view, "KRW");
  const read = view.domain?.currentValuePresentation;
  if (!baseline?.positions || baseline.valueKrw === null || !current?.complete || current.amount === null || !current.asOf ||
    read?.kind !== "legacy") return null;
  const currentPositions = legacyPositions(read);
  if (!currentPositions) return null;
  const previousPositions = new Map(baseline.positions.map(row => [row.key, row]));
  const rows = [...new Set([...previousPositions.keys(), ...currentPositions.keys()])].map(key => {
    const previous = previousPositions.get(key);
    const position = currentPositions.get(key);
    const { name, ticker, market, currency } = position ?? previous!;
    const previousValueKrw = previous?.valueKrw ?? 0;
    const currentValueKrw = position?.valueKrw ?? 0;
    const changeKrw = currentValueKrw - previousValueKrw;
    const { priceChangeKrw, fxChangeKrw } = previous && position ? calculateFxAwarePositionMovementKrw({
      marketExposedQuantity: Math.min(previous.quantity, position.quantity),
      previousPrice: previous.price, currentPrice: position.price,
      previousFxRate: previous.fxRate, currentFxRate: position.fxRate,
    }) : { priceChangeKrw: 0, fxChangeKrw: 0 };
    return {
      key, name, ticker, market, currency, account: position?.account ?? null,
      previousValueKrw, currentValueKrw, changeKrw, returnPct: percentOrNull(changeKrw, previousValueKrw),
      priceChangeKrw, fxChangeKrw, quantityChangeKrw: separateRounding(changeKrw - priceChangeKrw - fxChangeKrw),
    };
  });
  const sum = (field: "previousValueKrw" | "currentValueKrw" | "priceChangeKrw" | "fxChangeKrw" | "quantityChangeKrw") =>
    rows.reduce((total, row) => total + row[field], 0);
  const previousValueKrw = baseline.valueKrw;
  const currentValueKrw = Number(current.amount);
  if (!withinCent(sum("previousValueKrw"), previousValueKrw) || !withinCent(sum("currentValueKrw"), currentValueKrw)) return null;
  return {
    cutoffDate: baseline.date, asOf: current.asOf, previousValueKrw, currentValueKrw, rows,
    priceChangeKrw: sum("priceChangeKrw"), fxChangeKrw: sum("fxChangeKrw"), quantityChangeKrw: sum("quantityChangeKrw"),
  };
}

export function reviewedMovementForView(view: BetaView, change: ReturnType<typeof todayChangeForHistory>) {
  const detail = view.domain?.reviewedCurrentMovement;
  if (!detail || !change || change.valueKrw === null || detail.cutoffDate !== change.cutoffDate ||
    detail.asOf !== currentHistoryValuation(view, "KRW")?.asOf || !withinCent(detail.previousValueKrw, change.previousValueKrw) ||
    !withinCent(detail.currentValueKrw, change.valueKrw)) return null;
  return detail;
}
