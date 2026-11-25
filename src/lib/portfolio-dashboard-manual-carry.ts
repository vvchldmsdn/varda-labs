import type { CurrentHoldingMovement } from "./current-holding-movement";
import type { DashboardHolding } from "./portfolio-dashboard";
import { MANUAL_ASSET_PRICE_POLICY } from "./market-data/manual-asset-price.ts";
import { toNumber } from "./portfolio-math.ts";

type ClosingPosition = {
  assetId: string | null; account: string | null; snapshotDate: string; source: string | null;
  currency: string | null; quantity: string | number | null; marketValueKrw: string | number | null;
  unitPrice: string | number | null; fxRate: string | number | null; priceSource: string | null; priceBasis: string | null;
};

/** A carried manual mark can belong to the account's valuation even when it
 * cannot contribute a fresh quote. Keep the market-movement rows independent. */
export function reconcileManualCarryWithClose(input: {
  holdings: readonly DashboardHolding[]; positions: readonly ClosingPosition[]; movement: CurrentHoldingMovement;
  closingRows: readonly {snapshotDate: string; source: string | null; totalMarketValue: string | number | null}[];
  cutoffDate: string; cycleStart: Date; hasCycleEvents: boolean;
}) {
  const { holdings, positions, movement, cutoffDate } = input;
  if (input.hasCycleEvents || !movement.excludedCount || movement.exclusions.length !== movement.excludedCount ||
      !movement.includedCount || movement.changeKrw === null || movement.previousValueKrw === null ||
      holdings.length !== positions.length || movement.includedCount + movement.excludedCount !== holdings.length) return null;
  if (movement.exclusions.some(row => row.subject !== "holding" ||
      !["missing_quoted_instrument", "manual_valuation_not_updated_in_cycle"].includes(row.reason))) return null;
  const excluded = new Set(movement.exclusions.map(row => row.holdingId));
  const sameAmount = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const closeSource = "varda_manual_daily_snapshot";
  const closes = input.closingRows.filter(row => row.snapshotDate === cutoffDate && row.source === closeSource);
  const previousValueKrw = closes.length === 1 ? toNumber(closes[0].totalMarketValue) : null;
  if (previousValueKrw === null || previousValueKrw <= 0) return null;
  const byAsset = new Map(positions.map(row => [row.assetId, row]));
  if (byAsset.size !== positions.length || new Set(holdings.map(row => row.id)).size !== holdings.length) return null;
  const manualNames: string[] = [];
  let priorSum = 0, valueKrw = 0, manualValueKrw = 0;
  for (const holding of holdings) {
    const row = byAsset.get(holding.id);
    const previous = toNumber(row?.marketValueKrw);
    if (!row || row.source !== closeSource || row.snapshotDate !== cutoffDate || row.account !== holding.account ||
        row.currency !== holding.currency || toNumber(row.quantity) !== holding.quantity || !(holding.quantity > 0) ||
        previous === null || previous < 0 || !(holding.valueKrw >= 0)) return null;
    if (excluded.has(holding.id)) {
      if (holding.currency !== "KRW" || holding.priceSource !== MANUAL_ASSET_PRICE_POLICY.source ||
          holding.priceQuoteType !== MANUAL_ASSET_PRICE_POLICY.quoteType || holding.priceStatus !== MANUAL_ASSET_PRICE_POLICY.status ||
          !holding.priceAsOf || !(Date.parse(holding.priceAsOf) <= input.cycleStart.getTime()) ||
          row.priceSource !== MANUAL_ASSET_PRICE_POLICY.source || row.priceBasis !== "manual_current" ||
          toNumber(row.unitPrice) !== holding.currentPrice || toNumber(row.fxRate) !== 1 || !(holding.currentPrice > 0) ||
          !sameAmount(holding.quantity * holding.currentPrice, previous) || !sameAmount(previous, holding.valueKrw)) return null;
      manualNames.push(holding.name);
      manualValueKrw += holding.valueKrw;
    }
    priorSum += previous;
    valueKrw += holding.valueKrw;
  }
  if (manualNames.length !== movement.excludedCount || !sameAmount(priorSum, previousValueKrw) ||
      !sameAmount(movement.previousValueKrw + manualValueKrw, previousValueKrw) ||
      !sameAmount(valueKrw - previousValueKrw, movement.changeKrw)) return null;
  return { cutoffDate, previousValueKrw, valueKrw, manualNames };
}
