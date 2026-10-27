import { Decimal } from "./money.ts";
import { projectNativeInvestmentEvent, resolveNativeTrade, type NativeEvent, type NativePortfolioState } from "./native-portfolio-ledger.ts";
import { convertMoney, costLotsInReportingCurrency, type FxEvidence } from "./currency-valuation.ts";

export type InvestmentEntry = { id: string; accountId: string; recordedAt?: string | Date | null; data: { event: NativeEvent | { type: "opening"; at: string }; state: NativePortfolioState; effect?: unknown } };
export type InvestmentAccount = { id: string; state: NativePortfolioState | null };
export type InvestmentReadBoundary = { asOf?: string; boundary?: "before" | "inclusive" };
export const INVESTMENT_BASIS = "executed_consideration_excluding_cash_v1";

/** Effective, owner-filtered records only. Replay is in memory; original cash,
 * events and snapshots are never rewritten. Missing opening/order stays missing. */
export function projectInvestmentAccount(account: InvestmentAccount, entries: readonly InvestmentEntry[], options: InvestmentReadBoundary = {}) {
  if (!account.state) return null;
  const until = options.asOf === undefined ? Infinity : Date.parse(options.asOf);
  if (Number.isNaN(until)) throw new Error("investment_invalid_boundary");
  const rows = entries.filter(row => row.accountId === account.id && (Date.parse(row.data.event.at) < until || (options.boundary === "inclusive" && Date.parse(row.data.event.at) === until)))
    .toSorted((a, b) => a.data.state.sequence - b.data.state.sequence);
  if (!rows.length && until <= Date.parse(account.state.startedAt)) return null;
  const opening = rows[0];
  if (!opening || opening.data.event.type !== "opening" || opening.data.state.sequence !== 0 || opening.data.state.accountId !== account.id || opening.data.state.startedAt !== account.state.startedAt) throw new Error("investment_opening_missing");
  let state = structuredClone(opening.data.state);
  const projected: InvestmentEntry[] = [structuredClone(opening)];
  const seen = new Set([opening.id]);
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (seen.has(row.id) || row.data.state.accountId !== account.id || row.data.event.type === "opening" || row.data.state.sequence <= rows[i - 1].data.state.sequence) throw new Error("investment_ledger_ambiguous");
    seen.add(row.id);
    // A revision may change durable sequence numbers. Effective row order and
    // recorded final quantities remain authoritative, not synthetic cash.
    const result = projectNativeInvestmentEvent(state, { ...row.data.event, sequence: state.sequence + 1 });
    if (!result.ok) throw new Error("investment_" + result.reason);
    state = result.next;
    if (!sameQuantities(state, row.data.state)) throw new Error("investment_quantity_mismatch");
    projected.push({ ...row, data: { ...row.data, state, effect: result } });
  }
  if (options.asOf === undefined && (!sameQuantities(state, account.state) || rows.at(-1)!.data.state.sequence !== account.state.sequence)) throw new Error("investment_state_changed");
  return { basis: INVESTMENT_BASIS, state, entries: projected, sourceSequence: rows.at(-1)!.data.state.sequence };
}

export function investmentEventKey(e: NativeEvent) {
  return e.type === "buy" || e.type === "sell" ? JSON.stringify([e.type,e.at,e.assetId,e.currency,e.quantity,e.price ?? null,e.executionUnitPrice ?? null,e.settlement ?? null,e.settlementStatus ?? null,e.fee ?? null,e.tax ?? null]) : null;
}

function sameQuantities(a: NativePortfolioState, b: NativePortfolioState) {
  return a.positions.length === b.positions.length && a.positions.every(p => b.positions.some(q => p.assetId === q.assetId && p.currency === q.currency && Decimal.from(p.quantity).compare(q.quantity) === 0));
}

/** Uses acquisition/execution-time FX, never today's FX for historical costs.
 * KRW is the existing legacy return DTO basis. Native exact evidence stays in
 * the replay; its public number boundary is unchanged. */
export function investmentKrwEvidence(projected: NonNullable<ReturnType<typeof projectInvestmentAccount>>, fx: readonly FxEvidence[], asOf: string) {
  const historical = fx.filter(row => row.kind === "daily_reference" || row.kind === "historical_spot");
  const maxAge = 3 * 86400000;
  const cost = (lots: Parameters<typeof costLotsInReportingCurrency>[0], at: string) => costLotsInReportingCurrency(lots, "KRW", historical, maxAge, at);
  const positions = projected.state.positions.map(p => { const c = cost(p.costLots, asOf); return { assetId: p.assetId, currency: p.currency, quantity: p.quantity, costKrw: c.ok ? c.value.toNumber().toString() : null }; });
  const trades = projected.entries.flatMap(row => {
    const e = row.data.event;
    if (e.type !== "buy" && e.type !== "sell") return [];
    const execution = resolveNativeTrade(e), total = execution.settlement ?? execution.calculatedConsideration;
    const rates = e.dateEvidence ? historical.filter(r => r.kind === "daily_reference") : historical;
    const gross = total ? convertMoney(total.amount, total.currency, "KRW", e.at, rates, maxAge) : null;
    const effect = row.data.effect as { realized?: { disposedCostLots: Parameters<typeof cost>[0] } | null };
    const disposed = effect?.realized ? cost(effect.realized.disposedCostLots, e.at) : null;
    const remaining = cost(row.data.state.positions.find(p => p.assetId === e.assetId)?.costLots ?? null, asOf);
    let net = gross?.ok ? gross.value : null;
    for (const charge of [e.fee, e.tax]) if (charge) { const v = convertMoney(charge.amount, charge.currency, "KRW", e.at, rates, maxAge); net = net && v.ok ? net.sub(v.value) : null; }
    return [{ id: row.id, eventKey: investmentEventKey(e), amountKrw: gross?.ok ? gross.value.toNumber().toString() : null,
      costKrw: disposed?.ok ? disposed.value.toNumber().toString() : null,
      realizedPnlKrw: disposed?.ok && net ? net.sub(disposed.value).toNumber().toString() : null,
      remainingCostKrw: remaining.ok ? remaining.value.toNumber().toString() : null,
      consideration: total, basis: INVESTMENT_BASIS }];
  });
  return { positions, trades, basis: INVESTMENT_BASIS, sourceSequence: projected.sourceSequence };
}
