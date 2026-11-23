import {
  buildDailyPositionMovement,
  buildPreviousCloseMovement,
  currentExecutionContribution,
  currentLocalPurchaseMovement,
  eventMatchesHolding,
  isPortfolioMovementEligibleHolding,
  positionSnapshotMatchesHolding,
  type PortfolioMovementEventInput,
  type PortfolioMovementHoldingInput,
  type PortfolioMovementPositionSnapshotInput,
  type PortfolioMovementPriceSnapshotInput,
  type PortfolioMovementCycle,
  type PortfolioMovementContribution,
  type PortfolioMovementExclusion,
  type PortfolioMovementExclusionReason,
} from './portfolio-movement.ts';
import { normalizeTicker, toNumber } from './portfolio-math.ts';

export type CurrentHoldingMovement = {
  basis: 'current_quantity_price_fx' | 'execution_adjusted_price_fx';
  changeKrw: number | null;
  priceChangeKrw: number | null;
  fxChangeKrw: number | null;
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

/** Remaining holdings only. With the effective cycle ledger, use actual fills
 * and opening quantities. Omitted eventRows requests a constant-basket comparison. */
export function buildCurrentHoldingMovement(request: {
  holdings: PortfolioMovementHoldingInput[];
  eventRows?: PortfolioMovementEventInput[];
  positionRows: PortfolioMovementPositionSnapshotInput[];
  priceRows: PortfolioMovementPriceSnapshotInput[];
  baselineDate: string | null;
  usdKrwRate: number;
  movementCycle: PortfolioMovementCycle;
}): CurrentHoldingMovement {
  // Some ledgers retain a zero-share asset after liquidation. This view lists
  // currently held assets. Historical account performance covers closed trades.
  const input = request.eventRows === undefined ? request : { ...request,
    holdings: request.holdings.filter(holding => holding.quantity !== 0 || holding.valueKrw !== 0) };
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
  let comparable = selected.contributionRows;
  const issues = new Map<string, PortfolioMovementExclusionReason>();
  const localPurchases = new Map<string, NonNullable<PortfolioMovementExclusion['localPurchases']>>();
  if (input.eventRows !== undefined) {
    const scoped = new Map<string, PortfolioMovementEventInput[]>();
    for (const event of input.eventRows) {
      if (event.eventDate !== input.movementCycle.snapshotDate) continue;
      if (!event.movementEvidence && !['buy', 'sell', 'split'].includes(event.eventType)) continue;
      const unknownIdentity = !event.assetId && !event.legacyAssetId && !normalizeTicker(event.ticker) && !event.assetName;
      const matches = input.holdings.filter(holding => unknownIdentity ?
        !event.account || event.account === holding.account : eventMatchesHolding(event, holding, 'all'));
      for (const holding of matches) {
        if (event.eventType === 'ledger_evidence_unavailable') issues.set(holding.id, 'incomplete_trade_attribution');
        else if (matches.length > 1 || unknownIdentity) issues.set(holding.id, 'ambiguous_trade_identity');
        else scoped.set(holding.id, [...(scoped.get(holding.id) ?? []), event]);
      }
    }
    comparable = [];
    for (const holding of input.holdings) {
      if (issues.has(holding.id) || !isPortfolioMovementEligibleHolding(holding)) continue;
      const snapshots = input.positionRows.filter(snapshot => positionSnapshotMatchesHolding(snapshot, holding));
      if (snapshots.length > 1 || snapshots.some(snapshot =>
          input.holdings.filter(candidate => positionSnapshotMatchesHolding(snapshot, candidate)).length > 1)) {
        issues.set(holding.id, 'ambiguous_baseline_identity');
        continue;
      }
      const snapshot = snapshots[0];
      const trades = scoped.get(holding.id);
      if (trades?.length) {
        const movement = currentExecutionContribution(holding, snapshot, trades, input.usdKrwRate, input.movementCycle);
        if (typeof movement === 'string') {
          issues.set(holding.id, movement);
          if (['missing_current_fx', 'missing_trade_fx', 'missing_baseline_fx', 'missing_baseline_snapshot'].includes(movement)) {
            const local = currentLocalPurchaseMovement(holding, snapshot, trades, input.movementCycle);
            if (local) localPurchases.set(holding.id, local);
          }
        } else comparable.push(movement);
        continue;
      }
      const unchanged = selected.contributionRows.find(row => row.holdingId === holding.id);
      if (!unchanged) continue;
      // Repricing today's quantity at yesterday's close must not hide an
      // observed change of quantity for which no comparable fill was found.
      const quantity = toNumber(snapshot?.quantity);
      const value = toNumber(snapshot?.marketValueKrw);
      if (quantity !== null && Math.abs(quantity - holding.quantity) > Math.max(1e-8, holding.quantity * 1e-10) ||
          value !== null && Math.abs(value - unchanged.previousValueKrw) > Math.max(.01, value * 1e-10)) {
        issues.set(holding.id, 'incomplete_trade_attribution');
        continue;
      }
      comparable.push(unchanged);
    }
  }
  const rows = comparable.filter((row): row is PortfolioMovementContribution & { priceChangeKrw: number; fxChangeKrw: number } =>
    row.priceChangeKrw !== null && row.fxChangeKrw !== null,
  );
  const previous = rows.reduce((sum, row) => sum + row.previousValueKrw, 0);
  const change = rows.reduce((sum, row) => sum + row.changeKrw, 0);
  const excludedCount = Math.max(0, input.holdings.length - rows.length);
  const includedIds = new Set(rows.map(row => row.holdingId));
  const exclusions: PortfolioMovementExclusion[] = input.holdings.filter(holding => !includedIds.has(holding.id)).map(holding => {
    const recorded = selected.exclusions.find(row => row.subject !== 'aggregate' && row.holdingId === holding.id);
    if (recorded && !issues.has(holding.id)) return recorded;
    const ticker = normalizeTicker(holding.ticker);
    const reason = issues.get(holding.id) ?? (!ticker || ticker === '-' ? 'missing_quoted_instrument'
      : !isPortfolioMovementEligibleHolding(holding) ? 'unsupported_asset_type'
      : selected.reason === 'missing_previous_close_fallback' ? 'missing_previous_close_fallback'
      : 'missing_comparison_evidence');
    return { subject: 'holding', reason, source: selected.source, holdingId: holding.id, snapshotId: null,
      ticker: holding.ticker, assetName: holding.name, account: holding.account, currency: holding.currency, valueKrw: holding.valueKrw,
      ...(localPurchases.has(holding.id) ? { localPurchases: localPurchases.get(holding.id) } : {}) };
  });
  const rawChanges = rows.map(row => {
    if (row.execution) {
      const holding = input.holdings.find(candidate => candidate.id === row.holdingId);
      return holding ? holding.valueKrw - row.previousValueKrw : null;
    }
    if (row.source !== 'daily_position_snapshot') return null;
    const normalizedRow = normalized.find(snapshot => snapshot.assetId === row.holdingId);
    const original = input.positionRows.find(snapshot => snapshot.id === normalizedRow?.id);
    const holding = input.holdings.find(holding => holding.id === row.holdingId);
    const value = original ? toNumber(original.marketValueKrw) : null;
    return value !== null && holding ? holding.valueKrw - value : null;
  });
  const rawChange = rows.length && rawChanges.every(value => value !== null) ? rawChanges.reduce<number>((sum, value) => sum + value!, 0) : null;
  return { basis: input.eventRows === undefined ? 'current_quantity_price_fx' : 'execution_adjusted_price_fx', changeKrw: rows.length ? change : null,
    priceChangeKrw: rows.length ? rows.reduce((sum, row) => sum + row.priceChangeKrw, 0) : null,
    fxChangeKrw: rows.length ? rows.reduce((sum, row) => sum + row.fxChangeKrw, 0) : null,
    returnPct: rows.length && previous > 0 ? change / previous * 100 : null,
    previousValueKrw: rows.length ? previous : null, includedCount: rows.length, excludedCount,
    partial: excludedCount > 0, valuationChangeKrw: rawChange, quantityChangeKrw: rawChange === null ? null : rawChange - change,
    rows, exclusions };
}
