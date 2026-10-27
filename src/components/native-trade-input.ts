import { Decimal, isCurrency, moneyMinor, type Currency } from "@/lib/money";
import { resolveNativeTrade, type NativeTradeInput } from "@/lib/native-portfolio-ledger";

function amount(value: string | undefined, unit?: Currency, positive = true) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 60) throw new Error("invalid_amount");
  const result = Decimal.from(value);
  if (result.compare(0) < 0 || (positive && result.compare(0) === 0)) throw new Error("invalid_amount");
  if (unit) moneyMinor(value, unit);
  return result;
}

/** Input adapter only. Net cash is explicitly supplied by the user, never inferred
 * from a displayed price or FX rate. The existing ledger still validates gross
 * settlement, costs, quantity and price and applies all account/ownership rules. */
export function tradeInputFromFields(kind: "buy" | "sell", fields: Record<string, string>, unit: Currency, assetId: string): NativeTradeInput {
  // Older correction forms use "price" for the same per-share mode.
  const mode = fields.inputMode === "price" ? "unit" : fields.inputMode ?? "execution";
  if (!["execution", "unit", "total", "net"].includes(mode)) throw new Error("invalid_input");
  const cashUnit = mode === "unit" || mode === "execution" ? unit : fields.settlementCurrency ?? unit;
  if (!isCurrency(cashUnit)) throw new Error("invalid_currency");
  if (mode === "net" && (!fields.fee || !fields.tax)) throw new Error("net_costs_required");
  const fee = fields.fee ? amount(fields.fee, cashUnit, false) : null;
  const tax = fields.tax ? amount(fields.tax, cashUnit, false) : null;
  let gross: Decimal | null = null;
  if (mode === "net") {
    const net = amount(fields.netTotal, cashUnit, kind === "buy");
    const costs = fee!.add(tax!);
    gross = kind === "buy" ? net.sub(costs) : net.add(costs);
    if (gross.compare(0) <= 0) throw new Error("invalid_net_settlement");
  } else if (mode === "total") gross = amount(fields.total, cashUnit);
  const event: NativeTradeInput = {
    type: kind, assetId, currency: unit, quantity: amount(fields.quantity).toExactString(),
    ...(mode === "execution" ? { settlementStatus: "unconfirmed" as const } : {}),
    ...(gross ? { settlement: { amount: gross.toExactString(), currency: cashUnit } } : { price: amount(fields.price).toExactString() }),
    // For cross-currency settlement the engine can preserve a reported price
    // without inventing an FX rate or demanding equality across currencies.
    ...((mode === "total" || mode === "net") && cashUnit !== unit && fields.price ? { executionUnitPrice: { amount: amount(fields.price).toExactString(), currency: unit } } : {}),
    ...(fields.orderPrice ? { orderUnitPrice: { amount: amount(fields.orderPrice).toExactString(), currency: unit } } : {}),
    ...(fee ? { fee: { amount: fee.toExactString(), currency: cashUnit } } : {}),
    ...(tax ? { tax: { amount: tax.toExactString(), currency: cashUnit } } : {}),
  };
  resolveNativeTrade(event);
  return event;
}

export function tradeCashAmount(event: NativeTradeInput) {
  const resolved = resolveNativeTrade(event);
  if (!resolved.settlement) return null;
  const gross = Decimal.from(resolved.settlement.amount);
  const costs = Decimal.from(event.fee?.amount ?? "0").add(event.tax?.amount ?? "0");
  return { gross: resolved.settlement, cash: { amount: (event.type === "buy" ? gross.add(costs) : gross.sub(costs)).toExactString(), currency: resolved.settlement.currency }, costsKnown: event.fee !== undefined && event.tax !== undefined };
}

export function tradeConsideration(event: NativeTradeInput) {
  const resolved = resolveNativeTrade(event);
  return resolved.settlement ?? resolved.calculatedConsideration ?? null;
}

export function exactTradeAmount(value: string) {
  const [integer, fraction] = value.split(".");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : "." + fraction);
}
