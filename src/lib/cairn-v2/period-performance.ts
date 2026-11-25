import { calculateUnitModifiedDietz } from "../investment-lab-modified-dietz.ts";
import { resolveKrwFxRate } from "../portfolio-math.ts";
import type { RecoveredReturnCurve } from "../period-return-recovery.ts";
import type { AttributionAccountObservation, AttributionPosition, AttributionTrade, PeriodAttributionRange } from "./period-attribution.ts";
import type { CanonicalClose } from "./canonical-close.ts";

export type PerformanceBasis = "invested_assets_excluding_cash" | "portfolio_including_cash" | "mixed";
export type PerformanceGapReason = "valuation" | "trade" | "cash_flow" | "capital" | "scope";
export type PerformancePoint = { date: string; returnPct: number | null; dailyReturnPct: number | null; segment: string | null; estimatedFx?: boolean; liveAsOf?: string; recovered?: true; accountReview?: true; reviewEstimated?: boolean; canonicalClose?: true };
export type PeriodPerformance = {
  range: PeriodAttributionRange; basis: PerformanceBasis; currency: "KRW"; includesCarriedMarks: boolean; includesClosingFx: boolean;
  points: PerformancePoint[]; gaps: { start: string; end: string; reason: PerformanceGapReason }[];
};
export const MAX_PERFORMANCE_DAYS = 3660;

type Position = AttributionPosition & { carriedMark?: boolean };
export type PerformanceObservation = Omit<AttributionAccountObservation, "positions"> & {
  source: string; at?: string; liveAsOf?: string; positions: Position[]; recoveryOpeningKrw?: number | null; canonicalClose?: CanonicalClose;
};
export type PerformanceFlow = { date: string; accountId: string; at: string; amountKrw: number | null };
type Evidence = {
  accounts: { id: string; holdings: boolean }[];
  observations: PerformanceObservation[]; trades: PerformanceTrade[]; cashFlows: PerformanceFlow[];
};
type PerformanceTrade = AttributionTrade & { closingFx?: boolean };

const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const day = 86_400_000;
const dateAfter = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * day).toISOString().slice(0, 10);

function frame(observation: PerformanceObservation) {
  const positions = new Map<string, Position>();
  if (observation.expectedPositions !== observation.positions.length) return null;
  let value = 0;
  for (const row of observation.positions) {
    if (!row.assetId || positions.has(row.assetId) || !nonnegative(row.marketValueKrw)) return null;
    positions.set(row.assetId, row);
    value += row.marketValueKrw;
  }
  const opening = observation.recoveryOpeningKrw;
  if (opening != null && opening > 0 && Math.round(opening) !== Math.round(value)) return null;
  return Number.isFinite(value) ? { positions, value, source: observation.source, at: observation.at, liveAsOf: observation.liveAsOf } : null;
}
type Frame = NonNullable<ReturnType<typeof frame>>;

export function matchesRecoveredClose(row: PerformanceObservation, value: number) {
  const approved = ["base44_import", "varda_daily_snapshot_v1", "varda_manual_daily_snapshot"].includes(row.source) ||
    row.source.startsWith("broker_reconstructed_close_v1:");
  const close = frame(row);
  return approved && !row.at && !row.liveAsOf && close !== null && Math.round(close.value) === Math.round(value);
}

/** An audited broker period can supply its own starting capital and flows. A
 * later interval can inherit its growth only at a matching confirmed close. */
export function joinRecoveredPerformance(result: PeriodPerformance, curve: RecoveredReturnCurve,
  accountId: string, observations: readonly PerformanceObservation[]): PeriodPerformance {
  const anchor = curve.points.at(-1);
  if (result.basis !== "invested_assets_excluding_cash" || curve.currency !== result.currency ||
      curve.baseDate < result.range.start || curve.endDate > result.range.end || anchor?.returnPct == null ||
      anchor.valueKrw == null || !curve.points.length) return result;
  const history = new Map(curve.points.map(p => [p.date, p]));
  let matched = false;
  for (const row of observations) {
    if (row.date < curve.baseDate || row.date > curve.endDate || row.accountId !== accountId) continue;
    const recoveredValue = history.get(row.date)?.valueKrw;
    if (recoveredValue == null) continue;
    if (!matchesRecoveredClose(row, recoveredValue)) return result;
    if (row.date === curve.endDate) matched = true;
  }
  if (!matched) return result;

  const gaps = new Map<string, PerformanceGapReason>();
  for (const gap of result.gaps) {
    for (let d = gap.start; d <= gap.end; d = dateAfter(d, 1)) gaps.set(d, gap.reason);
  }
  const close = result.points.find(p => p.date === curve.endDate);
  const growthAtAnchor = 1 + anchor.returnPct / 100;
  const points: PerformancePoint[] = result.points.map(point => {
    if (point.date < curve.baseDate) return point;
    if (point.date <= curve.endDate) {
      const pct = history.get(point.date)?.returnPct;
      if (pct == null) {
        if (!gaps.has(point.date)) gaps.set(point.date, "valuation");
        return { date: point.date, returnPct: null, dailyReturnPct: null, segment: null };
      }
      gaps.delete(point.date);
      const priorPct = history.get(dateAfter(point.date, -1))?.returnPct;
      const dailyReturnPct = priorPct == null || priorPct <= -100 ? null : ((1 + pct / 100) / (1 + priorPct / 100) - 1) * 100;
      return { date: point.date, returnPct: pct, dailyReturnPct, segment: curve.baseDate, recovered: true };
    }
    if (point.returnPct == null || !point.segment) return point;
    // Retain independent segments after a later break. The original anchor
    // can also be the opening of a fresh segment when its incoming link failed.
    const previousGrowth = point.segment === curve.endDate ? 1 :
      point.segment === close?.segment && close.returnPct != null ? 1 + close.returnPct / 100 : null;
    if (previousGrowth == null || previousGrowth <= 0) return point;
    const linked = (growthAtAnchor * (1 + point.returnPct / 100) / previousGrowth - 1) * 100;
    return Number.isFinite(linked) ? { ...point, returnPct: linked, segment: curve.baseDate } : point;
  });
  const ranges: PeriodPerformance["gaps"] = [];
  for (const point of points) {
    const reason = gaps.get(point.date);
    if (!reason) continue;
    const last = ranges.at(-1);
    if (last?.reason === reason && dateAfter(last.end, 1) === point.date) last.end = point.date;
    else ranges.push({ start: point.date, end: point.date, reason });
  }
  return { ...result, points, gaps: ranges };
}
type Flow = { effectiveServiceDate: string; sequence: number; direction: "inflow" | "outflow"; amount: number; at?: string };
function flow(date: string, sequence: number, amount: number, at?: string): Flow {
  return { effectiveServiceDate: date, sequence, direction: amount < 0 ? "outflow" : "inflow", amount: Math.abs(amount), at };
}

function holdingFlows(before: Frame, after: Frame, trades: AttributionTrade[], flows: Flow[]): PerformanceGapReason | null {
  const traded = new Map<string, number>();
  for (const trade of trades) {
    const id = trade.assetId, q = trade.quantityDelta;
    if (!id || !q || !Number.isFinite(q)) return "trade";
    const currency = before.positions.get(id)?.currency ?? after.positions.get(id)?.currency;
    if (trade.currency && currency && trade.currency.toUpperCase() !== currency.toUpperCase()) return "trade";
    let amount = trade.flowKrw;
    if (amount == null) {
      const factor = resolveKrwFxRate(trade.currency ?? currency, trade.fxRate);
      if (!factor.ok || !nonnegative(trade.price) || trade.price === 0) return "trade";
      amount = q * trade.price * factor.rate;
    }
    if (!Number.isFinite(amount) || Math.sign(amount) !== Math.sign(q)) return "trade";
    flows.push(flow(trade.date, flows.length, amount));
    traded.set(id, (traded.get(id) ?? 0) + q);
  }
  for (const id of new Set([...before.positions.keys(), ...after.positions.keys(), ...traded.keys()])) {
    const a = before.positions.get(id), b = after.positions.get(id);
    if (a && b && a.currency !== b.currency) return "valuation";
    const q0 = a ? a.quantity : 0, q1 = b ? b.quantity : 0;
    if (!nonnegative(q0) || !nonnegative(q1)) return "trade";
    if (Math.abs(q0 + (traded.get(id) ?? 0) - q1) > Math.max(1e-8, q1 * 1e-10)) return "trade";
    // A separately entered fractional holding value has no proven acquisition/disposal principal.
    if ((a?.fixedKrw ?? 0) !== (b?.fixedKrw ?? 0)) return "capital";
    if ((q0 === 0 && q1 === 0 || b?.carriedMark) &&
        ((a?.marketValueKrw ?? 0) !== (b?.marketValueKrw ?? 0) || q0 !== q1)) return "valuation";
  }
  return null;
}

const key = (account: string, date: string) => account + "/" + date;
function indexEvents<T extends { accountId: string; date: string }>(rows: T[]) {
  const index = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row.accountId, row.date);
    const existing = index.get(id);
    if (existing) existing.push(row); else index.set(id, [row]);
  }
  return index;
}

/** Each link uses the same scope and the same saved valuation convention at both ends.
 * A new segment starts at the next evidenced opening after a break; it does not inherit gains across the gap. */
export function buildPeriodPerformance(range: PeriodAttributionRange, evidence: Evidence): PeriodPerformance {
  const holdings = evidence.accounts.filter(a => a.holdings).length;
  const basis = !evidence.accounts.length || holdings > 0 && holdings < evidence.accounts.length ? "mixed" :
    holdings ? "invested_assets_excluding_cash" : "portfolio_including_cash";
  const result: PeriodPerformance = { range, currency: "KRW", basis, includesCarriedMarks: false, includesClosingFx: false, points: [], gaps: [] };
  const frames = new Map(evidence.observations.map(row => [key(row.accountId, row.date), frame(row)]));
  const trades = indexEvents(evidence.trades), cashFlows = indexEvents(evidence.cashFlows);
  function link(start: string, end: string): PerformanceGapReason | { change: number; closingFx: boolean } {
    if (basis === "mixed") return "scope";
    let v0 = 0, v1 = 0, from: string | undefined, to: string | undefined, carried = false, closingFx = false;
    const flows: Flow[] = [];
    const dates: string[] = [];
    for (let d = dateAfter(start, 1); d <= end; d = dateAfter(d, 1)) dates.push(d);
    for (const { id } of evidence.accounts) {
      const before = frames.get(key(id, start)), after = frames.get(key(id, end));
      if (!before || !after) return "valuation";
      if (after.liveAsOf) {
        const compatible = holdings ? ["base44_import", "varda_daily_snapshot_v1", "varda_manual_daily_snapshot"].includes(before.source) ||
          before.source.startsWith("broker_reconstructed_close_v1:") : before.source === "native_ledger_cutoff";
        if (!compatible || after.source !== (holdings ? "current_investments" : "current_native_ledger")) return "scope";
      } else if (before.source !== after.source) return "scope";
      if (holdings) {
        const intervalTrades = dates.flatMap(d => trades.get(key(id, d)) ?? []);
        const reason = holdingFlows(before, after, intervalTrades, flows);
        if (reason) return reason;
        closingFx ||= intervalTrades.some(trade => trade.closingFx);
        carried ||= [...before.positions.values(), ...after.positions.values()].some(row => row.carriedMark);
      } else {
        if (!before.at || !after.at || from && from !== before.at || to && to !== after.at) return "scope";
        from = before.at; to = after.at;
        for (const entry of dates.flatMap(d => cashFlows.get(key(id, d)) ?? [])) {
          if (entry.amountKrw === null || !Number.isFinite(entry.amountKrw) || !entry.amountKrw) return "cash_flow";
          flows.push(flow(entry.date, flows.length, entry.amountKrw, entry.at));
        }
      }
      v0 += before.value; v1 += after.value;
    }
    const calculation = calculateUnitModifiedDietz({
      valuations: [{ serviceDate: start, value: v0, at: from, boundary: "before" },
        { serviceDate: end, value: v1, at: to,
          boundary: evidence.accounts.some(a => frames.get(key(a.id, end))?.liveAsOf) && !holdings ? undefined : "before" }], flows,
      timing: holdings ? undefined : "observed_timestamps",
    });
    if (calculation.status !== "ready") return "capital";
    result.includesCarriedMarks ||= carried;
    result.includesClosingFx ||= closingFx;
    return { change: calculation.totalReturn, closingFx };
  }
  const unavailable = new Set<string>();
  function gap(date: string, reason: PerformanceGapReason) {
    unavailable.add(date);
    const last = result.gaps.at(-1);
    if (last?.reason === reason && dateAfter(last.end, 1) === date) last.end = date;
    else result.gaps.push({ start: date, end: date, reason });
  }
  let segment: string | null = null, growth = 1, estimatedFx = false;
  let canonical: CanonicalClose | undefined;
  const saved = new Map(evidence.observations.flatMap(row =>
    basis === "invested_assets_excluding_cash" && evidence.accounts.length === 1 &&
    row.accountId === evidence.accounts[0].id && row.canonicalClose ? [[row.date,row.canonicalClose] as const] : []));
  let previous: PerformancePoint | null = null;
  for (let date = range.start; date <= range.end; date = dateAfter(date, 1)) {
    const point: PerformancePoint = { date, returnPct: null, dailyReturnPct: null, segment: null };
    result.points.push(point);
    const endpoints = evidence.accounts.map(a => frames.get(key(a.id, date)));
    const receipt = saved.get(date);
    if (receipt) {
      point.canonicalClose = true;
      point.returnPct = receipt.returnPct; point.dailyReturnPct = receipt.dailyReturnPct; point.segment = receipt.segment;
      point.reviewEstimated = receipt.reviewEstimated;
      canonical = receipt;
      segment = receipt.returnPct !== null && receipt.returnPct > -100 ? receipt.segment : null;
      growth = receipt.returnPct === null ? 1 : 1 + receipt.returnPct / 100;
      estimatedFx = false;
      if (receipt.returnPct === null || receipt.dailyReturnPct === null && segment !== date) gap(date,"trade");
      // Stored performance may be known even without a complete position
      // frame. The subsequent link independently needs the actual opening.
      previous = point;
      continue;
    }
    if (basis === "mixed" || endpoints.some(f => !f)) {
      gap(date, basis === "mixed" ? "scope" : "valuation");
      // Missing calendar observations are not fabricated; the next measured close may still establish
      // a multi-day result. A rejected snapshot is stronger evidence and breaks the chain.
      if (endpoints.some(f => f === null)) { previous = null; segment = null; }
      continue;
    }
    if (!previous) { previous = point; continue; }
    // A provisional quote cannot establish the missing close on a prior day.
    // Keep the current tip open until its preceding daily valuation is known.
    if (endpoints.some(endpoint => endpoint?.liveAsOf) && dateAfter(previous.date, 1) !== date) {
      gap(date, "valuation"); continue;
    }
    const interval = link(previous.date, date);
    if (typeof interval === "string") { gap(date, interval); segment = null; previous = point; continue; }
    if (!segment) {
      segment = previous.date; growth = 1; estimatedFx = false; canonical = undefined;
      // A confirmed ending valuation can anchor the next day's gain even
      // when the gain leading to that valuation was unprovable.
      if (previous.returnPct === null && !unavailable.has(previous.date)) { previous.segment = segment; previous.returnPct = 0; }
    }
    estimatedFx ||= interval.closingFx;
    growth *= 1 + interval.change;
    if (!Number.isFinite(growth)) { gap(date, "capital"); segment = null; previous = point; continue; }
    point.segment = segment;
    if (canonical) { point.canonicalClose = true; point.reviewEstimated = canonical.reviewEstimated; }
    if (estimatedFx) point.estimatedFx = true;
    point.dailyReturnPct = dateAfter(previous.date, 1) === date ? interval.change * 100 : null;
    point.returnPct = (growth - 1) * 100;
    const liveAt = endpoints[0]?.liveAsOf;
    if (liveAt && endpoints.every(endpoint => endpoint?.liveAsOf === liveAt)) point.liveAsOf = liveAt;
    previous = point;
    if (growth === 0) segment = null;
  }
  return result;
}
