import { calculateUnitModifiedDietz } from "./investment-lab-modified-dietz.ts";
import { convertMoney, fxFactor, valuePosition, type FxEvidence, type ValuationObservation } from "./currency-valuation.ts";
import { Decimal, type Currency } from "./money.ts";
import type { NativeDateEvidence } from "./native-portfolio-ledger.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

export type DatedMoney = { boundary?: "before"; amount: string; currency: Currency; at: string; serviceDate: string; source: string };
export type PortfolioCashFlow = DatedMoney & { dateEvidence?: NativeDateEvidence; id: string; kind: "external_in" | "external_out" | "internal_transfer" | "exchange" | "dividend" | "fee" };
/** The supplied valuations must cover the same portfolio including its cash.
 * Income/fees/internal transfers are already in valuation, not external capital.
 * Reuses Modified Dietz; neither TWR nor MWR is substituted or claimed. */
export function calculateCurrencyModifiedDietz(input: { reporting: Currency; valuations: DatedMoney[]; flows: PortfolioCashFlow[]; cashFlowEvidence: "complete" | "missing"; fx: readonly FxEvidence[]; maxFxAgeMs: number; boundary?: "portfolio_including_cash" | "selected_group" }) {
  if (input.cashFlowEvidence !== "complete") return { status: "blocked" as const, reason: "cash_flow_evidence_missing" };
  if (new Set(input.flows.map(flow => flow.id)).size !== input.flows.length || input.flows.some(flow => !flow.id)) return { status: "blocked" as const, reason: "duplicate_flow" };
  const ordered = [...input.valuations].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  if (ordered.some((row, index) => !Number.isFinite(Date.parse(row.at)) || (index > 0 && Date.parse(row.at) <= Date.parse(ordered[index - 1].at)))) return { status: "blocked" as const, reason: "valuation_time_mismatch" };
  const valuations = [];
  const flows = [];
  for (const row of input.valuations) {
    if (!row.source || !Number.isFinite(Date.parse(row.at))) return { status: "blocked" as const, reason: "invalid_valuation" };
    if (resolveSnapshotCycle(new Date(row.at)).snapshotDate !== row.serviceDate) return { status: "blocked" as const, reason: "valuation_service_date_mismatch" };
    const amount = convertMoney(row.amount, row.currency, input.reporting, row.at, input.fx, input.maxFxAgeMs);
    if (!amount.ok) return { status: "blocked" as const, reason: amount.reason };
    valuations.push({ boundary: row.boundary, serviceDate: row.serviceDate, at: row.at, value: amount.value.toNumber() });
  }
  for (let index = 0; index < input.flows.length; index++) {
    const flow = input.flows[index];
    if (!flow.source || !Number.isFinite(Date.parse(flow.at)) || !["external_in", "external_out", "internal_transfer", "exchange", "dividend", "fee"].includes(flow.kind)) return { status: "blocked" as const, reason: "invalid_flow" };
    if (resolveSnapshotCycle(new Date(flow.at)).snapshotDate !== flow.serviceDate) return { status: "blocked" as const, reason: "flow_service_date_mismatch" };
    const amount = convertMoney(flow.amount, flow.currency, input.reporting, flow.at, flow.dateEvidence ? input.fx.filter(rate => rate.kind === "daily_reference") : input.fx, input.maxFxAgeMs);
    if (!amount.ok) return { status: "blocked" as const, reason: amount.reason };
    if (amount.value.compare(0) < 0) return { status: "blocked" as const, reason: "invalid_flow" };
    if (flow.kind === "external_in" || flow.kind === "external_out") flows.push({ effectiveServiceDate: flow.serviceDate, at: flow.at, sequence: index, direction: flow.kind === "external_in" ? "inflow" as const : "outflow" as const, amount: amount.value.toNumber() });
  }
  // The common period engine weights the actual instants. Service-date labels
  // remain unchanged; a noon deposit belongs after the earlier 07:00 capture.
  const result = calculateUnitModifiedDietz({ valuations, flows, timing: "observed_timestamps" });
  return { ...result, reporting: input.reporting, boundary: input.boundary ?? "portfolio_including_cash", currencyVersion: "observed_timestamp_modified_dietz_v1", dateOnlyPolicy: input.flows.some(flow => flow.dateEvidence) ? "service_day_midpoint" : null };
}

/** Reconcile actual quantity changes against observed trade legs before attribution. */
export type DatedSplit = { at: string; ratio: { n: string; d: string }; sequence: number };
export function attributeCurrencyTrades(input: { beforeBoundary?: "before"; before: ValuationObservation; after: ValuationObservation; trades: { quantityDelta: string; price: string | null; currency: Currency; at: string; source: string; sequence?: number }[] | null; splits?: readonly DatedSplit[]; reporting: Currency; fx: readonly FxEvidence[]; beforeFx?: readonly FxEvidence[]; maxFxAgeMs: number }) {
  try {
    const { before, after, fx, reporting, maxFxAgeMs, trades } = input;
    if (!trades || before.currency !== after.currency || Date.parse(after.at) < Date.parse(before.at)) return { ok: false as const, reason: "trade_evidence_missing" };
    const begin = valuePosition(before, reporting, input.beforeFx ?? fx, maxFxAgeMs), end = valuePosition(after, reporting, fx, maxFxAgeMs);
    const f0 = Decimal.from(before.quantity).compare(0) === 0 ? { ok: true as const, value: Decimal.from(1) } : fxFactor(before.currency, reporting, before.at, input.beforeFx ?? fx, maxFxAgeMs), f1 = Decimal.from(after.quantity).compare(0) === 0 ? { ok: true as const, value: Decimal.from(1) } : fxFactor(after.currency, reporting, after.at, fx, maxFxAgeMs);
    if (!begin.ok) return begin; if (!end.ok) return end; if (!f0.ok) return f0; if (!f1.ok) return f1;
    const splits = input.splits ?? [];
    if (splits.some(split => !Number.isFinite(Date.parse(split.at)) || (Date.parse(split.at) < Date.parse(before.at) || (input.beforeBoundary !== "before" && Date.parse(split.at) === Date.parse(before.at))) || Date.parse(split.at) > Date.parse(after.at) || !Number.isSafeInteger(split.sequence) || Decimal.from(split.ratio.n).compare(0) <= 0 || Decimal.from(split.ratio.d).compare(0) <= 0)) return { ok: false as const, reason: "invalid_split_evidence" };
    if (new Set(splits.map(split => split.sequence)).size !== splits.length) return { ok: false as const, reason: "duplicate_split_evidence" };
    const factor = (items: readonly DatedSplit[]) => items.reduce((value, split) => value.mul(split.ratio.n).div(split.ratio.d), Decimal.from(1));
    const totalFactor = factor(splits);
    // Normalize only attribution arithmetic to end-date shares. Stored endpoint
    // quantities, raw prices, acquisition costs and snapshot evidence stay intact.
    let quantity = Decimal.from(before.quantity).mul(totalFactor), flow = Decimal.from(0);
    let price = Decimal.from(0), exchange = Decimal.from(0);
    let previousPrice = Decimal.from(before.price).div(totalFactor), previousFx = f0.value;
    let previousTradeAt = Date.parse(before.at);
    for (const trade of trades) {
      if (trade.price === null) return { ok: false as const, reason: "trade_execution_price_missing" };
      if (!trade.source || trade.currency !== before.currency || !Number.isFinite(Date.parse(trade.at)) || (Date.parse(trade.at) < Date.parse(before.at) || (input.beforeBoundary !== "before" && Date.parse(trade.at) === Date.parse(before.at))) || Date.parse(trade.at) > Date.parse(after.at) || Decimal.from(trade.price).compare(0) <= 0) return { ok: false as const, reason: "invalid_trade" };
      if (Date.parse(trade.at) < previousTradeAt) return { ok: false as const, reason: "trade_time_order_invalid" };
      previousTradeAt = Date.parse(trade.at);
      const rate = fxFactor(trade.currency, reporting, trade.at, fx, maxFxAgeMs); if (!rate.ok) return rate;
      if (splits.some(split => Date.parse(split.at) === Date.parse(trade.at)) && !Number.isSafeInteger(trade.sequence)) return { ok: false as const, reason: "split_trade_order_missing" };
      const remainingFactor = factor(splits.filter(split => Date.parse(split.at) > Date.parse(trade.at) || (Date.parse(split.at) === Date.parse(trade.at) && split.sequence > trade.sequence!)));
      const delta = Decimal.from(trade.quantityDelta).mul(remainingFactor), tradePrice = Decimal.from(trade.price).div(remainingFactor);
      price = price.add(quantity.mul(tradePrice.sub(previousPrice)).mul(previousFx));
      exchange = exchange.add(quantity.mul(tradePrice).mul(rate.value.sub(previousFx)));
      quantity = quantity.add(delta);
      if (quantity.compare(0) < 0) return { ok: false as const, reason: "quantity_mismatch" };
      flow = flow.add(delta.mul(tradePrice).mul(rate.value));
      previousPrice = tradePrice; previousFx = rate.value;
    }
    if (quantity.compare(after.quantity) !== 0) return { ok: false as const, reason: "quantity_mismatch" };
    // No price/FX exposure remains after full disposal. The neutral price used
    // for an explicit zero endpoint must never determine the decomposition.
    if (quantity.compare(0) > 0) {
      price = price.add(quantity.mul(Decimal.from(after.price).sub(previousPrice)).mul(previousFx));
      exchange = exchange.add(quantity.mul(after.price).mul(f1.value.sub(previousFx)));
    }
    const change = end.value.sub(begin.value).sub(flow);
    if (price.add(exchange).compare(change) !== 0) return { ok: false as const, reason: "attribution_mismatch" };
    return { ok: true as const, value: { price, exchange, flow, change, valuationChange: end.value.sub(begin.value), reporting, crossTerm: "fx" } };
  } catch { return { ok: false as const, reason: "invalid_trade" }; }
}
