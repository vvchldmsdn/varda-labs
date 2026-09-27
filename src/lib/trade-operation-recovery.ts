import type { NativeMutation } from "@/db/queries/native-portfolio-ledger";
export type PendingTrade = { sessionKey: string; mutation: NativeMutation; savedAt: number };
const PREFIX = "cairn:pending-trade:v1:";
const DRAFT_TTL = 24 * 60 * 60 * 1000;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
/** No token or URL data. One outstanding operation per signed-in subject. */
export function rememberTrade(storage: StoragePort, value: PendingTrade) {
  const text = JSON.stringify(value);
  if (!/^[a-f0-9]{64}$/.test(value.sessionKey) || text.length > 32000) throw new Error("recovery_storage_unavailable");
  try {
    const existing=storage.getItem(PREFIX+value.sessionKey);
    if(existing) { const saved=JSON.parse(existing); if((saved.mutation?.operationId??saved.operationId)!==value.mutation.operationId) throw new Error("recovery_pending"); }
    storage.setItem(PREFIX + value.sessionKey, text);
    if (storage.getItem(PREFIX + value.sessionKey) !== text) throw new Error();
  } catch(error) { if(error instanceof Error && error.message==="recovery_pending") throw error; throw new Error("recovery_storage_unavailable"); }
}
export function pendingTrade(storage: StoragePort, sessionKey: string, now = Date.now()): PendingTrade | { sessionKey: string; operationId: string; expired: true } | null {
  // Expired drafts are scrubbed even if a different account signs in. Only the
  // authenticated subject's pending value is ever returned or retransmitted.
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i); if (!key?.startsWith(PREFIX)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null");
      if (!value || !Number.isFinite(value.savedAt) || key!==PREFIX+value.sessionKey) throw new Error();
      if (now - value.savedAt > DRAFT_TTL && value.mutation) {
        const identity=JSON.stringify({ sessionKey:value.sessionKey, operationId:value.mutation.operationId, savedAt:value.savedAt, expired:true });
        storage.setItem(key,identity);
        if(storage.getItem(key)!==identity) throw new Error();
      }
    } catch { if(key===PREFIX+sessionKey) throw new Error("recovery_storage_unavailable"); }
  }
  try { return JSON.parse(storage.getItem(PREFIX + sessionKey) ?? "null"); } catch { throw new Error("recovery_storage_unavailable"); }
}
export function forgetTrade(storage: StoragePort, sessionKey: string, operationId?:string) {
  const raw=storage.getItem(PREFIX+sessionKey);if(!raw)return;
  const saved=JSON.parse(raw);
  if(operationId && (saved.mutation?.operationId??saved.operationId)!==operationId) return;
  storage.removeItem(PREFIX + sessionKey);
}
