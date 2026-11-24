import { holdingImpact, type AttributionPosition, type AttributionTrade } from "./period-attribution.ts";

type ReviewedInstrument = {
  key: string;
  name: string;
  ticker: string | null;
  market: "korea" | "us";
  currency: "KRW" | "USD";
};

export type ReviewedHistoryPosition = ReviewedInstrument & {
  quantity: number;
  price: number;
  fxRate: number;
  valueKrw: number;
};

export type ReviewedHistoryTrade = ReviewedInstrument & {
  quantityDelta: number;
  price: number;
  fxRate: number;
  flowKrw: number;
};

export function reviewedPositionKey(ticker: string | null, market: string, currency: string) {
  if (market === "korea" && currency === "KRW" && (!ticker || /^[0-9A-Z]{6}$/.test(ticker))) {
    return "KRW:" + (ticker || "KRD040200002");
  }
  if (market === "us" && currency === "USD" && ticker && /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) return "USD:" + ticker;
  return null;
}

function instrument(input: unknown): ReviewedInstrument | null {
  if (!input || typeof input !== "object") return null;
  const {key, name, ticker, market, currency} = input as Record<string, unknown>;
  if (typeof key !== "string" || typeof name !== "string" || !name.trim() || name.length > 120 ||
    ticker !== null && typeof ticker !== "string" || market !== "korea" && market !== "us" ||
    currency !== "KRW" && currency !== "USD" || reviewedPositionKey(ticker, market, currency) !== key) return null;
  return { key, name, ticker, market, currency };
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const sameWon = (a: number, b: number) => Math.abs(a - b) <= 0.01;

export function projectReviewedHistoryPositions(input: unknown, valueKrw: number | null) {
  if (!Array.isArray(input) || input.length > 200) return undefined;
  const positions: ReviewedHistoryPosition[] = [];
  const keys = new Set<string>();
  for (const row of input) {
    const asset = instrument(row);
    if (!asset || keys.has(asset.key)) return undefined;
    const { quantity, price, fxRate, valueKrw } = row;
    if (!positive(quantity) || !positive(price) || !positive(fxRate) || !positive(valueKrw) ||
      asset.currency === "KRW" && fxRate !== 1 || !sameWon(quantity * price * fxRate, valueKrw)) return undefined;
    keys.add(asset.key);
    positions.push({ ...asset, quantity, price, fxRate, valueKrw });
  }
  if (!sameWon(positions.reduce((total, row) => total + row.valueKrw, 0), valueKrw ?? 0)) return undefined;
  return positions;
}

export function projectReviewedHistoryTrades(input: unknown) {
  if (!Array.isArray(input) || input.length > 200) return undefined;
  const trades: ReviewedHistoryTrade[] = [];
  for (const row of input) {
    const asset = instrument(row);
    if (!asset) return undefined;
    const { quantityDelta, price, fxRate, flowKrw } = row;
    if (typeof quantityDelta !== "number" || !positive(Math.abs(quantityDelta)) || !positive(price) ||
      !positive(fxRate) || typeof flowKrw !== "number" || !Number.isFinite(flowKrw) ||
      Math.sign(quantityDelta) !== Math.sign(flowKrw) || asset.currency === "KRW" && fxRate !== 1 ||
      !sameWon(quantityDelta * price * fxRate, flowKrw)) return undefined;
    trades.push({ ...asset, quantityDelta, price, fxRate, flowKrw });
  }
  return trades;
}

export function reviewedAttributionPosition(row: ReviewedHistoryPosition): AttributionPosition {
  return { ...row, assetId: row.key, fixedKrw: null, marketValueKrw: row.valueKrw };
}

export function reviewedAttributionTrade(row: ReviewedHistoryTrade, date: string, accountId: string): AttributionTrade {
  return { ...row, assetId: row.key, date, accountId };
}

export function reviewedHoldingMovement(before: ReviewedHistoryPosition | undefined, after: ReviewedHistoryPosition | undefined,
  trades: readonly ReviewedHistoryTrade[]) {
  return holdingImpact(before && reviewedAttributionPosition(before), after && reviewedAttributionPosition(after),
    trades.map(row => reviewedAttributionTrade(row, "", "")));
}
