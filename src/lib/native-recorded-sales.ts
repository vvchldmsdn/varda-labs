import type { NativeStoredAccount, NativeStoredEntry } from "../db/queries/native-portfolio-ledger";
import { Decimal } from "./money.ts";
import type { NativeGroupSelection } from "./native-group-scope";
import type { TrackedRealizedTrade } from "./currency-tracked-portfolio";

export type SaleEntry = {id:string; accountId:string; data:{
  event:NativeStoredEntry["data"]["event"]; effect:unknown;
}};

export function nativeQuantitiesMatch(account: NativeStoredAccount) {
  const state = account.state;
  return !!state && state.positions.every(p => account.assets.some(a => a.id === p.assetId && a.currency === p.currency &&
    Decimal.from(a.quantity).compare(p.quantity) === 0 && a.archived === (Decimal.from(p.quantity).compare(0) === 0))) &&
    account.assets.every(a => a.archived || state.positions.some(p => p.assetId === a.id && Decimal.from(p.quantity).compare(a.quantity) === 0));
}

/** Each immutable sale contributes only its own proceeds and disposed lots. */
export function projectNativeRecordedSales(ownerId:string, asOf:string, ledger:{
  accounts:readonly NativeStoredAccount[]; entries:readonly SaleEntry[]; historyComplete?:boolean; accountsComplete?:boolean;
}, scopeKind:string, selection?:NativeGroupSelection) {
  const group = scopeKind === "portfolio_group";
  const whole = new Set(selection?.wholeAccountIds ?? []), direct = new Set(selection?.directAssetIds ?? []);
  const accounts = ledger.accounts.filter(a => !group || whole.has(a.id) || a.assets.some(asset => direct.has(asset.id)));
  const lookup = new Map(accounts.map(a => [a.id,a]));
  const included = (accountId:string,assetId:string) => !group || whole.has(accountId) || direct.has(assetId);
  const historyComplete = ledger.historyComplete !== false;
  const scopeComplete = ledger.accountsComplete !== false && historyComplete && accounts.length > 0 &&
    (!group || !!selection && [...whole].every(id=>lookup.has(id)) && [...direct].every(id=>accounts.some(a=>a.assets.some(h=>h.id===id)))) &&
    accounts.every(a=>a.state && Date.parse(a.state.at) <= Date.parse(asOf) && nativeQuantitiesMatch(a) &&
      !a.state.unsettledTrades?.some(t=>included(a.id,t.assetId)));
  const sales:TrackedRealizedTrade[] = [];
  if (historyComplete) for (const entry of ledger.entries) {
    const event = entry.data.event, account = lookup.get(entry.accountId);
    if (!account || event.type !== "sell" || !included(account.id,event.assetId) ||
        (selection && Date.parse(event.at) < Date.parse(selection.stableSince))) continue;
    const effect = entry.data.effect as {realized?:Pick<TrackedRealizedTrade,"proceeds"|"disposedCostLots">|null}|null;
    sales.push({id:entry.id,ownerId,accountId:account.id,positionId:event.assetId,
      name:account.assets.find(s=>s.id===event.assetId)?.name ?? event.assetId,at:event.at,source:event.source,dateEvidence:event.dateEvidence,
      proceeds:effect?.realized?.proceeds ?? null,disposedCostLots:effect?.realized?.disposedCostLots ?? null});
  }
  return {realizedTrades:historyComplete ? sales : null, realizedTradesComplete:scopeComplete};
}
