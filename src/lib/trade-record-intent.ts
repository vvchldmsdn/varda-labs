export type TradeRecordAction = "buy" | "sell" | "cost_basis";
export type TradeRecordHint = { accountId?: string; assetId?: string; action?: string };
type SelectableAccount = { id: string; active?: boolean; assets: readonly { id: string }[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeTradeRecordHint(input: { accountId?: unknown; assetId?: unknown; action?: unknown }): TradeRecordHint {
  return {
    accountId: typeof input.accountId === "string" && UUID.test(input.accountId) ? input.accountId : undefined,
    assetId: typeof input.assetId === "string" && UUID.test(input.assetId) ? input.assetId : undefined,
    action: input.action === "buy" || input.action === "sell" || input.action === "cost_basis" ? input.action : undefined,
  };
}
/** Navigation hints never establish account ownership; resolve only against the authenticated account list. */
export function resolveTradeRecordSelection(accounts: readonly SelectableAccount[], input: TradeRecordHint) {
  const hint = normalizeTradeRecordHint(input);
  const account = accounts.find(row => row.active !== false && row.id === hint.accountId);
  const asset = account?.assets.find(row => row.id === hint.assetId);
  return { accountId: account?.id ?? "", assetId: asset?.id ?? "", action: ((!hint.accountId || account) ? hint.action ?? "deposit" : "deposit") as TradeRecordAction | "deposit" };
}
export function tradeRecordHref(input: TradeRecordHint = {}) {
  const hint = normalizeTradeRecordHint(input), params = new URLSearchParams();
  if (hint.accountId) params.set("accountId", hint.accountId);
  if (hint.assetId && hint.accountId) params.set("assetId", hint.assetId);
  if (hint.action) params.set("action", hint.action);
  return "/portfolio/ledger" + (params.size ? "?" + params.toString() : "");
}
/** Opening balances do not complete the requested trade; retain only its holding selection. */
export function fieldsAfterLedgerSave(previous: Record<string, string>, wasOpening: boolean, at: string): Record<string, string> {
  return { currency: previous.currency ?? "USD", at, assetType: "etf", ...(wasOpening && previous.assetId ? { assetId: previous.assetId } : {}) };
}
