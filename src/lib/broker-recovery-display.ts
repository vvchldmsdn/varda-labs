import { Decimal } from "./money.ts";

export type BrokerEvidenceMoney = Readonly<{ currency: "KRW" | "USD"; amount: string }>;
export type BrokerRecoveryDisplay = Readonly<{
  executionGross: BrokerEvidenceMoney | null;
  originalDisplay: BrokerEvidenceMoney | null;
  cashSettlement: (BrokerEvidenceMoney & Readonly<{ date: string }>) | null;
  orderUnitPrice?: BrokerEvidenceMoney;
}>;

/** Whitelist financial evidence only. Operator IDs, source paths and the manifest stay server-side. */
export function projectBrokerRecoveryDisplay(value: unknown, event: {
  source: string | null; eventDate: string; eventType: string; quantityDelta: string | null;
}): BrokerRecoveryDisplay | null {
  const data = record(value);
  if (event.source !== "broker_recovery_v1" || !data || data.version !== 1 ||
      data.tradeDate !== event.eventDate || data.side !== event.eventType ||
      !["buy", "sell"].includes(event.eventType) || typeof data.quantity !== "string" ||
      event.quantityDelta === null || !/^\d+(?:\.\d{1,6})?$/.test(data.quantity)) return null;
  try {
    if (Decimal.from(data.quantity).compare(0) <= 0 ||
        Decimal.from(data.quantity).mul(event.eventType === "sell" ? -1 : 1).compare(event.quantityDelta) !== 0) return null;
  } catch { return null; }
  const executionGross = money(data.executionGross);
  const orderUnitPrice = unitPrice(data.orderUnitPrice);
  const originalDisplay = money(data.originalDisplay);
  const settlement = record(data.cashSettlement), settlementMoney = money(settlement);
  const date = settlement?.date;
  const cashSettlement = settlementMoney && typeof date === "string" && validDate(date) && date >= event.eventDate
    ? Object.freeze({ ...settlementMoney, date }) : null;
  if (!executionGross && !originalDisplay && !cashSettlement && !orderUnitPrice) return null;
  return Object.freeze({ executionGross, originalDisplay, cashSettlement, ...(orderUnitPrice ? { orderUnitPrice } : {}) });
}

function unitPrice(value: unknown): BrokerEvidenceMoney | null {
  const data = record(value);
  if (!data || (data.currency !== "KRW" && data.currency !== "USD") || typeof data.amount !== "string" ||
      !/^\d{1,16}(?:\.\d{1,12})?$/.test(data.amount)) return null;
  return Decimal.from(data.amount).compare(0) > 0 ? Object.freeze({ currency: data.currency, amount: data.amount }) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function money(value: unknown): BrokerEvidenceMoney | null {
  const data = record(value);
  if (!data || !["KRW", "USD"].includes(String(data.currency)) || typeof data.amount !== "string" ||
      !/^\d{1,14}(?:\.\d{1,2})?$/.test(data.amount)) return null;
  const currency = data.currency as "KRW" | "USD";
  try {
    if (Decimal.from(data.amount).compare(0) <= 0) return null;
    Decimal.from(data.amount).minor(currency, "exact");
  } catch { return null; }
  return Object.freeze({ currency, amount: data.amount });
}
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function formatBrokerEvidenceMoney(value: BrokerEvidenceMoney): string {
  const [whole, fractional = ""] = value.amount.split(".");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return value.currency === "USD" ? `$${grouped}.${fractional.padEnd(2, "0")}` : `${grouped}원`;
}

export function formatBrokerEvidenceUnitPrice(value: BrokerEvidenceMoney): string {
  const [whole, fraction] = value.amount.split(".");
  const text = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
  return value.currency === "USD" ? `$${text}` : `${text}원`;
}
