/** Unsubmitted input only. Pending operations use the separate immutable recovery log. */
export type TradeEntryDraft = { at: number; accountId: string; kind: "buy" | "sell"; fields: Record<string, string> };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const prefix = "cairn:trade-entry:v1:";
export function tradeEntryStorage(): StoragePort | null { try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; } }
export function tradeEntryKey(sessionKey: string, hint: { accountId?: string; assetId?: string; action?: string }) {
  if (!/^[a-f0-9]{64}$/.test(sessionKey)) return null;
  return `${prefix}${sessionKey}:${hint.accountId ?? "all"}:${hint.assetId ?? "new"}:${hint.action ?? "any"}`;
}
export function readTradeEntry(storage: StoragePort | null, key: string | null, now = Date.now()): TradeEntryDraft | null {
  if (!key || !storage) return null;
  try {
    const draft = JSON.parse(storage.getItem(key) ?? "null");
    if (!draft) return null;
    if (!Number.isFinite(draft.at) || now < draft.at || now - draft.at > 86400000 || !["buy", "sell"].includes(draft.kind) || typeof draft.accountId !== "string" || !draft.fields || typeof draft.fields !== "object" || Array.isArray(draft.fields) || Object.values(draft.fields).some(value => typeof value !== "string") || JSON.stringify(draft).length > 16000) { storage.removeItem(key); return null; }
    return draft;
  } catch { return null; }
}
export function saveTradeEntry(storage: StoragePort | null, key: string | null, draft: TradeEntryDraft) {
  if (!key || !storage) return false;
  try { const value = JSON.stringify(draft); if (value.length > 16000) return false; storage.setItem(key, value); return true; } catch { return false; }
}
export function clearTradeEntry(storage: StoragePort | null, key: string | null) { if (key) try { storage?.removeItem(key); } catch { /* The pending-operation log remains authoritative. */ } }
