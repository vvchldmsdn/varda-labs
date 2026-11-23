import type { eventLedgerEntries } from "../db/schema.ts";
import { projectBrokerRecoveryDisplay } from "./broker-recovery-display.ts";
import { resolveNativeTrade, type NativeEvent } from "./native-portfolio-ledger.ts";
import { normalizeTicker, toNumber } from "./portfolio-math.ts";
import type { PortfolioMovementEventInput } from "./portfolio-movement.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

type LedgerRow = typeof eventLedgerEntries.$inferSelect;
type Position = {
  accountId: string | null; account: string | null; assetId: string | null; legacyAssetId: string | null;
  ticker: string | null; assetName: string | null; currency: string | null; description: string | null;
  capturedAt: Date | null; cycleEndAt: Date | null;
};
type Asset = { id: string; accountId: string | null; legacyBase44Id: string | null; currency: string | null };
export type MovementSplit = { id: string; accountId: string; account: string; assetId: string; at: string; reportedDate?: string };

function timestamp(value: unknown) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function positionMatches(row: LedgerRow, position: Position) {
  if (position.account !== row.account || (position.accountId && position.accountId !== row.accountId)) return false;
  if (row.assetId && position.assetId) return row.assetId === position.assetId;
  if (row.legacyAssetId && position.legacyAssetId) return row.legacyAssetId === position.legacyAssetId;
  if (row.assetId && position.assetId === null && !row.legacyAssetId) return false;
  return row.ticker ? normalizeTicker(row.ticker) === normalizeTicker(position.ticker) : row.assetName === position.assetName;
}

function positive(value: unknown) {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** Principal exposure for movement only. The cash/settlement and return-cost projections remain separate. */
function nativeFill(row: LedgerRow, event: NativeEvent): Partial<PortfolioMovementEventInput> {
  if ((event.type !== "buy" && event.type !== "sell") || event.type !== row.eventType || event.assetId !== row.assetId) {
    return { movementEvidence: "unresolved" };
  }
  try {
    const execution = resolveNativeTrade(event);
    const quantity = positive(event.quantity);
    const signedQuantity = toNumber(row.quantityDelta);
    if (!quantity || signedQuantity !== (event.type === "sell" ? -quantity : quantity)) return { movementEvidence: "unresolved" };
    const principal = execution.settlement ?? execution.calculatedConsideration;
    const localGross = principal?.currency === event.currency ? positive(principal.amount) : null;
    const price = positive(execution.executionUnitPrice?.amount) ?? (localGross === null ? null : localGross / quantity);
    // The cost projection's amountKrw may use a historical reporting rate. Only
    // recorded KRW gross qualifies as execution FX here. Fee/tax are separate.
    const grossKrw = principal?.currency === "KRW" ? positive(principal.amount) : null;
    const fxRate = event.currency === "KRW" ? 1 : price && grossKrw ? grossKrw / (price * quantity) : null;
    return { price, fxRate, amountKrw: grossKrw };
  } catch {
    return { movementEvidence: "unresolved" };
  }
}

export function projectDashboardMovementEvents(input: {
  rows: readonly LedgerRow[]; splits?: readonly MovementSplit[]; unverifiedAccounts?: readonly string[]; positions: readonly Position[];
  assets: readonly Asset[]; serviceDate: string; now: Date;
}): PortfolioMovementEventInput[] {
  const { rows, positions, assets, serviceDate, now } = input;
  const corrected = new Set<string>();
  for (const row of rows) {
    if (row.correctsEventId) corrected.add(row.accountId + "/id/" + row.correctsEventId);
    if (row.legacyCorrectsEventId) corrected.add(row.accountId + "/legacy/" + row.legacyCorrectsEventId);
  }
  const start = Date.parse(serviceDate + "T07:00:00+09:00");
  const end = start + 86_400_000;
  const result: PortfolioMovementEventInput[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = row.accountId + "/id/" + row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const buySell = row.eventType === "buy" || row.eventType === "sell";
    if (!buySell && row.eventType !== "split" && !toNumber(row.quantityDelta) && !row.correctsEventId && !row.legacyCorrectsEventId) continue;
    const native = (row.nativeData as {event?: NativeEvent} | null)?.event;
    const broker = row.source === "broker_recovery_v1" ? row.brokerRecoveryData as {executedAt?: unknown; assetId?: unknown; id?: unknown} | null : null;
    const exactValue = native ? (native.dateEvidence ? null : native.at) : broker?.executedAt;
    const exact = timestamp(exactValue);
    if (exact !== null ? exact < start || exact >= end || exact > now.getTime() : row.eventDate !== serviceDate) continue;
    const matches = positions.filter(position => positionMatches(row, position));
    const captured = matches.filter(p => p.description?.split(/;\s*/).includes("valuation_policy=execution_collection_v1"));
    let uncertain = row.correctsEventId != null || row.legacyCorrectsEventId != null || corrected.has(key) ||
      (row.legacyBase44Id != null && corrected.has(row.accountId + "/legacy/" + row.legacyBase44Id)) ||
      !buySell || (exactValue != null && exact === null) || (row.source === "broker_recovery_v1" && !broker);
    if (buySell && row.quantityDelta != null) {
      const delta = toNumber(row.quantityDelta);
      if (delta === null || Math.sign(delta) !== (row.eventType === "sell" ? -1 : 1)) uncertain = true;
    }
    if (captured.length && matches.length === 1) {
      const cutoff = timestamp(captured[0].cycleEndAt);
      const saved = timestamp(captured[0].capturedAt);
      const recorded = timestamp(row.createdAt ?? row.recordedAt);
      // The live-collection writer includes effective events through its real collection
      // instant. Late entries didn't exist when it saved. Date-only is never a wall clock.
      if (recorded !== null && saved !== null && recorded <= saved) {
        if (exact !== null && cutoff !== null && exact <= cutoff) continue;
        if (exact === null || cutoff === null) uncertain = true;
      } else if (recorded === null || saved === null) uncertain = true;
    }
    const base: PortfolioMovementEventInput = {
      eventDate: serviceDate, eventType: row.eventType, account: row.account, assetId: row.assetId,
      legacyAssetId: row.legacyAssetId, ticker: row.ticker, assetName: row.assetName, amountKrw: row.amountKrw,
      quantityDelta: row.quantityDelta, price: row.price, fxRate: row.fxRate,
      beforeValue: row.beforeValue, afterValue: row.afterValue, recordedAt: row.recordedAt, createdAt: row.createdAt,
      movementWindowResolved: true, ...(exact !== null ? { movementEffectiveAt: new Date(exact).toISOString() } : {}),
    };
    if (native) Object.assign(base, nativeFill(row, native));
    if (broker) {
      const evidence = projectBrokerRecoveryDisplay(broker, row);
      const asset = assets.find(a => a.accountId === row.accountId &&
        (row.assetId ? a.id === row.assetId : row.legacyAssetId && a.legacyBase44Id === row.legacyAssetId));
      const currency = asset?.currency ?? (matches.length === 1 ? matches[0].currency : null);
      const gross = evidence?.executionGross;
      const q = Math.abs(toNumber(row.quantityDelta) ?? 0);
      // Imported evidence explicitly distinguishes gross consideration from the
      // order budget and final cash settlement. Use the receipt's gross only.
      base.price = null;
      base.fxRate = currency === "KRW" ? 1 : null;
      base.amountKrw = gross?.currency === "KRW" ? gross.amount : null;
      if (!evidence || (broker.assetId != null && broker.assetId !== row.assetId) || (broker.id != null && broker.id !== row.id)) uncertain = true;
      else if (gross?.currency === currency && q > 0) {
        base.price = Number(gross.amount) / q;
      }
    }
    if (uncertain) base.movementEvidence = "unresolved";
    result.push(base);
  }
  for (const split of input.splits ?? []) {
    const at = timestamp(split.at);
    if (seen.has(split.accountId + "/id/" + split.id) || at === null ||
        (split.reportedDate ?? resolveSnapshotCycle(new Date(at)).snapshotDate) !== serviceDate ||
        (!split.reportedDate && at > now.getTime())) continue;
    result.push({ eventDate: serviceDate, eventType: "split", account: split.account, assetId: split.assetId,
      legacyAssetId: null, ticker: null, assetName: null, amountKrw: null, beforeValue: null, afterValue: null,
      movementEvidence: "unresolved", movementWindowResolved: true });
  }
  for (const account of input.unverifiedAccounts ?? []) {
    // No assertion that a fill occurred: an incomplete ledger cannot establish
    // a no-trade day, even if same-day buys and sales net to zero shares.
    result.push({ eventDate: serviceDate, eventType: "ledger_evidence_unavailable", account, assetId: null,
      legacyAssetId: null, ticker: null, assetName: null, amountKrw: null, beforeValue: null, afterValue: null,
      movementEvidence: "unresolved", movementWindowResolved: true });
  }
  return result;
}
