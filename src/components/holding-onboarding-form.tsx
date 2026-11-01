"use client";

import "@/components/onboarding/holding-onboarding.css";

import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { NativeLedgerNotice } from "@/components/native-ledger-notice";
import { NATIVE_LEDGER_REQUIRED_MESSAGE } from "@/lib/native-ledger-compatibility";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, FileText, PencilLine, Plus, Trash2, X } from "lucide-react";
import { createHoldingBatch } from "@/app/portfolio/holdings/new/actions";
import { useI18n } from "@/components/i18n/locale-provider";
import { ManagementText } from "@/components/i18n/management-text";
import { InstrumentSearch, type InstrumentChoice } from "@/components/onboarding/instrument-search";
import { HoldingImportPanel, type TableHoldingDraft } from "@/components/onboarding/holding-import-panel";
import { BalancePhotoPanel, type BalanceReviewRow } from "@/components/onboarding/balance-photo-panel";
import motion from "@/components/onboarding/entry-motion.module.css";
import { QuickHoldingReference } from "@/components/first-visit/quick-holding-reference";
import { PlanHoldingReference } from "@/components/onboarding/plan-holding-reference";
import { trackFirstVisit } from "@/lib/first-visit-events";
import type { HoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { MAX_HOLDING_BATCH, validateHoldingDrafts, unresolvedHoldingKeys, type HoldingBatchState, type HoldingDraft } from "@/lib/holding-batch";
import { Button as CairnButton, IconButton, Field as CairnField, Fieldset as CairnFieldset, Form as CairnForm, Input as CairnInput, Radio as CairnRadio, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


const INITIAL_STATE: HoldingBatchState = { status: "idle", results: [] };
const identity = (row: Pick<HoldingDraft, "market" | "ticker">) => `${row.market}:${row.ticker.trim().toUpperCase()}`;
const positive = (value: string, precision: number) => /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value)) && (value.split(".")[1]?.length ?? 0) <= precision;
type EntryMethod = "photo" | "text" | "manual";

type HoldingFormProps = { options: HoldingOnboardingOptions; initialAccountId?: string; accountSelectionProvided?: boolean; nativeAccountIds?: readonly string[]; persistAccountContext?: boolean; preview?: boolean; fromPlan?: boolean; fromQuick?: boolean; action?: typeof createHoldingBatch; onComplete?: (accountId: string) => void };
export function HoldingOnboardingForm(props: HoldingFormProps) {
  const scope = `${props.options.draftOwnerKey ?? "preview"}:${props.initialAccountId ?? ""}`;
  const [selection, setSelection] = useState({ scope, account: props.initialAccountId ?? props.options.accounts[0]?.id ?? "" });
  const account = selection.scope === scope ? selection.account : props.initialAccountId ?? props.options.accounts[0]?.id ?? "";
  return <HoldingOnboardingWorkspace {...props} key={`${props.options.draftOwnerKey ?? "preview"}:${account}`} initialAccountId={account} onAccountChange={next => setSelection({ scope, account: next })} />;
}
export function HoldingOnboardingWorkspace({ options, initialAccountId, accountSelectionProvided = false, nativeAccountIds = [], persistAccountContext = true, preview = false, fromPlan = false, fromQuick = false, action: submitBatch = createHoldingBatch, onAccountChange, onComplete }: HoldingFormProps & { onAccountChange?: (account: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HoldingDraft[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [rowResults, setRowResults] = useState<HoldingBatchState["results"]>([]);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [draftLoaded, setDraftLoaded] = useState(!options.draftOwnerKey);
  const [draftUnavailable, setDraftUnavailable] = useState(false);
  const [resumedAccount, setResumedAccount] = useState<string | null>(null);
  const [accountId, setAccountId] = useState(initialAccountId ?? options.accounts[0]?.id ?? "");
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<InstrumentChoice | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [manualMarket, setManualMarket] = useState<"korea" | "us">("korea");
  const [manualType, setManualType] = useState<"etf" | "stock">("etf");
  const [manualTicker, setManualTicker] = useState("");
  const [manualName, setManualName] = useState("");
  const [error, setError] = useState<"duplicate" | "quantity" | "cost" | "limit" | "ticker" | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0), [method, setMethod] = useState<EntryMethod>("photo");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [photoDraft, setPhotoDraft] = useState<BalanceReviewRow[]>([]);
  const [tableDraft, setTableDraft] = useState<TableHoldingDraft>({ text: "", rows: [] });
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const needsFocus = useRef(false);
  function go(next: 0 | 1 | 2) {
    if (pending) return;
    if (next === step) { queueMicrotask(() => { stepHeading.current?.focus({ preventScroll: true }); stepHeading.current?.scrollIntoView({ block: "nearest" }); }); return; }
    setDirection(next < step ? "back" : "forward"); setStep(next); needsFocus.current = true;
  }
  useEffect(() => {
    if (!needsFocus.current) return;
    needsFocus.current = false;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView({ block: "nearest" });
  }, [step]);
  const draftKey = !preview && options.draftOwnerKey ? `cairn:holding-draft:v2:${options.draftOwnerKey}:${accountId}` : null;
  const hydratedKey = useRef<string | null>(null);
  function retainDraft(inFlight = uncertain, completed?: { saved: typeof saved; results: typeof rowResults }, submitted = hasSubmitted) {
    if (!draftKey) return true;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rows, hasSubmitted: submitted, saved: completed?.saved ?? saved, accountId, groupId, groupName, results: completed?.results ?? rowResults, uncertain: inFlight, workspace: { step, method, searchQuery, selected, quantity, cost, manualMarket, manualType, manualTicker, manualName, photoDraft, tableDraft } })); return true; }
    catch { setDraftUnavailable(true); return false; }
  }
  const [state, action, pending] = useActionState(async (previous: HoldingBatchState, data: FormData) => {
    setHasSubmitted(true);
    const allRows: HoldingDraft[] = JSON.parse(String(data.get("holdings")));
    const submitted = data.get("retryKey") ? allRows.filter(row => row.key === data.get("retryKey")) : allRows;
    data.set("holdings", JSON.stringify(submitted));
    const invalid = validateHoldingDrafts(submitted, data);
    if (invalid.length) {
      setRowResults(current => [...current.filter(item => !invalid.some(row => row.key === item.key)), ...invalid]);
      return { status: "invalid", attemptedKeys: [], results: invalid } as HoldingBatchState;
    }
    // Persist the immutable submission before any request can reach the server.
    if (!retainDraft([...new Set([...uncertain, ...submitted.map(row => row.key)])], undefined, true)) return previous;
    setUncertain([...new Set([...uncertain, ...submitted.map(row => row.key)])]);
    let result: HoldingBatchState;
    try { result = await submitBatch(previous, data); }
    catch { result = { status: "partial", results: submitted.map(row => ({ key: row.key, result: { status: "error", message: "저장 응답을 받지 못했어요. 같은 목록으로 다시 확인하면 중복 저장하지 않습니다." } })) }; }
    const nextUncertain = [...uncertain.filter(key => !submitted.some(row => row.key === key)), ...unresolvedHoldingKeys(submitted, result)];
    setUncertain(nextUncertain);
    setRowResults(current => [...current.filter(item => !result.results.some(next => next.key === item.key)), ...result.results]);
    if (!preview) for (const item of result.results) {
      if (item.result.status === "success" && item.result.firstHoldingCreated === true && item.result.assetId) {
        trackFirstVisit("first_holding_created", item.result.assetId);
      }
    }
    const nextSaved = { ...saved };
    for (const item of result.results) if (item.result.status === "success") {
      const row = submitted.find(candidate => candidate.key === item.key);
      if (row) nextSaved[item.key] = identity(row);
    }
    setSaved(nextSaved);
    retainDraft(nextUncertain, { saved: nextSaved, results: [...rowResults.filter(item => !result.results.some(next => next.key === item.key)), ...result.results] }, true);
    if (rows.length > 0 && rows.every(row => nextSaved[row.key])) onComplete?.(accountId);
    return result;
  }, INITIAL_STATE);
  const awaitingPrice = rowResults.some(item => !saved[item.key] && item.result.status === "price_unavailable");
  useEffect(() => {
    if (hydratedKey.current === draftKey && draftKey !== null) return;
    let current = true;
    // Read browser-owned storage after hydration, never during the server render.
    queueMicrotask(() => {
    if (!current) return;
    hydratedKey.current = draftKey;
    if (draftKey) try {
      const text = sessionStorage.getItem(draftKey) ?? sessionStorage.getItem(`cairn:holding-draft:v1:${options.draftOwnerKey}`);
      const draft = text ? JSON.parse(text) : null;
      if (draft && Number.isFinite(draft.at) && draft.accountId === accountId && options.accounts.some(account => account.id === draft.accountId) && Array.isArray(draft.rows) && draft.rows.every((row: HoldingDraft) => typeof row.key === "string" && typeof row.ticker === "string" && typeof row.quantity === "string")) {
        setRows(draft.rows); setSaved(draft.saved ?? {});
        setGroupId(draft.groupId ?? ""); setGroupName(draft.groupName ?? "");
        setRowResults(draft.results ?? []); setUncertain(draft.uncertain ?? []);
        setHasSubmitted(draft.hasSubmitted === true || Object.keys(draft.saved ?? {}).length > 0 || (draft.results?.length ?? 0) > 0 || (draft.uncertain?.length ?? 0) > 0);
        const workspace = draft.workspace;
        setStep(workspace && [0, 1, 2].includes(workspace.step) ? workspace.step : draft.rows.length ? 2 : 0);
        if (workspace) {
          if (["photo", "text", "manual"].includes(workspace.method)) setMethod(workspace.method);
          if (workspace.selected && typeof workspace.selected.name === "string" && typeof workspace.selected.ticker === "string") setSelected(workspace.selected);
          for (const [key, setter] of [["searchQuery", setSearchQuery], ["quantity", setQuantity], ["cost", setCost], ["manualTicker", setManualTicker], ["manualName", setManualName]] as const) if (typeof workspace[key] === "string") setter(workspace[key]);
          if (["korea", "us"].includes(workspace.manualMarket)) setManualMarket(workspace.manualMarket);
          if (["stock", "etf"].includes(workspace.manualType)) setManualType(workspace.manualType);
          if (Array.isArray(workspace.photoDraft) && workspace.photoDraft.length <= 24 && workspace.photoDraft.every((row: BalanceReviewRow) => typeof row.key === "string" && typeof row.label === "string" && typeof row.quantity === "string")) setPhotoDraft(workspace.photoDraft);
          if (typeof workspace.tableDraft?.text === "string" && workspace.tableDraft.text.length <= 64_000 && Array.isArray(workspace.tableDraft.rows) && workspace.tableDraft.rows.every((row: TableHoldingDraft["rows"][number]) => typeof row.label === "string" && typeof row.quantity === "string")) setTableDraft(workspace.tableDraft);
        }
      }
    } catch { setDraftUnavailable(true); }
    setDraftLoaded(true);
    });
    return () => { current = false; };
  }, [draftKey, options.accounts, options.draftOwnerKey, accountId]);
  useEffect(() => {
    if (!draftLoaded || !draftKey) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rows, hasSubmitted, saved, accountId, groupId, groupName, results: rowResults, uncertain, workspace: { step, method, searchQuery, selected, quantity, cost, manualMarket, manualType, manualTicker, manualName, photoDraft, tableDraft } })); }
    catch { queueMicrotask(() => setDraftUnavailable(true)); }
  }, [draftLoaded, draftKey, rows, saved, accountId, groupId, groupName, rowResults, uncertain, hasSubmitted, step, method, searchQuery, selected, quantity, cost, manualMarket, manualType, manualTicker, manualName, photoDraft, tableDraft]);
  const unsaved = rows.filter(row => !saved[row.key]);
  const hasSaved = Object.keys(saved).length > 0;
  const allSaved = rows.length > 0 && hasSaved && unsaved.length === 0;
  const finalReview = step === 2 && !(method === "photo" && photoDraft.length > 0 || method === "text" && tableDraft.rows.length > 0);
  const errorText = error === "duplicate" ? t("이 종목은 이미 목록에 있거나 저장되었습니다. 목록의 수량을 확인해 주세요.", "This holding is already queued or saved. Check its quantity in the list.")
    : error === "quantity" ? t("수량을 0보다 크게 입력해 주세요. 소수점 6자리까지 가능합니다.", "Enter a quantity above zero, with up to six decimal places.")
    : error === "cost" ? t("평균 매입가는 0보다 크게, 소수점 4자리까지 입력해 주세요.", "Enter an average cost above zero, with up to four decimal places.")
    : error === "limit" ? t("한 번에 12종목까지 가능합니다. 먼저 목록을 저장해 주세요.", "Add up to 12 holdings at a time. Save this list first.")
    : error === "ticker" ? t("티커를 확인해 주세요. 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.", "Check the ticker. Use letters, numbers, dots, underscores or hyphens.") : null;

  function selectAccount(next: string) {
    if (!retainDraft()) return;
    onAccountChange?.(next);
    setAccountId(next);
    // Embedded readers own their route scope; keep their form selection local.
    // Standalone pages persist account context without remounting queued inputs.
    if (!persistAccountContext || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("accountId", next);
    url.searchParams.set("scope", `account:${next}`);
    window.history.replaceState(null, "", url);
  }
  function addDrafts(drafts: HoldingDraft[], review = true) {
    if (unsaved.length + drafts.length > MAX_HOLDING_BATCH) { setError("limit"); return false; }
    const seen = new Set([...rows.map(identity), ...Object.values(saved)]);
    for (const draft of drafts) {
      if (seen.has(identity(draft))) { setError("duplicate"); return false; }
      seen.add(identity(draft));
    }
    setRows(previous => [...previous, ...drafts]); setError(null); if (review) go(2); return true;
  }
  function addHolding() {
    if (!selected) return;
    if (!positive(quantity, 6)) { setError("quantity"); return; }
    if (cost && !positive(cost, 4)) { setError("cost"); return; }
    if (addDrafts([{ key: crypto.randomUUID(), instrumentId: selected.id, name: selected.name, ticker: selected.ticker, market: selected.market, assetType: selected.assetType, quantity, averageCost: cost, currentPrice: "" }], false)) {
      setSelected(null); setQuantity(""); setCost(""); setManualTicker(""); setManualName(""); setSearchQuery("");
    }
  }
  function editRow(key: string, field: "quantity" | "averageCost" | "currentPrice", value: string) {
    if (uncertain.includes(key)) return;
    setRows(previous => previous.map(row => row.key === key ? { ...row, [field]: value } : row));
    setRowResults(previous => previous.filter(row => row.key !== key));
  }

  const completion = hasSaved ? <CairnStatus as="div" tone="success" className={`varda-onboarding-success ${motion.success}`} role="status"><Check size={20} /><strong>{t(`${Object.keys(saved).length}종목이 포트폴리오에 담겼어요.`, `${Object.keys(saved).length} holdings added to your portfolio.`)}</strong><Link href={`/portfolio/first-look?${new URLSearchParams({scope: `account:${accountId}`})}`}>{t("내 포트폴리오 첫 화면 보기", "See your portfolio")}<ArrowRight size={16} /></Link>{hasSaved ? <CairnButton variant="secondary" type="button" className="varda-onboarding-text-button" onClick={() => { setRows(previous => previous.filter(row => !saved[row.key])); if (unsaved.length === 0 && uncertain.length === 0) { setSaved({}); setRowResults([]); setHasSubmitted(false); setResumedAccount(null); go(0); } }} disabled={pending}>{t("저장된 목록 접고 더 추가하기", "Clear saved rows and add more")}<Plus size={16} /></CairnButton> : null}</CairnStatus> : null;

  if (nativeAccountIds.includes(accountId)) return <div className="varda-holding-onboarding">
    <CairnField>{t("담을 계좌", "Add to account")}<CairnSelect className="cairn-form-select" value={accountId} onChange={event => selectAccount(event.target.value)} aria-label={t("보유 계좌", "Holding account")}>{options.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</CairnSelect></CairnField>
    <NativeLedgerNotice accountId={accountId} action="buy" />
  </div>;
  // Action completion requests a native reset; retain React-managed account and retry selections.
  return <CairnForm action={preview ? undefined : action} className="varda-holding-onboarding" noValidate data-entry-step={step} onReset={event => event.preventDefault()} onSubmit={event => { if (preview || !finalReview || unsaved.length === 0) event.preventDefault(); }}>
    <input type="hidden" name="holdings" value={JSON.stringify(unsaved)} />
    <input type="hidden" name="accountId" value={accountId} />
    <input type="hidden" name="portfolioGroupId" value={groupId} />
    <input type="hidden" name="newPortfolioGroupName" value={groupId ? "" : groupName} />
    <header className="varda-entry-heading">
      <div className="varda-entry-progress" aria-label={t(`${step + 1}/3 단계`, `Step ${step + 1} of 3`)}>{[t("방법 선택", "Method"), t("자료 입력", "Details"), t("확인·등록", "Review")].map((label, index) => <span key={index} aria-current={step === index ? "step" : undefined}><i aria-hidden="true" />{label}</span>)}</div>
      <h2 ref={stepHeading} tabIndex={-1}>{step === 2 && allSaved ? t("보유종목을 등록했어요", "Your holdings are ready") : step === 0 ? t("보유 종목을 어떻게 가져올까요?", "How would you like to add your holdings?") : step === 2 ? t("내 보유 내역이 맞나요?", "Do these holdings look right?") : method === "photo" ? t("잔고가 보이는 캡처를 골라주세요", "Choose a screenshot of your holdings") : method === "text" ? t("종목과 수량을 붙여넣어 주세요", "Paste your holdings and quantities") : t("종목을 고르고 수량을 알려주세요", "Choose a holding and enter its quantity")}</h2>
      <p>{step === 2 ? t("현재 보유잔고를 등록해요. 새 매매는 거래 기록에서 입력해 주세요.", "Register your current holdings. Record new buys and sells separately.") : t("매입가를 몰라도 시작할 수 있어요.", "You can start without your purchase prices.")}</p>
    </header>
    {resumedAccount ? <p className="varda-onboarding-hint">{t(`${resumedAccount}의 저장 중인 목록을 이어서 확인해 주세요.`, `Resume the pending list for ${resumedAccount}.`)}</p> : null}
    <div className="varda-onboarding-account-line" hidden={accountSelectionProvided && Boolean(accountId)}><CairnField>{t("담을 계좌", "Add to account")}<CairnSelect className="cairn-form-select" value={accountId} onChange={event => selectAccount(event.target.value)} disabled={pending || hasSaved || uncertain.length > 0} aria-label={t("보유 계좌", "Holding account")}>{!accountId ? <option value="">{t("보유 계좌를 선택해 주세요.", "Choose a holding account.")}</option> : null}{options.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</CairnSelect></CairnField></div>
    <section hidden={step !== 0} className={motion.stage} data-direction={direction} aria-label={t("등록 방법", "Entry method")}>
      <CairnFieldset className="varda-entry-methods"><legend className="sr-only">{t("등록 방법 선택", "Choose an entry method")}</legend>{([
        ["photo", Camera, t("캡처로 가져오기", "From a screenshot"), t("증권 앱의 잔고 화면", "Your brokerage holdings screen")],
        ["text", FileText, t("텍스트·표 붙여넣기", "Paste text or a table"), t("종목명과 보유 수량", "Holding names and quantities")],
        ["manual", PencilLine, t("직접 입력하기", "Enter manually"), t("한 종목씩 검색해서 추가", "Search and add each holding")],
      ] as const).map(([value, Icon, title, description]) => <CairnField key={value} data-selected={method === value}><CairnRadio name="entryMethod" value={value} checked={method === value} onChange={() => setMethod(value)} /><Icon size={24} aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span>{method === value ? <Check size={20} aria-hidden="true" /> : null}</CairnField>)}</CairnFieldset>
      <div className="varda-entry-footer"><CairnButton variant="primary" type="button" className="varda-onboarding-primary" disabled={!draftLoaded} onClick={() => go(1)}>{t("자료 입력하기", "Provide details")}<ArrowRight size={18} /></CairnButton>{rows.length > 0 && <CairnButton variant="ghost" type="button" onClick={() => { setMethod("manual"); go(2); }}>{t(`담아둔 ${rows.length}종목 확인`, `Review ${rows.length} queued holdings`)}</CairnButton>}</div>
    </section>
    <div hidden={step === 0 || method !== "photo"} className={motion.stage} data-direction={direction} data-step={step}>{draftLoaded && <BalancePhotoPanel onProvide={() => go(1)} guided stage={step === 2 ? "review" : "provide"} onReview={() => go(2)} initialRows={photoDraft} onDraftChange={setPhotoDraft} onAdd={addDrafts} remaining={MAX_HOLDING_BATCH - unsaved.length} disabled={pending || step === 0 || method !== "photo"} preview={preview} />}</div>
<div hidden={step === 0 || method !== "text"} className={motion.stage} data-direction={direction} data-step={step}>{draftLoaded && <HoldingImportPanel guided stage={step === 2 ? "review" : "provide"} onReview={() => go(2)} initialDraft={tableDraft} onDraftChange={setTableDraft} onAdd={addDrafts} remaining={MAX_HOLDING_BATCH - unsaved.length} disabled={pending || step === 0 || method !== "text"} preview={preview} />}</div>
    <div className="varda-onboarding-workspace">
      <section hidden={step !== 1} className={`varda-onboarding-compose ${motion.stage}`} data-direction={direction} aria-label={t("보유 자료 입력", "Holding details")} onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>

        <div hidden={method !== "manual"}>
        {fromPlan ? <PlanHoldingReference disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSearch={name => { setSelected(null); setQuantity(""); setCost(""); setError(null); setSearchQuery(name); }} /> : null}
        {fromQuick ? <QuickHoldingReference disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSearch={name => { setSelected(null); setQuantity(""); setCost(""); setError(null); setSearchQuery(name); }} /> : null}
        <InstrumentSearch queryValue={searchQuery} onQueryChange={setSearchQuery} privateQuery={fromPlan || fromQuick} preview={preview} disabled={pending || step !== 1 || method !== "manual" || unsaved.length >= MAX_HOLDING_BATCH} onSelect={instrument => { setSelected(instrument); setQuantity(""); setCost(""); setError(null); }} />
        {selected ? <div className="varda-onboarding-selected">
          <div className="varda-onboarding-selected-title"><div><strong>{selected.name}</strong><span>{selected.ticker} · {selected.market === "korea" ? "KR" : "US"} · {selected.currency}</span></div><IconButton disabled={pending} onClick={() => setSelected(null)} label={t("종목 선택 취소", "Clear selected holding")}><X size={18} /></IconButton></div>
          <CairnField className="varda-onboarding-quantity">{t("몇 주 가지고 있나요?", "How many shares do you hold?")}<CairnInput value={quantity} onChange={event => { setQuantity(event.target.value); setError(null); }} type="number" inputMode="decimal" min="0.000001" step="0.000001" placeholder="0" disabled={pending} autoComplete="off" /></CairnField>
          <details className="varda-onboarding-disclosure"><summary>{t("평균 매입가도 알고 있어요", "I know my average purchase price")}</summary><CairnField>{t("1주 평균 매입가", "Average cost per share")} · {selected.currency}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={cost} onChange={event => setCost(event.target.value)} disabled={pending} /></CairnField><p>{t("비워 두면 매입가를 입력할 때까지 수익률을 표시하지 않아요.", "Optional. If left blank, returns remain unavailable until you enter a cost.")}</p></details>
          {!cost && <p className="varda-onboarding-hint">{t("매입가 없이 평가액은 볼 수 있어요. 손익·수익률은 나중에 계산해요.", "You can see the holding value. Profit and return need a purchase cost.")}</p>}
          <CairnButton variant="secondary" type="button" className="varda-onboarding-secondary" onClick={addHolding} disabled={pending}><Plus size={17} />{t("목록에 추가", "Add to list")}</CairnButton>
        </div> : <div className="varda-onboarding-start-note"><span>↗</span><p>{t("종목을 선택하고 수량을 입력해 주세요.", "Find your holding, then enter its quantity.")}<small>{t("매입가는 나중에 추가해도 괜찮아요.", "You can add your purchase price later.")}</small></p></div>}
        {errorText ? <CairnStatus as="p" tone="danger" role="alert" className="varda-onboarding-error">{errorText}</CairnStatus> : null}
        <details className="varda-onboarding-disclosure"><summary>{t("검색되지 않는 종목 직접 입력", "Enter an unlisted ticker manually")}</summary>
          <p>{t("상장 시장과 티커를 확인해 주세요.", "Check the listing market and ticker.")}</p>
          <div className="varda-onboarding-fields"><CairnField>{t("상장 시장", "Market")}<CairnSelect className="cairn-form-select" aria-label={t("상장 시장", "Market")} value={manualMarket} disabled={pending} onChange={event => setManualMarket(event.target.value as "korea" | "us")}><option value="korea">{t("한국 · KRW", "Korea · KRW")}</option><option value="us">{t("미국 · USD", "US · USD")}</option></CairnSelect></CairnField><CairnField>{t("유형", "Type")}<CairnSelect className="cairn-form-select" aria-label={t("유형", "Type")} value={manualType} disabled={pending} onChange={event => setManualType(event.target.value as "etf" | "stock")}><option value="etf">ETF</option><option value="stock">{t("주식", "Stock")}</option></CairnSelect></CairnField><CairnField>{t("티커", "Ticker")}<CairnInput value={manualTicker} onChange={event => setManualTicker(event.target.value.toUpperCase())} disabled={pending} maxLength={50} autoCapitalize="characters" autoComplete="off" placeholder={manualMarket === "korea" ? "069500" : "AAPL"} /></CairnField><CairnField>{t("이름 (선택)", "Name (optional)")}<CairnInput value={manualName} onChange={event => setManualName(event.target.value)} disabled={pending} maxLength={255} /></CairnField></div>
          <CairnButton variant="secondary" type="button" className="varda-onboarding-text-button" disabled={pending} onClick={() => {
            const ticker = manualTicker.trim().toUpperCase();
            if (!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(ticker)) { setError("ticker"); return; }
            setSelected({ id: "", name: manualName.trim() || ticker, ticker, market: manualMarket, currency: manualMarket === "korea" ? "KRW" : "USD", assetType: manualType }); setQuantity(""); setCost(""); setError(null);
          }}>{t("이 종목의 수량 입력", "Enter quantity for this ticker")}<ArrowRight size={16} /></CairnButton>
        </details>
        </div>

        <div className="varda-entry-footer">{rows.length > 0 && <CairnButton variant="primary" type="button" className="varda-onboarding-primary" onClick={() => go(2)} disabled={pending}>{t(`${rows.length}종목 확인하기`, `Review ${rows.length} holdings`)}<ArrowRight size={18} /></CairnButton>}<CairnButton variant="ghost" type="button" onClick={() => go(0)} disabled={pending}><ArrowLeft size={17} />{t("방법 바꾸기", "Change method")}</CairnButton></div>
      </section>
      <section hidden={!finalReview} className={`varda-onboarding-review ${motion.stage}`} data-direction={direction} aria-labelledby="holding-review-heading">
        {allSaved && completion}
        <div hidden={allSaved} className="varda-onboarding-review-title"><p className="varda-onboarding-eyebrow" id="holding-review-heading">{t("저장할 종목", "Ready to save")}</p><span>{unsaved.length} / {MAX_HOLDING_BATCH}</span></div>
        <details className="varda-saved-holdings" open={!allSaved}><summary hidden={!allSaved}>{t(`등록한 ${rows.length}종목 보기`, `View ${rows.length} saved holdings`)}</summary>
        {rows.length === 0 ? <div className="varda-onboarding-empty"><span>0</span><p>{t("한 종목부터 시작해 보세요.", "Start with a single holding.")}<small>{t("여러 종목을 담아 한 번에 저장할 수 있어요.", "Or add several and save them together.")}</small></p></div> : <ol className="varda-onboarding-queue">{rows.map((row, index) => {
          const isSaved = Boolean(saved[row.key]);
          const result = rowResults.find(item => item.key === row.key)?.result;
          const locked = pending || isSaved || uncertain.includes(row.key);
          return <li key={row.key} data-saved={isSaved}>
            <div className="varda-onboarding-row-heading"><span className="varda-onboarding-row-number">{isSaved ? <Check size={16} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{row.name || row.ticker}</strong><small>{row.ticker} · {row.market === "korea" ? "KRW" : "USD"}{isSaved ? ` · ${t("저장 완료", "Saved")}` : ""}</small></div>{!isSaved ? <IconButton disabled={locked} label={t(`${row.name} 목록에서 제거`, `Remove ${row.name} from list`)} onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}><Trash2 size={18} /></IconButton> : null}</div>
            <CairnField className="varda-onboarding-row-quantity">{t("보유 수량", "Quantity")}<CairnInput type="number" inputMode="decimal" min="0.000001" step="0.000001" value={row.quantity} required disabled={locked} onChange={event => editRow(row.key, "quantity", event.target.value)} aria-label={t(`${row.name} 보유 수량`, `${row.name} quantity`)} /></CairnField>
            {!isSaved ? <details className="varda-onboarding-disclosure"><summary>{t("매입가·가격 확인", "Cost & price lookup")}</summary><div className="varda-onboarding-fields"><CairnField>{t("평균 매입가 (선택)", "Average cost (optional)")}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.averageCost} disabled={locked} onChange={event => editRow(row.key, "averageCost", event.target.value)} /></CairnField><CairnField>{t("현재 1주 가격 · 자동 조회가 안 될 때", "Current price if lookup is unavailable")}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.currentPrice} disabled={locked} onChange={event => editRow(row.key, "currentPrice", event.target.value)} /></CairnField></div><p>{t("저장하려면 자동 조회 가격 또는 직접 입력한 현재가가 필요해요. 매입가는 비워도 됩니다.", "We look up the current price. If unavailable, you can enter it here.")}</p></details> : null}
            {!isSaved ? <span className="varda-onboarding-hint">{uncertain.includes(row.key) ? t("저장 확인 필요", "Confirm save") : result?.status === "price_unavailable" ? result.retryAfterSeconds ? t("시세 조회 대기", "Price lookup pending") : t("가격 입력 필요", "Price required") : result && result.status !== "success" ? t("저장 실패 · 다시 확인", "Save failed · review") : t("저장 대기", "Ready to save")}</span> : null}
            {!isSaved && (hasSubmitted || uncertain.includes(row.key)) && <CairnButton variant="secondary" type="submit" name="retryKey" value={row.key} disabled={pending || preview || !draftLoaded}>{uncertain.includes(row.key) ? t("저장 여부 확인·재시도", "Check save & retry") : t("이 종목 다시 저장", "Retry this holding")}</CairnButton>}
            {result?.conflictReason && <Link href={`${typeof window !== "undefined" && window.location.pathname.startsWith("/beta") ? "/beta/portfolio/holdings/manage" : "/portfolio/holdings"}?scope=account:${accountId}`}>{t("기존 보유 기록 확인", "Review existing holding")}</Link>}
            {result && !isSaved && result.message ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-error"><ManagementText>{result.message}</ManagementText></CairnStatus> : null}
          </li>;
        })}</ol>}</details>
        <details hidden={allSaved} className="varda-onboarding-disclosure"><summary>{t("분석 그룹 설정 (선택)", "Analysis group (optional)")}</summary><p>{t("비워 두면 기본 그룹으로 정리됩니다. 나중에 관리 화면에서 바꿀 수 있어요.", "Leave blank to use a default group. You can change it later in Manage.")}</p><CairnField>{t("기존 그룹", "Existing group")}<CairnSelect className="cairn-form-select" value={groupId} disabled={pending || hasSaved || uncertain.length > 0} onChange={event => setGroupId(event.target.value)}><option value="">{t("기본 그룹 사용", "Use default group")}</option>{options.portfolioGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</CairnSelect></CairnField>{!groupId ? <CairnField>{t("새 그룹 이름 (선택)", "New group name (optional)")}<CairnInput maxLength={100} value={groupName} disabled={pending || hasSaved || uncertain.length > 0} onChange={event => setGroupName(event.target.value)} /></CairnField> : null}</details>
        {unsaved.some(row => !row.averageCost) && <p className="varda-onboarding-hint">{t("매입가가 없는 종목은 평가액만 표시해요. 손익·수익률은 원가를 입력한 뒤 확인할 수 있어요.", "Holdings without purchase costs show their value only. Add costs later to see profit and return.")}</p>}
        <div className="varda-onboarding-save varda-entry-footer">
          {state.results.some(item => item.result.message === NATIVE_LEDGER_REQUIRED_MESSAGE) ? <NativeLedgerNotice accountId={accountId} action="buy" /> : null}
          {state.status === "invalid" && state.results.length === 0 ? <CairnStatus as="p" tone="danger" role="alert" className="varda-onboarding-error">{t("입력한 목록을 확인한 뒤 다시 저장해 주세요.", "Check the holding list and try saving again.")}</CairnStatus> : null}
          {state.status === "partial" && rowResults.length > 0 && unsaved.length > 0 ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-hint">{hasSaved
            ? t("저장된 종목은 유지됩니다. 나머지만 확인한 뒤 다시 저장하세요.", "Saved holdings are kept. Review and retry only the remaining holdings.")
            : awaitingPrice
              ? t("아직 저장된 종목이 없습니다. 가격 확인 후 다시 저장하거나 현재가를 직접 입력해 주세요.", "No holdings have been saved yet. Save again after prices are available, or enter current prices yourself.")
              : t("아직 저장된 종목이 없습니다. 각 종목의 안내를 확인한 뒤 다시 저장해 주세요.", "No holdings have been saved yet. Check each holding's message before trying again.")}</CairnStatus> : null}
          {draftUnavailable ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-hint">{t("이 브라우저에서 목록을 보관할 수 없어요. 사이트 저장 권한을 확인한 뒤 다시 저장해 주세요.", "This browser cannot retain the retry list. Check site storage permissions, then retry.")}</CairnStatus> : null}
          {unsaved.length > 0 && <CairnButton variant="primary" type="submit" className="varda-onboarding-primary" disabled={preview || !finalReview || !draftLoaded || pending || unsaved.length === 0 || !accountId}>{pending ? t("종목을 확인하며 저장 중…", "Checking and saving holdings…") : t(`${unsaved.length}종목 저장`, `Save ${unsaved.length} holding${unsaved.length === 1 ? "" : "s"}`)}<ArrowRight size={18} /></CairnButton>}
          {!allSaved && <CairnButton variant="ghost" type="button" disabled={pending} onClick={() => go(0)}><ArrowLeft size={17} />{t("종목 더 추가하기", "Add more holdings")}</CairnButton>}
          <p className="varda-onboarding-hint">{preview ? t("예시 화면입니다. 편집은 가능하지만 저장하지 않습니다.", "Demo view. You can edit the list, but saving is disabled.") : t("실제 주문 없이 보유 내역만 기록해요.", "Records your holdings. No orders are placed.")}</p>
          {!allSaved && completion}
        </div>
      </section>
    </div>
    {step === 2 && (method === "photo" && photoDraft.length > 0 || method === "text" && tableDraft.rows.length > 0) && <CairnButton variant="ghost" type="button" onClick={() => go(1)}><ArrowLeft size={17} />{t("자료 입력으로", "Back to details")}</CairnButton>}
  </CairnForm>;
}
