"use client";

import "@/components/onboarding/holding-onboarding.css";

import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { NativeLedgerNotice } from "@/components/native-ledger-notice";
import { NATIVE_LEDGER_REQUIRED_MESSAGE } from "@/lib/native-ledger-compatibility";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Plus, Trash2, X } from "lucide-react";
import { createHoldingBatch } from "@/app/portfolio/holdings/new/actions";
import { useI18n } from "@/components/i18n/locale-provider";
import { ManagementText } from "@/components/i18n/management-text";
import { InstrumentSearch, type InstrumentChoice } from "@/components/onboarding/instrument-search";
import { HoldingImportPanel } from "@/components/onboarding/holding-import-panel";
import { BalancePhotoPanel } from "@/components/onboarding/balance-photo-panel";
import { QuickHoldingReference } from "@/components/first-visit/quick-holding-reference";
import { PlanHoldingReference } from "@/components/onboarding/plan-holding-reference";
import { trackFirstVisit } from "@/lib/first-visit-events";
import type { HoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { MAX_HOLDING_BATCH, type HoldingBatchState, type HoldingDraft } from "@/lib/holding-batch";
import { Button as CairnButton, IconButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


const INITIAL_STATE: HoldingBatchState = { status: "idle", results: [] };
const identity = (row: Pick<HoldingDraft, "market" | "ticker">) => `${row.market}:${row.ticker.trim().toUpperCase()}`;
const positive = (value: string, precision: number) => /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value)) && (value.split(".")[1]?.length ?? 0) <= precision;

export function HoldingOnboardingForm({ options, initialAccountId, nativeAccountIds = [], persistAccountContext = true, preview = false, fromPlan = false, fromQuick = false, action: submitBatch = createHoldingBatch }: { options: HoldingOnboardingOptions; initialAccountId?: string; nativeAccountIds?: readonly string[]; persistAccountContext?: boolean; preview?: boolean; fromPlan?: boolean; fromQuick?: boolean; action?: typeof createHoldingBatch }) {
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
  const [planSearch, setPlanSearch] = useState({ name: "", revision: 0 });
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [manualMarket, setManualMarket] = useState<"korea" | "us">("korea");
  const [manualType, setManualType] = useState<"etf" | "stock">("etf");
  const [manualTicker, setManualTicker] = useState("");
  const [manualName, setManualName] = useState("");
  const [error, setError] = useState<"duplicate" | "quantity" | "cost" | "limit" | "ticker" | null>(null);
  const draftKey = !preview && options.draftOwnerKey ? `cairn:holding-draft:v1:${options.draftOwnerKey}` : null;
  const hydratedKey = useRef<string | null>(null);
  function retainDraft(inFlight = uncertain) {
    if (!draftKey) return true;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rows, saved, accountId, groupId, groupName, results: rowResults, uncertain: inFlight })); return true; }
    catch { setDraftUnavailable(true); return false; }
  }
  const [state, action, pending] = useActionState(async (previous: HoldingBatchState, data: FormData) => {
    const submitted: HoldingDraft[] = JSON.parse(String(data.get("holdings")));
    // Persist the immutable submission before any request can reach the server.
    if (!retainDraft(submitted.map(row => row.key))) return previous;
    setUncertain(submitted.map(row => row.key));
    let result: HoldingBatchState;
    try { result = await submitBatch(previous, data); }
    catch { result = { status: "partial", results: submitted.map(row => ({ key: row.key, result: { status: "error", message: "저장 응답을 받지 못했어요. 같은 목록으로 다시 확인하면 중복 저장하지 않습니다." } })) }; }
    setUncertain(submitted.filter(row => !result.results.some(item => item.key === row.key && item.result.status !== "error")).map(row => row.key));
    setRowResults(current => [...current.filter(item => !result.results.some(next => next.key === item.key)), ...result.results]);
    if (!preview) for (const item of result.results) {
      if (item.result.status === "success" && item.result.firstHoldingCreated === true && item.result.assetId) {
        trackFirstVisit("first_holding_created", item.result.assetId);
      }
    }
    setSaved(previousSaved => {
      const next = { ...previousSaved };
      for (const item of result.results) if (item.result.status === "success") {
        const row = submitted.find(candidate => candidate.key === item.key);
        if (row) next[item.key] = identity(row);
      }
      return next;
    });
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
      const text = sessionStorage.getItem(draftKey);
      const draft = text ? JSON.parse(text) : null;
      if (draft && Number.isFinite(draft.at) && options.accounts.some(account => account.id === draft.accountId) && Array.isArray(draft.rows) && draft.rows.every((row: HoldingDraft) => typeof row.key === "string" && typeof row.ticker === "string" && typeof row.quantity === "string")) {
        const unfinished = draft.rows.some((row: HoldingDraft) => !draft.saved?.[row.key]) || draft.uncertain?.length > 0;
        // A finished batch must not override an explicit new-account entry.
        if (initialAccountId && initialAccountId !== draft.accountId && !unfinished) { setDraftLoaded(true); return; }
        setRows(draft.rows); setSaved(draft.saved ?? {}); setAccountId(draft.accountId);
        if (initialAccountId && initialAccountId !== draft.accountId) setResumedAccount(options.accounts.find(account => account.id === draft.accountId)?.name ?? null);
        setGroupId(draft.groupId ?? ""); setGroupName(draft.groupName ?? "");
        setRowResults(draft.results ?? []); setUncertain(draft.uncertain ?? []);
      }
    } catch { setDraftUnavailable(true); }
    setDraftLoaded(true);
    });
    return () => { current = false; };
  }, [draftKey, options.accounts, initialAccountId]);
  useEffect(() => {
    if (!draftLoaded || !draftKey) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rows, saved, accountId, groupId, groupName, results: rowResults, uncertain })); }
    catch { queueMicrotask(() => setDraftUnavailable(true)); }
  }, [draftLoaded, draftKey, rows, saved, accountId, groupId, groupName, rowResults, uncertain]);
  const unsaved = rows.filter(row => !saved[row.key]);
  const hasSaved = Object.keys(saved).length > 0;
  const errorText = error === "duplicate" ? t("이 종목은 이미 목록에 있거나 저장되었습니다. 목록의 수량을 확인해 주세요.", "This holding is already queued or saved. Check its quantity in the list.")
    : error === "quantity" ? t("수량을 0보다 크게 입력해 주세요. 소수점 6자리까지 가능합니다.", "Enter a quantity above zero, with up to six decimal places.")
    : error === "cost" ? t("평균 매입가는 0보다 크게, 소수점 4자리까지 입력해 주세요.", "Enter an average cost above zero, with up to four decimal places.")
    : error === "limit" ? t("한 번에 12종목까지 가능합니다. 먼저 목록을 저장해 주세요.", "Add up to 12 holdings at a time. Save this list first.")
    : error === "ticker" ? t("티커를 확인해 주세요. 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.", "Check the ticker. Use letters, numbers, dots, underscores or hyphens.") : null;

  function selectAccount(next: string) {
    setAccountId(next);
    // Embedded readers own their route scope; keep their form selection local.
    // Standalone pages persist account context without remounting queued inputs.
    if (!persistAccountContext || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("accountId", next);
    url.searchParams.set("scope", `account:${next}`);
    window.history.replaceState(null, "", url);
  }
  function addDrafts(drafts: HoldingDraft[]) {
    if (unsaved.length + drafts.length > MAX_HOLDING_BATCH) { setError("limit"); return false; }
    const seen = new Set([...rows.map(identity), ...Object.values(saved)]);
    for (const draft of drafts) {
      if (seen.has(identity(draft))) { setError("duplicate"); return false; }
      seen.add(identity(draft));
    }
    setRows(previous => [...previous, ...drafts]); setError(null); return true;
  }
  function addHolding() {
    if (!selected) return;
    if (!positive(quantity, 6)) { setError("quantity"); return; }
    if (cost && !positive(cost, 4)) { setError("cost"); return; }
    if (addDrafts([{ key: crypto.randomUUID(), instrumentId: selected.id, name: selected.name, ticker: selected.ticker, market: selected.market, assetType: selected.assetType, quantity, averageCost: cost, currentPrice: "" }])) {
      setSelected(null); setQuantity(""); setCost("");
    }
  }
  function editRow(key: string, field: "quantity" | "averageCost" | "currentPrice", value: string) {
    if (uncertain.includes(key)) return;
    setRows(previous => previous.map(row => row.key === key ? { ...row, [field]: value } : row));
  }

  if (nativeAccountIds.includes(accountId)) return <div className="varda-holding-onboarding">
    <CairnField>{t("담을 계좌", "Add to account")}<CairnSelect className="cairn-form-select" value={accountId} onChange={event => selectAccount(event.target.value)} aria-label={t("보유 계좌", "Holding account")}>{options.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</CairnSelect></CairnField>
    <NativeLedgerNotice accountId={accountId} action="buy" />
  </div>;
  // Action completion requests a native reset; retain React-managed account and retry selections.
  return <CairnForm action={preview ? undefined : action} className="varda-holding-onboarding" onReset={event => event.preventDefault()} onSubmit={event => { if (preview || unsaved.length === 0) event.preventDefault(); }}>
    <input type="hidden" name="holdings" value={JSON.stringify(unsaved)} />
    <input type="hidden" name="accountId" value={accountId} />
    <input type="hidden" name="portfolioGroupId" value={groupId} />
    <input type="hidden" name="newPortfolioGroupName" value={groupId ? "" : groupName} />
    {resumedAccount ? <p className="varda-onboarding-hint">{t(`${resumedAccount}의 저장 중인 목록을 이어서 확인해 주세요.`, `Resume the pending list for ${resumedAccount}.`)}</p> : null}
    <div className="varda-onboarding-account-line"><CairnField>{t("담을 계좌", "Add to account")}<CairnSelect className="cairn-form-select" value={accountId} onChange={event => selectAccount(event.target.value)} disabled={pending || hasSaved || uncertain.length > 0} aria-label={t("보유 계좌", "Holding account")}>{!accountId ? <option value="">{t("보유 계좌를 선택해 주세요.", "Choose a holding account.")}</option> : null}{options.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</CairnSelect></CairnField></div>
    <div className="varda-onboarding-workspace">
      <section className="varda-onboarding-compose" aria-labelledby="holding-add-heading" onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <p className="varda-onboarding-eyebrow" id="holding-add-heading">{t("어떤 종목을 보유하고 있나요?", "What do you hold?")}</p>
        <BalancePhotoPanel key={accountId} onAdd={addDrafts} remaining={MAX_HOLDING_BATCH - unsaved.length} disabled={pending} preview={preview} />
        {fromPlan ? <PlanHoldingReference disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSearch={name => { setSelected(null); setQuantity(""); setCost(""); setError(null); setPlanSearch(previous => ({ name, revision: previous.revision + 1 })); }} /> : null}
        {fromQuick ? <QuickHoldingReference disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSearch={name => { setSelected(null); setQuantity(""); setCost(""); setError(null); setPlanSearch(previous => ({ name, revision: previous.revision + 1 })); }} /> : null}
        <InstrumentSearch key={planSearch.revision} initialQuery={planSearch.name} privateQuery={fromPlan || fromQuick} preview={preview} disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSelect={instrument => { setSelected(instrument); setQuantity(""); setCost(""); setError(null); }} />
        {selected ? <div className="varda-onboarding-selected">
          <div className="varda-onboarding-selected-title"><div><strong>{selected.name}</strong><span>{selected.ticker} · {selected.market === "korea" ? "KR" : "US"} · {selected.currency}</span></div><IconButton disabled={pending} onClick={() => setSelected(null)} label={t("종목 선택 취소", "Clear selected holding")}><X size={18} /></IconButton></div>
          <CairnField className="varda-onboarding-quantity">{t("몇 주 가지고 있나요?", "How many shares do you hold?")}<CairnInput value={quantity} onChange={event => { setQuantity(event.target.value); setError(null); }} type="number" inputMode="decimal" min="0.000001" step="0.000001" placeholder="0" disabled={pending} autoComplete="off" /></CairnField>
          <details className="varda-onboarding-disclosure"><summary>{t("평균 매입가도 알고 있어요", "I know my average purchase price")}</summary><CairnField>{t("1주 평균 매입가", "Average cost per share")} · {selected.currency}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={cost} onChange={event => setCost(event.target.value)} disabled={pending} /></CairnField><p>{t("비워 두면 매입가를 입력할 때까지 수익률을 표시하지 않아요.", "Optional. If left blank, returns remain unavailable until you enter a cost.")}</p></details>
          <CairnButton variant="secondary" type="button" className="varda-onboarding-secondary" onClick={addHolding} disabled={pending}><Plus size={17} />{t("목록에 추가", "Add to list")}</CairnButton>
        </div> : <div className="varda-onboarding-start-note"><span>↗</span><p>{t("종목을 선택하고 수량을 입력해 주세요.", "Find your holding, then enter its quantity.")}<small>{t("매입가는 나중에 추가해도 괜찮아요.", "You can add your purchase price later.")}</small></p></div>}
        {errorText ? <CairnStatus as="p" tone="danger" role="alert" className="varda-onboarding-error">{errorText}</CairnStatus> : null}
        <details className="varda-onboarding-disclosure"><summary>{t("검색되지 않는 종목 직접 입력", "Enter an unlisted ticker manually")}</summary>
          <p>{t("상장 시장과 티커를 확인해 주세요.", "Check the listing market and ticker.")}</p>
          <div className="varda-onboarding-fields"><CairnField>{t("상장 시장", "Market")}<CairnSelect className="cairn-form-select" value={manualMarket} disabled={pending} onChange={event => setManualMarket(event.target.value as "korea" | "us")}><option value="korea">{t("한국 · KRW", "Korea · KRW")}</option><option value="us">{t("미국 · USD", "US · USD")}</option></CairnSelect></CairnField><CairnField>{t("유형", "Type")}<CairnSelect className="cairn-form-select" value={manualType} disabled={pending} onChange={event => setManualType(event.target.value as "etf" | "stock")}><option value="etf">ETF</option><option value="stock">{t("주식", "Stock")}</option></CairnSelect></CairnField><CairnField>{t("티커", "Ticker")}<CairnInput value={manualTicker} onChange={event => setManualTicker(event.target.value.toUpperCase())} disabled={pending} maxLength={50} autoCapitalize="characters" autoComplete="off" placeholder={manualMarket === "korea" ? "069500" : "AAPL"} /></CairnField><CairnField>{t("이름 (선택)", "Name (optional)")}<CairnInput value={manualName} onChange={event => setManualName(event.target.value)} disabled={pending} maxLength={255} /></CairnField></div>
          <CairnButton variant="secondary" type="button" className="varda-onboarding-text-button" disabled={pending} onClick={() => {
            const ticker = manualTicker.trim().toUpperCase();
            if (!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(ticker)) { setError("ticker"); return; }
            setSelected({ id: "", name: manualName.trim() || ticker, ticker, market: manualMarket, currency: manualMarket === "korea" ? "KRW" : "USD", assetType: manualType }); setQuantity(""); setCost(""); setError(null);
          }}>{t("이 종목의 수량 입력", "Enter quantity for this ticker")}<ArrowRight size={16} /></CairnButton>
        </details>
        <HoldingImportPanel onAdd={addDrafts} remaining={MAX_HOLDING_BATCH - unsaved.length} disabled={pending} preview={preview} />
      </section>
      <section className="varda-onboarding-review" aria-labelledby="holding-review-heading">
        <div className="varda-onboarding-review-title"><p className="varda-onboarding-eyebrow" id="holding-review-heading">{t("저장할 종목", "Ready to save")}</p><span>{unsaved.length} / {MAX_HOLDING_BATCH}</span></div>
        {rows.length === 0 ? <div className="varda-onboarding-empty"><span>0</span><p>{t("한 종목부터 시작해 보세요.", "Start with a single holding.")}<small>{t("여러 종목을 담아 한 번에 저장할 수 있어요.", "Or add several and save them together.")}</small></p></div> : <ol className="varda-onboarding-queue">{rows.map((row, index) => {
          const isSaved = Boolean(saved[row.key]);
          const result = rowResults.find(item => item.key === row.key)?.result;
          const locked = pending || isSaved || uncertain.includes(row.key);
          return <li key={row.key} data-saved={isSaved}>
            <div className="varda-onboarding-row-heading"><span className="varda-onboarding-row-number">{isSaved ? <Check size={16} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{row.name || row.ticker}</strong><small>{row.ticker} · {row.market === "korea" ? "KRW" : "USD"}{isSaved ? ` · ${t("저장 완료", "Saved")}` : ""}</small></div>{!isSaved ? <IconButton disabled={locked} label={t(`${row.name} 목록에서 제거`, `Remove ${row.name} from list`)} onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}><Trash2 size={18} /></IconButton> : null}</div>
            <CairnField className="varda-onboarding-row-quantity">{t("보유 수량", "Quantity")}<CairnInput type="number" inputMode="decimal" min="0.000001" step="0.000001" value={row.quantity} required disabled={locked} onChange={event => editRow(row.key, "quantity", event.target.value)} aria-label={t(`${row.name} 보유 수량`, `${row.name} quantity`)} /></CairnField>
            {!isSaved ? <details className="varda-onboarding-disclosure"><summary>{t("매입가·가격 확인", "Cost & price lookup")}</summary><div className="varda-onboarding-fields"><CairnField>{t("평균 매입가 (선택)", "Average cost (optional)")}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.averageCost} disabled={locked} onChange={event => editRow(row.key, "averageCost", event.target.value)} /></CairnField><CairnField>{t("현재 1주 가격 · 자동 조회가 안 될 때", "Current price if lookup is unavailable")}<CairnInput type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.currentPrice} disabled={locked} onChange={event => editRow(row.key, "currentPrice", event.target.value)} /></CairnField></div><p>{t("저장하려면 자동 조회 가격 또는 직접 입력한 현재가가 필요해요. 매입가는 비워도 됩니다.", "We look up the current price. If unavailable, you can enter it here.")}</p></details> : null}
            {!isSaved ? <span className="varda-onboarding-hint">{uncertain.includes(row.key) ? t("저장 확인 필요", "Confirm save") : result?.status === "price_unavailable" ? result.retryAfterSeconds ? t("시세 조회 대기", "Price lookup pending") : t("가격 입력 필요", "Price required") : result && result.status !== "success" ? t("저장 실패 · 다시 확인", "Save failed · review") : t("저장 대기", "Ready to save")}</span> : null}
            {result && !isSaved && result.message ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-error"><ManagementText>{result.message}</ManagementText></CairnStatus> : null}
          </li>;
        })}</ol>}
        <details className="varda-onboarding-disclosure"><summary>{t("분석 그룹 설정 (선택)", "Analysis group (optional)")}</summary><p>{t("비워 두면 기본 그룹으로 정리됩니다. 나중에 관리 화면에서 바꿀 수 있어요.", "Leave blank to use a default group. You can change it later in Manage.")}</p><CairnField>{t("기존 그룹", "Existing group")}<CairnSelect className="cairn-form-select" value={groupId} disabled={pending || hasSaved || uncertain.length > 0} onChange={event => setGroupId(event.target.value)}><option value="">{t("기본 그룹 사용", "Use default group")}</option>{options.portfolioGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</CairnSelect></CairnField>{!groupId ? <CairnField>{t("새 그룹 이름 (선택)", "New group name (optional)")}<CairnInput maxLength={100} value={groupName} disabled={pending || hasSaved || uncertain.length > 0} onChange={event => setGroupName(event.target.value)} /></CairnField> : null}</details>
        <div className="varda-onboarding-save">
          {state.results.some(item => item.result.message === NATIVE_LEDGER_REQUIRED_MESSAGE) ? <NativeLedgerNotice accountId={accountId} action="buy" /> : null}
          {state.status === "invalid" && state.results.length === 0 ? <CairnStatus as="p" tone="danger" role="alert" className="varda-onboarding-error">{t("입력한 목록을 확인한 뒤 다시 저장해 주세요.", "Check the holding list and try saving again.")}</CairnStatus> : null}
          {state.status === "partial" ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-hint">{hasSaved
            ? t("저장된 종목은 유지됩니다. 나머지만 확인한 뒤 다시 저장하세요.", "Saved holdings are kept. Review and retry only the remaining holdings.")
            : awaitingPrice
              ? t("아직 저장된 종목이 없습니다. 가격 확인 후 다시 저장하거나 현재가를 직접 입력해 주세요.", "No holdings have been saved yet. Save again after prices are available, or enter current prices yourself.")
              : t("아직 저장된 종목이 없습니다. 각 종목의 안내를 확인한 뒤 다시 저장해 주세요.", "No holdings have been saved yet. Check each holding's message before trying again.")}</CairnStatus> : null}
          {draftUnavailable ? <CairnStatus as="p" tone="neutral" role="status" className="varda-onboarding-hint">{t("이 브라우저에서 목록을 보관할 수 없어요. 사이트 저장 권한을 확인한 뒤 다시 저장해 주세요.", "This browser cannot retain the retry list. Check site storage permissions, then retry.")}</CairnStatus> : null}
          <CairnButton variant="primary" type="submit" className="varda-onboarding-primary" disabled={preview || !draftLoaded || pending || unsaved.length === 0 || !accountId}>{pending ? t("종목을 확인하며 저장 중…", "Checking and saving holdings…") : t(`${unsaved.length}종목 저장`, `Save ${unsaved.length} holding${unsaved.length === 1 ? "" : "s"}`)}<ArrowRight size={18} /></CairnButton>
          <p className="varda-onboarding-hint">{preview ? t("예시 화면입니다. 편집은 가능하지만 저장하지 않습니다.", "Demo view. You can edit the list, but saving is disabled.") : t("실제 주문 없이 보유 내역만 기록해요.", "Records your holdings. No orders are placed.")}</p>
          {hasSaved ? <CairnStatus as="div" tone="success" className="varda-onboarding-success" role="status"><Check size={20} /><strong>{t(`${Object.keys(saved).length}종목이 포트폴리오에 담겼어요.`, `${Object.keys(saved).length} holdings added to your portfolio.`)}</strong><Link href={`/portfolio/first-look?${new URLSearchParams({scope: `account:${accountId}`})}`}>{t("내 포트폴리오 첫 화면 보기", "See your portfolio")}<ArrowRight size={16} /></Link>{hasSaved ? <CairnButton variant="secondary" type="button" className="varda-onboarding-text-button" onClick={() => { setRows(previous => previous.filter(row => !saved[row.key])); if (unsaved.length === 0 && uncertain.length === 0) { setSaved({}); setRowResults([]); setResumedAccount(null); } }} disabled={pending}>{t("저장된 목록 접고 더 추가하기", "Clear saved rows and add more")}<Plus size={16} /></CairnButton> : null}</CairnStatus> : null}
        </div>
      </section>
    </div>
  </CairnForm>;
}
