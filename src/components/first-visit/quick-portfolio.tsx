"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createQuickDraft, parseQuickDraft, QUICK_INSTRUMENTS, QUICK_STORAGE_KEY, validateQuickPortfolio, type QuickDraft, type QuickInput } from "@/lib/quick-portfolio";
import { parseMoneyInput, type Currency } from "@/lib/money";
import { trackFirstVisit } from "@/lib/first-visit-events";
import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "./money-input";
import { QuickResults, formatQuickTimestamp } from "./quick-results";
import { ContinueWithPortfolio } from "./portfolio-activation";
import { ACTIVATION_STORAGE_KEY } from "@/lib/portfolio-activation";
import styles from "./quick-portfolio.module.css";

type Row = { key: string; name: string; value: string; instrumentId: string | null; inputCurrency: Currency };
const blank = (key: string, inputCurrency: Currency = "KRW"): Row => ({ key, name: "", value: "", instrumentId: null, inputCurrency });
const timeZones = ["Asia/Seoul", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "UTC"];
const inputErrors: Record<string, string> = {
  "자산 이름과 금액을 확인해 주세요.": "Check your asset names and amounts.",
  "KRW 또는 USD를 선택해 주세요.": "Select KRW or USD.",
  "입력 기준 시각과 표시 설정을 확인해 주세요.": "Check the input date and display settings.",
  "환산 기준을 확인해 주세요.": "Enter a valid positive exchange rate, up to 1,000,000 KRW per USD.",
  "자산을 1~12개 입력해 주세요.": "Enter between 1 and 12 assets.",
  "각 자산의 이름을 1~60자로 입력해 주세요.": "Give each asset a name between 1 and 60 characters.",
  "같은 자산은 금액을 합치거나 이름을 구분해 주세요.": "Combine repeated assets or give them distinct names.",
  "금액과 소수 자릿수를 확인해 주세요. KRW는 정수, USD는 소수 둘째 자리까지입니다.": "Check your amounts: whole won for KRW, up to two decimals for USD.",
  "선택한 종목과 이름이 일치하지 않습니다. 종목을 다시 선택해 주세요.": "The name does not match the selected instrument. Select it again.",
  "최소 한 자산의 금액을 0보다 크게 입력해 주세요.": "Enter a positive amount for at least one asset.",
  "입력 내용을 줄여 주세요.": "Shorten your inputs before saving.",
};

export function QuickPortfolio({ signedIn = false, initialSaved, preview = false }: { signedIn?: boolean; preview?: boolean; initialSaved?: { id: string; input: QuickInput } }) {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<Row[]>([blank("0")]);
  const [currency, setCurrency] = useState<Currency>("KRW");
  const [timeZone, setTimeZone] = useState("Asia/Seoul");
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [result, setResult] = useState<QuickInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fxRate, setFxRate] = useState("");
  const [fxChanged, setFxChanged] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState<"blocked" | "expired" | "save" | "delete" | "">("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)) ?? (initialSaved ? { ...createQuickDraft(initialSaved.input), id: initialSaved.id } : null);
        if (stored) {
          setRows(stored.input.rows.map((row, index) => ({ ...row, key: String(index), value: String(row.value), inputCurrency: row.inputCurrency ?? stored.input.currency })));
          setCurrency(stored.input.currency); setTimeZone(stored.input.timeZone ?? "Asia/Seoul");
          setFxRate(stored.input.fx?.find(item => item.kind === "user_input")?.rate ?? "");
          setDraft(stored); setResult(stored.input); setDirty(false);
          localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(stored));
        } else localStorage.removeItem(QUICK_STORAGE_KEY);
      } catch { setStorageWarning("blocked"); }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSaved]);

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      try { const stored = parseQuickDraft(localStorage.getItem(QUICK_STORAGE_KEY)); if (!stored || stored.id === draft.id) localStorage.removeItem(QUICK_STORAGE_KEY); } catch {}
      setDraft(null); setStorageWarning("expired");
    }, Math.max(0, draft.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [draft]);

  function changed() { trackFirstVisit("portfolio_input_started"); setDirty(true); setResult(null); setError(""); }
  function update(key: string, patch: Partial<Row>) { changed(); setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row)); }
  function changeCurrency(next: Currency) {
    changed(); setCurrency(next);
    // A reporting preference never reinterprets an amount the visitor already entered.
    setRows(current => current.map(row => !row.name.trim() && !row.value ? { ...row, inputCurrency: next } : row));
  }
  function calculate(newReference = false) {
    // Edits retain their original reference time. A new dated calculation
    // requires an explicit reference-time action or new FX assumption.
    const asOf = !newReference && !fxChanged && draft?.input.asOf ? draft.input.asOf : new Date().toISOString();
    const fx = (fxChanged || newReference) && fxRate.trim() ? [{ base: "USD", quote: "KRW", rate: fxRate.trim(), observedAt: asOf, fetchedAt: asOf, kind: "user_input", source: "manual" }]
      : !fxChanged ? draft?.input.fx : undefined;
    const candidate = !dirty && !newReference && draft ? draft.input : {
      version: 2, source: "manual", currency, timeZone, locale: draft?.input.locale ?? locale,
      asOf, ...(fx?.length ? { fx } : {}),
      rows: rows.filter(row => row.name.trim() || row.value).map(row => ({ name: row.name, value: parseMoneyInput(row.value, row.inputCurrency) ?? NaN, inputCurrency: row.inputCurrency, instrumentId: row.instrumentId })),
    };
    const parsed = validateQuickPortfolio(candidate);
    if (!parsed.ok) { setError(parsed.error); return; }
    const next = createQuickDraft(parsed.input, draft);
    setDraft(next); setResult(parsed.input); setDirty(false); setFxChanged(false); setError("");
    trackFirstVisit("portfolio_result_viewed", next.id);
    try { localStorage.setItem(QUICK_STORAGE_KEY, JSON.stringify(next)); setStorageWarning(""); } catch { setStorageWarning("save"); }
    requestAnimationFrame(() => document.getElementById("quick-result")?.focus());
  }
  function clear() {
    setRows([blank("0", currency)]); setDraft(null); setResult(null); setError(""); setDirty(true); setFxRate(""); setFxChanged(false);
    try { localStorage.removeItem(QUICK_STORAGE_KEY); localStorage.removeItem(ACTIVATION_STORAGE_KEY); setStorageWarning(""); } catch { setStorageWarning("delete"); }
  }
  const warning = storageWarning === "blocked" ? t("임시 저장이 차단되어 있어요. 새로고침하면 입력이 사라집니다.", "Browser storage is blocked. Refreshing will clear your input.")
    : storageWarning === "expired" ? t("24시간 보관이 끝났어요. 다시 계산하면 입력을 보관할 수 있어요.", "Your 24-hour draft expired. Calculate again to keep these inputs.")
    : storageWarning === "save" ? t("입력을 보관하지 못했어요. 로그인 후 자동으로 이어갈 수 없습니다.", "Your input could not be kept for sign-in. Allow site storage to continue.")
    : storageWarning === "delete" ? t("임시 입력을 지우지 못했어요. 브라우저의 사이트 데이터 설정을 확인해 주세요.", "Could not clear your draft. Check your browser’s site data settings.") : "";
  const zones = timeZones.includes(timeZone) ? timeZones : [timeZone, ...timeZones];
  return <section className={styles.workspace}>
    <h1>{t("어떤 자산을 가지고 있나요?", "What do you own?")}</h1>
    <p>{t("정확하지 않아도 괜찮아요.", "Approximate amounts are enough to start.")}</p>
    <div className={styles.grid}>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); calculate(); }} noValidate>
        <div className={styles.preferences}><label>{t("분석 기준 통화", "Analyze in")}<select value={currency} onChange={event => changeCurrency(event.target.value as Currency)}><option value="KRW">KRW ₩</option><option value="USD">USD $</option></select></label><span>{t("입력 금액의 통화는 각 자산에서 선택해요.", "Choose each amount’s currency below.")}</span></div>
        {rows.map((row, index) => {
          const matches = row.name.trim().length && !row.instrumentId ? QUICK_INSTRUMENTS.filter(item => `${item.name} ${item.ticker}`.toLowerCase().includes(row.name.trim().toLowerCase())).slice(0, 4) : [];
          const instrument = QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId);
          return <fieldset className={`${styles.row} ${styles.currencyRow}`} key={row.key}>
            <legend>{t(`자산 ${index + 1}`, `Asset ${index + 1}`)}</legend>
            <label className={styles.nameField}>{t("종목명", "Asset")}<input autoComplete="off" maxLength={60} aria-label={t(`자산 ${index + 1} 이름`, `Asset ${index + 1} name`)} value={row.name} onChange={event => update(row.key, { name: event.target.value, instrumentId: null })} placeholder={t("종목 검색 또는 직접 입력", "Search or enter a name")} /></label>
            <label>{t("현재 금액", "Current amount")}<MoneyInput aria-label={t(`자산 ${index + 1} 금액`, `Asset ${index + 1} amount`)} value={row.value} allowDecimals={row.inputCurrency === "USD"} onValueChange={value => update(row.key, { value })} placeholder={row.inputCurrency === "USD" ? "0.00" : "0"} /></label>
            <label className={styles.currencyField}>{t("입력 통화", "Currency")}<select aria-label={t(`자산 ${index + 1} 입력 통화`, `Asset ${index + 1} input currency`)} value={row.inputCurrency} onChange={event => update(row.key, { inputCurrency: event.target.value as Currency })}><option value="KRW">KRW</option><option value="USD">USD</option></select></label>
            <button className={styles.removeRow} type="button" aria-label={t(`자산 ${index + 1} 제외`, `Remove asset ${index + 1}`)} disabled={rows.length === 1} onClick={() => { changed(); setRows(current => current.filter(item => item.key !== row.key)); }}>×</button>
            {matches.length ? <div className={styles.suggestions} aria-label={t(`자산 ${index + 1} 검색 결과`, `Asset ${index + 1} search results`)}>{matches.map(item => <button type="button" key={item.id} onClick={() => update(row.key, { name: item.name, instrumentId: item.id })}>{item.name} · {item.ticker}</button>)}</div> : null}
            {instrument && instrument.currency !== row.inputCurrency ? <p className={styles.selectedLabel}>{t(`거래 통화는 ${instrument.currency}입니다. 입력 금액은 선택한 ${row.inputCurrency}로 보관해요.`, `Trades in ${instrument.currency}. Your amount stays in ${row.inputCurrency}.`)}</p> : null}
          </fieldset>;
        })}
        <div className={styles.actions}><button type="button" disabled={rows.length >= 12} onClick={() => setRows(current => current.some(row => !row.name.trim() && !row.value) ? current : [...current, blank(crypto.randomUUID(), currency)])}>{t("＋ 자산 추가", "＋ Add asset")}</button><button type="button" onClick={clear}>{t("입력 지우기", "Clear inputs")}</button></div>
        {rows.some(row => (row.name.trim() || row.value) && row.inputCurrency !== currency) ? <details className={styles.method}><summary>{t("환율을 입력해 함께 계산", "Use an exchange-rate assumption")}</summary><label className={styles.timeZone}>{t("1 USD = KRW", "1 USD = KRW")}<input type="text" inputMode="decimal" aria-label={t("입력 환율 · 달러당 원", "Assumed KRW per USD")} value={fxRate} placeholder="—" onChange={event => { changed(); setFxRate(event.target.value); setFxChanged(true); }} /></label><p>{t("직접 입력한 가정 환율로 환산해요. 실제 시세나 체결 가능한 환율은 아닙니다.", "Uses the rate you enter as an assumption, not a live or executable quote.")}</p></details> : null}
        {error ? <p role="alert" className={styles.error}>{t(error, inputErrors[error] ?? "Check your inputs and try again.")}</p> : null}
        <div className={styles.actions}><button className={styles.primary} type="submit">{t("구성 확인하기", "See my portfolio")}</button></div>
        <details className={styles.method}><summary>{t("표시 시간대 · 입력 보관", "Time zone and saved inputs")}</summary><label className={styles.timeZone}>{t("표시 시간대", "Display time zone")}<select value={timeZone} onChange={event => { changed(); setTimeZone(event.target.value); }}>{zones.map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></label><p>{draft?.input.asOf ? t(`입력 기준: ${formatQuickTimestamp(draft.input.asOf, timeZone)}`, `Inputs as of ${formatQuickTimestamp(draft.input.asOf, timeZone)}`) : t("첫 계산 시각을 입력 기준으로 보관해요.", "The first calculation sets the reference time for your inputs.")}</p><p>{t("수정해도 원래 기준 시각을 유지해요. 서비스 기록은 한국시간 오전 7시에 구분합니다.", "Edits keep their original reference time. The service day changes at 07:00 Asia/Seoul.")}</p>{draft ? <button type="button" className={styles.referenceUpdate} onClick={() => calculate(true)}>{fxRate ? t("현재 시각과 이 가정 환율로 다시 계산", "Use current time and confirm this rate") : t("현재 시각으로 다시 계산", "Use current reference time")}</button> : null}<p>{t("입력은 이 브라우저에 24시간 보관하며 ‘입력 지우기’로 삭제할 수 있어요. 로그인해 저장한 입력은 내 기록에서 삭제할 수 있습니다.", "Inputs stay in this browser for 24 hours and can be cleared above. Inputs saved to your account can be deleted in My records.")}</p></details>
        {warning ? <p role="status" className={styles.note}>{warning}</p> : null}
      </form>
      <div id="quick-result" tabIndex={-1}>{result ? <QuickResults input={result} compact action={!storageWarning && draft ? <ContinueWithPortfolio draft={draft} signedIn={signedIn} preview={preview} /> : null} /> : <section className={styles.empty}><h2>{t("내 자산이 한눈에.", "Your portfolio at a glance.")}</h2><Link href="/demo/home">{t("입력 전에 샘플 체험하기 →", "Explore the sample first →")}</Link></section>}</div>
    </div>
  </section>;
}
