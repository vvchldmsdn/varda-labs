import {
  buildDailyPositionMovement,
  buildPreviousCloseMovement,
  type PortfolioMovementHoldingInput,
  type PortfolioMovementPositionSnapshotInput,
  type PortfolioMovementPriceSnapshotInput,
  type PortfolioMovementCycle,
  type PortfolioMovementContribution,
  type PortfolioMovementExclusion,
} from './portfolio-movement.ts';
import { normalizeTicker, toNumber } from './portfolio-math.ts';

export type CurrentHoldingMovement = {
  basis: 'current_quantity_price_fx';
  changeKrw: number | null;
  returnPct: number | null;
  previousValueKrw: number | null;
  includedCount: number;
  excludedCount: number;
  partial: boolean;
  valuationChangeKrw: number | null;
  quantityChangeKrw: number | null;
  rows: PortfolioMovementContribution[];
  exclusions: PortfolioMovementExclusion[];
};

/** Reprice the SAME current quantities at both prices. This is a current-basket
 * price/FX comparison, never account performance or a cash-flow estimate.
 * Reuse the existing instrument, freshness, calendar and FX admission policy. */
export function buildCurrentHoldingMovement(input: {
  holdings: PortfolioMovementHoldingInput[];
  positionRows: PortfolioMovementPositionSnapshotInput[];
  priceRows: PortfolioMovementPriceSnapshotInput[];
  baselineDate: string | null;
  usdKrwRate: number;
  movementCycle: PortfolioMovementCycle;
}): CurrentHoldingMovement {
  const normalized = input.holdings.flatMap(holding => {
    const exact = input.positionRows.filter(row => row.assetId === holding.id && (!row.account || row.account === holding.account));
    const candidates = exact.length ? exact : input.positionRows.filter(row => !row.assetId && row.account === holding.account && (
      (row.legacyAssetId && row.legacyAssetId === holding.legacyBase44Id) ||
      (normalizeTicker(row.ticker) && normalizeTicker(row.ticker) === normalizeTicker(holding.ticker))
    ));
    if (candidates.length !== 1) return [];
    const row = candidates[0];
    const price = toNumber(row.unitPrice) ?? toNumber(row.closePrice) ?? toNumber(row.currentPrice);
    const fx = holding.currency === 'KRW' ? 1 : toNumber(row.fxRate) ?? toNumber(row.previousFxRate);
    if (price === null || price <= 0 || fx === null || fx <= 0) return [];
    return [{ ...row, quantity: holding.quantity, marketValueKrw: holding.quantity * price * fx }];
  });
  const snapshots = buildDailyPositionMovement({ ...input, positionRows: normalized, eventRows: [], selectedAccount: 'all' });
  const closes = buildPreviousCloseMovement({ holdings: input.holdings, priceRows: input.priceRows, referenceDate: input.baselineDate, usdKrwRate: input.usdKrwRate, movementCycle: input.movementCycle });
  // Keep a common source for all rows, rather than silently mixing periods.
  const selected = snapshots.contributionRows.length ? snapshots : closes;
  // A legacy fixed KRW balance can be part of valueKrw without known exposed
  // quantity. Its unexplained amount is not a price/FX return.
  const rows = selected.contributionRows.filter(row =>
    row.priceChangeKrw !== null && row.fxChangeKrw !== null,
  );
  const previous = rows.reduce((sum, row) => sum + row.previousValueKrw, 0);
  const change = rows.reduce((sum, row) => sum + row.changeKrw, 0);
  const excludedCount = Math.max(0, input.holdings.length - rows.length);
  const rawChanges = rows.map(row => {
    if (row.source !== 'daily_position_snapshot') return null;
    const normalizedRow = normalized.find(snapshot => snapshot.assetId === row.holdingId);
    const original = input.positionRows.find(snapshot => snapshot.id === normalizedRow?.id);
    const holding = input.holdings.find(holding => holding.id === row.holdingId);
    const value = original ? toNumber(original.marketValueKrw) : null;
    return value !== null && holding ? holding.valueKrw - value : null;
  });
  const rawChange = rows.length && rawChanges.every(value => value !== null) ? rawChanges.reduce<number>((sum, value) => sum + value!, 0) : null;
  return { basis: 'current_quantity_price_fx', changeKrw: rows.length ? change : null,
    returnPct: rows.length && previous > 0 ? change / previous * 100 : null,
    previousValueKrw: rows.length ? previous : null, includedCount: rows.length, excludedCount,
    partial: excludedCount > 0, valuationChangeKrw: rawChange, quantityChangeKrw: rawChange === null ? null : rawChange - change,
    rows, exclusions: selected.exclusions.filter(row => row.subject !== 'aggregate') };
}
