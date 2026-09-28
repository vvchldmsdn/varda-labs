/** Exact decimal/rational arithmetic. Round only at a money settlement boundary. */
export type Currency = "KRW" | "USD";
export const MONEY_VERSION = "reporting_currency_v1";
export const MINOR_DIGITS: Readonly<Record<Currency, number>> = { KRW: 0, USD: 2 };
export function isCurrency(value: unknown): value is Currency { return value === "KRW" || value === "USD"; }

function gcd(a: bigint, b: bigint): bigint { a = a < BigInt(0) ? -a : a; while (b) { const r = a % b; a = b; b = r; } return a || BigInt(1); }
export class Decimal {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = BigInt(1)) {
    if (!d) throw new Error("invalid_decimal");
    if (d < BigInt(0)) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
  }
  static from(value: string | number | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    const text = String(value);
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || text.length > 100) throw new Error("invalid_decimal");
    const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
    if (Math.abs(exponent) > 30) throw new Error("invalid_decimal");
    const n = BigInt((match[1] || "") + match[2] + (match[3] ?? ""));
    return exponent >= 0 ? new Decimal(n * BigInt(10) ** BigInt(exponent)) : new Decimal(n, BigInt(10) ** BigInt(-exponent));
  }
  add(b: string | number | Decimal) { const v = Decimal.from(b); return new Decimal(this.n * v.d + v.n * this.d, this.d * v.d); }
  sub(b: string | number | Decimal) { const v = Decimal.from(b); return new Decimal(this.n * v.d - v.n * this.d, this.d * v.d); }
  mul(b: string | number | Decimal) { const v = Decimal.from(b); return new Decimal(this.n * v.n, this.d * v.d); }
  div(b: string | number | Decimal) { const v = Decimal.from(b); return new Decimal(this.n * v.d, this.d * v.n); }
  compare(b: string | number | Decimal) { const v = Decimal.from(b); const delta = this.n * v.d - v.n * this.d; return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : 0; }
  toNumber() { const value = Number(this.n) / Number(this.d); if (!Number.isFinite(value)) throw new Error("decimal_overflow"); return value; }
  /** Lossless serialization for native finite decimals (quantity × raw price).
   * Recurring ratios must stay rational internally, not be silently rounded. */
  toExactString() {
    let denominator = this.d, twos = 0, fives = 0;
    while (denominator % BigInt(2) === BigInt(0)) { denominator /= BigInt(2); twos++; }
    while (denominator % BigInt(5) === BigInt(0)) { denominator /= BigInt(5); fives++; }
    const scale = Math.max(twos, fives);
    if (denominator !== BigInt(1) || scale > 60) throw new Error("non_finite_decimal");
    const integer = this.n * BigInt(2) ** BigInt(scale - twos) * BigInt(5) ** BigInt(scale - fives);
    const digits = (integer < BigInt(0) ? -integer : integer).toString().padStart(scale + 1, "0");
    return (integer < BigInt(0) ? "-" : "") + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
  }
  minor(currency: Currency, rounding: "exact" | "floor" | "nearest" = "exact"): bigint {
    const n = this.n * BigInt(10) ** BigInt(MINOR_DIGITS[currency]);
    const q = n / this.d, r = n % this.d;
    if (rounding === "exact" && r) throw new Error("invalid_minor_unit");
    if (rounding === "floor") return r < BigInt(0) ? q - BigInt(1) : q;
    if (rounding === "nearest" && (r < BigInt(0) ? -r : r) * BigInt(2) >= this.d) return q + (n < BigInt(0) ? -BigInt(1) : BigInt(1));
    return q;
  }
}
export function moneyMinor(value: number | string, currency: Currency): number {
  const units = Decimal.from(value).minor(currency);
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("money_overflow");
  return Number(units);
}
export function moneyFromMinor(value: number | bigint, currency: Currency): number {
  if (!isCurrency(currency) || (typeof value === "number" && !Number.isSafeInteger(value))) throw new Error("money_overflow");
  const exact = new Decimal(BigInt(value), BigInt(10) ** BigInt(MINOR_DIGITS[currency]));
  const amount = exact.toNumber();
  // A safe integer number of cents is not necessarily representable as a dollar Number.
  // Reject the presentation boundary rather than silently changing the saved/allocated cent.
  if (Decimal.from(amount).compare(exact) !== 0) throw new Error("money_overflow");
  return amount;
}
export function formatMoney(value: number, currency: Currency, locale = "ko-KR") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: MINOR_DIGITS[currency], maximumFractionDigits: MINOR_DIGITS[currency] }).format(value);
}
/** Deliberately accept only ko/en decimal punctuation; reject ambiguous grouping. */
export function parseMoneyInput(text: string, currency: Currency): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text.trim())) return null;
  try { return moneyFromMinor(moneyMinor(text.trim().replaceAll(",", ""), currency), currency); } catch { return null; }
}
