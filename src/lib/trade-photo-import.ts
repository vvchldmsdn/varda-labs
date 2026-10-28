import { Decimal, isCurrency } from "./money.ts";
import { nativeDateOnlyAt, resolveNativeTrade } from "./native-portfolio-ledger.ts";
import { tradePhotoDate, tradePhotoNumber, type TradePhotoCandidate } from "./trade-photo.ts";
import type { NativeMutation, NativeStoredAccount, NativeStoredEntry } from "@/db/queries/native-portfolio-ledger";
import type { PendingTrade } from "./trade-operation-recovery";

export type ImportEntry = { id: string; operationId: string; accountId: string; type: string; at: string; date: string; dateOnly?: boolean; assetId?: string; quantity?: string };
export type TradeImportContext = { sessionKey: string; serverNow: string; canWrite: boolean; complete: boolean; accounts: NativeStoredAccount[]; entries: ImportEntry[] };
export type ReviewedPhotoTrade = TradePhotoCandidate & { key: string; operationId: string; accountId: string; assetId: string; verified: boolean; afterEventId: string; status: "review" | "saved" | "excluded" };
export const koreaTradeDay = (at: string) => new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);
export function photoImportEntries(entries: NativeStoredEntry[]): ImportEntry[] {
  return entries.map(e => {
    const event = e.data.event;
    const dateOnly = "dateEvidence" in event && event.dateEvidence?.precision === "date_only";
    return { id: e.id, operationId: e.operationId, accountId: e.accountId, type: event.type, at: event.at,
      date: dateOnly ? event.dateEvidence!.reportedDate : koreaTradeDay(event.at), dateOnly: !!dateOnly,
      ...("assetId" in event ? { assetId: event.assetId } : {}), ...("quantity" in event ? { quantity: event.quantity } : {}) };
  });
}
/** Match the ledger's date-only service day [07:00 KST, next 07:00), including overnight fills. */
export function photoOrderingEntries(row: ReviewedPhotoTrade, entries: ImportEntry[]) {
  if (!row.date || tradePhotoDate(row.date) !== row.date) return [];
  const midpoint = Date.parse(nativeDateOnlyAt(row.date));
  return entries.filter(e => e.accountId === row.accountId && e.operationId !== row.operationId && (e.dateOnly ? e.date === row.date : Date.parse(e.at) >= midpoint - 12 * 3600000 && Date.parse(e.at) < midpoint + 12 * 3600000));
}
export function samePhotoTrade(a: Pick<ReviewedPhotoTrade, "accountId" | "assetId" | "side" | "date" | "quantity">, b: Pick<ReviewedPhotoTrade, "accountId" | "assetId" | "side" | "date" | "quantity">) {
  try { return !!a.assetId && a.accountId === b.accountId && a.assetId === b.assetId && a.side === b.side && a.date === b.date && Decimal.from(a.quantity).compare(b.quantity) === 0; } catch { return false; }
}
export function importIssue(row: ReviewedPhotoTrade, context: TradeImportContext, queue: ReviewedPhotoTrade[] = []): string | null {
  if (!context.complete) return "incomplete_history";
  if (!context.canWrite) return "write_unavailable";
  const account = context.accounts.find(a => a.id === row.accountId && a.active !== false);
  if (!account?.state) return "opening_required";
  const asset = account.assets.find(a => a.id === row.assetId);
  if (!asset || !isCurrency(asset.currency)) return "instrument_required";
  if (row.currency !== asset.currency) return "currency_mismatch";
  if (!tradePhotoNumber(row.quantity, 6) || !tradePhotoNumber(row.price)) return "invalid_amount";
  if (!row.date || tradePhotoDate(row.date) !== row.date || Date.parse(nativeDateOnlyAt(row.date)) > Date.parse(context.serverNow)) return "invalid_date";
  if (row.date <= koreaTradeDay(account.state.startedAt)) return "included_in_opening";
  if (context.entries.some(e => e.operationId !== row.operationId && e.accountId === row.accountId && e.assetId === row.assetId && e.type === row.side && e.date === row.date && e.quantity && Decimal.from(e.quantity).compare(row.quantity) === 0)) return "duplicate_record";
  if (queue.some(other => other.key !== row.key && other.status !== "excluded" && samePhotoTrade(row, other))) return "duplicate_photo";
  if (!row.verified) return "review_required";
  const sameDay = photoOrderingEntries(row, context.entries);
  const earlier = queue.slice(0, queue.findIndex(other => other.key === row.key)).some(other => other.status !== "excluded" && other.accountId === row.accountId && other.date === row.date);
  if ((sameDay.length || earlier) && !row.afterEventId) return "ordering_required";
  if (row.afterEventId.startsWith("queue:")) {
    const priorIndex = queue.findIndex(other => `queue:${other.key}` === row.afterEventId);
    const ownIndex = queue.findIndex(other => other.key === row.key);
    const prior = queue[priorIndex];
    if (!prior || priorIndex >= ownIndex || prior.status === "excluded" || prior.accountId !== row.accountId || prior.date !== row.date) return "ordering_required";
  } else if (row.afterEventId && !context.entries.some(e => e.id === row.afterEventId && e.accountId === row.accountId)) return "ordering_required";
  return null;
}
export function preparePhotoTrade(row: ReviewedPhotoTrade, context: TradeImportContext, queue: ReviewedPhotoTrade[]): NativeMutation {
  const issue = importIssue(row, context, queue); if (issue) throw new Error(issue);
  const account = context.accounts.find(a => a.id === row.accountId)!;
  let afterEventId = row.afterEventId;
  if (afterEventId.startsWith("queue:")) {
    const prior = queue.find(other => `queue:${other.key}` === afterEventId)!;
    afterEventId = context.entries.find(e => e.operationId === prior.operationId)?.id ?? "";
    if (!afterEventId) throw new Error("ordering_required");
  }
  const event = { type: row.side, at: nativeDateOnlyAt(row.date), assetId: row.assetId, currency: row.currency as "USD" | "KRW", quantity: tradePhotoNumber(row.quantity, 6)!, price: tradePhotoNumber(row.price)!, settlementStatus: "unconfirmed" as const,
    dateEvidence: { precision: "date_only" as const, reportedDate: row.date, timeZone: "Asia/Seoul" as const, policy: "service_day_midpoint" as const } };
  resolveNativeTrade(event);
  return { operationId: row.operationId, accountId: account.id, expectedSequence: account.state!.sequence, event,
    history: { reason: "거래 사진에서 체결 내역 확인 후 등록", notInOpening: true, ...(afterEventId ? { afterEventId } : {}) } };
}

export class PhotoSaveError extends Error {
  readonly definite: boolean;
  constructor(code: string, definite = false) { super(code); this.definite = definite; }
}
export type PhotoSavePort = {
  context(): Promise<TradeImportContext>;
  pending(): PendingTrade | { operationId: string } | null;
  remember(value: PendingTrade): void; forget(operationId: string): void;
  lookup(operationId: string): Promise<"committed" | "cancelled" | "unconfirmed">;
  post(mutation: NativeMutation): Promise<void>;
};
/** Called inside the SAME Web Lock as manual trading. Stop on the first uncertain or invalid save.
 * A retry sends the retained exact payload, never a new financial operation. */
export async function savePhotoTrades(queue: ReviewedPhotoTrade[], sessionKey: string, port: PhotoSavePort, saved: (key: string) => void) {
  const selected = queue.filter(row => row.status === "review");
  let context = await port.context();
  if (context.sessionKey !== sessionKey) throw new Error("account_changed");
  const pending = port.pending();
  if (pending && !selected.some(row => row.operationId === ("mutation" in pending ? pending.mutation.operationId : pending.operationId))) throw new Error("recovery_pending");
  for (const row of selected) {
    if (context.entries.some(e => e.operationId === row.operationId)) continue;
    const issue = importIssue(row, context, queue); if (issue) throw new Error(issue);
  }
  for (const row of selected) {
    context = await port.context();
    if (context.sessionKey !== sessionKey || !context.complete || !context.canWrite) throw new Error("account_changed");
    if (context.entries.some(e => e.operationId === row.operationId)) { port.forget(row.operationId); saved(row.key); continue; }
    const retained = port.pending();
    let mutation: NativeMutation;
    if (retained) {
      if (!("mutation" in retained) || retained.mutation.operationId !== row.operationId) throw new Error("recovery_pending");
      const status = await port.lookup(row.operationId);
      if (status === "committed") { port.forget(row.operationId); saved(row.key); continue; }
      if (status === "cancelled") { port.forget(row.operationId); throw new Error("operation_cancelled"); }
      mutation = retained.mutation;
    } else {
      mutation = preparePhotoTrade(row, context, queue);
      port.remember({ sessionKey, mutation, savedAt: Date.now() });
    }
    try { await port.post(mutation); }
    catch (error) { if (error instanceof PhotoSaveError && error.definite) port.forget(row.operationId); throw error; }
    port.forget(row.operationId); saved(row.key);
  }
}

export function photoImportMessage(code: string): string {
  return ({ incomplete_history: "전체 거래 이력을 확인하지 못했어요. 중복 검사를 위해 잠시 후 다시 시도해 주세요.", write_unavailable: "현재 이 계좌의 거래 저장을 사용할 수 없어요.", opening_required: "시작 잔고를 확인한 계좌를 선택해 주세요.", instrument_required: "이 계좌에 등록된 종목을 선택해 주세요. 새 종목은 직접 거래 입력에서 등록할 수 있어요.", currency_mismatch: "체결 단가의 통화와 선택한 종목의 통화가 달라요. 사진에서 확인해 주세요.", invalid_amount: "체결 수량과 단가를 확인해 주세요. 수량은 소수점 6자리까지 입력합니다.", invalid_date: "실제 체결일을 확인해 주세요. 오늘 거래는 날짜만으로 처리할 수 있는 시점 이후에 등록하거나 직접 입력에서 정확한 시각을 입력해 주세요.", included_in_opening: "시작 잔고 날짜 이전·당일 거래입니다. 시작 잔고에 이미 포함된 거래를 추가하면 수량이 중복돼요.", duplicate_record: "같은 계좌·종목·날짜·수량의 거래가 이미 있어요. 중복이 아닌 별도 체결이라면 직접 입력에서 기록을 대조해 주세요.", duplicate_photo: "목록에 같은 거래가 있어요. 사진이 겹쳤는지 확인하고 하나를 제외해 주세요.", review_required: "사진과 종목·체결일·수량·단가를 대조한 뒤 확인해 주세요.", ordering_required: "같은 날 거래 순서를 지정해 주세요. 순서를 알 수 없다면 정확한 체결 시각을 확인해 주세요.", recovery_pending: "저장 여부를 확인 중인 거래가 있어요. 직접 거래 입력 화면에서 먼저 확인해 주세요.", operation_cancelled: "종료된 저장 요청입니다. 사진을 다시 읽고 기록 여부를 확인해 주세요.", conflict: "다른 창에서 계좌 정보가 바뀌었어요. 다시 확인한 후 저장해 주세요.", account_changed: "로그인 또는 계좌 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.", historical_replay_invalid: "이후 기록과 수량이 맞지 않아요. 체결일과 같은 날 거래 순서를 확인해 주세요.", historical_order_required: "같은 날 거래 순서를 확인해 주세요.", historical_order_invalid: "선택한 거래 순서가 기존 기록과 맞지 않아요.", historical_scope_too_large: "재계산 범위가 거래 500건 또는 연결 계좌 8개를 넘었어요. 기존 기록은 유지됩니다.", event_precedes_recorded_snapshot: "과거 평가 이후 거래를 재계산하지 못했어요. 직접 거래 입력에서 확인해 주세요." } as Record<string, string>)[code] ?? "저장을 완료하지 못했어요. 완료된 건은 유지되며, 저장 여부 확인 후 같은 요청으로 이어갑니다.";
}
