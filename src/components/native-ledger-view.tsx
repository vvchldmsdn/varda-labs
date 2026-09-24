"use client";

import Link from "next/link";
import { InstrumentSearch } from "@/components/onboarding/instrument-search";
import { nativeDateOnlyAt, resolveNativeTrade, type NativeDateEvidence } from "@/lib/native-portfolio-ledger";
import { NativeTradeFields } from "@/components/native-trade-fields";
import { fieldsAfterLedgerSave, resolveTradeRecordSelection } from "@/lib/trade-record-intent";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppNavigation } from "@/components/app-navigation";
import { MoneyInput } from "@/components/first-visit/money-input";
import { useI18n } from "@/components/i18n/locale-provider";
import { Decimal, formatMoney, isCurrency, moneyMinor, type Currency } from "@/lib/money";
import type { NativeMutation, NativeStoredAccount } from "@/db/queries/native-portfolio-ledger";
import styles from "./native-ledger-view.module.css";

type EventKind = NonNullable<NativeMutation["event"]>["type"];
type Account = NativeStoredAccount & { active?: boolean; assets: (NativeStoredAccount["assets"][number] & { name?: string; ticker?: string })[] };
type SelectionHint = { accountId?: string; assetId?: string; action?: string };
type LedgerData = { sessionKey: string; accounts: Account[]; canWrite: boolean };
type CostField = { amount: string; currency: Currency; at: string };
type Fields = Record<string, string>;
const EVENTS: [EventKind, string, string][] = [["deposit", "입금", "Deposit"], ["withdraw", "출금", "Withdraw"], ["buy", "매수", "Buy"], ["sell", "매도", "Sell"], ["dividend", "배당금", "Dividend"], ["fee", "수수료·세금", "Fee / tax"], ["exchange", "환전", "Exchange"], ["transfer", "내 계좌 간 이동", "Between my accounts"], ["split", "주식 분할·병합", "Stock split"], ["cost_basis", "매입원가 보완", "Add acquisition cost"]];
function localNow() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, -1); }
function timestamp(value: string) { const at = new Date(value); if (!value || !Number.isFinite(at.getTime()) || at.getTime() > Date.now()) throw new Error("invalid_time"); return at.toISOString(); }
function exact(value: string, currency?: Currency, positive = true) { if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("invalid_amount"); const amount = Decimal.from(value); if (amount.compare(0) < 0 || (positive && amount.compare(0) === 0)) throw new Error("invalid_amount"); if (currency) moneyMinor(value, currency); return amount.toExactString(); }
function currency(value: string): Currency { if (!isCurrency(value)) throw new Error("invalid_currency"); return value; }

/** UI request builder only. The authenticated writer revalidates all ownership,
 * settlement precision, quantities and original dated costs independently. */
export function buildNativeLedgerMutation({ account, kind, fields, lots, operationId, newAssetId, confirmed }: {
  account: Account; kind: EventKind; fields: Fields; lots: CostField[]; operationId: string; newAssetId: string; confirmed: boolean;
}): NativeMutation {
  const dateEvidence: NativeDateEvidence | undefined = account.state && (kind === "buy" || kind === "sell") && fields.timePrecision === "date_only"
    ? { precision: "date_only", reportedDate: fields.tradeDate, timeZone: "Asia/Seoul", policy: "service_day_midpoint" } : undefined;
  const at = timestamp(dateEvidence ? nativeDateOnlyAt(dateEvidence.reportedDate) : fields.at), base = { operationId, accountId: account.id, expectedSequence: account.state?.sequence ?? null };
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
    const settlementUnit = fields.inputMode === "total" ? currency(fields.settlementCurrency ?? unit) : unit;
    const event = { type: kind, at, ...(dateEvidence ? { dateEvidence } : {}), assetId: isNew ? newAssetId : asset!.id, quantity, currency: unit,
      ...(fields.inputMode === "total" ? { settlement: { amount: exact(fields.total, settlementUnit), currency: settlementUnit } } : { price: exact(fields.price) }),
      ...(fields.orderPrice ? { orderUnitPrice: { amount: exact(fields.orderPrice), currency: unit } } : {}),
      ...(fields.fee ? { fee: { amount: exact(fields.fee, settlementUnit, false), currency: settlementUnit } } : {}),
      ...(fields.tax ? { tax: { amount: exact(fields.tax, settlementUnit, false), currency: settlementUnit } } : {}) };
    resolveNativeTrade(event);
    if (kind === "sell" && position && Decimal.from(quantity).compare(position.quantity) > 0) throw new Error("insufficient_quantity");
    if (!isNew) return { ...base, event };
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
    return { ...base, event: { type: kind, at, assetId: position!.assetId, costLots: lots.map(lot => ({ amount: exact(lot.amount, lot.currency, false), currency: lot.currency, at: timestamp(lot.at), source: "user_native_ledger", remaining: { n: "1", d: "1" } })) } };
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
  const session = useRef<string | null>(null), pending = useRef<{ sessionKey: string; mutation: NativeMutation } | null>(null), lock = useRef(false);
  const activeAccounts = data?.accounts.filter(row => row.active !== false) ?? [];
  const account = activeAccounts.find(row => row.id === accountId) ?? activeAccounts[0];
  const asset = account?.assets.find(row => row.id === fields.assetId);
  const unit = isCurrency(asset?.currency) && fields.assetId !== "new" ? asset.currency : isCurrency(fields.currency) ? fields.currency : "USD";
  const errorMessage = (code: string) => {
    if (code === "sign_in_required" || code === "account_changed") return t("로그인 상태가 바뀌었어요. 다시 로그인해 주세요.", "Your sign-in changed. Please sign in again.");
    if (code === "conflict" || code === "inactive") return t("보유 정보가 바뀌었어요. 최신 내용을 확인한 후 다시 저장해 주세요.", "The account changed. Review the latest holdings before saving again.");
    if (code === "event_precedes_recorded_snapshot" || code === "invalid_time") return t("기록 시각을 확인해 주세요. 마지막 평가 이후의 거래를 기록할 수 있어요.", "Check the time. Transactions must follow the latest recorded valuation.");
    if (code === "holding_changed") return t("보유 정보가 바뀌었어요. 창을 닫고 홈을 새로고침해 주세요.", "The holding changed. Close this window and refresh Home.");
    if (code === "opening_confirmation_required") return t("현재 보유 수량과 현금 잔액을 확인해 주세요.", "Confirm the current quantities and cash balances.");
    if (code === "insufficient_quantity") return t("보유 수량보다 많이 매도할 수 없어요.", "You cannot sell more than you hold.");
    if (code === "holding_required") return t("기록할 종목을 선택해 주세요.", "Choose a holding.");
    if (code === "temporarily_unavailable") return t("지금은 새 거래 기록을 이용할 수 없어요. 기존 보유 정보는 홈에서 볼 수 있어요.", "New records are currently unavailable. Your existing holdings remain available on Home.");
    if (code === "peer_account_required") return t("잔액 확인을 마친 다른 계좌를 선택해 주세요.", "Choose another account with confirmed balances.");
    if (code === "instrument_required") return t("종목명과 티커를 확인해 주세요.", "Check the instrument name and ticker.");
    if (code === "cost_basis_already_known") return t("원가가 아직 없는 보유종목만 보완할 수 있어요.", "Acquisition cost can only be added where it is unknown.");
    if (["invalid_input", "invalid_request", "invalid_amount", "money_precision", "invalid_currency", "state_or_event_mismatch"].includes(code)) return t("금액·수량과 잔액을 확인해 주세요. 원화는 정수, 달러 결제액은 소수 둘째 자리까지 입력할 수 있어요.", "Check amounts, quantities and balances. KRW settlements use whole won; USD settlements use at most two decimal places.");
    return t("지금은 기록을 저장할 수 없어요. 입력을 유지한 채 다시 시도할 수 있습니다.", "The record could not be saved. Your inputs are still here for retry.");
  };
  async function load(rebase = false) {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/portfolio/ledger", { cache: "no-store", credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || typeof body.sessionKey !== "string" || !Array.isArray(body.accounts)) { if (response.status === 401) setSignedOut(true); throw new Error(body.error ?? "unavailable"); }
      if (session.current && session.current !== body.sessionKey) { pending.current = null; onPendingChange?.(false); setUncertain(false); setFields({ currency: "USD", at: localNow() }); setLots([{ amount: "", currency: "USD", at: "" }]); setConfirmed(false); setAccountId(""); setError("account_changed"); }
      const selection = resolveNativeLedgerSelection(body.accounts, { ...initialSelection, accountId: initialSelection.accountId ?? body.accounts.find((row: Account) => row.assets.some(asset => asset.id === initialSelection.assetId))?.id });
      if (compact && ((initialSelection.accountId && selection.accountId !== initialSelection.accountId) || (initialSelection.assetId && selection.assetId !== initialSelection.assetId) || !["buy", "sell"].includes(selection.action))) {
        setData({ ...body, canWrite: false }); setError("holding_changed"); return;
      }
      if (!session.current) {
        setAccountId(selection.accountId); setKind(selection.action);
        setFields(previous => ({ ...previous, inputMode: "total", assetId: newInstrument ? "new" : selection.assetId }));
      }
      session.current = body.sessionKey; setData(body); setSignedOut(false);
      setFields(previous => ({ ...previous, at: previous.at || localNow() }));
      if (rebase) { pending.current = null; setConflict(false); setConfirmed(false); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* one authenticated load; mutations explicitly refresh */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function edit(name: string, value: string) { if (busy || uncertain) return; setFields(previous => ({ ...previous, [name]: value })); pending.current = null; setSuccess(false); setError(""); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current || !account || !data?.canWrite || conflict) return;
    setError(""); setSuccess(false);
    let dispatched = false;
    try {
      if (!pending.current) pending.current = { sessionKey: data.sessionKey, mutation: buildNativeLedgerMutation({ account, kind, fields, lots, operationId: crypto.randomUUID(), newAssetId: crypto.randomUUID(), confirmed }) };
      lock.current = true; setBusy(true); onBusyChange?.(true); onPendingChange?.(true); dispatched = true;
      const response = await fetch("/api/portfolio/ledger", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(30_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const body = await response.json();
      if (body.error === "temporarily_unavailable") setData(previous => previous ? { ...previous, canWrite: false } : previous);
      if (!response.ok || !["created", "existing"].includes(body.status)) { if ((response.status >= 400 && response.status < 500) || (response.status === 503 && body.error === "temporarily_unavailable")) { pending.current = null; onPendingChange?.(false); setUncertain(false); } if (response.status === 409) setConflict(true); if (response.status === 401) setSignedOut(true); throw new Error(body.error ?? "unavailable"); }
      pending.current = null; onPendingChange?.(false); setUncertain(false); setSuccess(true); setSavedOpening(!account.state); setConfirmed(false); setFields(previous => fieldsAfterLedgerSave(previous, !account.state, localNow())); setLots([{ amount: "", currency: "USD", at: "" }]);
      await load();
      if (account.state) onSaved?.();
    } catch (cause) { if (dispatched && pending.current) setUncertain(true); setError(cause instanceof Error ? cause.message : "unavailable"); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const label = (ko: string, en: string, name: string, type = "text") => <label>{t(ko, en)}<input name={name} type={type} step={type === "datetime-local" ? "0.001" : undefined} value={fields[name] ?? ""} onChange={event => edit(name, event.target.value)} required /></label>;
  const money = (ko: string, en: string, name: string, inCurrency: Currency, required = true) => <label>{t(ko, en)} · {inCurrency}<MoneyInput aria-label={`${t(ko, en)} ${inCurrency}`} value={fields[name] ?? ""} onValueChange={value => edit(name, value)} allowDecimals={inCurrency === "USD"} required={required} placeholder="0" /></label>;
  const currencySelect = <label>{t("통화", "Currency")}<select value={fields.currency ?? "USD"} onChange={event => edit("currency", event.target.value)}><option>USD</option><option>KRW</option></select></label>;
  const accountName = (row: Account) => row.name;
  return <div className={compact ? styles.compact : styles.page}>{!compact ? <AppNavigation activePath="/portfolio/manage" /> : null}<section id={compact ? undefined : "varda-main-content"} className={styles.body}>
    {!compact ? <div className={styles.heading}><h1>{t("매매·현금 기록", "Trades & cash")}</h1><Link href={`/?currency=${fields.currency === "KRW" ? "KRW" : "USD"}`}>{t("홈으로 →", "Home →")}</Link></div> : null}
    <p className={styles.note}>{t("증권사에서 체결한 거래를 기록합니다.", "Record trades already executed at your broker.")}</p>
    {!compact ? <div className={styles.tradeKinds} role="group" aria-label={t("매매 유형", "Trade type")}>
      {(["buy", "sell"] as const).map(action => <button key={action} type="button" aria-pressed={kind === action} disabled={busy || uncertain || loading || !data?.canWrite || signedOut || conflict} onClick={() => { setKind(action); pending.current = null; setError(""); setSuccess(false); }}>{action === "buy" ? t("매수 기록", "Record buy") : t("매도 기록", "Record sell")}</button>)}
    </div> : null}
    {loading ? <p role="status" className={styles.note}>{t("보유 정보를 확인하고 있어요…", "Loading your holdings…")}</p> : null}
    {error ? <div role="alert" className={styles.error}><p>{errorMessage(error)}</p>{signedOut ? <Link href="/auth/sign-in?returnTo=%2Fportfolio%2Fledger">{t("로그인", "Sign in")}</Link> : conflict || !data || error === "temporarily_unavailable" ? <button className={styles.secondary} type="button" onClick={() => void load(true)} disabled={loading}>{t("최신 정보 확인", "Review latest holdings")}</button> : null}</div> : null}
    {success ? <p role="status" className={styles.success}>{savedOpening ? t("잔액을 확인했어요. 선택한 거래를 이어서 기록하세요.", "Balances confirmed. Continue with your selected transaction.") : t("기록했어요. 홈에서 변경된 보유 정보를 확인할 수 있어요.", "Recorded. Your updated holdings are available on Home.")}</p> : null}
    {data?.canWrite && !account ? <><p className={styles.note}>{t("기록할 계좌를 먼저 선택해 주세요.", "Add an account to keep these records.")}</p><Link href="/portfolio/accounts">{t("계좌 추가 →", "Add an account →")}</Link></> : null}
    {data && !data.canWrite && !error ? <p role="status" className={styles.note}>{errorMessage("temporarily_unavailable")}</p> : null}
    {account && data?.canWrite ? <><form onSubmit={submit} className={styles.form} noValidate><fieldset className={styles.entryFields} disabled={busy || uncertain}>
      {compact && (initialSelection.accountId === account.id || !!initialSelection.assetId && initialSelection.assetId === fields.assetId) ? <p className={styles.selectedAccount}>{accountName(account)}{initialSelection.assetId ? ` · ${account.assets.find(row => row.id === fields.assetId)?.ticker ?? ""}` : ""}</p> : <label>{t("계좌", "Account")}<select value={account.id} onChange={event => { setAccountId(event.target.value); pending.current = null; setConfirmed(false); setConflict(false); setError(""); setSuccess(false); setFields({ currency: "USD", at: localNow(), assetType: "etf", inputMode: "total", ...(newInstrument ? { assetId: "new" } : {}) }); }}>{activeAccounts.map(row => <option key={row.id} value={row.id}>{accountName(row)}</option>)}</select></label>}
      {account.state ? <details open={compact ? undefined : true} className={styles.cashDetails}><summary>{t("계좌 현금 확인", "Account cash")}</summary><div className={styles.cash}>{(["KRW", "USD"] as const).map(value => <span key={value}>{t("현금", "Cash")} · {value}<strong>{formatMoney(Number(account.state!.cash[value]), value, locale === "en" ? "en-US" : "ko-KR")}</strong></span>)}</div></details> : <><p className={styles.note}>{t("현재 잔액을 한 번 확인하면 이후 입출금과 매매를 이어서 기록할 수 있어요.", "Confirm today’s balances once, then record deposits and trades as they happen.")}</p><div className={styles.grid}>{money("원화 현금 잔액", "KRW cash balance", "cashKrw", "KRW")}{money("달러 현금 잔액", "USD cash balance", "cashUsd", "USD")}</div><details><summary>{t("현재 보유종목 확인", "Review current holdings")}</summary><div className={styles.holdings}>{account.assets.filter(row => !row.archived).map(row => <div key={row.id}><span>{row.name ?? row.ticker ?? t("보유 종목", "Holding")}</span><span>{row.quantity} · {row.currency}</span></div>)}</div><p className={styles.note}>{t("매입원가는 나중에 보완할 수 있어요.", "Acquisition costs can be added later.")}</p></details><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); pending.current = null; }} />{t("현재 보유 수량과 현금 잔액을 확인했어요.", "I have checked the current quantities and cash balances.")}</label></>}
      {account.state ? <>{!compact ? <label>{t("어떤 기록인가요?", "What happened?")}<select value={kind} onChange={event => { setKind(event.target.value as EventKind); pending.current = null; setError(""); setSuccess(false); }}>{EVENTS.map(([value, ko, en]) => <option key={value} value={value}>{t(ko, en)}</option>)}</select></label> : null}
        {(!compact || (!initialSelection.assetId && !newInstrument)) && ["buy", "sell", "split", "cost_basis"].includes(kind) ? <label>{t("종목", "Holding")}<select value={fields.assetId ?? ""} onChange={event => edit("assetId", event.target.value)}><option value="">{t("선택하세요", "Choose a holding")}</option>{account.assets.filter(row => kind === "buy" || account.state!.positions.some(p => p.assetId === row.id && Decimal.from(p.quantity).compare(0) > 0 && (kind !== "cost_basis" || p.costLots === null))).map(row => <option key={row.id} value={row.id}>{row.name ?? row.ticker ?? t("보유 종목", "Holding")} · {row.currency}</option>)}{kind === "buy" ? <option value="new">{t("새 종목 추가", "Add a new instrument")}</option> : null}</select></label> : null}
        {kind === "buy" && fields.assetId === "new" ? <fieldset><legend>{t("새 종목", "New instrument")}</legend>
          <InstrumentSearch privateQuery disabled={busy} onSelect={choice => { pending.current = null; setFields(previous => ({ ...previous, name: choice.name, ticker: choice.ticker, currency: choice.currency, assetType: choice.assetType })); }} />
          {fields.ticker ? <p>{fields.name} · {fields.ticker}</p> : null}
          <details><summary>{t("직접 입력", "Enter manually")}</summary><div className={styles.grid}>{label("종목명", "Name", "name")}{label("티커", "Ticker", "ticker")}{currencySelect}<label>{t("종류", "Type")}<select value={fields.assetType ?? "etf"} onChange={event => edit("assetType", event.target.value)}><option value="etf">ETF</option><option value="stock">{t("개별 주식", "Stock")}</option></select></label></div></details>
        </fieldset> : null}
        {["deposit", "withdraw", "dividend", "fee", "transfer", "exchange"].includes(kind) ? <div className={styles.row}>{money(kind === "exchange" ? "환전할 금액" : "금액", kind === "exchange" ? "Amount to exchange" : "Amount", "amount", currency(fields.currency ?? "USD"))}{currencySelect}</div> : null}
        {kind === "dividend" || kind === "fee" ? <label>{t("해당 종목 · 선택", "Related holding · optional")}<select value={fields.assetId ?? ""} onChange={event => edit("assetId", event.target.value)}><option value="">{t("계좌 공통 / 아직 모름", "Account-wide / unknown")}</option>{account.assets.filter(row => account.state!.positions.some(p => p.assetId === row.id)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : null}
        {kind === "buy" || kind === "sell" ? <NativeTradeFields kind={kind} fields={fields} unit={unit} quantity={positionFor(account, fields.assetId)?.quantity ?? "0"} edit={edit} /> : null}
        {kind === "exchange" ? <>{money("실제로 받은 금액", "Amount actually received", "credit", fields.currency === "USD" ? "KRW" : "USD")}<details><summary>{t("환전 수수료", "Exchange fee")}</summary>{money("별도 차감 수수료", "Separately debited fee", "fee", currency(fields.currency ?? "USD"), false)}</details></> : null}
        {kind === "transfer" ? <label>{t("받는 내 계좌", "My receiving account")}<select value={fields.peerAccountId ?? ""} onChange={event => edit("peerAccountId", event.target.value)}><option value="">{t("계좌 선택", "Choose an account")}</option>{activeAccounts.filter(row => row.id !== account.id && row.state).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : null}
        {kind === "split" ? <><div className={styles.grid}>{label("변경 후 주식 수", "Shares after split", "ratioN")}{label("변경 전 주식 수", "Shares before split", "ratioD")}</div><p className={styles.note}>{t("예: 1주가 4주가 되었다면 4와 1을 입력하세요.", "For a four-for-one split, enter 4 and 1.")}</p></> : null}
        {kind === "cost_basis" ? <fieldset><legend>{t("현재 보유분의 매입원가", "Cost of the current holding")}</legend><p className={styles.note}>{t("현재 남아 있는 보유분에 해당하는 금액과 실제 매입 날짜를 입력하세요. 여러 날짜라면 나누어 추가하세요.", "Enter the cost attributable to your remaining holding and its actual acquisition date. Add separate dates when needed.")}</p><div className={styles.lots}>{lots.map((lot, index) => <div className={styles.lot} key={index}><div className={styles.row}><label>{t("매입원가", "Acquisition cost")}<MoneyInput value={lot.amount} allowDecimals={lot.currency === "USD"} onValueChange={value => { setLots(previous => previous.map((row, i) => i === index ? { ...row, amount: value } : row)); pending.current = null; }} /></label><label>{t("통화", "Currency")}<select value={lot.currency} onChange={event => { setLots(previous => previous.map((row, i) => i === index ? { ...row, currency: event.target.value as Currency } : row)); pending.current = null; }}><option>USD</option><option>KRW</option></select></label></div><label>{t("실제 매입 시각", "Acquired at")}<input type="datetime-local" step="0.001" value={lot.at} onChange={event => { setLots(previous => previous.map((row, i) => i === index ? { ...row, at: event.target.value } : row)); pending.current = null; }} /></label>{lots.length > 1 ? <button type="button" className={styles.secondary} onClick={() => { setLots(previous => previous.filter((_, i) => i !== index)); pending.current = null; }}>{t("제외", "Remove")}</button> : null}</div>)}</div><button type="button" className={styles.secondary} onClick={() => { setLots(previous => [...previous, { amount: "", currency: unit, at: "" }]); pending.current = null; }}>{t("다른 매입 날짜 추가", "Add another acquisition date")}</button></fieldset> : null}
      </> : null}
      {account.state && (kind === "buy" || kind === "sell") ? <label>{t("거래 시간", "Trade timing")}<select value={fields.timePrecision ?? "exact"} onChange={event => edit("timePrecision", event.target.value)}><option value="exact">{t("날짜와 시각", "Date and time")}</option><option value="date_only">{t("과거 거래일만 알아요 · 한국시간", "Past date only · Korea time")}</option></select></label> : null}
      {account.state && (kind === "buy" || kind === "sell") && fields.timePrecision === "date_only" ? <>{label("거래일 · 한국시간", "Trade date · Korea time", "tradeDate", "date")}<p className={styles.note}>{t("시각 미상으로 기록하며, 일별 수익률에는 하루 중간 시점으로 반영합니다.", "Saved as date-only. Daily returns use the middle of the service day.")}</p></> : label("기록 시각 · 기기 시간대", "Recorded at · Device time zone", "at", "datetime-local")}
      </fieldset>{uncertain ? <p className={styles.note}>{t("저장 결과를 확인하지 못했어요. 같은 내용으로 다시 확인해 주세요.", "The save result is uncertain. Retry this same record to confirm it.")}</p> : null}<div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy || loading || conflict || signedOut}>{busy ? t("기록 중…", "Saving…") : account.state ? kind === "buy" ? t("매수 기록 저장", "Save buy record") : kind === "sell" ? t("매도 기록 저장", "Save sell record") : t("기록하기", "Save record") : t("잔액 확인 후 계속", "Confirm balances and continue")}</button>{!compact ? <Link href={`/?currency=${fields.currency === "KRW" ? "KRW" : "USD"}`}>{t("나중에 하기", "Later")}</Link> : null}</div>
    </form></> : null}
  </section></div>;
}

function positionFor(account: Account, assetId: string) { return account.state?.positions.find(row => row.assetId === assetId); }
