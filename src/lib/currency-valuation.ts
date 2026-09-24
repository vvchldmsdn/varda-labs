import { Decimal, isCurrency, type Currency, MONEY_VERSION } from "./money.ts";

export type FxEvidence = Readonly<{
  base: Currency; quote: Currency; rate: string;
  observedAt: string; fetchedAt: string; source: string;
  kind: "spot" | "historical_spot" | "daily_reference" | "user_input" | "synthetic";
  requestedAt?: string;
  /** Present only when restored from an immutable, owned valuation capture. */
  capturedAt?: string;
}>;
export type CurrencyResult<T> = { ok: true; value: T } | { ok: false; reason: "fx_missing" | "fx_stale" | "fx_invalid" | "future_evidence" | "price_basis_mismatch" | "missing_cost_evidence" | "invalid_value" };
/** Dated captures keep their original pair evidence. Later backfills may fill
 * another pair, but cannot rewrite a previously captured portfolio valuation. */
export function selectValuationFxAt(at: string, asOf: string, evidence: readonly FxEvidence[], historical: boolean): readonly FxEvidence[] {
  const validCapture = (row: FxEvidence) => Number.isFinite(Date.parse(row.capturedAt ?? "")) && Date.parse(row.observedAt) <= Date.parse(row.fetchedAt) && Date.parse(row.fetchedAt) <= Date.parse(row.capturedAt!) && Date.parse(row.capturedAt!) <= Date.parse(asOf);
  if (!historical) return evidence.filter(row => row.kind === "spot" || row.kind === "daily_reference" || row.kind === "historical_spot");
  const admitted = evidence.filter(row => row.kind === "daily_reference" || row.kind === "historical_spot" || (row.kind === "spot" && validCapture(row)));
  const captured = admitted.filter(row => row.capturedAt === at && validCapture(row));
  return [...captured, ...admitted.filter(row => !captured.some(saved => (saved.base === row.base && saved.quote === row.quote) || (saved.base === row.quote && saved.quote === row.base)))];
}
export function fxFactor(from: Currency, to: Currency, at: string, evidence: readonly FxEvidence[], maxAgeMs: number): CurrencyResult<Decimal> {
  const time = Date.parse(at);
  if (!isCurrency(from) || !isCurrency(to) || !Number.isFinite(time) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return { ok: false, reason: "fx_invalid" };
  const knownAt = Date.now();
  if (time > knownAt) return { ok: false, reason: "future_evidence" };
  if (from === to) return { ok: true, value: Decimal.from(1) };
  const matching = evidence.filter(row => (row.base === from && row.quote === to) || (row.base === to && row.quote === from));
  if (!matching.length) return { ok: false, reason: "fx_missing" };
  const valid = matching.filter(row => {
    try { return row.base !== row.quote && row.source.trim() && Number.isFinite(Date.parse(row.observedAt)) && Number.isFinite(Date.parse(row.fetchedAt)) && Date.parse(row.observedAt) <= Date.parse(row.fetchedAt) &&
      (row.kind !== "historical_spot" || (Number.isFinite(Date.parse(row.requestedAt ?? "")) && Date.parse(row.observedAt) <= Date.parse(row.requestedAt!) && Date.parse(row.requestedAt!) <= knownAt)) && Decimal.from(row.rate).compare(0) > 0; } catch { return false; }
  });
  if (!valid.length) return { ok: false, reason: "fx_invalid" };
  // Historic reconstruction may use a subsequently collected observation, but never a future observation.
  const past = valid.filter(row => Date.parse(row.observedAt) <= time && Date.parse(row.fetchedAt) <= knownAt).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  if (!past.length) return { ok: false, reason: "future_evidence" };
  const row = past[0];
  if (time - Date.parse(row.observedAt) > maxAgeMs) return { ok: false, reason: "fx_stale" };
  const factor = row.base === from ? Decimal.from(row.rate) : Decimal.from(1).div(row.rate);
  if (past.some(item => Date.parse(item.observedAt) === Date.parse(row.observedAt) && (item.base === from ? Decimal.from(item.rate) : Decimal.from(1).div(item.rate)).compare(factor) !== 0)) return { ok: false, reason: "fx_invalid" };
  return { ok: true, value: factor };
}
export function convertMoney(amount: string | number | Decimal, from: Currency, to: Currency, at: string, evidence: readonly FxEvidence[], maxAgeMs: number): CurrencyResult<Decimal> {
  const factor = fxFactor(from, to, at, evidence, maxAgeMs);
  if (!factor.ok) return factor;
  try { return { ok: true, value: Decimal.from(amount).mul(factor.value) }; } catch { return { ok: false, reason: "invalid_value" }; }
}
export type ValuationObservation = { quantity: string; price: string; currency: Currency; at: string; priceObservedAt?: string; basis: "raw"; source: string };
export function valuePosition(row: ValuationObservation, reporting: Currency, fx: readonly FxEvidence[], maxAgeMs: number): CurrencyResult<Decimal> {
  if (row.basis !== "raw") return { ok: false, reason: "price_basis_mismatch" };
  try {
    if (Decimal.from(row.quantity).compare(0) < 0 || Decimal.from(row.price).compare(0) <= 0 || !row.source || !Number.isFinite(Date.parse(row.at))) return { ok: false, reason: "invalid_value" };
    if (row.priceObservedAt !== undefined && (!Number.isFinite(Date.parse(row.priceObservedAt)) || Date.parse(row.priceObservedAt) > Date.parse(row.at))) return { ok: false, reason: "future_evidence" };
    if (Decimal.from(row.quantity).compare(0) === 0) return { ok: true, value: Decimal.from(0) };
    return convertMoney(Decimal.from(row.quantity).mul(row.price), row.currency, reporting, row.at, fx, maxAgeMs);
  } catch { return { ok: false, reason: "invalid_value" }; }
}
/** q0 * (p1-p0) * f0; FX absorbs the price/FX cross term, matching existing movement policy. */
export function decomposeCurrencyMovement(before: ValuationObservation, after: ValuationObservation, reporting: Currency, fx: readonly FxEvidence[], maxAgeMs: number) {
  if (before.currency !== after.currency || before.basis !== "raw" || after.basis !== "raw") return { ok: false as const, reason: "price_basis_mismatch" };
  const v0 = valuePosition(before, reporting, fx, maxAgeMs), v1 = valuePosition(after, reporting, fx, maxAgeMs);
  if (!v0.ok) return v0; if (!v1.ok) return v1;
  if (Date.parse(after.at) < Date.parse(before.at)) return { ok: false as const, reason: "invalid_value" };
  const f0 = fxFactor(before.currency, reporting, before.at, fx, maxAgeMs), f1 = fxFactor(after.currency, reporting, after.at, fx, maxAgeMs);
  if (!f0.ok) return f0; if (!f1.ok) return f1;
  const q0 = Decimal.from(before.quantity), q1 = Decimal.from(after.quantity), p0 = Decimal.from(before.price), p1 = Decimal.from(after.price);
  const start = q0.mul(p0).mul(f0.value), end = q1.mul(p1).mul(f1.value);
  const price = q0.mul(p1.sub(p0)).mul(f0.value);
  const exchange = q0.mul(p1).mul(f1.value.sub(f0.value));
  const position = q1.sub(q0).mul(p1).mul(f1.value);
  return { ok: true as const, value: { start, end, price, exchange, position, total: end.sub(start), version: MONEY_VERSION, reporting } };
}
export function costInReportingCurrency(cost: { amount: string; currency: Currency; at: string; source: string } | null, reporting: Currency, fx: readonly FxEvidence[], maxAgeMs: number) {
  if (!cost || !cost.source || !Number.isFinite(Date.parse(cost.at))) return { ok: false as const, reason: "missing_cost_evidence" };
  return convertMoney(cost.amount, cost.currency, reporting, cost.at, fx.filter(row => row.kind !== "user_input"), maxAgeMs);
}

/** Weighted-average disposal keeps each acquisition's original date and currency. */
export function costLotsInReportingCurrency(lots: readonly { amount: string; currency: Currency; at: string; source: string; remaining: { n: string; d: string } }[] | null, reporting: Currency, fx: readonly FxEvidence[], maxAgeMs: number, asOf: string) {
  if (!lots) return { ok: false as const, reason: "missing_cost_evidence" };
  try {
    let total = Decimal.from(0);
    for (const lot of lots) {
      if (Date.parse(lot.at) > Date.parse(asOf)) return { ok: false as const, reason: "future_evidence" };
      const fraction = new Decimal(BigInt(lot.remaining.n), BigInt(lot.remaining.d));
      if (fraction.compare(0) < 0 || fraction.compare(1) > 0) return { ok: false as const, reason: "invalid_value" };
      const converted = costInReportingCurrency(lot, reporting, fx, maxAgeMs);
      if (!converted.ok) return converted;
      total = total.add(converted.value.mul(fraction));
    }
    return { ok: true as const, value: total };
  } catch { return { ok: false as const, reason: "invalid_value" }; }
}

export type NativeReturnPoint = { at: string; price: string; currency: Currency; basis: "raw_price" | "split_adjusted" | "total_return"; dataset: string };
/** Every date is translated before calculating returns; never convert a KRW return or path. */
export function reportingReturnSeries(points: readonly NativeReturnPoint[], reporting: Currency, fx: readonly FxEvidence[], maxAgeMs: number) {
  if (points.length < 2) return { ok: false as const, reason: "insufficient_history" };
  const values: Decimal[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.basis !== points[0].basis || point.dataset !== points[0].dataset || point.currency !== points[0].currency || !point.dataset || !Number.isFinite(Date.parse(point.at)) || (i > 0 && Date.parse(point.at) <= Date.parse(points[i - 1].at))) return { ok: false as const, reason: "price_basis_mismatch" };
    const value = convertMoney(point.price, point.currency, reporting, point.at, fx, maxAgeMs);
    if (!value.ok) return value;
    if (value.value.compare(0) <= 0) return { ok: false as const, reason: "invalid_value" };
    values.push(value.value);
  }
  return { ok: true as const, value: values.slice(1).map((value, index) => ({ at: points[index + 1].at, return: value.div(values[index]).sub(1).toNumber() })), reporting, basis: points[0].basis, dataset: points[0].dataset, version: MONEY_VERSION };
}
