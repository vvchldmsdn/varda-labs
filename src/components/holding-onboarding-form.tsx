"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useMarketCollectionPolling } from "@/components/use-market-collection-polling";
import { ArrowRight, Check, Plus, Trash2, X } from "lucide-react";
import { createHoldingBatch } from "@/app/portfolio/holdings/new/actions";
import { useI18n } from "@/components/i18n/locale-provider";
import { ManagementText } from "@/components/i18n/management-text";
import { InstrumentSearch, type InstrumentChoice } from "@/components/onboarding/instrument-search";
import { HoldingImportPanel } from "@/components/onboarding/holding-import-panel";
import type { HoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { MAX_HOLDING_BATCH, type HoldingBatchState, type HoldingDraft } from "@/lib/holding-batch";

const INITIAL_STATE: HoldingBatchState = { status: "idle", results: [] };
const identity = (row: Pick<HoldingDraft, "market" | "ticker">) => `${row.market}:${row.ticker.trim().toUpperCase()}`;
const positive = (value: string, precision: number) => /^\d+(?:\.\d+)?$/.test(value) && Number(value) > 0 && Number.isFinite(Number(value)) && (value.split(".")[1]?.length ?? 0) <= precision;

export function HoldingOnboardingForm({ options, preview = false }: { options: HoldingOnboardingOptions; preview?: boolean }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HoldingDraft[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [accountId, setAccountId] = useState(options.accounts[0]?.id ?? "");
  const [groupId, setGroupId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [selected, setSelected] = useState<InstrumentChoice | null>(null);
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [manualMarket, setManualMarket] = useState<"korea" | "us">("korea");
  const [manualType, setManualType] = useState<"etf" | "stock">("etf");
  const [manualTicker, setManualTicker] = useState("");
  const [manualName, setManualName] = useState("");
  const [error, setError] = useState<"duplicate" | "quantity" | "cost" | "limit" | "ticker" | null>(null);
  const [state, action, pending] = useActionState(async (previous: HoldingBatchState, data: FormData) => {
    const result = await createHoldingBatch(previous, data);
    const submitted: HoldingDraft[] = JSON.parse(String(data.get("holdings")));
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
  const awaitingPrice = state.results.some(item => item.result.status === "price_unavailable");
  const collectionState = useMarketCollectionPolling(!preview && awaitingPrice, state, true);
  const unsaved = rows.filter(row => !saved[row.key]);
  const hasSaved = Object.keys(saved).length > 0;
  const errorText = error === "duplicate" ? t("이 종목은 이미 목록에 있거나 저장되었습니다. 목록의 수량을 확인해 주세요.", "This holding is already queued or saved. Check its quantity in the list.")
    : error === "quantity" ? t("수량을 0보다 크게 입력해 주세요. 소수점 6자리까지 가능합니다.", "Enter a quantity above zero, with up to six decimal places.")
    : error === "cost" ? t("평균 매입가는 0보다 크게, 소수점 4자리까지 입력해 주세요.", "Enter an average cost above zero, with up to four decimal places.")
    : error === "limit" ? t("한 번에 12종목까지 가능합니다. 먼저 목록을 저장해 주세요.", "Add up to 12 holdings at a time. Save this list first.")
    : error === "ticker" ? t("티커를 확인해 주세요. 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.", "Check the ticker. Use letters, numbers, dots, underscores or hyphens.") : null;

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
    setRows(previous => previous.map(row => row.key === key ? { ...row, [field]: value } : row));
  }

  return <form action={preview ? undefined : action} className="varda-holding-onboarding" onSubmit={event => { if (preview || unsaved.length === 0) event.preventDefault(); }}>
    <input type="hidden" name="holdings" value={JSON.stringify(unsaved)} />
    <input type="hidden" name="accountId" value={accountId} />
    <input type="hidden" name="portfolioGroupId" value={groupId} />
    <input type="hidden" name="newPortfolioGroupName" value={groupId ? "" : groupName} />
    <div className="varda-onboarding-account-line"><label>{t("담을 계좌", "Add to account")}<select value={accountId} onChange={event => setAccountId(event.target.value)} disabled={pending || hasSaved} aria-label={t("보유 계좌", "Holding account")}>{options.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><span>{t("계좌 비밀번호나 거래 권한은 필요하지 않아요.", "No brokerage password or trading access needed.")}</span></div>
    <div className="varda-onboarding-workspace">
      <section className="varda-onboarding-compose" aria-labelledby="holding-add-heading" onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <p className="varda-onboarding-eyebrow" id="holding-add-heading">01 · {t("종목과 수량", "HOLDING & QUANTITY")}</p>
        <InstrumentSearch preview={preview} disabled={pending || unsaved.length >= MAX_HOLDING_BATCH} onSelect={instrument => { setSelected(instrument); setQuantity(""); setCost(""); setError(null); }} />
        {selected ? <div className="varda-onboarding-selected">
          <div className="varda-onboarding-selected-title"><div><strong>{selected.name}</strong><span>{selected.ticker} · {selected.market === "korea" ? "KR" : "US"} · {selected.currency}</span></div><button type="button" disabled={pending} onClick={() => setSelected(null)} aria-label={t("종목 선택 취소", "Clear selected holding")}><X size={18} /></button></div>
          <label className="varda-onboarding-quantity">{t("몇 주 가지고 있나요?", "How many shares do you hold?")}<input value={quantity} onChange={event => { setQuantity(event.target.value); setError(null); }} type="number" inputMode="decimal" min="0.000001" step="0.000001" placeholder="0" disabled={pending} autoComplete="off" /></label>
          <details className="varda-onboarding-disclosure"><summary>{t("평균 매입가도 알고 있어요", "I know my average purchase price")}</summary><label>{t("1주 평균 매입가", "Average cost per share")} · {selected.currency}<input type="number" inputMode="decimal" min="0.0001" step="0.0001" value={cost} onChange={event => setCost(event.target.value)} disabled={pending} /></label><p>{t("선택 사항입니다. 비워 두면 수익률을 추정하지 않고 원가 미입력으로 표시합니다.", "Optional. If left blank, returns remain unavailable until you enter a cost.")}</p></details>
          <button type="button" className="varda-onboarding-secondary" onClick={addHolding} disabled={pending}><Plus size={17} />{t("목록에 추가", "Add to list")}</button>
        </div> : <div className="varda-onboarding-start-note"><span>↗</span><p>{t("이름을 찾아 선택하고, 수량만 입력하세요.", "Find your holding, then enter its quantity.")}<small>{t("매입가는 나중에 추가해도 괜찮아요.", "You can add your purchase price later.")}</small></p></div>}
        {errorText ? <p role="alert" className="varda-onboarding-error">{errorText}</p> : null}
        <details className="varda-onboarding-disclosure"><summary>{t("검색되지 않는 종목 직접 입력", "Enter an unlisted ticker manually")}</summary>
          <p>{t("검색 목록은 모든 종목을 포함하지 않습니다. 정확한 상장 시장과 티커를 확인해 주세요.", "The catalog is not exhaustive. Enter the exact listing market and ticker.")}</p>
          <div className="varda-onboarding-fields"><label>{t("상장 시장", "Market")}<select value={manualMarket} disabled={pending} onChange={event => setManualMarket(event.target.value as "korea" | "us")}><option value="korea">{t("한국 · KRW", "Korea · KRW")}</option><option value="us">{t("미국 · USD", "US · USD")}</option></select></label><label>{t("유형", "Type")}<select value={manualType} disabled={pending} onChange={event => setManualType(event.target.value as "etf" | "stock")}><option value="etf">ETF</option><option value="stock">{t("주식", "Stock")}</option></select></label><label>{t("티커", "Ticker")}<input value={manualTicker} onChange={event => setManualTicker(event.target.value.toUpperCase())} disabled={pending} maxLength={50} autoCapitalize="characters" autoComplete="off" placeholder={manualMarket === "korea" ? "069500" : "AAPL"} /></label><label>{t("이름 (선택)", "Name (optional)")}<input value={manualName} onChange={event => setManualName(event.target.value)} disabled={pending} maxLength={255} /></label></div>
          <button type="button" className="varda-onboarding-text-button" disabled={pending} onClick={() => {
            const ticker = manualTicker.trim().toUpperCase();
            if (!/^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(ticker)) { setError("ticker"); return; }
            setSelected({ id: "", name: manualName.trim() || ticker, ticker, market: manualMarket, currency: manualMarket === "korea" ? "KRW" : "USD", assetType: manualType }); setQuantity(""); setCost(""); setError(null);
          }}>{t("이 종목의 수량 입력", "Enter quantity for this ticker")}<ArrowRight size={16} /></button>
        </details>
        <HoldingImportPanel onAdd={addDrafts} remaining={MAX_HOLDING_BATCH - unsaved.length} disabled={pending} preview={preview} />
      </section>
      <section className="varda-onboarding-review" aria-labelledby="holding-review-heading">
        <div className="varda-onboarding-review-title"><p className="varda-onboarding-eyebrow" id="holding-review-heading">02 · {t("추가할 목록", "REVIEW YOUR LIST")}</p><span>{unsaved.length} / {MAX_HOLDING_BATCH}</span></div>
        {rows.length === 0 ? <div className="varda-onboarding-empty"><span>0</span><p>{t("한 종목부터 시작해 보세요.", "Start with a single holding.")}<small>{t("여러 종목을 담아 한 번에 저장할 수 있어요.", "Or add several and save them together.")}</small></p></div> : <ol className="varda-onboarding-queue">{rows.map((row, index) => {
          const isSaved = Boolean(saved[row.key]);
          const result = state.results.find(item => item.key === row.key)?.result;
          return <li key={row.key} data-saved={isSaved}>
            <div className="varda-onboarding-row-heading"><span className="varda-onboarding-row-number">{isSaved ? <Check size={16} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{row.name || row.ticker}</strong><small>{row.ticker} · {row.market === "korea" ? "KRW" : "USD"}{isSaved ? ` · ${t("저장 완료", "Saved")}` : ""}</small></div>{!isSaved ? <button type="button" disabled={pending} aria-label={t(`${row.name} 목록에서 제거`, `Remove ${row.name} from list`)} onClick={() => setRows(previous => previous.filter(item => item.key !== row.key))}><Trash2 size={16} /></button> : null}</div>
            <label className="varda-onboarding-row-quantity">{t("보유 수량", "Quantity")}<input type="number" inputMode="decimal" min="0.000001" step="0.000001" value={row.quantity} required disabled={pending || isSaved} onChange={event => editRow(row.key, "quantity", event.target.value)} aria-label={t(`${row.name} 보유 수량`, `${row.name} quantity`)} /></label>
            {!isSaved ? <details className="varda-onboarding-disclosure"><summary>{t("매입가·현재가 추가 또는 수정", "Add or edit cost and current price")}</summary><div className="varda-onboarding-fields"><label>{t("평균 매입가 (선택)", "Average cost (optional)")}<input type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.averageCost} disabled={pending} onChange={event => editRow(row.key, "averageCost", event.target.value)} /></label><label>{t("현재 1주 가격 (선택)", "Current price (optional)")}<input type="number" inputMode="decimal" min="0.0001" step="0.0001" value={row.currentPrice} disabled={pending} onChange={event => editRow(row.key, "currentPrice", event.target.value)} /></label></div><p>{t("현재가를 비우면 확인된 가격을 조회합니다. 확인할 수 없으면 해당 종목의 저장 결과에 표시합니다.", "If blank, a verified quote is requested. If unavailable, the result will explain what is needed.")}</p></details> : null}
            {result && !isSaved && result.message ? <p role="status" className="varda-onboarding-error"><ManagementText>{result.message}</ManagementText></p> : null}
          </li>;
        })}</ol>}
        <details className="varda-onboarding-disclosure"><summary>{t("분석 그룹 설정 (선택)", "Analysis group (optional)")}</summary><p>{t("비워 두면 기본 그룹으로 정리됩니다. 나중에 관리 화면에서 바꿀 수 있어요.", "Leave blank to use a default group. You can change it later in Manage.")}</p><label>{t("기존 그룹", "Existing group")}<select value={groupId} disabled={pending || hasSaved} onChange={event => setGroupId(event.target.value)}><option value="">{t("기본 그룹 사용", "Use default group")}</option>{options.portfolioGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{!groupId ? <label>{t("새 그룹 이름 (선택)", "New group name (optional)")}<input maxLength={100} value={groupName} disabled={pending || hasSaved} onChange={event => setGroupName(event.target.value)} /></label> : null}</details>
        <div className="varda-onboarding-save">
          {state.status === "invalid" && state.results.length === 0 ? <p role="alert" className="varda-onboarding-error">{t("입력한 목록을 확인한 뒤 다시 저장해 주세요.", "Check the holding list and try saving again.")}</p> : null}
          {state.status === "partial" ? <p role="status" className="varda-onboarding-hint">{hasSaved
            ? t("저장된 종목은 유지됩니다. 나머지만 확인한 뒤 다시 저장하세요.", "Saved holdings are kept. Review and retry only the remaining holdings.")
            : awaitingPrice
              ? t("아직 저장된 종목이 없습니다. 가격 확인 후 다시 저장하거나 현재가를 직접 입력해 주세요.", "No holdings have been saved yet. Save again after prices are available, or enter current prices yourself.")
              : t("아직 저장된 종목이 없습니다. 각 종목의 안내를 확인한 뒤 다시 저장해 주세요.", "No holdings have been saved yet. Check each holding's message before trying again.")}</p> : null}
          {awaitingPrice && collectionState === "waiting" ? <p role="status" className="varda-onboarding-hint">{t("가격 확인이 대기 중입니다. 다시 저장을 눌러 확인하거나 현재 가격을 직접 입력해 주세요.", "Price lookup is still pending. Try saving again or enter a current price.")}</p> : null}
          <button type="submit" className="varda-onboarding-primary" disabled={preview || pending || unsaved.length === 0 || !accountId}>{pending ? t("종목을 확인하며 저장 중…", "Checking and saving holdings…") : t(`${unsaved.length}종목 저장`, `Save ${unsaved.length} holding${unsaved.length === 1 ? "" : "s"}`)}<ArrowRight size={18} /></button>
          <p className="varda-onboarding-hint">{preview ? t("예시 화면입니다. 편집은 가능하지만 저장하지 않습니다.", "Demo view. You can edit the list, but saving is disabled.") : t("주문을 실행하지 않습니다. 내 포트폴리오에 기록만 추가합니다.", "No orders are placed. These are records for your portfolio.")}</p>
          {hasSaved ? <div className="varda-onboarding-success" role="status"><Check size={20} /><strong>{t(`${Object.keys(saved).length}종목이 포트폴리오에 담겼어요.`, `${Object.keys(saved).length} holdings added to your portfolio.`)}</strong><Link href="/portfolio/first-look">{t("내 포트폴리오 첫 화면 보기", "See your portfolio")}<ArrowRight size={16} /></Link>{rows.some(row => saved[row.key]) ? <button type="button" className="varda-onboarding-text-button" onClick={() => setRows(previous => previous.filter(row => !saved[row.key]))} disabled={pending}>{t("저장된 목록 접고 더 추가하기", "Clear saved rows and add more")}<Plus size={16} /></button> : null}</div> : null}
        </div>
      </section>
    </div>
  </form>;
}
