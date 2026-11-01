import type { NativeTradeInput } from "./native-portfolio-ledger";

export type TradeDraftInput = { kind: "buy" | "sell"; fields: Record<string, string> };
/** A correction gets its own fields. Never inherit the new trade's confirmations or amounts. */
export function correctionDraft(id: string, trade: NativeTradeInput & { at: string; dateEvidence?: import("./native-portfolio-ledger").NativeDateEvidence }, settlementOnly = false): TradeDraftInput {
  return { kind: trade.type, fields: {
    currency: trade.currency, assetId: trade.assetId, quantity: trade.quantity,
    inputMode: settlementOnly ? "total" : trade.settlementStatus === "unconfirmed" ? trade.executionTotal ? "execution_total" : "execution" : trade.settlement ? "total" : "price",
    total: trade.settlement?.amount ?? "", settlementCurrency: trade.settlement?.currency ?? trade.currency,
    price: trade.executionUnitPrice?.amount ?? trade.price ?? "", executionTotal: trade.executionTotal?.amount ?? "",
    memo: trade.memo ?? "", fee: trade.fee?.amount ?? "", tax: trade.tax?.amount ?? "",
    historyMode: "yes", replaces: id, reason: settlementOnly ? "체결 기록의 정산 정보 보완" : "", notInOpening: "",
    timePrecision: trade.dateEvidence?.precision ?? "exact", tradeDate: trade.dateEvidence?.reportedDate ?? "",
    at: new Date(Date.parse(trade.at) - new Date(trade.at).getTimezoneOffset() * 60000).toISOString().slice(0, -1),
  } };
}

export function newTradeDraft(draft: TradeDraftInput): TradeDraftInput {
  const fields = { ...draft.fields };
  // Old drafts may have retained a target after unchecking history mode.
  if (fields.replaces) for (const key of ["replaces", "reason", "notInOpening", "afterEventId"]) delete fields[key];
  return { kind: draft.kind, fields };
}
