import { Decimal, isCurrency, moneyMinor, type Currency } from "./money.ts";
import { resolveNativeTrade, validateNativeDateEvidence, type NativeEvent, type NativeMoney } from "./native-portfolio-ledger.ts";

export const NATIVE_RECORD_LIMIT = 100;
export const NATIVE_RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type NativeRecordType = NativeEvent["type"] | "opening";
export type NativeRecordAmount = NativeMoney & { kind: "amount" | "execution" | "settlement" | "fee" | "tax" | "debit" | "credit" };
export type NativeLedgerRecord = {
  id: string; accountId: string; type: NativeRecordType; at: string; reportedDate: string | null;
  assetName: string | null; ticker: string | null; quantity: string | null; unitPrice: NativeMoney | null;
  amounts: NativeRecordAmount[]; settlementUnconfirmed: boolean; memo: string | null;
  direction: "in" | "out" | null; ratio: { n: string; d: string } | null; costLotCount: number | null;
};
export type NativeRecordRow = { id: string; accountId: string; event: unknown; assetName: string | null; ticker: string | null };
export type NativeLedgerRecordsRead = {
  state: "ready"; account: { id: string; name: string }; records: NativeLedgerRecord[];
  complete: boolean; hasMore: boolean; limit: number;
} | { state: "not_found" | "unavailable" | "integrity_error"; records: []; complete: false };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_native_record");
  return value as Record<string, unknown>;
}
function decimal(value: unknown, positive = true): string {
  if (typeof value !== "string" || value.length > 240 || !/^\d+(?:\.\d+)?$/.test(value) || Decimal.from(value).compare(0) < (positive ? 1 : 0)) throw new Error("invalid_native_record");
  return value;
}
function time(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("invalid_native_record");
  return value;
}
function money(value: unknown): NativeMoney {
  const row = object(value);
  if (!isCurrency(row.currency)) throw new Error("invalid_native_record");
  const amount = decimal(row.amount, false); moneyMinor(amount, row.currency);
  return { amount, currency: row.currency };
}
/** Public read projection: never expose requests, account states or legacy rows. */
export function projectNativeLedgerRecord(row: NativeRecordRow, accountId: string): NativeLedgerRecord {
  if (!NATIVE_RECORD_ID.test(row.id) || row.accountId !== accountId) throw new Error("invalid_native_record");
  const event = object(row.event), at = time(event.at);
  const result: NativeLedgerRecord = { id: row.id, accountId, type: event.type as NativeRecordType, at,
    reportedDate: null, assetName: row.assetName, ticker: row.ticker, quantity: null, unitPrice: null,
    amounts: [], settlementUnconfirmed: false, memo: null, direction: null, ratio: null, costLotCount: null };
  const add = (kind: NativeRecordAmount["kind"], value: unknown) => { if (value != null) result.amounts.push({ kind, ...money(value) }); };
  switch (event.type) {
    case "opening": break;
    case "buy": case "sell": {
      if (typeof event.assetId !== "string" || !NATIVE_RECORD_ID.test(event.assetId)) throw new Error("invalid_native_record");
      const trade = event as unknown as Extract<NativeEvent, { type: "buy" | "sell" }>;
      validateNativeDateEvidence(at, trade.dateEvidence);
      const resolved = resolveNativeTrade(trade);
      result.quantity = decimal(trade.quantity);
      result.reportedDate = trade.dateEvidence?.reportedDate ?? null;
      result.memo = trade.memo ?? null;
      result.settlementUnconfirmed = trade.settlementStatus === "unconfirmed";
      result.unitPrice = resolved.executionUnitPrice ? { amount: resolved.executionUnitPrice.amount, currency: resolved.executionUnitPrice.currency } : null;
      // Execution evidence may have more precision than cash settlement. Keep it exact.
      const total = resolved.calculatedConsideration ?? (resolved.executionUnitPrice ? {
        amount: Decimal.from(trade.quantity).mul(resolved.executionUnitPrice.amount).toExactString(), currency: trade.currency,
      } : null);
      if (total) result.amounts.push({ kind: "execution", ...total });
      add("settlement", resolved.settlement); add("fee", resolved.fee); add("tax", resolved.tax);
      break;
    }
    case "deposit": case "withdraw": case "dividend": case "fee":
      add("amount", { amount: decimal(event.amount), currency: event.currency }); break;
    case "transfer":
      if (event.direction !== "in" && event.direction !== "out") throw new Error("invalid_native_record");
      result.direction = event.direction; add("amount", { amount: decimal(event.amount), currency: event.currency }); break;
    case "exchange": {
      const debit = money(event.debit), credit = money(event.credit);
      if (debit.currency === credit.currency || Decimal.from(debit.amount).compare(0) <= 0 || Decimal.from(credit.amount).compare(0) <= 0) throw new Error("invalid_native_record");
      add("debit", debit); add("credit", credit); add("fee", event.fee); break;
    }
    case "split": {
      const ratio = object(event.ratio); result.ratio = { n: decimal(ratio.n), d: decimal(ratio.d) }; break;
    }
    case "cost_basis":
      if (!Array.isArray(event.costLots) || !event.costLots.length || event.costLots.length > 2000) throw new Error("invalid_native_record");
      for (const item of event.costLots) { const lot = object(item); money(lot); time(lot.at); }
      result.costLotCount = event.costLots.length; break;
    default: throw new Error("invalid_native_record");
  }
  return result;
}

const labels: Record<NativeRecordType, readonly [string, string]> = {
  opening: ["시작 보유 확인", "Opening holdings"], buy: ["매수", "Buy"], sell: ["매도", "Sell"],
  deposit: ["입금", "Deposit"], withdraw: ["출금", "Withdrawal"], dividend: ["배당", "Dividend"],
  fee: ["수수료·세금", "Fees and tax"], exchange: ["환전", "Currency exchange"], transfer: ["계좌 간 이동", "Account transfer"],
  split: ["주식 분할·병합", "Stock split"], cost_basis: ["매입원가 보완", "Acquisition cost added"],
};
export function nativeRecordTypeLabel(type: NativeRecordType, locale: "ko" | "en") { return labels[type][locale === "en" ? 1 : 0]; }
export function nativeRecordAmountLabel(kind: NativeRecordAmount["kind"], locale: "ko" | "en") {
  const names = { amount: ["금액", "Amount"], execution: ["체결금액", "Execution amount"], settlement: ["정산 기준금액", "Settlement basis"], fee: ["수수료", "Fee"], tax: ["세금", "Tax"], debit: ["출금", "Debit"], credit: ["입금", "Credit"] };
  return names[kind][locale === "en" ? 1 : 0];
}
/** Group digits without converting exact quantity/price strings to binary numbers. */
export function nativeRecordNumber(value: string) { const [integer, fraction] = value.split("."); return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === undefined ? "" : `.${fraction}`); }
export function nativeLedgerRecordsHref(accountId?: string, currency: Currency = "KRW", beta = false) {
  const selected = accountId && NATIVE_RECORD_ID.test(accountId) ? accountId : undefined;
  const query = new URLSearchParams(beta ? { mode: "domain", scope: selected ? `account:${selected}` : "all", currency } : { currency });
  if (selected) query.set("accountId", selected);
  return `${beta ? "/beta" : ""}/portfolio/ledger?${query}#native-records`;
}
