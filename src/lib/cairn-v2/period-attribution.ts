import { calculateFxAwareSnapshotMovementKrw, resolveKrwFxRate } from "../portfolio-math.ts";
import { instrumentLabel } from "../instrument-display.ts";

export type PeriodAttributionRange = { start: string; end: string };
export type PeriodGapReason = "account_history" | "holding_history" | "price" | "fx" | "trade" | "valuation";
export type AttributionPosition = {
  assetId: string | null; name: string; ticker: string | null; market: string | null; currency: string | null;
  quantity: number | null; price: number | null; fxRate: number | null; fixedKrw: number | null; marketValueKrw: number | null;
};
export type AttributionAccountObservation = {
  date: string; accountId: string; expectedPositions: number | null; positions: AttributionPosition[];
};
export type AttributionTrade = {
  date: string; accountId: string; assetId: string | null; quantityDelta: number | null;
  price: number | null; fxRate: number | null; flowKrw?: number | null; currency?: string | null;
  name?: string | null; ticker?: string | null; market?: string | null;
};
export type AttributionEvidence = {
  accounts: { id: string; name: string }[];
  observations: AttributionAccountObservation[];
  trades: AttributionTrade[];
};
type Amounts = { priceKrw: number; fxKrw: number };
type ResultAmounts = { priceKrw: number | null; fxKrw: number | null; totalKrw: number | null };
export type PeriodAttribution = ResultAmounts & {
  range: PeriodAttributionRange;
  state: "complete" | "partial" | "unavailable";
  days: { date: string; priceKrw: number | null; fxKrw: number | null; complete: boolean }[];
  holdings: ({ key: string; account: string; name: string } & ResultAmounts)[];
  gaps: { start: string; end: string; account: string | null; holding: string | null; reason: PeriodGapReason }[];
};

const DAY = 86_400_000;
export const MAX_ATTRIBUTION_DAYS = 366;
const dateAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayTime = (value: string) => Date.parse(value + "T00:00:00Z");
function validDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayTime(value)) && dateAt(dayTime(value)) === value;
}
export function validateAttributionRange(range: PeriodAttributionRange, today: string) {
  return validDay(today) && validDay(range.start) && validDay(range.end) && range.start <= range.end &&
    range.end <= today && (dayTime(range.end) - dayTime(range.start)) / DAY < MAX_ATTRIBUTION_DAYS;
}
export function calendarAttributionRange(preset: "thisMonth" | "lastMonth", today: string): PeriodAttributionRange {
  if (!validDay(today)) throw new RangeError("Invalid service date");
  const first = today.slice(0, 7) + "-01";
  if (preset === "thisMonth") return { start: first, end: today };
  const end = dateAt(dayTime(first) - DAY);
  return { start: end.slice(0, 7) + "-01", end };
}

const positive = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonnegative = (v: number | null | undefined): v is number => v === 0 || positive(v);
const emptyAmounts = (): ResultAmounts => ({ priceKrw: null, fxKrw: null, totalKrw: null });
function addAmounts(total: ResultAmounts, value: Amounts) {
  total.priceKrw = (total.priceKrw ?? 0) + value.priceKrw;
  total.fxKrw = (total.fxKrw ?? 0) + value.fxKrw;
  total.totalKrw = total.priceKrw + total.fxKrw;
}

function roster(observation: AttributionAccountObservation) {
  const positions = new Map<string, AttributionPosition | null>();
  let known = observation.positions.length === observation.expectedPositions;
  for (const row of observation.positions) {
    if (!row.assetId) known = false;
    else if (positions.has(row.assetId)) { known = false; positions.set(row.assetId, null); }
    else positions.set(row.assetId, row);
  }
  return { positions, known };
}

type Leg = { quantityDelta: number; price: number; fxRate: number };
function admittedLegs(trades: AttributionTrade[], currency: string | null) {
  const legs: Leg[] = [];
  let flow = 0;
  for (const trade of trades) {
    if (trade.currency && currency && trade.currency.toUpperCase() !== currency.toUpperCase()) return null;
    const fx = resolveKrwFxRate(trade.currency ?? currency, trade.fxRate);
    if (!fx.ok || !positive(trade.price) || !trade.quantityDelta || !Number.isFinite(trade.quantityDelta)) return null;
    const executed = trade.quantityDelta * trade.price * fx.rate;
    const grossFlow = trade.flowKrw ?? executed;
    if (!Number.isFinite(grossFlow) || Math.sign(grossFlow) !== Math.sign(trade.quantityDelta)) return null;
    flow += grossFlow;
    legs.push({ quantityDelta: trade.quantityDelta, price: trade.price, fxRate: fx.rate });
  }
  return { legs, flow };
}

/** No closing price exists for a sold-out holding. Value its actual local
 * proceeds at the opening FX rate to separate the price result from FX.
 * For an intraday round trip the opening exposure is zero, so use the actual
 * acquisition FX weighted by local purchase consideration. This also works
 * when multiple same-date fills have no verified intraday ordering. */
function closedImpact(legs: Leg[], flow: number, openingLocal: number, previousValue: number, openingFx?: number): Amounts | PeriodGapReason {
  let localProceeds = 0, localPurchases = 0, krwPurchases = 0;
  for (const leg of legs) {
    const consideration = leg.quantityDelta * leg.price;
    if (consideration < 0) localProceeds -= consideration;
    else { localPurchases += consideration; krwPurchases += consideration * leg.fxRate; }
  }
  const baseFx = openingFx ?? (localPurchases > 0 ? krwPurchases / localPurchases : null);
  if (!positive(baseFx) || !localProceeds) return "trade";
  const priceKrw = (localProceeds - localPurchases - openingLocal) * baseFx;
  const fxKrw = legs.reduce((sum, leg) => sum - leg.quantityDelta * leg.price * (leg.fxRate - baseFx), 0);
  const change = -flow - previousValue;
  return Math.abs(priceKrw + fxKrw - change) <= Math.max(.01, Math.abs(change) * 1e-10)
    ? { priceKrw, fxKrw } : "valuation";
}

function holdingImpact(before: AttributionPosition | undefined, after: AttributionPosition | undefined,
  trades: AttributionTrade[]): Amounts | PeriodGapReason {
  const startQty = before ? before.quantity : 0;
  const endQty = after ? after.quantity : 0;
  if (!nonnegative(startQty) || !nonnegative(endQty)) return "holding_history";
  if (before && after && before.currency !== after.currency) return "valuation";
  const currency = after?.currency ?? before?.currency ?? trades[0]?.currency ?? null;
  const execution = admittedLegs(trades, currency);
  if (!execution) return "trade";
  const { legs, flow } = execution;
  const resultingQty = legs.reduce((q, leg) => q + leg.quantityDelta, startQty);
  if (Math.abs(resultingQty - endQty) > Math.max(1e-8, endQty * 1e-10)) return "trade";
  const previousValue = before ? before.marketValueKrw : 0;
  const currentValue = after ? after.marketValueKrw : 0;
  if (!nonnegative(previousValue) || !nonnegative(currentValue)) return "valuation";
  // A KRW balance without shares is a manual valuation, with no observable unit price.
  if ((!startQty && previousValue > 0) || (!endQty && currentValue > 0)) return "valuation";
  if (!startQty && !endQty && !legs.length) return { priceKrw: 0, fxKrw: 0 };
  if (startQty > 0 && !positive(before?.price) || endQty > 0 && !positive(after?.price)) return "price";
  const previousFx = resolveKrwFxRate(currency, before?.fxRate);
  const currentFx = resolveKrwFxRate(currency, after?.fxRate);
  if (startQty > 0 && !previousFx.ok || endQty > 0 && !currentFx.ok) return "fx";

  if (!endQty) return closedImpact(legs, flow, startQty * (before?.price ?? 0), previousValue,
    startQty && previousFx.ok ? previousFx.rate : undefined);
  const first = legs[0];
  // A proven empty opening carries no exposure. Its inert reference can be
  // the first execution. A nonempty opening always requires its own marks.
  const openingPrice = startQty ? before?.price : first?.price;
  const openingFx = startQty ? previousFx.ok && previousFx.rate : first?.fxRate;
  if (!positive(openingPrice) || !openingFx) return "price";
  if (!positive(after?.price)) return "price";
  if (!currentFx.ok) return "fx";
  const movement = calculateFxAwareSnapshotMovementKrw({ previousQuantity: startQty, quantity: endQty,
    previousPrice: openingPrice, currentPrice: after.price, previousFxRate: openingFx, currentFxRate: currentFx.rate,
    previousValueKrw: previousValue, currentValueKrw: currentValue, trades: legs, tradeFlowKrw: flow });
  return movement.priceChangeKrw === null || movement.fxChangeKrw === null ? "valuation" :
    { priceKrw: movement.priceChangeKrw, fxKrw: movement.fxChangeKrw };
}

type Roster = ReturnType<typeof roster>;
function accountImpact(before: Roster | null | undefined, after: Roster | null | undefined,
  trades: AttributionTrade[], record: (id: string, name: string, value: Amounts) => void,
  gap: (reason: PeriodGapReason, id?: string, name?: string) => void) {
  if (!before || !after) { gap("account_history"); return; }
  if (!before.known || !after.known) gap("holding_history");
  const byAsset = new Map<string, AttributionTrade[]>();
  for (const trade of trades) {
    // Without an identity this execution could belong to any position in this account.
    if (!trade.assetId) { gap("trade"); return; }
    const list = byAsset.get(trade.assetId);
    if (list) list.push(trade);
    else byAsset.set(trade.assetId, [trade]);
  }
  const ids = new Set([...before.positions.keys(), ...after.positions.keys(), ...byAsset.keys()]);
  for (const id of ids) {
    const start = before.positions.get(id), end = after.positions.get(id);
    const name = instrumentLabel(end ?? start ?? byAsset.get(id)?.[0] ?? {});
    // An absent row means zero exposure only when the whole roster is accounted for.
    if (start === null || end === null || (!start && !before.known) || (!end && !after.known)) {
      gap("holding_history", id, name);
      continue;
    }
    const effect = holdingImpact(start, end, byAsset.get(id) ?? []);
    if (typeof effect === "string") gap(effect, id, name);
    else record(id, name, effect);
  }
}

export function buildPeriodAttribution(range: PeriodAttributionRange, evidence: AttributionEvidence): PeriodAttribution {
  if (!validateAttributionRange(range, range.end)) throw new RangeError("Invalid attribution period");
  const records = new Map<string, Roster | null>();
  for (const row of evidence.observations) {
    const key = row.date + "/" + row.accountId;
    records.set(key, records.has(key) ? null : roster(row));
  }
  const trades = new Map<string, AttributionTrade[]>();
  for (const row of evidence.trades) {
    const key = row.date + "/" + row.accountId;
    const list = trades.get(key);
    if (list) list.push(row);
    else trades.set(key, [row]);
  }
  const gaps: PeriodAttribution["gaps"] = [], days: PeriodAttribution["days"] = [];
  const latestGap = new Map<string, PeriodAttribution["gaps"][number]>();
  const holdings = new Map<string, PeriodAttribution["holdings"][number]>();
  const totals = emptyAmounts();
  for (let time = dayTime(range.start); time <= dayTime(range.end); time += DAY) {
    const date = dateAt(time), prior = dateAt(time - DAY);
    const subtotal = emptyAmounts();
    let complete = true;
    function addGap(reason: PeriodGapReason, account: string | null, accountId: string, id = "", holding: string | null = null) {
      complete = false;
      const key = JSON.stringify([reason, accountId, id]);
      const previous = latestGap.get(key);
      if (previous?.end === date) return;
      if (previous?.end === prior) previous.end = date;
      else {
        const issue = { start: date, end: date, reason, account, holding };
        latestGap.set(key, issue); gaps.push(issue);
      }
    }
    if (!evidence.accounts.length) addGap("account_history", null, "");
    for (const account of evidence.accounts) {
      const key = date + "/" + account.id;
      accountImpact(records.get(prior + "/" + account.id), records.get(key), trades.get(key) ?? [],
        (id, name, effect) => {
          const key = account.id + "/" + id;
          const line = holdings.get(key) ?? { key, name, account: account.name, ...emptyAmounts() };
          addAmounts(line, effect); holdings.set(key, line); addAmounts(subtotal, effect);
        }, (reason, id, name) => addGap(reason, account.name, account.id, id, name));
    }
    // A confirmed empty account does not prove that an unobserved sibling
    // had zero movement. An entirely observed empty scope does prove zero.
    if (complete && subtotal.priceKrw === null) addAmounts(subtotal, { priceKrw: 0, fxKrw: 0 });
    if (subtotal.priceKrw !== null && subtotal.fxKrw !== null)
      addAmounts(totals, { priceKrw: subtotal.priceKrw, fxKrw: subtotal.fxKrw });
    days.push({ date, priceKrw: subtotal.priceKrw, fxKrw: subtotal.fxKrw, complete });
  }
  const rows = [...holdings.values()].sort((a,b) => Math.abs(b.totalKrw ?? 0) - Math.abs(a.totalKrw ?? 0) || a.key.localeCompare(b.key));
  return { range, ...totals, state: totals.totalKrw === null ? "unavailable" : gaps.length ? "partial" : "complete", days, holdings: rows, gaps };
}
