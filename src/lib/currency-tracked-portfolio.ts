import { Decimal, isCurrency, type Currency } from "./money.ts";
import { valuePosition, costInReportingCurrency, costLotsInReportingCurrency, convertMoney, selectValuationFxAt, type FxEvidence, type ValuationObservation } from "./currency-valuation.ts";
import { attributeCurrencyTrades, calculateCurrencyModifiedDietz, type DatedSplit } from "./currency-performance.ts";
import type { NativeCostLot } from "./native-portfolio-ledger.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

export const TRACKED_CURRENCY_VERSION = "owned_native_valuation_v1";
export type TrackedNativePosition = {
  id: string; ownerId: string; name: string;
  accountId?: string; kind?: "holding" | "cash"; costLots?: readonly NativeCostLot[] | null; ticker?: string | null; market?: string;
  /** Only admitted, native, raw price evidence. at is the price observation, not fetch time. */
  observation: ValuationObservation | null;
  evidenceReason?: "corporate_actions_pending" | "corporate_actions_provisional" | "corporate_actions_conflict" | "corporate_action_ledger_mismatch" | "corporate_action_price_pending";
  unsupportedReason?: "manual_gold" | "cash_not_observed" | "fractional_value_not_dated" | "unsupported_instrument";
  cost?: { amount: string; currency: Currency; at: string; source: string } | null;
};
export type TrackedValuationFrame = {
  at: string; source: string; positions: readonly TrackedNativePosition[];
  /** Caller must account for archived positions and cash before claiming a complete portfolio. */
  scopeComplete: boolean;
};
export type TrackedTrade = {
  id: string; ownerId: string; positionId: string; quantityDelta: string; price: string;
  currency: Currency; at: string; source: string; sequence?: number;
};
export type TrackedRealizedTrade = {
  id: string; ownerId: string; accountId: string; positionId: string; name: string; at: string; source: string;
  proceeds: { amount: string; currency: Currency } | null;
  /** Frozen disposal fractions from the sale event, never the holding's later cost basis. */
  disposedCostLots: readonly NativeCostLot[] | null;
};
export type TrackedPortfolioEvidence = {
  ownerId: string; reporting: Currency; asOf: string;
  current: TrackedValuationFrame; history: readonly TrackedValuationFrame[];
  /** null means unknown ledger coverage, including when endpoint quantities happen to match. */
  trades: readonly TrackedTrade[] | null;
  fx: readonly FxEvidence[]; maxFxAgeMs: number; maxPriceAgeMs: number;
  cashFlows?: readonly { id: string; ownerId: string; accountId: string; at: string; currency: Currency; delta: string; kind: "external" | "trade" | "income" | "fee" | "exchange" | "transfer"; externalToScope?: boolean }[];
  ledgerComplete?: boolean;
  corporateActionsInWindow?: boolean;
  splits?: readonly (DatedSplit & { positionId: string })[];
  nativeSequences?: Readonly<Record<string, number>>;
  realizedTrades?: readonly TrackedRealizedTrade[] | null;
  realizedTradesComplete?: boolean;
  groupEvidence?: { policy: "current_membership_whole_cash_direct_holdings"; stableSince: string; reason: string | null };
};
export type CurrencyTrackedInput = TrackedPortfolioEvidence;
type Issue = { code: string; positionId?: string; at?: string };
type ValuedFrame = {
  at: string; total: string | null; verifiedSubtotal: string; complete: boolean;
  coverage: { positions: number; valued: number; scopeComplete: boolean; excludedPositions: number; excludedWeightPct: number | null };
  positions: { id: string; name: string; value: string | null; cost: string | null; weightPct: number | null; priceObservedAt: string | null; reason: string | null }[];
  issues: Issue[];
};
type Attribution = { price: string; exchange: string; assetTradeFlow: string; investmentChange: string; valuationChange: string; otherCashReturn: string; positions: { id: string; name: string; price: string; exchange: string; change: string }[] };

/** Read-only adapter, not an authorization mechanism: call only after the tenant-scoped loader.
 * It never converts a precomputed KRW dashboard total or invents a historical quantity/price/date.
 * History is actual dated valuation only. Performance returns require portfolio cash-flow coverage elsewhere. */
export function buildTrackedCurrencyPortfolio(evidence: TrackedPortfolioEvidence) {
  const invalid = !evidence.ownerId || !isCurrency(evidence.reporting) || !Number.isFinite(Date.parse(evidence.asOf)) || Date.parse(evidence.asOf) > Date.now() || !Number.isFinite(evidence.maxFxAgeMs) || evidence.maxFxAgeMs < 0 || !Number.isFinite(evidence.maxPriceAgeMs) || evidence.maxPriceAgeMs < 0;
  const frames = [...evidence.history, evidence.current];
  const ownerMismatch = frames.some(frame => frame.positions.some(row => row.ownerId !== evidence.ownerId)) || evidence.trades?.some(row => row.ownerId !== evidence.ownerId) || evidence.cashFlows?.some(row => row.ownerId !== evidence.ownerId) || evidence.realizedTrades?.some(row => row.ownerId !== evidence.ownerId);
  // Never return another owner's names/amounts even when an upstream DTO is accidentally mixed.
  if (invalid || ownerMismatch) return { status: "blocked" as const, reason: ownerMismatch ? "owner_scope_mismatch" : "invalid_input", version: TRACKED_CURRENCY_VERSION, reporting: evidence.reporting, current: null, history: [], movement: null };
  const historicFx = evidence.fx.filter(row => row.kind === "daily_reference" || row.kind === "historical_spot" || (row.kind === "spot" && Number.isFinite(Date.parse(row.capturedAt ?? "")) && Date.parse(row.observedAt) <= Date.parse(row.fetchedAt) && Date.parse(row.fetchedAt) <= Date.parse(row.capturedAt!) && Date.parse(row.capturedAt!) <= Date.parse(evidence.asOf)));
  const frozenFx = (at: string) => selectValuationFxAt(at, evidence.asOf, evidence.fx, true);
  const currentFx = evidence.fx.filter(row => row.kind === "spot" || row.kind === "daily_reference" || row.kind === "historical_spot");
  const exactTotals = new Map<TrackedValuationFrame, Decimal>();
  const valueFrame = (frame: TrackedValuationFrame, historic: boolean): ValuedFrame => {
    // A recorded observation retains the rates captured with it. Later backfills
    // may fill a missing currency, but cannot rewrite an already valued frame.
    const frameFx = selectValuationFxAt(frame.at, evidence.asOf, evidence.fx, historic);
    const issues: Issue[] = [];
    const at = Date.parse(frame.at);
    if (!Number.isFinite(at) || at > Date.parse(evidence.asOf) || !frame.source.trim()) issues.push({ code: "invalid_frame", at: frame.at });
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    for (const row of frame.positions) { if (!row.id || seen.has(row.id)) duplicates.add(row.id); seen.add(row.id); }
    const exactValues = new Map<string, Decimal>();
    const positions = frame.positions.map(row => {
      const priceObservedAt = row.observation?.priceObservedAt ?? row.observation?.at ?? null;
      const base = { id: row.id, name: row.name, value: null as string | null, cost: null as string | null, weightPct: null as number | null, priceObservedAt, reason: null as string | null };
      const priceAt = Date.parse(priceObservedAt ?? "");
      let reason = issues.some(issue => issue.code === "invalid_frame") ? "invalid_frame" : duplicates.has(row.id) ? "duplicate_position" : row.unsupportedReason ?? row.evidenceReason ?? (!row.observation ? "native_price_evidence_missing" : !Number.isFinite(priceAt) || priceAt > at ? "invalid_price_time" : at - priceAt > evidence.maxPriceAgeMs ? "price_stale" : null);
      if (!reason && row.observation && !row.observation.source.trim()) reason = "native_price_evidence_missing";
      if (!reason && row.observation) {
        // FX is at the valuation time; an earlier unchanged quote does not freeze currency exposure.
        const value = valuePosition({ ...row.observation, at: frame.at }, evidence.reporting, frameFx, evidence.maxFxAgeMs);
        if (!value.ok) reason = value.reason;
        else {
          base.value = value.value.toNumber().toString();
          exactValues.set(row.id, value.value);
          // Costs require their own acquisition date and historical rate; no average-cost date invention.
          if (row.costLots !== undefined || (row.cost && Date.parse(row.cost.at) <= at)) {
            const cost = row.costLots !== undefined ? costLotsInReportingCurrency(row.costLots, evidence.reporting, historicFx, evidence.maxFxAgeMs, frame.at) : costInReportingCurrency(row.cost!, evidence.reporting, historicFx, evidence.maxFxAgeMs);
            if (cost.ok && cost.value.compare(0) >= 0) base.cost = cost.value.toNumber().toString();
          }
        }
      }
      if (reason) { base.reason = reason; issues.push({ code: reason, positionId: row.id, at: frame.at }); }
      return base;
    });
    if (!frame.scopeComplete) issues.push({ code: "portfolio_scope_incomplete", at: frame.at });
    const subtotal = [...exactValues.values()].reduce((sum, value) => sum.add(value), Decimal.from(0));
    const complete = !issues.length && frame.scopeComplete;
    if (complete) exactTotals.set(frame, subtotal);
    if (complete && subtotal.compare(0) > 0) positions.forEach(row => { row.weightPct = exactValues.get(row.id)!.div(subtotal).mul(100).toNumber(); });
    return { at: frame.at, total: complete ? subtotal.toNumber().toString() : null, verifiedSubtotal: subtotal.toNumber().toString(), complete, coverage: { positions: positions.length, valued: positions.filter(row => row.value !== null).length, scopeComplete: frame.scopeComplete, excludedPositions: positions.filter(row => row.value === null).length, excludedWeightPct: complete ? 0 : null }, positions, issues };
  };
  const current = valueFrame(evidence.current, false);
  const history = evidence.history.map(frame => valueFrame(frame, true));
  const axisInvalid = evidence.history.some((frame, i) => Date.parse(frame.at) >= Date.parse(evidence.current.at) || (i > 0 && Date.parse(frame.at) <= Date.parse(evidence.history[i - 1].at)));
  if (axisInvalid) history.forEach(frame => { frame.complete = false; frame.total = null; frame.positions.forEach(row => { row.weightPct = null; }); frame.issues.push({ code: "history_axis_invalid", at: frame.at }); });
  let movement: { from: string; to: string; attribution: Attribution | null; reason: string | null; valuationChange: string | null } | null = null;
  const before = evidence.history.at(-1), valuedBefore = history.at(-1);
  if (before && valuedBefore) {
    let reason: string | null = !valuedBefore.complete || !current.complete ? "valuation_incomplete" : evidence.trades === null ? "trade_evidence_missing" : evidence.corporateActionsInWindow && !evidence.splits?.length ? "corporate_action_attribution_unavailable" : null;
    const valuationChange = current.total !== null && valuedBefore.total !== null ? exactTotals.get(evidence.current)!.sub(exactTotals.get(before)!).toNumber().toString() : null;
    const previous = new Map(before.positions.map(row => [row.id, row]));
    if (!reason && (previous.size !== evidence.current.positions.length || evidence.current.positions.some(row => !previous.has(row.id)))) reason = "position_axis_mismatch";
    const ids = new Set<string>();
    if (!reason) for (const trade of evidence.trades ?? []) {
      if (!trade.id || ids.has(trade.id) || !previous.has(trade.positionId) || !Number.isFinite(Date.parse(trade.at)) || Date.parse(trade.at) <= Date.parse(before.at) || Date.parse(trade.at) > Date.parse(evidence.current.at)) { reason = "invalid_trade_ledger"; break; }
      ids.add(trade.id);
    }
    let price = Decimal.from(0), exchange = Decimal.from(0), flow = Decimal.from(0), change = Decimal.from(0);
    const positionChanges: Attribution["positions"] = [];
    if (!reason) for (const row of evidence.current.positions) {
      const p0 = previous.get(row.id)!;
      // Historical baseline/trade FX must be admitted as daily evidence; latest FX may be spot.
      const fx = [...historicFx, ...currentFx.filter(rate => Date.parse(rate.observedAt) > Date.parse(before.at))];
      const result = attributeCurrencyTrades({ before: { ...p0.observation!, at: before.at }, after: { ...row.observation!, at: evidence.current.at }, trades: evidence.trades!.filter(trade => trade.positionId === row.id).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.sequence ?? 0) - (b.sequence ?? 0)), splits: evidence.splits?.filter(split => split.positionId === row.id), reporting: evidence.reporting, fx, beforeFx: frozenFx(before.at), maxFxAgeMs: evidence.maxFxAgeMs });
      if (!result.ok) { reason = result.reason; break; }
      price = price.add(result.value.price); exchange = exchange.add(result.value.exchange); flow = flow.add(result.value.flow); change = change.add(result.value.change);
      positionChanges.push({ id: row.id, name: row.name, price: result.value.price.toNumber().toString(), exchange: result.value.exchange.toNumber().toString(), change: result.value.change.toNumber().toString() });
    }
    if (!reason && evidence.ledgerComplete && evidence.cashFlows) {
      let external = Decimal.from(0);
      for (const leg of evidence.cashFlows.filter(leg => Date.parse(leg.at) > Date.parse(before.at) && Date.parse(leg.at) <= Date.parse(evidence.current.at))) {
        if (leg.kind !== "external" && !leg.externalToScope) continue;
        const converted = convertMoney(leg.delta, leg.currency, evidence.reporting, leg.at, evidence.fx, evidence.maxFxAgeMs);
        if (!converted.ok) { reason = converted.reason; break; }
        external = external.add(converted.value);
      }
      if (!reason && valuationChange !== null) { flow = external; change = exactTotals.get(evidence.current)!.sub(exactTotals.get(before)!).sub(external); }
    }
    movement = { from: before.at, to: evidence.current.at, reason, valuationChange, attribution: reason ? null : { price: price.toNumber().toString(), exchange: exchange.toNumber().toString(), assetTradeFlow: flow.toNumber().toString(), investmentChange: change.toNumber().toString(), valuationChange: valuationChange!, otherCashReturn: change.sub(price).sub(exchange).toNumber().toString(), positions: positionChanges } };
  }
  const start = history[0];
  const performance = evidence.ledgerComplete && current.complete && start?.complete && history.every(frame => frame.complete) && evidence.cashFlows ? calculateCurrencyModifiedDietz({
    reporting: evidence.reporting, cashFlowEvidence: "complete", fx: evidence.fx, maxFxAgeMs: evidence.maxFxAgeMs, boundary: evidence.groupEvidence ? "selected_group" : "portfolio_including_cash",
    valuations: [...history, current].map(frame => ({ at: frame.at, serviceDate: resolveSnapshotCycle(new Date(frame.at)).snapshotDate, amount: frame.total!, currency: evidence.reporting, source: "native_ledger_snapshot" })),
    flows: evidence.cashFlows.filter(leg => (leg.kind === "external" || leg.externalToScope) && Date.parse(leg.at) > Date.parse(start.at) && Date.parse(leg.at) <= Date.parse(current.at)).map(leg => ({ id: leg.id, amount: Decimal.from(leg.delta).compare(0) < 0 ? Decimal.from(leg.delta).mul(-1).toExactString() : leg.delta, currency: leg.currency, at: leg.at, serviceDate: resolveSnapshotCycle(new Date(leg.at)).snapshotDate, source: "native_ledger", kind: Decimal.from(leg.delta).compare(0) < 0 ? "external_out" as const : "external_in" as const }))
  }) : null;
  return { status: current.complete ? "ready" as const : "incomplete" as const, version: TRACKED_CURRENCY_VERSION, reporting: evidence.reporting, asOf: evidence.asOf, current, history, movement, realizedPnl: valueRecordedSales(evidence, historicFx), performanceReturn: performance, performanceReason: performance ? null : evidence.groupEvidence?.reason ?? "portfolio_cash_flow_evidence_required", boundary: "explicit_owned_native_positions" };
}
export type CurrencyTrackedResult = ReturnType<typeof buildTrackedCurrencyPortfolio>;

/** Gross recorded sale proceeds less original dated disposed costs; fees remain cash expenses. */
function valueRecordedSales(evidence: TrackedPortfolioEvidence, historicalFx: readonly FxEvidence[]) {
  const sales = evidence.realizedTrades ?? [], counts = new Map<string, number>();
  for (const sale of sales) counts.set(sale.id, (counts.get(sale.id) ?? 0) + 1);
  let subtotal = Decimal.from(0);
  const rows = sales.map(sale => {
    const row = { id: sale.id, positionId: sale.positionId, name: sale.name, at: sale.at, proceeds: null as string | null, cost: null as string | null, pnl: null as string | null, reason: null as string | null };
    try {
      if (!sale.id || counts.get(sale.id) !== 1 || !sale.accountId || !sale.positionId || !sale.source.trim() || !Number.isFinite(Date.parse(sale.at)) || Date.parse(sale.at) > Date.parse(evidence.asOf)) { row.reason = "invalid_recorded_sale"; return row; }
      if (!sale.proceeds || !isCurrency(sale.proceeds.currency) || Decimal.from(sale.proceeds.amount).compare(0) <= 0) { row.reason = "sale_proceeds_missing"; return row; }
      const proceeds = convertMoney(sale.proceeds.amount, sale.proceeds.currency, evidence.reporting, sale.at, historicalFx, evidence.maxFxAgeMs);
      if (!proceeds.ok) { row.reason = proceeds.reason; return row; }
      row.proceeds = proceeds.value.toNumber().toString();
      if (!sale.disposedCostLots?.length) { row.reason = "missing_cost_evidence"; return row; }
      const cost = costLotsInReportingCurrency(sale.disposedCostLots, evidence.reporting, historicalFx, evidence.maxFxAgeMs, sale.at);
      if (!cost.ok) { row.reason = cost.reason; return row; }
      if (cost.value.compare(0) < 0) { row.reason = "invalid_cost_evidence"; return row; }
      row.cost = cost.value.toNumber().toString();
      const pnl = proceeds.value.sub(cost.value); subtotal = subtotal.add(pnl); row.pnl = pnl.toNumber().toString();
    } catch { row.reason = "invalid_recorded_sale"; }
    return row;
  });
  const scopeComplete = evidence.realizedTrades !== undefined && evidence.realizedTrades !== null && evidence.realizedTradesComplete === true;
  const complete = scopeComplete && rows.every(row => row.reason === null);
  return { status: complete ? "ready" as const : "incomplete" as const, reporting: evidence.reporting, through: evidence.asOf,
    total: complete ? subtotal.toNumber().toString() : null, verifiedSubtotal: subtotal.toNumber().toString(),
    coverage: { sales: rows.length, valued: rows.filter(row => row.pnl !== null).length, scopeComplete }, rows,
    policy: "recorded_sales_original_dated_cost_fees_separate" as const };
}
