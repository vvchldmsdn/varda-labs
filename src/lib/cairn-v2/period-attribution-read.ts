import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { ACCOUNT_HISTORY_ATTRIBUTION_SQL, projectAccountHistoryReview } from "@/db/queries/account-history-review";
import { ownedRecoveredReturnSql, recoveredCurveAtClose } from "@/db/queries/period-return-recovery";
import { fxFactor, valuePosition, type FxEvidence } from "../currency-valuation";
import type { TrackedNativePosition } from "../currency-tracked-portfolio";
import { isCurrency } from "../money";
import { resolveNativeTrade, type NativeTradeInput } from "../native-portfolio-ledger";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import { toNumber } from "../portfolio-math";
import type { TenantContext } from "../session-resolver-contract";
import { SNAPSHOT_FX_REFERENCE_MAX_AGE_MS } from "../snapshots/cutoff-fx";
import { resolveSnapshotCycle } from "../snapshots/market-calendar";
import { projectReviewedHistoryTrades, reviewedAttributionPosition, reviewedAttributionTrade } from "./reviewed-history-positions";
import { canonicalBasketIncludes, parseCanonicalClose } from "./canonical-close";
import { withinReviewedValuationDates } from "./reviewed-history-series";
import { cutoffDateForValuation, valuationDateForCutoff } from "./history-date";
import {
  buildPeriodAttribution, type AttributionAccountObservation, type AttributionPosition, type AttributionTrade,
  type PeriodAttributionRange,
} from "./period-attribution";
import { ATTRIBUTION_ACCOUNTS_SQL, ATTRIBUTION_ENDS_SQL, ATTRIBUTION_TRADES_SQL, CANONICAL_CLOSE_SCOPE_SQL,
  PERFORMANCE_ACCOUNTS_SQL, PERFORMANCE_CASH_SQL, PERFORMANCE_ENDS_SQL, PERFORMANCE_LIVE_SCOPE_SQL, PERFORMANCE_TRADES_SQL } from "./period-attribution-sql";
import { buildPeriodPerformance, joinRecoveredPerformance, MAX_PERFORMANCE_DAYS, type PeriodPerformance, type PerformanceFlow, type PerformanceObservation } from "./period-performance";
import { performanceLiveFrame } from "./period-performance-live";
import { readPerformanceMarks } from "./period-performance-market-read";

type Row = Readonly<Record<string, unknown>>;
const text = (value: unknown) => typeof value === "string" ? value : null;

function filterClosingBasket<T extends AttributionAccountObservation>(row: T, includes?: ReturnType<typeof canonicalBasketIncludes>): T {
  if (!includes) return row;
  // Filtering must not make an incomplete original mark appear complete.
  const positions = row.positions.filter(includes);
  return { ...row, positions, expectedPositions: row.positions.length === row.expectedPositions &&
    row.positions.every(p => p.name?.trim() || p.ticker?.trim()) ? positions.length : null };
}

function nativePosition(row: TrackedNativePosition, at: string, fx: readonly FxEvidence[]): AttributionPosition {
  const obs = row.observation;
  const base = { assetId: row.id, name: row.name, ticker: row.ticker ?? null, market: row.market ?? null,
    currency: obs?.currency ?? null, quantity: toNumber(obs?.quantity), fixedKrw: null };
  if (!obs || row.unsupportedReason || row.evidenceReason || obs.at !== at || obs.basis !== "raw" ||
    !obs.source?.trim() || obs.timestampBasis === "stored_valuation" || !isCurrency(obs.currency)) {
    return { ...base, price: null, fxRate: null, marketValueKrw: null };
  }
  // A cutoff stores the exact admitted FX evidence. Never consult today's FX or the current asset row.
  const rate = fxFactor(obs.currency, "KRW", at, fx, SNAPSHOT_FX_REFERENCE_MAX_AGE_MS);
  const valuation = valuePosition(obs, "KRW", fx, SNAPSHOT_FX_REFERENCE_MAX_AGE_MS);
  return { ...base, price: toNumber(obs.price), fxRate: rate.ok ? rate.value.toNumber() : null,
    marketValueKrw: valuation.ok ? valuation.value.toNumber() : null };
}

function observation(row: Row, ownerId: string): AttributionAccountObservation {
  const accountId = String(row.account_id), date = String(row.date);
  const positions = Array.isArray(row.positions) ? row.positions : [];
  if (!row.frame_at) return { accountId, date, expectedPositions: toNumber(row.expected_positions), positions };
  const nativeRows = positions as TrackedNativePosition[];
  const owned = nativeRows.filter(p => p && p.accountId === accountId && p.ownerId === ownerId);
  return { accountId, date, expectedPositions: row.frame_complete === true ? nativeRows.length : null,
    positions: owned.map(p => nativePosition(p, String(row.frame_at), Array.isArray(row.native_fx) ? row.native_fx : [])) };
}

function trade(row: Row): AttributionTrade {
  const base = { date: String(row.date), accountId: String(row.account_id), assetId: text(row.asset_id),
    name: text(row.name), ticker: text(row.ticker), market: text(row.market), currency: text(row.currency) };
  const unknown = { ...base, quantityDelta: null, price: null, fxRate: null, flowKrw: null };
  const sign = row.event_type === "buy" ? 1 : row.event_type === "sell" ? -1 : null;
  if (!sign || row.uncertain) return unknown;
  if (row.native_event) {
    const event = row.native_event as NativeTradeInput;
    const q = toNumber(event.quantity);
    if (q === null || q <= 0) return unknown;
    try {
      const execution = resolveNativeTrade(event);
      const gross = execution.settlement;
      const consideration = gross ?? execution.calculatedConsideration;
      const unit = toNumber(execution.executionUnitPrice?.amount) ??
        (consideration?.currency === event.currency ? Number(consideration.amount) / q : null);
      const grossKrw = gross?.currency === "KRW" ? toNumber(gross.amount) : null;
      // Native gross settlement and the separately recorded charges are distinct. When executed in USD
      // with documented KRW gross, their ratio gives the actual conversion for this execution.
      const rate = event.currency === "KRW" ? 1 : grossKrw !== null && unit !== null && unit > 0 ? grossKrw / (q * unit) : null;
      return { ...base, quantityDelta: sign * q, price: unit, fxRate: rate, flowKrw: grossKrw === null ? null : sign * grossKrw };
    } catch { return unknown; }
  }
  const q = toNumber(row.quantity_delta);
  if (q === null || Math.sign(q) !== sign) return unknown;
  const gross = row.gross as { amount?: string; currency?: string } | null;
  const nativeGross = gross?.currency === base.currency ? toNumber(gross?.amount) : null;
  const price = toNumber(row.price) ?? (nativeGross === null ? null : nativeGross / Math.abs(q));
  const grossKrw = toNumber(row.amount_krw);
  return { ...base, quantityDelta: q, price, fxRate: toNumber(row.fx_rate),
    flowKrw: grossKrw === null ? null : sign * Math.abs(grossKrw) };
}

export async function readPeriodAttribution({ tenantContext, scope, range }: {
  tenantContext: TenantContext; scope: PortfolioAnalysisScope; range: PeriodAttributionRange;
}) {
  if (scope.kind === "portfolio_group") throw new Error("period_attribution_group_unsupported");
  const account = scope.kind === "account" ? scope.accountId : null;
  const period = [account, range.start, range.end];
  // A previous valuation day is needed to calculate the first day's impact.
  // Its next-morning cutoff is the valuation range's start date.
  const [accounts, ends, events, reviews, scopes] = await runTenantReadTransaction(tenantContext.ownerUserId, tx => [
    tx.query(ATTRIBUTION_ACCOUNTS_SQL, [account]),
    tx.query(ATTRIBUTION_ENDS_SQL, period),
    tx.query(ATTRIBUTION_TRADES_SQL, period),
    ...(account ? [tx.query(ACCOUNT_HISTORY_ATTRIBUTION_SQL, [tenantContext.ownerUserId, account, range.start, cutoffDateForValuation(range.end)]),
      tx.query(CANONICAL_CLOSE_SCOPE_SQL,[account, range.end])] : []),
  ]);
  const review = account && projectAccountHistoryReview(reviews?.[0], "attribution");
  const scopeReceipt = parseCanonicalClose(scopes?.[0]?.receipt, String(scopes?.[0]?.date));
  const includes = scopeReceipt && (scopeReceipt.excludedLabels.length || scopeReceipt.excludedTickers.length)
    ? canonicalBasketIncludes(scopeReceipt) : undefined;
  const canonicalDays = new Set<string>();
  const savedTrades: AttributionTrade[] = [];
  const observations = ends.map(row => {
    const obs = observation(row, tenantContext.ownerUserId);
    const receipt = parseCanonicalClose(row.canonical_receipt, obs.date);
    if (!receipt) return filterClosingBasket(obs, includes);
    const raw = (row.canonical_receipt as Row).reviewedTrades;
    const verified = projectReviewedHistoryTrades(raw);
    const known = !!verified && Array.isArray(raw) && raw.every(r => typeof r?.assetId === "string" && r.assetId);
    if (known) savedTrades.push(...verified.map((t,i) => ({ ...reviewedAttributionTrade(t,obs.date,obs.accountId),assetId:raw[i].assetId })));
    canonicalDays.add(obs.accountId + "/" + obs.date);
    return { ...obs, reviewed: { valueKrw: toNumber(row.close_value), estimated: receipt.reviewEstimated, tradesKnown: known, materialized: true as const } };
  });
  const trades = [...events.map(trade).filter(row => !canonicalDays.has(row.accountId + "/" + row.date) && (!includes || includes(row))), ...savedTrades];
  if (review && accounts.some(row => row.id === account)) {
    const matches = (row: {accountId: string; date: string}) => row.accountId === account &&
      withinReviewedValuationDates(review, row.date) && !canonicalDays.has(row.accountId + "/" + row.date);
    const overlay = review.points.filter(p => !canonicalDays.has(account + "/" + valuationDateForCutoff(p.date)));
    const reviewedObservations = overlay.map(point => ({
      date: valuationDateForCutoff(point.date), accountId: account, expectedPositions: point.positions?.length ?? null,
      positions: point.positions?.map(reviewedAttributionPosition) ?? [],
      reviewed: { valueKrw: point.valueKrw, estimated: point.estimated, tradesKnown: !!point.trades },
    } satisfies AttributionAccountObservation));
    return buildPeriodAttribution(range, {
      accounts: accounts.map(a => ({ id: String(a.id), name: String(a.name) })),
      observations: [...observations.filter(row => !matches(row)), ...reviewedObservations],
      trades: [...trades.filter(row => !matches(row)),
        ...overlay.flatMap(point => (point.trades ?? []).map(row => reviewedAttributionTrade(row, valuationDateForCutoff(point.date), account)))],
    });
  }
  return buildPeriodAttribution(range, {
    accounts: accounts.map(a => ({ id: String(a.id), name: String(a.name) })),
    observations, trades,
  });
}

function performanceObservation(row: Row, ownerId: string): PerformanceObservation {
  const result = observation(row, ownerId);
  if (!row.frame_at) return { ...result, source: String(row.source), recoveryOpeningKrw: toNumber(row.recovery_opening_krw) };
  const positions: TrackedNativePosition[] = Array.isArray(row.positions) ? row.positions : [];
  const cash = positions.filter(p => p?.kind === "cash");
  // Both balances (including explicit zero) are stored by the native cutoff writer.
  // A holdings subtotal is never a proxy for an account with cash.
  const cashComplete = cash.length === 2 && ["KRW", "USD"].every(currency => cash.some(p =>
    p.id === "cash:" + result.accountId + ":" + currency && p.observation?.currency === currency &&
    p.observation.source === "native_ledger_cash" && p.observation.price === "1"));
  const cutoff = Date.parse(String(row.frame_at));
  const valid = cashComplete && cutoff === Date.parse(result.date + "T22:00:00Z") &&
    Array.isArray(row.available_currencies) && row.available_currencies.includes("KRW");
  return { ...result, source: "native_ledger_cutoff", at: String(row.frame_at),
    expectedPositions: valid ? result.expectedPositions : null };
}

function performanceFlows(rows: readonly Row[], ends: readonly Row[], accounts: readonly Row[]): PerformanceFlow[] {
  const withinScope = new Set(accounts.map(a => a.id));
  const fx = new Map<string, FxEvidence[]>();
  for (const end of ends) if (Array.isArray(end.native_fx)) {
    fx.set(String(end.account_id) + "/" + String(end.date), end.native_fx);
  }
  const transfers = new Map<unknown, Row[]>();
  for (const row of rows) if (row.type === "transfer") {
    const pair = transfers.get(row.transfer_id) ?? [];
    pair.push(row); transfers.set(row.transfer_id, pair);
  }
  const flows: PerformanceFlow[] = [];
  for (const row of rows) {
    const date = String(row.date), at = String(row.at), accountId = String(row.account_id);
    const sign = row.type === "deposit" || row.direction === "in" ? 1 : -1;
    const leg = Array.isArray(row.legs) && row.legs.length === 1 ? row.legs[0] : null;
    const amount = toNumber(row.amount);
    const admitted = leg && amount !== null && amount > 0 && leg.currency === row.currency &&
      leg.kind === (row.type === "transfer" ? "transfer" : "external") && toNumber(leg.delta) === sign * amount;
    if (!admitted || !isCurrency(row.currency) ||
        row.type === "transfer" && (!text(row.peer) || !text(row.transfer_id) || !["in", "out"].includes(String(row.direction)))) {
      flows.push({ date, accountId, at, amountKrw: null }); continue;
    }
    if (row.type === "transfer" && withinScope.has(row.peer)) {
      const pair = transfers.get(row.transfer_id) ?? [];
      if (pair.length !== 2 || !pair.some(other => other.account_id === row.peer && other.peer === row.account_id &&
        other.at === row.at && other.currency === row.currency && toNumber(other.amount) === amount && other.direction !== row.direction)) {
        flows.push({ date, accountId, at, amountKrw: null });
      }
      continue;
    }
    const previous = new Date(Date.parse(date + "T00:00:00Z") - 86_400_000).toISOString().slice(0,10);
    const closeFx = fx.get(accountId + "/" + date) ?? [];
    const cutoff = date + "T22:00:00Z";
    const fixing = closeFx.filter(item => item.fixing && Date.parse(item.fixing.cutoffAt) === Date.parse(cutoff));
    const evidence = [...(fx.get(accountId + "/" + previous) ?? []), ...closeFx].filter(item => !item.fixing);
    // The event time still weights the cash flow. Translate its native amount at
    // this day's shared reporting rate without treating it as a currency trade.
    const rate = fixing.length ? fxFactor(row.currency, "KRW", cutoff, fixing, SNAPSHOT_FX_REFERENCE_MAX_AGE_MS)
      : fxFactor(row.currency, "KRW", at, row.date_only ? evidence.filter(item => item.kind === "daily_reference") : evidence,
        SNAPSHOT_FX_REFERENCE_MAX_AGE_MS);
    flows.push({ date, accountId, at, amountKrw: rate.ok ? sign * amount * rate.value.toNumber() : null });
  }
  return flows;
}

type PerformanceReadRequest = {
  tenantContext: TenantContext; scope: PortfolioAnalysisScope; range: PeriodAttributionRange;
  now?: Date; includeLive?: boolean; onClosedEvidence?: (rows: readonly {date: string; snapshotId: string}[]) => void;
};
export async function readPeriodPerformance(request: PerformanceReadRequest) {
  return performanceRange(request, true);
}
async function performanceRange({ tenantContext, scope, range, now = new Date(), includeLive = true, onClosedEvidence }: PerformanceReadRequest,
  canExpand: boolean): Promise<PeriodPerformance> {
  if (scope.kind === "portfolio_group") throw new Error("period_performance_group_unsupported");
  const account = scope.kind === "account" ? scope.accountId : null;
  const params = [account, range.start, range.end];
  const serviceDay = resolveSnapshotCycle(now).snapshotDate;
  const open = includeLive && range.start <= serviceDay && serviceDay <= range.end &&
    now.getTime() > Date.parse(serviceDay + "T07:00:00+09:00");
  const readRecovery = includeLive && account !== null;
  const [accounts, ends, trades, cash, ...extra] = await runTenantReadTransaction(tenantContext.ownerUserId, tx => [
    tx.query(PERFORMANCE_ACCOUNTS_SQL, [account]), tx.query(PERFORMANCE_ENDS_SQL, params),
    tx.query(PERFORMANCE_TRADES_SQL, params), tx.query(PERFORMANCE_CASH_SQL, params),
    ...(open ? [tx.query(PERFORMANCE_LIVE_SCOPE_SQL, [account])] : []),
    ...(readRecovery ? [tx.query(ownedRecoveredReturnSql(true), [tenantContext.ownerUserId, account, range.start, range.end])] : []),
    ...(account ? [tx.query(CANONICAL_CLOSE_SCOPE_SQL, [account, range.end])] : []),
  ]);
  const guards = open ? extra[0] : undefined;
  const recoveryRow = readRecovery ? extra[open ? 1 : 0]?.[0] : undefined;
  const scopeRow = account ? extra.at(-1)?.[0] : undefined;
  const receipt = parseCanonicalClose(scopeRow?.receipt, String(scopeRow?.date));
  if (receipt && canExpand && receipt.date < range.start && Date.parse(range.end) - Date.parse(receipt.date) < MAX_PERFORMANCE_DAYS * 86_400_000) {
    // The storage worker and a clipped chart both use the same corrected
    // opening and all intervening closed links, even after several new closes.
    const full = await performanceRange({ tenantContext, scope, range: {start:receipt.date,end:range.end}, now, includeLive, onClosedEvidence }, false);
    return { ...full, range, points: full.points.filter(p => p.date >= range.start),
      gaps: full.gaps.filter(g => g.end >= range.start).map(g => ({ ...g,start: g.start < range.start ? range.start : g.start })) };
  }
  const recovery = account && !receipt ? recoveredCurveAtClose(recoveryRow, ends, account) : null;
  onClosedEvidence?.(ends.flatMap(row => typeof row.snapshot_id === "string" ? [{ date: String(row.date), snapshotId: row.snapshot_id }] : []));
  const includes = receipt && (receipt.excludedLabels.length || receipt.excludedTickers.length) ? canonicalBasketIncludes(receipt) : undefined;
  const observations = ends.map(row => {
    const obs = performanceObservation(row, tenantContext.ownerUserId);
    const saved = account && parseCanonicalClose(row.canonical_receipt, obs.date);
    return saved ? { ...obs, canonicalClose:saved, recoveryOpeningKrw:toNumber(row.close_value) } : filterClosingBasket(obs, includes);
  });
  if (recovery) {
    const opening = observations.find(o => o.accountId === account && o.date === recovery.baseDate);
    if (opening && !opening.at) opening.recoveryOpeningKrw = recovery.points[0].valueKrw;
  }
  const fxEnds: Row[] = [...ends];
  const executionEnds = new Map<string, {date: string; at: number}>();
  for (const row of ends) {
    if (typeof row.execution_end_at !== "string") continue;
    const at = new Date(row.execution_end_at);
    if (Number.isFinite(at.getTime())) {
      executionEnds.set(String(row.account_id) + "/" + resolveSnapshotCycle(at).snapshotDate, { date: String(row.date), at: at.getTime() });
    }
  }
  // Translate only a recorded foreign execution at its own service-day portfolio mark.
  // This is a reporting convention, not an inferred exchange or settlement.
  const closeRates = new Map<string, Set<number>>();
  for (const [index, observation] of observations.entries()) {
    if (observation.at || observation.expectedPositions !== observation.positions.length) continue;
    const rates = new Set(observation.positions.flatMap(p => p.currency === "USD" && p.fxRate !== null &&
      Number.isFinite(p.fxRate) && p.fxRate > 0 ? [p.fxRate] : []));
    // A final sale can leave no USD position at this close. The same completed
    // portfolio snapshot retains the FX quote used by its writer.
    const portfolioRate = toNumber(ends[index].portfolio_usd_krw);
    if (portfolioRate !== null && portfolioRate > 0) rates.add(portfolioRate);
    closeRates.set(observation.accountId + "/" + observation.date, rates);
  }
  const holdings = accounts.every(row => row.holdings === true);
  if (open && accounts.length && guards?.length && (holdings || accounts.every(row => row.holdings === false)) &&
      accounts.every(a => guards.some(row => row.account_id === a.id)) &&
      accounts.every(a => ends.some(row => row.account_id === a.id && String(row.date) < serviceDay)) &&
      !ends.some(row => row.date === serviceDay) &&
      accounts.every(a => (executionEnds.get(a.id + "/" + serviceDay)?.at ?? 0) < now.getTime())) {
    // Market data and the current ledger are re-read with server-owned scope.
    // A failed price read only affects the provisional tip.
    const latest = new Map<string, { at: string; observation: PerformanceObservation }>();
    for (const [i, observation] of observations.entries()) {
      if (observation.date < serviceDay && observation.expectedPositions === observation.positions.length &&
          typeof ends[i].captured_at === "string") latest.set(observation.accountId, { at: String(ends[i].captured_at), observation });
    }
    const evidence = await readPerformanceMarks(tenantContext, scope, now, holdings, latest).catch(() => null);
    const live = evidence && performanceLiveFrame(evidence, tenantContext.ownerUserId, guards, holdings, serviceDay, now.toISOString());
    if (live) {
      observations.push(...live.observations.map(row => filterClosingBasket(row, includes)));
      for (const observation of live.observations) {
        if (live.portfolioUsdKrw !== null) closeRates.set(observation.accountId + "/" + serviceDay, new Set([live.portfolioUsdKrw]));
        fxEnds.push({ account_id: observation.accountId, date: serviceDay, native_fx: live.fx });
      }
    }
  }
  const byNow = (row: Row, at: unknown) => !open || row.date !== serviceDay || at == null || Date.parse(String(at)) <= now.getTime();
  const result = buildPeriodPerformance(range, {
    accounts: accounts.map(a => ({ id: String(a.id), holdings: a.holdings === true })),
    observations, trades: trades.flatMap(row => {
      // A current holdings writer values through its actual cycle_end_at,
      // including executions exactly at that instant. A retrospective cutoff
      // uses the usual exclusive 07:00 boundary regardless of when it was saved.
      const previousClose = executionEnds.get(String(row.account_id) + "/" + String(row.date));
      const nativeEvent = row.native_event as {dateEvidence?: unknown} | null;
      const exact = typeof row.executed_at === "string" && !nativeEvent?.dateEvidence;
      const date = previousClose && exact && Date.parse(String(row.executed_at)) <= previousClose.at ? previousClose.date : String(row.date);
      if (date < range.start || date > range.end || !byNow(row, exact ? row.executed_at : null)) return [];
      const leg = { ...trade(row), date };
      if (includes && !includes(leg)) return [];
      const rates = closeRates.get(leg.accountId + "/" + leg.date);
      if (leg.currency !== "USD" || leg.flowKrw !== null || leg.fxRate !== null ||
          !leg.price || !leg.quantityDelta || rates?.size !== 1) return leg;
      return { ...leg, fxRate: [...rates][0], closingFx: true };
    }), cashFlows: performanceFlows(cash.filter(row => byNow(row, row.at)), fxEnds, accounts),
  });
  return recovery && account ? joinRecoveredPerformance(result, recovery, account, observations) : result;
}
