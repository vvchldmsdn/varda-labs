"use client";

import Link from "next/link";
import { InstrumentSearch } from "@/components/onboarding/instrument-search";
import { hasUnsettledTrades, nativeDateOnlyAt, resolveNativeTrade, type NativeDateEvidence } from "@/lib/native-portfolio-ledger";
import { NativeLedgerTimestamp } from "@/components/native-ledger-timestamp";
import { tradeInputFromFields } from "./native-trade-input";
import { NativeTradeFields } from "@/components/native-trade-fields";
import { fieldsAfterLedgerSave, resolveTradeRecordSelection } from "@/lib/trade-record-intent";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppNavigation } from "@/components/app-navigation";
import { MoneyInput } from "@/components/first-visit/money-input";
import { useI18n } from "@/components/i18n/locale-provider";
import { Decimal, formatMoney, isCurrency, moneyMinor, type Currency } from "@/lib/money";
import type { NativeMutation, NativeStoredAccount } from "@/db/queries/native-portfolio-ledger";
import styles from "./native-ledger-view.module.css";
import { rememberTrade, pendingTrade, forgetTrade } from "@/lib/trade-operation-recovery";
import { observeNativeLedgerClock, nativeLedgerNow, nativeLedgerLocalTime, type NativeLedgerClock } from "@/lib/native-ledger-clock";
import { Button as CairnButton, Field as CairnField, Fieldset as CairnFieldset, Form as CairnForm, Input as CairnInput, PageTitle as CairnPageTitle, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


type EventKind = NonNullable<NativeMutation["event"]>["type"];
type Account = NativeStoredAccount & { active?: boolean; assets: (NativeStoredAccount["assets"][number] & { name?: string; ticker?: string })[] };
type SelectionHint = { accountId?: string; assetId?: string; action?: string };
type LedgerData = { serverNow: string; sessionKey: string; accounts: Account[]; canWrite: boolean; ordering?: {id:string;accountId:string;type:string;at:string}[]; trades?: { id:string; accountId:string; event: NonNullable<NativeMutation["event"]> }[] };
type CostField = { amount: string; currency: Currency; at: string };
type Fields = Record<string, string>;
type PendingOperation = {sessionKey:string;mutation:NativeMutation};
const EVENTS: [EventKind, string, string][] = [["deposit", "입금", "Deposit"], ["withdraw", "출금", "Withdraw"], ["buy", "매수", "Buy"], ["sell", "매도", "Sell"], ["dividend", "배당금", "Dividend"], ["fee", "수수료·세금", "Fee / tax"], ["exchange", "환전", "Exchange"], ["transfer", "내 계좌 간 이동", "Between my accounts"], ["split", "주식 분할·병합", "Stock split"], ["cost_basis", "매입원가 보완", "Add acquisition cost"]];
function timestamp(value: string, nowMs: number) { const at = new Date(value); if (!value || !Number.isFinite(at.getTime()) || !Number.isFinite(nowMs) || at.getTime() > nowMs) throw new Error("invalid_time"); return at.toISOString(); }
function exact(value: string, currency?: Currency, positive = true) { if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("invalid_amount"); const amount = Decimal.from(value); if (amount.compare(0) < 0 || (positive && amount.compare(0) === 0)) throw new Error("invalid_amount"); if (currency) moneyMinor(value, currency); return amount.toExactString(); }
function currency(value: string): Currency { if (!isCurrency(value)) throw new Error("invalid_currency"); return value; }

/** UI request builder only. The authenticated writer revalidates all ownership,
 * settlement precision, quantities and original dated costs independently. */
export function buildNativeLedgerMutation({ account, kind, fields, lots, operationId, newAssetId, confirmed, nowMs = Date.now() }: {
  account: Account; kind: EventKind; fields: Fields; lots: CostField[]; operationId: string; newAssetId: string; confirmed: boolean; nowMs?: number;
}): NativeMutation {
  const dateEvidence: NativeDateEvidence | undefined = account.state && (kind === "buy" || kind === "sell") && fields.timePrecision === "date_only"
    ? { precision: "date_only", reportedDate: fields.tradeDate, timeZone: "Asia/Seoul", policy: "service_day_midpoint" } : undefined;
  const at = timestamp(dateEvidence ? nativeDateOnlyAt(dateEvidence.reportedDate) : fields.at, nowMs), base = { operationId, accountId: account.id, expectedSequence: account.state?.sequence ?? null };
  if (!account.state) {
    if (!confirmed) throw new Error("opening_confirmation_required");
    return { ...base, opening: { at, cash: { KRW: exact(fields.cashKrw ?? "", "KRW", false), USD: exact(fields.cashUsd ?? "", "USD", false) }, positions: account.assets.filter(row => !row.archived).map(row => ({ assetId: row.id, currency: currency(row.currency), quantity: exact(row.quantity, undefined, false), costLots: null })) } };
  }
  const asset = account.assets.find(row => row.id === fields.assetId);
  const position = account.state.positions.find(row => row.assetId === fields.assetId);
  if (["sell", "split", "cost_basis"].includes(kind) && !position) throw new Error("holding_required");
  if (kind === "deposit" || kind === "withdraw" || kind === "dividend" || kind === "fee") {
    const unit = currency(fields.currency);
    if ((kind === "dividend" || kind === "fee") && fields.assetId && !position) throw new Error("holding_required");
    return { ...base, event: { type: kind, at, currency: unit, amount: exact(fields.amount, unit), ...((kind === "dividend" || kind === "fee") && position ? { assetId: position.assetId } : {}) } };
  }
  if (kind === "buy" || kind === "sell") {
    const isNew = kind === "buy" && fields.assetId === "new";
    if (!isNew && !asset) throw new Error("holding_required");
    const unit = currency(isNew ? fields.currency : asset!.currency);
    const quantity = exact(fields.quantity);
    const event = { ...tradeInputFromFields(kind, fields, unit, isNew ? newAssetId : asset!.id), at, ...(dateEvidence ? { dateEvidence } : {}) };
    resolveNativeTrade(event);
    if (kind === "sell" && position && !fields.historyMode && Decimal.from(quantity).compare(position.quantity) > 0) throw new Error("insufficient_quantity");
    if (!isNew) {
      if (fields.historyMode && fields.notInOpening !== "yes") throw new Error("opening_confirmation_required");
      return { ...base, event, ...(fields.historyMode ? { history: { reason: fields.reason?.trim() || "", notInOpening: true as const, ...(fields.replaces ? { replaces: fields.replaces } : {}), ...(fields.afterEventId ? { afterEventId:fields.afterEventId } : {}) } } : {}) };
    }
    if (fields.historyMode) throw new Error("historical_instrument_required");
    const name = fields.name?.trim(), ticker = fields.ticker?.trim().toUpperCase();
    if (!name || name.length > 100 || !/^[A-Z0-9.\-]{1,20}$/.test(ticker ?? "")) throw new Error("instrument_required");
    return { ...base, event, newAsset: { id: newAssetId, name, ticker, market: unit === "USD" ? "us" : "korea", currency: unit, assetType: fields.assetType === "stock" ? "stock" : "etf" } };
  }
  if (kind === "exchange") {
    const debitCurrency = currency(fields.currency), creditCurrency = debitCurrency === "USD" ? "KRW" : "USD";
    return { ...base, event: { type: kind, at, debit: { amount: exact(fields.amount, debitCurrency), currency: debitCurrency }, credit: { amount: exact(fields.credit, creditCurrency), currency: creditCurrency }, ...(fields.fee ? { fee: { amount: exact(fields.fee, debitCurrency, false), currency: debitCurrency } } : {}) } };
  }
  if (kind === "transfer") {
    if (!fields.peerAccountId || fields.peerAccountId === account.id) throw new Error("peer_account_required");
    const unit = currency(fields.currency);
    return { ...base, event: { type: kind, at, amount: exact(fields.amount, unit), currency: unit, direction: "out", peerAccountId: fields.peerAccountId, transferId: operationId } };
  }
  if (kind === "split") return { ...base, event: { type: kind, at, assetId: position!.assetId, ratio: { n: exact(fields.ratioN), d: exact(fields.ratioD) } } };
  if (kind === "cost_basis") {
    if (!lots.length || position!.costLots !== null) throw new Error("cost_basis_already_known");
    return { ...base, event: { type: kind, at, assetId: position!.assetId, costLots: lots.map(lot => ({ amount: exact(lot.amount, lot.currency, false), currency: lot.currency, at: timestamp(lot.at, nowMs), source: "user_native_ledger", remaining: { n: "1", d: "1" } })) } };
  }
  throw new Error("invalid_input");
}

export function resolveNativeLedgerSelection(accounts: Account[], hint: SelectionHint) {
  return resolveTradeRecordSelection(accounts, hint);
}

export function NativeLedgerView({ initialSelection = {}, compact = false, newInstrument = false, onSaved, onBusyChange, onPendingChange }: { initialSelection?: SelectionHint; compact?: boolean; newInstrument?: boolean; onSaved?: () => void; onBusyChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<LedgerData | null>(null), [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<EventKind>("deposit"), [fields, setFields] = useState<Fields>({ currency: "USD", assetType: "etf" });
  const [lots, setLots] = useState<CostField[]>([{ amount: "", currency: "USD", at: "" }]);
  const [savedOpening, setSavedOpening] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [success, setSuccess] = useState(false), [conflict, setConflict] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [pendingPreview,setPendingPreview]=useState<NativeMutation["event"]|null>(null);
  const [checking, setChecking] = useState(false), [expiredOperation, setExpiredOperation] = useState("");
  const session = useRef<string | null>(null), pending = useRef<PendingOperation | null>(null), lock = useRef(false);
  const clock = useRef<NativeLedgerClock | null>(null);
  function setPendingOperation(operation:PendingOperation|null){pending.current=operation;setPendingPreview(operation?.mutation.event??null);}
  const localNow = () => nativeLedgerLocalTime(nativeLedgerNow(clock.current));
  const activeAccounts = data?.accounts.filter(row => row.active !== false) ?? [];
  const account = activeAccounts.find(row => row.id === accountId) ?? activeAccounts[0];
  const asset = account?.assets.find(row => row.id === fields.assetId);
    const cashUnconfirmed = hasUnsettledTrades(account?.state);
const unit = isCurrency(asset?.currency) && fields.assetId !== "new" ? asset.currency : isCurrency(fields.currency) ? fields.currency : "USD";
  const errorMessage = (code: string) => {
    if (code === "recovery_storage_unavailable") return t("브라우저 저장을 허용한 뒤 다시 시도해 주세요. 이 요청은 전송하지 않았어요.", "Allow browser storage before saving. This request was not sent.");
    if (code === "recovery_pending") return t("다른 창에 확인 중인 거래가 있어요. 먼저 저장 여부를 확인해 주세요.", "Another tab has a pending record. Check its save status first.");
    if (code === "trade_not_after_opening" || code === "opening_day_order_unknown") return t("시작 잔액에 포함된 거래는 다시 넣을 수 없어요. 시작 시각 이후의 누락 거래인지 확인해 주세요.", "Check that this missing trade occurred after, and was not included in, your opening balances.");
    if (code === "historical_order_required" || code === "historical_order_invalid") return t("같은 날 거래 순서를 확인해 주세요. 시각을 알면 정확한 시각으로 입력해 주세요.", "Confirm the order of same-day trades, or enter the exact execution time.");
    if (code === "historical_replay_invalid") return t("이후 거래와 잔액이 맞지 않아 저장하지 않았어요. 날짜·수량·결제금액을 확인해 주세요.", "Later trades cannot be replayed with this change. Check dates, quantities and settlement amounts.");
    if (code === "historical_scope_too_large") return t("연결된 계좌 8개 또는 거래 500건을 넘는 이력은 여기서 정정할 수 없어요. 기존 기록은 그대로 유지됩니다.", "Corrections support up to 8 connected accounts and 500 records. Your existing records are unchanged.");
    if (code.startsWith("historical_")) return t("확인된 시작 잔액과 기존 종목의 거래만 정정할 수 있어요. 연결된 계좌 이력도 필요합니다.", "This change needs a verified opening, an existing instrument and complete connected-account history.");
    if (code === "sign_in_required" || code === "account_changed") return t("로그인 상태가 바뀌었어요. 다시 로그인해 주세요.", "Your sign-in changed. Please sign in again.");
    if (code === "conflict" || code === "inactive") return t("보유 정보가 바뀌었어요. 최신 내용을 확인한 후 다시 저장해 주세요.", "The account changed. Review the latest holdings before saving again.");
    if (code === "event_precedes_recorded_snapshot") return t("과거 거래 추가·정정을 선택해 이후 잔액을 함께 다시 계산해 주세요.", "Choose historical trade entry to recalculate the subsequent balances.");
    if (code === "invalid_time") return t("거래 날짜와 시각을 확인해 주세요.", "Check the trade date and time.");
    if (code === "operation_cancelled") return t("종료한 요청이에요. 새 거래는 다시 입력해 주세요.","This request was closed. Enter a new record to continue.");
    if (code === "holding_changed") return t("보유 정보가 바뀌었어요. 창을 닫고 홈을 새로고침해 주세요.", "The holding changed. Close this window and refresh Home.");
    if (code === "opening_confirmation_required") return t("현재 보유 수량과 현금 잔액을 확인해 주세요.", "Confirm the current quantities and cash balances.");
    if (code === "insufficient_quantity") return t("보유 수량보다 많이 매도할 수 없어요.", "You cannot sell more than you hold.");
    if (code === "holding_required") return t("기록할 종목을 선택해 주세요.", "Choose a holding.");
    if (code === "temporarily_unavailable") return t("지금은 새 거래 기록을 이용할 수 없어요. 기존 보유 정보는 홈에서 볼 수 있어요.", "New records are currently unavailable. Your existing holdings remain available on Home.");
    if (code === "peer_account_required") return t("잔액 확인을 마친 다른 계좌를 선택해 주세요.", "Choose another account with confirmed balances.");
    if (code === "instrument_required") return t("종목명과 티커를 확인해 주세요.", "Check the instrument name and ticker.");
    if (code === "cost_basis_already_known") return t("원가가 아직 없는 보유종목만 보완할 수 있어요.", "Acquisition cost can only be added where it is unknown.");
        if (code === "settlement_unconfirmed") return t("이 종목의 미확인 정산을 먼저 보완해 주세요. 같은 거래의 정산 정보만 정정하면 됩니다.", "Complete this holding's pending settlement by correcting that same record first.");
if (code === "net_costs_required") return t("이 거래의 수수료와 세금을 입력해 주세요. 없는 항목은 0, 모르는 항목은 확인 후 입력하세요.", "Enter the fees and tax for this trade. Enter 0 only for confirmed zero costs.");
    if (code === "invalid_net_settlement") return t("정산 금액과 수수료·세금의 관계를 확인해 주세요. 매수 정산 금액은 비용보다 커야 합니다.", "Check net settlement and costs. A buy debit must exceed fees and tax.");
    if (code === "invalid_minor_unit") return t("단가를 반올림하지 말고 ‘정산 금액’ 또는 ‘체결 총액’으로 실제 금액과 결제 통화를 입력해 주세요. 달러 결제액은 센트, 원화 결제액은 원 단위입니다.", "Do not round the unit price. Enter the actual net settlement or gross total and its currency. USD cash uses cents; KRW cash uses whole won.");
    if (["invalid_input", "invalid_request", "invalid_amount", "money_precision", "invalid_currency", "state_or_event_mismatch"].includes(code)) return t("금액·수량과 잔액을 확인해 주세요. 원화는 정수, 달러 결제액은 소수 둘째 자리까지 입력할 수 있어요.", "Check amounts, quantities and balances. KRW settlements use whole won; USD settlements use at most two decimal places.");
    return t("지금은 기록을 저장할 수 없어요. 입력을 유지한 채 다시 시도할 수 있습니다.", "The record could not be saved. Your inputs are still here for retry.");
  };
  function clearVisibleIdentity() {
    setSignedOut(true); setData(null); session.current=null; setPendingOperation(null);
    setUncertain(false); setExpiredOperation(""); setSuccess(false); setConflict(false); setChecking(false);
    clock.current=null; setFields({currency:"USD"}); setLots([{amount:"",currency:"USD",at:""}]);
    setAccountId(""); setConfirmed(false); setSavedOpening(false); onPendingChange?.(false);
  }
  function rejectChangedIdentity(response: Response, body: {error?:string}) {
    if(response.status===401 || response.status===403 || body.error==="account_changed") clearVisibleIdentity();
  }
  async function load(rebase = false) {
    setLoading(true); setError(""); setData(null);
    try {
      const response = await fetch("/api/portfolio/ledger", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || typeof body.sessionKey !== "string" || !Array.isArray(body.accounts)) { rejectChangedIdentity(response,body); throw new Error(body.error ?? "unavailable"); }
      clock.current = observeNativeLedgerClock(body.serverNow);
      if (session.current && session.current !== body.sessionKey) { setPendingOperation(null); onPendingChange?.(false); setUncertain(false); setFields({ currency: "USD", at: localNow() }); setLots([{ amount: "", currency: "USD", at: "" }]); setConfirmed(false); setAccountId(""); setError("account_changed"); setExpiredOperation(""); setChecking(false); setConflict(false); setSuccess(false); }
      const selection = resolveNativeLedgerSelection(body.accounts, { ...initialSelection, accountId: initialSelection.accountId ?? body.accounts.find((row: Account) => row.assets.some(asset => asset.id === initialSelection.assetId))?.id });
      if (compact && ((initialSelection.accountId && selection.accountId !== initialSelection.accountId) || (initialSelection.assetId && selection.assetId !== initialSelection.assetId) || !["buy", "sell"].includes(selection.action))) {
        setData({ ...body, canWrite: false }); setError("holding_changed"); return;
      }
      if (!session.current) {
        setAccountId(selection.accountId); setKind(selection.action);
        setFields(previous => ({ ...previous, inputMode: "execution", assetId: newInstrument ? "new" : selection.assetId }));
      }
      session.current = body.sessionKey; setData(body); setSignedOut(false);
      setFields(previous => ({ ...previous, at: previous.at || localNow() }));
      if (rebase && !uncertain) { setPendingOperation(null); setConflict(false); setConfirmed(false); }
      const saved = pendingTrade(localStorage, body.sessionKey);
      if (saved) {
        setChecking(true); setUncertain(true); onPendingChange?.(true);
        if ("mutation" in saved) { setPendingOperation({sessionKey:saved.sessionKey,mutation:saved.mutation}); setAccountId(saved.mutation.accountId); }
        else setExpiredOperation(saved.operationId);
        const result = await fetch("/api/portfolio/ledger", { method:"POST", credentials:"same-origin", signal:AbortSignal.timeout(15000), headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionKey:body.sessionKey,operationId:"mutation" in saved ? saved.mutation.operationId : saved.operationId}) });
        const status = await result.json();
        rejectChangedIdentity(result,status);
        if(!result.ok) throw new Error(status.error??"unavailable");
        if (result.ok && ["committed","cancelled"].includes(status.status)) { forgetTrade(localStorage,body.sessionKey,"mutation" in saved ? saved.mutation.operationId : saved.operationId); setPendingOperation(null); setExpiredOperation(""); setUncertain(false); onPendingChange?.(false); setSuccess(status.status==="committed"); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { setLoading(false); setChecking(false); }
  }
  useEffect(() => {
    // Initial loading is already represented by state. Queue this external read
    // so a discarded mount can cancel before issuing its authenticated request.
    let active=true;
    queueMicrotask(()=>{if(active)void load();});
    return()=>{active=false;};
    // One initial read; accepted mutations and user retries explicitly refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function retireExpiredOperation() {
    if(!data||!expiredOperation||busy||loading) return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/portfolio/ledger",{method:"POST",credentials:"same-origin",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionKey:data.sessionKey,operationId:expiredOperation,action:"cancel"})});
      const result=await response.json();
      rejectChangedIdentity(response,result);
      if(!response.ok||!["committed","cancelled"].includes(result.status)) throw new Error(result.error??"unavailable");
      forgetTrade(localStorage,data.sessionKey,expiredOperation);
      setPendingOperation(null);setExpiredOperation("");setUncertain(false);onPendingChange?.(false);setSuccess(result.status==="committed");await load();
    } catch(cause) {setError(cause instanceof Error?cause.message:"unavailable");}
    finally {setBusy(false);}
  }
  function edit(name: string, value: string) { if (busy || uncertain) return; setFields(previous => ({ ...previous, [name]: value })); setPendingOperation(null); setSuccess(false); setError(""); }
  async function submit(event: FormEvent, readNow: () => number) {
    event.preventDefault();
    if(!data || !navigator.locks) {setError("recovery_storage_unavailable");return;}
    await navigator.locks.request(`cairn:trade:${data.sessionKey}`,()=>submitLocked(event,readNow()));
  }
  async function submitLocked(event: FormEvent, submittedAt: number) {
    event.preventDefault(); if (lock.current || loading || checking || expiredOperation || !account || !data?.canWrite || conflict) return;
    lock.current=true; setBusy(true); onBusyChange?.(true);
    setError(""); setSuccess(false);
    let dispatched = false;
    try {
      const operation=pending.current??{sessionKey:data.sessionKey,mutation:buildNativeLedgerMutation({account,kind,fields,lots,operationId:crypto.randomUUID(),newAssetId:crypto.randomUUID(),confirmed,nowMs:nativeLedgerNow(clock.current)})};
      if(!pending.current)setPendingOperation(operation);
      rememberTrade(localStorage, {...operation,savedAt:submittedAt});
      if (uncertain) {
        const lookup = await fetch("/api/portfolio/ledger", {method:"POST",credentials:"same-origin",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionKey:data.sessionKey,operationId:operation.mutation.operationId})});
        const status=await lookup.json();
        rejectChangedIdentity(lookup,status);
        if (!lookup.ok) throw new Error(status.error ?? "unavailable");
        if (["committed","cancelled"].includes(status.status)) { forgetTrade(localStorage,data.sessionKey,pending.current?.mutation.operationId); setPendingOperation(null); setUncertain(false); onPendingChange?.(false); setSuccess(status.status==="committed"); await load(); return; }
      }
      lock.current = true; setBusy(true); onBusyChange?.(true); onPendingChange?.(true); dispatched = true;
      const response = await fetch("/api/portfolio/ledger", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const body = await response.json();
      if (body.error === "temporarily_unavailable") setData(previous => previous ? { ...previous, canWrite: false } : previous);
      if (!response.ok || !["created", "existing"].includes(body.status)) { if ([400,409].includes(response.status) && body.error !== "account_changed") { forgetTrade(localStorage,data.sessionKey,pending.current?.mutation.operationId); setPendingOperation(null); onPendingChange?.(false); setUncertain(false); } if (response.status === 409) setConflict(true); rejectChangedIdentity(response,body); throw new Error(body.error ?? "unavailable"); }
      forgetTrade(localStorage,data.sessionKey,pending.current?.mutation.operationId);
      setPendingOperation(null); onPendingChange?.(false); setUncertain(false); setSuccess(true); setSavedOpening(!account.state); setConfirmed(false); setFields(previous => ({...fieldsAfterLedgerSave(previous, !account.state, localNow()),...(compact ? {assetId:previous.assetId,inputMode:"execution"} : {})})); setLots([{ amount: "", currency: "USD", at: "" }]);
      await load();
      if (account.state) onSaved?.();
    } catch (cause) { if (dispatched && pending.current) setUncertain(true); if(cause instanceof Error && cause.message==="recovery_pending") {setPendingOperation(null);await load();} setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
    function completeSettlement() {
    const row = data?.trades?.find(row => row.accountId === account?.id && (row.event.type === "buy" || row.event.type === "sell") && row.event.settlementStatus === "unconfirmed" && (!compact || row.event.assetId === fields.assetId));
    if (!row || (row.event.type !== "buy" && row.event.type !== "sell")) return;
    const trade = row.event;
    setPendingOperation(null); setError(""); setSuccess(false); setKind(trade.type);
    setFields({ currency: trade.currency, assetId: trade.assetId, quantity: trade.quantity,
      price: trade.executionUnitPrice?.amount ?? trade.price ?? "", inputMode: "total", total: "", settlementCurrency: trade.currency,
      fee: trade.fee?.amount ?? "", tax: trade.tax?.amount ?? "", historyMode: "yes", replaces: row.id,
      reason: "체결 기록의 정산 정보 보완", notInOpening: "yes", timePrecision: trade.dateEvidence?.precision ?? "exact",
      tradeDate: trade.dateEvidence?.reportedDate ?? "", at: new Date(Date.parse(trade.at)-new Date(trade.at).getTimezoneOffset()*60000).toISOString().slice(0,-1) });
  }
const label = (ko: string, en: string, name: string, type = "text") => type === "datetime-local" ? <NativeLedgerTimestamp label={t(ko,en)} name={name} value={fields[name] ?? ""} onChange={value=>edit(name,value)} /> : <CairnField>{t(ko, en)}<CairnInput name={name} type={type} step={type === "datetime-local" ? "0.001" : undefined} value={fields[name] ?? ""} onChange={event => edit(name, event.target.value)} required /></CairnField>;
  const money = (ko: string, en: string, name: string, inCurrency: Currency, required = true) => <CairnField>{t(ko, en)} · {inCurrency}<MoneyInput aria-label={`${t(ko, en)} ${inCurrency}`} value={fields[name] ?? ""} onValueChange={value => edit(name, value)} allowDecimals={inCurrency === "USD"} required={required} placeholder="0" /></CairnField>;
  const currencySelect = <CairnField>{t("통화", "Currency")}<CairnSelect className="cairn-form-select" value={fields.currency ?? "USD"} onChange={event => edit("currency", event.target.value)}><option>USD</option><option>KRW</option></CairnSelect></CairnField>;
  const accountName = (row: Account) => row.name;
  return <div className={compact ? styles.compact : styles.page}>{!compact ? <AppNavigation activePath="/portfolio/manage" /> : null}<section id={compact ? undefined : "varda-main-content"} className={styles.body}>
    {!compact ? <div className={styles.heading}><CairnPageTitle>{t("매매·현금 기록", "Trades & cash")}</CairnPageTitle><Link href={`/?currency=${fields.currency === "KRW" ? "KRW" : "USD"}`}>{t("홈으로 →", "Home →")}</Link></div> : null}
    <p className={styles.note}>{t("증권사에서 체결한 거래를 기록합니다.", "Record trades already executed at your broker.")}</p>
    {loading ? <CairnStatus as="p" tone="neutral" role="status" className={styles.note}>{checking ? t("저장 여부 확인 중…", "Checking whether the record was saved…") : t("보유 정보를 확인하고 있어요…", "Loading your holdings…")}</CairnStatus> : null}
    {expiredOperation ? <CairnStatus as="p" tone="neutral" role="status">{t("입력 보관 기간이 지나 저장 여부만 확인할 수 있어요. 확인될 때까지 새 거래로 다시 입력하지 마세요.", "The draft has expired. Check this operation before entering it as a new trade.")} <CairnButton variant="secondary" type="button" onClick={() => void load()} disabled={loading}>{t("저장 여부 다시 확인", "Check save status")}</CairnButton> <CairnButton variant="secondary" type="button" onClick={()=>void retireExpiredOperation()} disabled={busy||loading}>{t("미저장 요청 종료","Close an unsaved request")}</CairnButton><small>{t("이미 저장됐다면 기록을 그대로 확인합니다.","If already saved, the record is kept.")}</small></CairnStatus> : null}
    {error ? <CairnStatus as="div" tone="danger" role="alert" className={styles.error}><p>{errorMessage(error)}</p>{signedOut ? <Link href="/auth/sign-in?returnTo=%2Fportfolio%2Fledger">{t("로그인", "Sign in")}</Link> : conflict || !data || error === "temporarily_unavailable" ? <CairnButton variant="secondary" className={`cairn-secondary ${styles.secondary}`} type="button" onClick={() => void load(true)} disabled={loading}>{t("최신 정보 확인", "Review latest holdings")}</CairnButton> : null}</CairnStatus> : null}
    {success ? <CairnStatus as="p" tone="success" role="status" className={styles.success}>{savedOpening ? t("잔액을 확인했어요. 선택한 거래를 이어서 기록하세요.", "Balances confirmed. Continue with your selected transaction.") : t("기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.", "Recorded. Your updated holdings are available on Home.")}</CairnStatus> : null}
    {data?.canWrite && !account ? <><p className={styles.note}>{t("기록할 계좌를 먼저 선택해 주세요.", "Add an account to keep these records.")}</p><Link href="/portfolio/accounts">{t("계좌 추가 →", "Add an account →")}</Link></> : null}
    {data && !data.canWrite && !error ? <CairnStatus as="p" tone="neutral" role="status" className={styles.note}>{errorMessage("temporarily_unavailable")}</CairnStatus> : null}
    {!signedOut && data && uncertain && pendingPreview ? <CairnStatus as="p" tone="neutral" role="status" className={styles.note}>{t("확인 중인 기록", "Pending record")}: {pendingPreview.at.slice(0,10)} · {pendingPreview.type} · {"quantity" in pendingPreview ? pendingPreview.quantity : ""}</CairnStatus> : null}
    {account && data?.canWrite ? <><CairnForm onSubmit={event=>{void submit(event,Date.now);}} className={styles.form} noValidate><CairnFieldset className={styles.entryFields} disabled={busy || uncertain}>
      {compact && (initialSelection.accountId === account.id || !!initialSelection.assetId && initialSelection.assetId === fields.assetId) ? <p className={styles.selectedAccount}>{accountName(account)}{initialSelection.assetId ? ` · ${account.assets.find(row => row.id === fields.assetId)?.ticker ?? ""}` : ""}</p> : <CairnField>{t("계좌", "Account")}<CairnSelect className="cairn-form-select" value={account.id} onChange={event => { setAccountId(event.target.value); setPendingOperation(null); setConfirmed(false); setConflict(false); setError(""); setSuccess(false); setFields({ currency: "USD", at: localNow(), assetType: "etf", inputMode: "execution", ...(newInstrument ? { assetId: "new" } : {}) }); }}>{activeAccounts.map(row => <option key={row.id} value={row.id}>{accountName(row)}</option>)}</CairnSelect></CairnField>}
      {cashUnconfirmed ? <CairnStatus as="p" tone="neutral" role="status" className={styles.note}>{t("체결은 반영됐어요. 투자자산 원가·수익률은 체결금액 기준으로 확인하며, 현금 정산은 별도로 관리합니다.", "Execution is recorded. Investment cost and returns use consideration; cash settlement is tracked separately.")} {data.trades?.some(row => row.accountId === account.id && (row.event.type === "buy" || row.event.type === "sell") && row.event.settlementStatus === "unconfirmed" && (!compact || row.event.assetId === fields.assetId)) ? <CairnButton variant="secondary" type="button" className={styles.secondary} onClick={completeSettlement}>{t("정산 보완", "Complete settlement")}</CairnButton> : <span>{t("이 계좌의 과거 거래에서 정산할 기록을 확인해 주세요.", "Review the account's earlier trades to complete settlement.")}</span>}</CairnStatus> : null}
      {account.state ? <details open={compact ? undefined : true} className={styles.cashDetails}><summary>{t("계좌 현금 확인", "Account cash")}</summary><div className={styles.cash}>{(["KRW", "USD"] as const).map(value => <span key={value}>{t("현금", "Cash")} · {value}<strong>{cashUnconfirmed ? t("정산 미확인", "Settlement unconfirmed") : formatMoney(Number(account.state!.cash[value]), value, locale === "en" ? "en-US" : "ko-KR")}</strong></span>)}</div></details> : <><p className={styles.note}>{t("현재 잔액을 한 번 확인하면 이후 입출금과 매매를 이어서 기록할 수 있어요.", "Confirm today’s balances once, then record deposits and trades as they happen.")}</p><div className={styles.grid}>{money("원화 현금 잔액", "KRW cash balance", "cashKrw", "KRW")}{money("달러 현금 잔액", "USD cash balance", "cashUsd", "USD")}</div><details><summary>{t("현재 보유종목 확인", "Review current holdings")}</summary><div className={styles.holdings}>{account.assets.filter(row => !row.archived).map(row => <div key={row.id}><span>{row.name ?? row.ticker ?? t("보유 종목", "Holding")}</span><span>{row.quantity} · {row.currency}</span></div>)}</div><p className={styles.note}>{t("매입원가는 나중에 보완할 수 있어요.", "Acquisition costs can be added later.")}</p></details><CairnField className={styles.confirm}><CairnInput type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setPendingOperation(null); }} />{t("현재 보유 수량과 현금 잔액을 확인했어요.", "I have checked the current quantities and cash balances.")}</CairnField></>}
      {account.state ? <>{!compact ? <CairnField>{t("기록 종류", "Record type")}<CairnSelect aria-label={t("기록 종류", "Record type")} className="cairn-form-select" value={kind} onChange={event => { setKind(event.target.value as EventKind); setPendingOperation(null); setError(""); setSuccess(false); }}>{EVENTS.map(([value, ko, en]) => <option key={value} value={value}>{t(ko, en)}</option>)}</CairnSelect></CairnField> : null}
        {(!compact || (!initialSelection.assetId && !newInstrument)) && ["buy", "sell", "split", "cost_basis"].includes(kind) ? <CairnField>{t("종목", "Holding")}<CairnSelect className="cairn-form-select" value={fields.assetId ?? ""} onChange={event => edit("assetId", event.target.value)}><option value="">{t("선택하세요", "Choose a holding")}</option>{account.assets.filter(row => kind === "buy" || !!fields.historyMode && kind === "sell" || account.state!.positions.some(p => p.assetId === row.id && Decimal.from(p.quantity).compare(0) > 0 && (kind !== "cost_basis" || p.costLots === null))).map(row => <option key={row.id} value={row.id}>{row.name ?? row.ticker ?? t("보유 종목", "Holding")} · {row.currency}</option>)}{kind === "buy" ? <option value="new">{t("새 종목 추가", "Add a new instrument")}</option> : null}</CairnSelect></CairnField> : null}
        {kind === "buy" && fields.assetId === "new" ? <CairnFieldset><legend>{t("새 종목", "New instrument")}</legend>
          <InstrumentSearch privateQuery disabled={busy} onSelect={choice => { setPendingOperation(null); setFields(previous => ({ ...previous, name: choice.name, ticker: choice.ticker, currency: choice.currency, assetType: choice.assetType })); }} />
          {fields.ticker ? <p>{fields.name} · {fields.ticker}</p> : null}
          <details><summary>{t("직접 입력", "Enter manually")}</summary><div className={styles.grid}>{label("종목명", "Name", "name")}{label("티커", "Ticker", "ticker")}{currencySelect}<CairnField>{t("종류", "Type")}<CairnSelect className="cairn-form-select" value={fields.assetType ?? "etf"} onChange={event => edit("assetType", event.target.value)}><option value="etf">ETF</option><option value="stock">{t("개별 주식", "Stock")}</option></CairnSelect></CairnField></div></details>
        </CairnFieldset> : null}
        {["deposit", "withdraw", "dividend", "fee", "transfer", "exchange"].includes(kind) ? <div className={styles.row}>{money(kind === "exchange" ? "환전할 금액" : "금액", kind === "exchange" ? "Amount to exchange" : "Amount", "amount", currency(fields.currency ?? "USD"))}{currencySelect}</div> : null}
        {kind === "dividend" || kind === "fee" ? <CairnField>{t("해당 종목 · 선택", "Related holding · optional")}<CairnSelect className="cairn-form-select" value={fields.assetId ?? ""} onChange={event => edit("assetId", event.target.value)}><option value="">{t("계좌 공통 / 아직 모름", "Account-wide / unknown")}</option>{account.assets.filter(row => account.state!.positions.some(p => p.assetId === row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</CairnSelect></CairnField> : null}
        {kind === "buy" || kind === "sell" ? <NativeTradeFields kind={kind} fields={fields} unit={unit} quantity={positionFor(account, fields.assetId)?.quantity ?? "0"} edit={edit} /> : null}
        {kind === "exchange" ? <>{money("실제로 받은 금액", "Amount actually received", "credit", fields.currency === "USD" ? "KRW" : "USD")}<details><summary>{t("환전 수수료", "Exchange fee")}</summary>{money("별도 차감 수수료", "Separately debited fee", "fee", currency(fields.currency ?? "USD"), false)}</details></> : null}
        {kind === "transfer" ? <CairnField>{t("받는 내 계좌", "My receiving account")}<CairnSelect className="cairn-form-select" value={fields.peerAccountId ?? ""} onChange={event => edit("peerAccountId", event.target.value)}><option value="">{t("계좌 선택", "Choose an account")}</option>{activeAccounts.filter(row => row.id !== account.id && row.state).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</CairnSelect></CairnField> : null}
        {kind === "split" ? <><div className={styles.grid}>{label("변경 후 주식 수", "Shares after split", "ratioN")}{label("변경 전 주식 수", "Shares before split", "ratioD")}</div><p className={styles.note}>{t("예: 1주가 4주가 되었다면 4와 1을 입력하세요.", "For a four-for-one split, enter 4 and 1.")}</p></> : null}
        {kind === "cost_basis" ? <CairnFieldset><legend>{t("현재 보유분의 매입원가", "Cost of the current holding")}</legend><p className={styles.note}>{t("현재 남아 있는 보유분에 해당하는 금액과 실제 매입 날짜를 입력하세요. 여러 날짜라면 나누어 추가하세요.", "Enter the cost attributable to your remaining holding and its actual acquisition date. Add separate dates when needed.")}</p><div className={styles.lots}>{lots.map((lot, index) => <div className={styles.lot} key={index}><div className={styles.row}><CairnField>{t("매입원가", "Acquisition cost")}<MoneyInput value={lot.amount} allowDecimals={lot.currency === "USD"} onValueChange={value => { setLots(previous => previous.map((row, i) => i === index ? { ...row, amount: value } : row)); setPendingOperation(null); }} /></CairnField><CairnField>{t("통화", "Currency")}<CairnSelect className="cairn-form-select" value={lot.currency} onChange={event => { setLots(previous => previous.map((row, i) => i === index ? { ...row, currency: event.target.value as Currency } : row)); setPendingOperation(null); }}><option>USD</option><option>KRW</option></CairnSelect></CairnField></div><CairnField>{t("실제 매입 시각", "Acquired at")}<CairnInput type="datetime-local" step="0.001" value={lot.at} onChange={event => { setLots(previous => previous.map((row, i) => i === index ? { ...row, at: event.target.value } : row)); setPendingOperation(null); }} /></CairnField>{lots.length > 1 ? <CairnButton variant="secondary" type="button" className={`cairn-secondary ${styles.secondary}`} onClick={() => { setLots(previous => previous.filter((_, i) => i !== index)); setPendingOperation(null); }}>{t("제외", "Remove")}</CairnButton> : null}</div>)}</div><CairnButton variant="secondary" type="button" className={`cairn-secondary ${styles.secondary}`} onClick={() => { setLots(previous => [...previous, { amount: "", currency: unit, at: "" }]); setPendingOperation(null); }}>{t("다른 매입 날짜 추가", "Add another acquisition date")}</CairnButton></CairnFieldset> : null}
      </> : null}
            <details open={fields.historyMode ? true : undefined}><summary>{t("거래일·과거 기록 정정", "Trade date & corrections")}</summary>
{account.state && (kind === "buy" || kind === "sell") ? <CairnField>{t("거래 시간", "Trade timing")}<CairnSelect className="cairn-form-select" value={fields.timePrecision ?? "exact"} onChange={event => edit("timePrecision", event.target.value)}><option value="exact">{t("날짜와 시각", "Date and time")}</option><option value="date_only">{t("과거 거래일만 알아요 · 한국시간", "Past date only · Korea time")}</option></CairnSelect></CairnField> : null}
      {account.state && (kind === "buy" || kind === "sell") ? <details open={fields.historyMode ? true : undefined}><summary>{t("과거 거래 추가·정정", "Historical trade entry / correction")}</summary>
        <CairnField><CairnInput type="checkbox" checked={!!fields.historyMode} onChange={e => edit("historyMode",e.target.checked ? "yes" : "")} />{t("시작 잔액 이후 거래를 다시 계산", "Recalculate trades after the opening balance")}</CairnField>
        {fields.historyMode ? <>{fields.assetId === "new" ? <CairnStatus as="p" tone="danger" role="alert" className={styles.note}>{t("과거 거래는 이미 등록된 종목에서 추가할 수 있어요.", "Historical trades need an existing holding.")}</CairnStatus> : null}<CairnField>{t("정정할 기록", "Record to correct")}<CairnSelect className="cairn-form-select" value={fields.replaces ?? ""} onChange={e => {
          const row=data.trades?.find(row => row.id===e.target.value); const trade=row?.event;
          if (trade && (trade.type === "buy" || trade.type === "sell")) { setKind(trade.type); setFields(previous => ({...previous,replaces:row!.id,assetId:trade.assetId,quantity:trade.quantity,inputMode:trade.settlementStatus === "unconfirmed" ? "execution" : trade.settlement ? "total" : "price",total:trade.settlement?.amount ?? "",settlementCurrency:trade.settlement?.currency ?? trade.currency,price:trade.executionUnitPrice?.amount ?? trade.price ?? "",netTotal:"",fee:trade.fee?.amount ?? "",tax:trade.tax?.amount ?? "",timePrecision:trade.dateEvidence?.precision ?? "exact",tradeDate:trade.dateEvidence?.reportedDate ?? "",at:new Date(Date.parse(trade.at)-new Date(trade.at).getTimezoneOffset()*60000).toISOString().slice(0,-1)})); }
          else edit("replaces","");
        }}><option value="">{t("누락된 새 거래", "A missing trade")}</option>{data.trades?.filter(row => row.accountId===account.id).map(row => <option key={row.id} value={row.id}>{row.event.at.slice(0,10)} · {"settlementStatus" in row.event && row.event.settlementStatus === "unconfirmed" ? t("정산 미확인 · ","Settlement pending · ") : ""}{row.event.type === "buy" ? t("매수","Buy") : t("매도","Sell")} · {"quantity" in row.event ? row.event.quantity : ""}</option>)}</CairnSelect></CairnField>
        {label("변경 이유", "Reason for change", "reason")}
        <CairnField className={styles.confirm}><CairnInput type="checkbox" checked={fields.notInOpening === "yes"} onChange={e => edit("notInOpening",e.target.checked ? "yes" : "")} />{t("시작 잔액에 이미 포함된 거래가 아닙니다.", "This trade was not already included in the opening balance.")}</CairnField>
        <p className={styles.note}>{t("현재 수량·현금·원가와 이후 평가를 다시 계산합니다. 원래 기록은 남습니다.", "Current shares, cash, cost and later valuations will be recalculated. The original record is retained.")}</p>
        <details><summary>{t("같은 날 거래 순서 확인", "Confirm same-day ordering")}</summary><CairnField>{t("이 거래 직전의 기록", "Immediately preceding record")}<CairnSelect className="cairn-form-select" value={fields.afterEventId ?? ""} onChange={e => edit("afterEventId",e.target.value)}><option value="">{t("시각 순서 사용", "Use recorded times")}</option>{data.ordering?.filter(row => row.accountId===account.id && row.id!==fields.replaces).map(row => <option key={row.id} value={row.id}>{row.at} · {row.type === "opening" ? t("시작 잔액","Opening") : EVENTS.find(e=>e[0]===row.type)?.[locale==="en"?2:1] ?? row.type}</option>)}</CairnSelect></CairnField></details>
        </> : null}</details> : null}
      {account.state && (kind === "buy" || kind === "sell") && fields.timePrecision === "date_only" ? <>{label("거래일 · 한국시간", "Trade date · Korea time", "tradeDate", "date")}<p className={styles.note}>{t("시각 미상으로 기록하며, 일별 수익률에는 하루 중간 시점으로 반영합니다.", "Saved as date-only. Daily returns use the middle of the service day.")}</p></> : label("기록 시각 · 기기 시간대", "Recorded at · Device time zone", "at", "datetime-local")}
      </details></CairnFieldset>{uncertain ? <p className={styles.note}>{t("저장 결과를 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요.", "The save result is uncertain. Retry this same record to confirm it.")}</p> : null}<div className={styles.actions}><CairnButton variant="primary" className={`cairn-primary ${styles.primary}`} type="submit" disabled={busy || loading || conflict || signedOut || !!fields.historyMode && fields.assetId === "new"}>{busy ? (uncertain ? t("저장 여부 확인 중…","Checking save status…") : t("기록 중…", "Saving…")) : uncertain ? t("저장 여부 확인·재시도","Check save / retry") : account.state ? kind === "buy" ? t("매수 기록 저장", "Save buy record") : kind === "sell" ? t("매도 기록 저장", "Save sell record") : t("기록하기", "Save record") : t("잔액 확인 후 계속", "Confirm balances and continue")}</CairnButton>{!compact ? <Link href={`/?currency=${fields.currency === "KRW" ? "KRW" : "USD"}`}>{t("나중에 하기", "Later")}</Link> : null}</div>
    </CairnForm></> : null}
  </section></div>;
}

function positionFor(account: Account, assetId: string) { return account.state?.positions.find(row => row.assetId === assetId); }
