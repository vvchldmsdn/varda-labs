import { Decimal, isCurrency, moneyMinor, type Currency } from "./money.ts";

export type NativeFraction = { n: string; d: string };
export type NativeDateEvidence = { precision: "date_only"; reportedDate: string; timeZone: "Asia/Seoul"; policy: "service_day_midpoint" };
export type NativeCostLot = { amount: string; currency: Currency; at: string; source: string; remaining: NativeFraction; dateEvidence?: NativeDateEvidence };
export type NativePosition = { assetId: string; currency: Currency; quantity: string; costLots: NativeCostLot[] | null };
export type NativePortfolioState = { version: 1; accountId: string; startedAt: string; at: string; sequence: number; cash: { KRW: string; USD: string }; positions: NativePosition[] };
export type NativeMoney = { amount: string; currency: Currency };
type EventBase = { id: string; sequence: number; at: string; source: string; dateEvidence?: NativeDateEvidence };
export type NativeTradeInput = { type: "buy" | "sell"; assetId: string; quantity: string; currency: Currency; price?: string; settlement?: NativeMoney; executionUnitPrice?: NativeMoney; orderUnitPrice?: NativeMoney; fee?: NativeMoney | null; tax?: NativeMoney | null };
export type NativeEvent = EventBase & (
  | { type: "deposit" | "withdraw" | "dividend" | "fee"; amount: string; currency: Currency; assetId?: string }
  | NativeTradeInput
  | { type: "exchange"; debit: NativeMoney; credit: NativeMoney; fee?: NativeMoney }
  | { type: "transfer"; direction: "in" | "out"; amount: string; currency: Currency; transferId: string; peerAccountId: string }
  | { type: "split"; assetId: string; ratio: NativeFraction }
  | { type: "cost_basis"; assetId: string; costLots: NativeCostLot[] }
);
export type NativeCashLeg = { currency: Currency; delta: string; kind: "external" | "trade" | "income" | "fee" | "exchange" | "transfer" };
export type NativeOpeningInput = { accountId: string; at: string; cash: { KRW: string; USD: string }; positions: NativePosition[] };
export type NativeEventResult = { ok: true; next: NativePortfolioState; cashLegs: NativeCashLeg[]; quantityDelta: { assetId: string; quantity: string } | null; realized: { proceeds: NativeMoney; disposedCostLots: NativeCostLot[] | null } | null; execution: ReturnType<typeof resolveNativeTrade> | null } | { ok: false; reason: string };

/** Sorting/whole-day weighting only, never an asserted intraday execution time. */
export function nativeDateOnlyAt(reportedDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportedDate) || new Date(`${reportedDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportedDate) fail("invalid_trade_date");
  return `${reportedDate}T10:00:00.000Z`; // midpoint of [07:00 KST, next 07:00)
}
export function validateNativeDateEvidence(at: string, evidence?: NativeDateEvidence) {
  if (!evidence) return;
  if (evidence.precision !== "date_only" || evidence.timeZone !== "Asia/Seoul" || evidence.policy !== "service_day_midpoint" || at !== nativeDateOnlyAt(evidence.reportedDate)) fail("invalid_trade_date");
}

/** Instrument currency and actual settlement are separate. Order prices never settle cash. */
export function resolveNativeTrade(event: NativeTradeInput) {
  if (!isCurrency(event.currency)) fail("invalid_currency");
  const q = quantity(event.quantity, true);
  const unit = event.executionUnitPrice ?? (event.price !== undefined ? { amount: event.price, currency: event.currency } : undefined);
  if (event.executionUnitPrice && event.price !== undefined && (event.executionUnitPrice.currency !== event.currency || positivePrice(event.price).compare(positivePrice(event.executionUnitPrice.amount)) !== 0)) fail("execution_evidence_conflict");
  if (unit && (!isCurrency(unit.currency) || unit.currency !== event.currency)) fail("execution_currency_mismatch");
  const price = unit ? positivePrice(unit.amount) : null;
  if (event.orderUnitPrice) {
    if (event.orderUnitPrice.currency !== event.currency) fail("order_currency_mismatch");
    positivePrice(event.orderUnitPrice.amount);
  }
  if (!event.settlement && !unit) fail("settlement_required");
  const settlement = event.settlement ?? { amount: q.mul(price!).toExactString(), currency: event.currency };
  const total = money(settlement.amount, settlement.currency, true);
  if (price && settlement.currency === event.currency && q.mul(price).compare(total) !== 0) fail("execution_evidence_conflict");
  // A repeating average remains rational. Never invent a USD average for a KRW settlement.
  const average = settlement.currency === event.currency ? total.div(q) : null;
  return { settlement: { amount: total.toExactString(), currency: settlement.currency },
    average: average ? { n: average.n.toString(), d: average.d.toString(), currency: event.currency, source: unit ? "reported_execution" as const : "derived_execution_average" as const } : null,
    executionUnitPrice: unit ?? null, fee: event.fee ?? null, tax: event.tax ?? null };
}

export const NATIVE_LEDGER_POLICY = Object.freeze({ version: "native_ledger_v1", disposal: "proportional_weighted_average", fees: "expense_separately", unknownCost: "retain_unknown_until_explicit_dated_basis", maxPositions: 200, maxCostLots: 2000, rationalDigits: 100 });

/** An opening balance is an observed starting point, never a fabricated deposit or purchase. */
export function createNativePortfolioState(input: NativeOpeningInput): { ok: true; state: NativePortfolioState } | { ok: false; reason: string } {
  try {
    const state: NativePortfolioState = { version: 1, accountId: input.accountId, startedAt: input.at, at: input.at, sequence: 0, cash: { ...input.cash }, positions: structuredClone(input.positions) };
    validateState(state);
    state.cash = { KRW: money(state.cash.KRW, "KRW", false).toExactString(), USD: money(state.cash.USD, "USD", false).toExactString() };
    state.positions = state.positions.map(position => ({ ...position, quantity: quantity(position.quantity).toExactString(), costLots: normalizeLots(position.costLots) }));
    return { ok: true, state };
  } catch (error) { return failure(error); }
}

/** Pure single-account reducer. The DB transaction must authorize account/asset/peer ownership,
 * serialize updates, enforce event-id uniqueness and commit both sides of a transfer together. */
export function applyNativeEvent(state: NativePortfolioState, event: NativeEvent): NativeEventResult {
  try {
    validateState(state);
    text(event.id, "event_id"); text(event.source, "source"); timestamp(event.at);
    validateNativeDateEvidence(event.at, event.dateEvidence);
    if (!Number.isSafeInteger(event.sequence) || event.sequence !== state.sequence + 1) fail("event_sequence_mismatch");
    if (Date.parse(event.at) < Date.parse(state.at)) fail("event_time_order_invalid");
    const next = structuredClone(state);
    const cashLegs: NativeCashLeg[] = [];
    let quantityDelta: { assetId: string; quantity: string } | null = null;
    let realized: { proceeds: NativeMoney; disposedCostLots: NativeCostLot[] | null } | null = null;
    let execution: ReturnType<typeof resolveNativeTrade> | null = null;
    const cash = (currency: Currency, delta: Decimal, kind: NativeCashLeg["kind"]) => {
      if (!isCurrency(currency)) fail("invalid_currency");
      // Validate each real settlement independently; no hidden fractional-cent rounding.
      money(delta.compare(0) < 0 ? delta.mul(-1).toExactString() : delta.toExactString(), currency, false);
      const balance = Decimal.from(next.cash[currency]).add(delta);
      if (balance.compare(0) < 0) fail("insufficient_cash");
      money(balance.toExactString(), currency, false);
      next.cash[currency] = balance.toExactString();
      if (delta.compare(0) !== 0) cashLegs.push({ currency, delta: delta.toExactString(), kind });
    };
    const fee = (value: NativeMoney | null | undefined) => {
      if (value) cash(value.currency, money(value.amount, value.currency, false).mul(-1), "fee");
    };
    const position = (assetId: string): NativePosition => {
      text(assetId, "asset_id"); const found = next.positions.find(row => row.assetId === assetId);
      if (!found) fail("position_missing"); return found!;
    };
    switch (event.type) {
      case "deposit": case "withdraw": case "dividend": case "fee": {
        if (event.assetId !== undefined) position(event.assetId);
        const value = money(event.amount, event.currency, true);
        cash(event.currency, value.mul(event.type === "withdraw" || event.type === "fee" ? -1 : 1), event.type === "deposit" || event.type === "withdraw" ? "external" : event.type === "dividend" ? "income" : "fee");
        break;
      }
      case "buy": case "sell": {
        text(event.assetId, "asset_id");
        if (!isCurrency(event.currency)) fail("invalid_currency");
        const amount = quantity(event.quantity, true);
        execution = resolveNativeTrade(event);
        const settlementCurrency = execution.settlement.currency;
        const gross = Decimal.from(execution.settlement.amount);
        let holding = next.positions.find(row => row.assetId === event.assetId);
        if (!holding && event.type === "buy") {
          // The parent writer has verified this is an existing owned assets.id.
          holding = { assetId: event.assetId, currency: event.currency, quantity: "0", costLots: [] };
          next.positions.push(holding);
        }
        if (!holding) fail("position_missing");
        if (holding!.currency !== event.currency) fail("instrument_currency_mismatch");
        const oldQuantity = quantity(holding!.quantity);
        if (event.type === "buy") {
          cash(settlementCurrency, gross.mul(-1), "trade"); fee(event.fee); fee(event.tax);
          holding!.quantity = quantity(oldQuantity.add(amount).toExactString()).toExactString();
          if (oldQuantity.compare(0) === 0) holding!.costLots = [];
          // A known new purchase cannot fill unknown original acquisition evidence.
          if (holding!.costLots !== null) holding!.costLots.push({ amount: gross.toExactString(), currency: settlementCurrency, at: event.at, source: event.source, remaining: { n: "1", d: "1" }, ...(event.dateEvidence ? { dateEvidence: event.dateEvidence } : {}) });
          quantityDelta = { assetId: event.assetId, quantity: amount.toExactString() };
        } else {
          if (amount.compare(oldQuantity) > 0) fail("insufficient_quantity");
          const retained = oldQuantity.sub(amount).div(oldQuantity), disposed = amount.div(oldQuantity);
          realized = { proceeds: { amount: gross.toExactString(), currency: settlementCurrency }, disposedCostLots: holding!.costLots === null ? null : holding!.costLots.map(lot => ({ ...lot, remaining: encoded(fraction(lot.remaining).mul(disposed)) })) };
          holding!.quantity = oldQuantity.sub(amount).toExactString();
          holding!.costLots = holding!.quantity === "0" ? [] : holding!.costLots === null ? null : holding!.costLots.map(lot => ({ ...lot, remaining: encoded(fraction(lot.remaining).mul(retained)) }));
          cash(settlementCurrency, gross, "trade"); fee(event.fee); fee(event.tax);
          quantityDelta = { assetId: event.assetId, quantity: amount.mul(-1).toExactString() };
        }
        break;
      }
      case "exchange": {
        if (event.debit.currency === event.credit.currency) fail("exchange_requires_two_currencies");
        cash(event.debit.currency, money(event.debit.amount, event.debit.currency, true).mul(-1), "exchange");
        cash(event.credit.currency, money(event.credit.amount, event.credit.currency, true), "exchange"); fee(event.fee);
        break;
      }
      case "transfer": {
        text(event.transferId, "transfer_id"); text(event.peerAccountId, "peer_account_id");
        if (event.peerAccountId === state.accountId || !["in", "out"].includes(event.direction)) fail("invalid_transfer");
        cash(event.currency, money(event.amount, event.currency, true).mul(event.direction === "out" ? -1 : 1), "transfer");
        break;
      }
      case "split": {
        const holding = position(event.assetId), before = quantity(holding.quantity), ratio = fraction(event.ratio, false);
        if (ratio.compare(0) <= 0 || ratio.compare(1) === 0) fail("invalid_split_ratio");
        if (before.compare(0) === 0) fail("empty_position");
        const after = quantity(before.mul(ratio).toExactString());
        holding.quantity = after.toExactString(); quantityDelta = { assetId: event.assetId, quantity: after.sub(before).toExactString() };
        // This is an actual quantity event. Original cost and price history are untouched.
        break;
      }
      case "cost_basis": {
        const holding = position(event.assetId);
        if (holding.costLots !== null) fail("cost_basis_already_known");
        if (quantity(holding.quantity).compare(0) <= 0) fail("empty_position");
        if (!Array.isArray(event.costLots)) fail("invalid_cost_lots");
        validateLots(event.costLots, event.at, true);
        holding.costLots = normalizeLots(event.costLots);
        break;
      }
      default: fail("unsupported_event");
    }
    next.at = event.at; next.sequence = event.sequence;
    validateState(next);
    return { ok: true, next, cashLegs, quantityDelta, realized, execution };
  } catch (error) { return failure(error); }
}

/** Exact cost components retain their original currency and acquisition date for dated FX conversion. */
export function nativeCostAmounts(lots: readonly NativeCostLot[] | null): { amount: Decimal; currency: Currency; at: string; source: string }[] | null {
  return lots === null ? null : lots.map(lot => ({ amount: Decimal.from(lot.amount).mul(fraction(lot.remaining)), currency: lot.currency, at: lot.at, source: lot.source }));
}

function fail(reason: string): never { throw new Error(reason); }
function failure(error: unknown): { ok: false; reason: string } { return { ok: false, reason: error instanceof Error ? error.message : "invalid_ledger_input" }; }
function text(value: unknown, name: string) { if (typeof value !== "string" || !value.trim() || value.length > 200) fail(`invalid_${name}`); }
function timestamp(at: unknown) {
  // Date-only/local timestamps cannot locate an actual cash flow across service boundaries.
  if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.now()) fail("invalid_event_time");
  const day = at.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) fail("invalid_event_time");
}
function money(value: string, currency: Currency, positive: boolean) {
  if (!isCurrency(currency) || typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 60) fail("invalid_money");
  const amount = Decimal.from(value);
  if (amount.compare(0) < 0 || (positive && amount.compare(0) === 0)) fail("invalid_money");
  moneyMinor(value, currency);
  return amount;
}
function quantity(value: string, positive = false) {
  if (typeof value !== "string" || !/^\d{1,14}(?:\.\d{1,6})?$/.test(value)) fail("invalid_quantity");
  const amount = Decimal.from(value); if (positive && amount.compare(0) <= 0) fail("invalid_quantity"); return amount;
}
function positivePrice(value: string) {
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,12})?$/.test(value)) fail("invalid_price");
  const amount = Decimal.from(value); if (amount.compare(0) <= 0) fail("invalid_price"); return amount;
}
function fraction(value: NativeFraction, atMostOne = true) {
  if (!value || typeof value.n !== "string" || typeof value.d !== "string" || !/^\d+$/.test(value.n) || !/^[1-9]\d*$/.test(value.d) || value.n.length > NATIVE_LEDGER_POLICY.rationalDigits || value.d.length > NATIVE_LEDGER_POLICY.rationalDigits) fail("invalid_cost_fraction");
  const result = new Decimal(BigInt(value.n), BigInt(value.d));
  if (result.compare(0) <= 0 || (atMostOne && result.compare(1) > 0)) fail("invalid_cost_fraction");
  return result;
}
function encoded(value: Decimal): NativeFraction {
  const result = { n: value.n.toString(), d: value.d.toString() };
  if (result.n.length > NATIVE_LEDGER_POLICY.rationalDigits || result.d.length > NATIVE_LEDGER_POLICY.rationalDigits) fail("cost_fraction_capacity");
  return result;
}
function validateLots(lots: NativeCostLot[] | null, asOf: string, positiveQuantity: boolean) {
  if (lots === null) return;
  if (!Array.isArray(lots) || lots.length > NATIVE_LEDGER_POLICY.maxCostLots || (positiveQuantity && lots.length === 0)) fail("invalid_cost_lots");
  for (const lot of lots) { money(lot.amount, lot.currency, false); timestamp(lot.at); validateNativeDateEvidence(lot.at, lot.dateEvidence); text(lot.source, "cost_source"); if (Date.parse(lot.at) > Date.parse(asOf)) fail("future_cost_evidence"); fraction(lot.remaining); }
}
function normalizeLots(lots: NativeCostLot[] | null) { return lots === null ? null : lots.map(lot => ({ ...lot, amount: Decimal.from(lot.amount).toExactString(), remaining: encoded(fraction(lot.remaining)) })); }
function validateState(state: NativePortfolioState) {
  if (!state || state.version !== 1) fail("invalid_state");
  text(state.accountId, "account_id"); timestamp(state.startedAt); timestamp(state.at);
  if (Date.parse(state.startedAt) > Date.parse(state.at) || !Number.isSafeInteger(state.sequence) || state.sequence < 0) fail("invalid_state");
  money(state.cash?.KRW, "KRW", false); money(state.cash?.USD, "USD", false);
  if (!Array.isArray(state.positions) || state.positions.length > NATIVE_LEDGER_POLICY.maxPositions) fail("invalid_positions");
  const ids = new Set<string>();
  for (const row of state.positions) {
    text(row.assetId, "asset_id"); if (ids.has(row.assetId)) fail("duplicate_position"); ids.add(row.assetId);
    if (!isCurrency(row.currency)) fail("invalid_currency");
    const amount = quantity(row.quantity); validateLots(row.costLots, state.at, amount.compare(0) > 0);
    if (amount.compare(0) === 0 && row.costLots !== null && row.costLots.length > 0) fail("empty_position_cost");
  }
}
