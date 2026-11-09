import { convertMoney, type FxEvidence } from "./currency-valuation.ts";
import { resolveNativeTrade, validateNativeDateEvidence, type NativeEvent } from "./native-portfolio-ledger.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";
import type { InvestmentLabScopeEventCandidate } from "./investment-lab-analysis-scope.ts";

export const LAB_TRADE_FX_AGE_MS = 3 * 86400000;
export type LabNativeTradeIssue = "fx_missing" | "unsupported" | "opening_boundary";
export type LabNativeAmountBasis = "recorded_krw" | "reported_execution_krw" | "historical_fx";
export type LabNativeTrace =
  | { reason: LabNativeTradeIssue }
  | { basis: LabNativeAmountBasis };
export type LabEffectiveEvent = {
  accountId: string; account: string; sequence: number;
  event: NativeEvent | { type: "opening"; at: string };
  linkedAssetId: string | null; legacyAssetId: string | null; assetName: string | null;
  market: string | null; assetType: string | null;
};

/** The caller supplies only effective entries. Revisions are not transactions. */
export function projectLabNativeEvents(rows: readonly LabEffectiveEvent[], fx: readonly FxEvidence[]): InvestmentLabScopeEventCandidate[] {
  const rates = fx.filter(rate => rate.kind === "daily_reference");
  const projected: InvestmentLabScopeEventCandidate[] = [];
  for (const row of rows) {
    const e = row.event;
    if (!e || !Number.isFinite(Date.parse(e.at))) throw new Error("lab_native_event_date_missing");
    // These changes do not move money across the invested-position boundary.
    if (["deposit","withdraw","exchange","transfer","dividend","fee","split","cost_basis"].includes(e.type)) continue;
    const trade = e.type === "buy" || e.type === "sell" ? e : null;
    if (trade) validateNativeDateEvidence(trade.at, trade.dateEvidence);
    const eventDate = trade?.dateEvidence?.reportedDate ?? resolveSnapshotCycle(new Date(e.at)).snapshotDate;
    let amountKrw: string | null = null;
    let nativeTrace: LabNativeTrace = { reason: e.type === "opening" ? "opening_boundary" : "unsupported" };
    if (trade && row.linkedAssetId === trade.assetId) {
      try {
        const execution = resolveNativeTrade(trade);
        // Cairn's investment-only amount is gross consideration before fees and
        // taxes. Unknown settlement can still have explicitly recorded execution.
        const gross = execution.settlement ?? execution.calculatedConsideration;
        if (gross?.currency === "KRW") {
          amountKrw = gross.amount;
          nativeTrace = { basis: trade.settlement?.currency === "KRW" ? "recorded_krw" : "reported_execution_krw" };
        } else if (gross?.currency === "USD") {
          const converted = convertMoney(gross.amount, gross.currency, "KRW", trade.at, rates, LAB_TRADE_FX_AGE_MS);
          if (converted.ok) {
            amountKrw = converted.value.toExactString();
            nativeTrace = { basis: "historical_fx" };
          } else {
            nativeTrace = { reason: "fx_missing" };
          }
        }
      } catch {
        // Invalid or conflicting execution evidence stays blocked.
      }
    }
    projected.push({
      accountId: row.accountId, account: row.account, assetId: trade?.assetId ?? null,
      legacyAssetId: row.legacyAssetId, assetName: row.assetName,
      market: row.market, currency: trade?.currency ?? null, assetCurrency: trade?.currency ?? null, assetType: row.assetType,
      eventDate, eventType: trade?.type ?? e.type, sequence: row.sequence, amountKrw,
      // Only the validated amount crosses this boundary. The legacy engine's
      // quantity × price fallback must never bypass an unresolved native amount.
      quantityDelta: null, price: null, fxRate: null, isCorrection: false,
      nativeTrace,
    });
  }
  return projected;
}
