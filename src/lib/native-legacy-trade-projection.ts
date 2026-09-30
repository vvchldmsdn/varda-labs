import { Decimal } from "./money.ts";
import { nativeCostAmounts, resolveNativeTrade, type NativeCostLot, type NativeEvent, type NativePortfolioState } from "./native-portfolio-ledger.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

export type NativeLegacyTradeEntry = {
  id: string;
  accountId: string;
  recordedAt?: string | Date | null;
  data: {
    event: NativeEvent | { type: "opening"; at: string };
    state: NativePortfolioState;
    effect?: unknown;
  };
};
export type NativeLegacyTradeAccount = {
  id: string;
  code: string;
  assets: readonly { id: string; name: string; ticker?: string | null; legacyBase44Id?: string | null }[];
};

/** Read projection only: callers supply EFFECTIVE native entries, never the
 * superseded raw event rows. Quantity/cash/cost in storage are not modified. */
export function projectNativeLegacyTrade<T extends object>(
  entry: NativeLegacyTradeEntry,
  account: NativeLegacyTradeAccount,
  originalRow?: T,
) {
  const event = entry.data.event;
  if (entry.accountId !== account.id || entry.data.state.accountId !== account.id ||
      (event.type !== "buy" && event.type !== "sell")) return null;
  const asset = account.assets.find(row => row.id === event.assetId);
  if (!asset) return null;
  const original = originalRow as { recordedAt?: Date | string | null; createdAt?: Date | string | null } | undefined;
  // Revision recorded_at is the date the corrected state became visible. Using
  // execution time here would pretend a later correction was in an old capture.
  const includedAt = entry.recordedAt ?? original?.createdAt ?? original?.recordedAt;
  if (includedAt == null || !Number.isFinite(new Date(includedAt).getTime())) return null;

  try {
    const execution = resolveNativeTrade(event);
    const quantity = Decimal.from(event.quantity);
    const quantityDelta = quantity.mul(event.type === "sell" ? -1 : 1).toExactString();
    const position = entry.data.state.positions.find(row => row.assetId === asset.id);
    if (!position || position.currency !== event.currency) return null;
    const afterQuantity = Decimal.from(position.quantity);
    const beforeQuantity = afterQuantity.sub(quantityDelta);
    if (beforeQuantity.compare(0) < 0) return null;
    const settlementKrw = execution.settlement.currency === "KRW" ? execution.settlement.amount : null;
    let price = execution.executionUnitPrice?.amount ?? null;
    // An exact average of a known same-currency settlement is valid execution
    // evidence; a repeating rational average remains in nativeData instead.
    if (price === null && execution.average) {
      try { price = new Decimal(BigInt(execution.average.n), BigInt(execution.average.d)).toExactString(); } catch { /* retain null */ }
    }
    const effect = entry.data.effect as { realized?: { disposedCostLots: NativeCostLot[] | null } | null } | null | undefined;
    const components = event.type === "sell" && effect?.realized ? nativeCostAmounts(effect.realized.disposedCostLots) : null;
    let disposedCostKrw: string | null = null;
    if (components !== null && components.every(component => component.currency === "KRW")) {
      try { disposedCostKrw = components.reduce((sum, component) => sum.add(component.amount), Decimal.from(0)).toExactString(); } catch { /* keep recurring cost unavailable to this decimal DTO */ }
    }
    let realizedPnlKrw: string | null = null;
    const charges = [event.fee, event.tax].filter(charge => charge != null);
    if (disposedCostKrw !== null && settlementKrw !== null && charges.every(charge => charge.currency === "KRW")) {
      realizedPnlKrw = charges.reduce((sum, charge) => sum.sub(charge.amount), Decimal.from(settlementKrw).sub(disposedCostKrw)).toExactString();
    }
    const remainingComponents = nativeCostAmounts(position.costLots);
    let remainingCostKrw: string | null = null;
    if (remainingComponents !== null && remainingComponents.every(component => component.currency === "KRW")) {
      try { remainingCostKrw = remainingComponents.reduce((sum, component) => sum.add(component.amount), Decimal.from(0)).toExactString(); } catch { /* exact KRW cost unavailable */ }
    }
    const nativeCostBasisStatus = disposedCostKrw === null ? "unavailable" as const : "available" as const;
    const nativeProjection = "effective_native_trade_v1" as const;
    return {
      ...originalRow,
      id: entry.id,
      accountId: account.id,
      account: account.code,
      assetId: asset.id,
      legacyAssetId: asset.legacyBase44Id ?? null,
      ticker: asset.ticker ?? null,
      assetName: asset.name,
      eventType: event.type,
      eventDate: event.dateEvidence?.reportedDate ?? resolveSnapshotCycle(new Date(event.at)).snapshotDate,
      recordedAt: new Date(includedAt),
      createdAt: new Date(includedAt),
      quantityDelta,
      amountKrw: settlementKrw,
      price,
      fxRate: event.currency === "KRW" ? "1" : null,
      beforeValue: { account: account.code, currency: event.currency, quantity: beforeQuantity.toExactString() },
      afterValue: {
        account: account.code, currency: event.currency, quantity: afterQuantity.toExactString(),
        trade_metrics: { disposed_cost_krw: disposedCostKrw, realized_pnl_krw: realizedPnlKrw, native_cost_basis_status: nativeCostBasisStatus },
      },
      memo: null,
      nativeProjection,
      nativeCostBasisStatus,
      nativeRemainingCostKrw: remainingCostKrw,
      nativeData: entry.data,
    };
  } catch {
    return null;
  }
}
