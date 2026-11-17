"use client";

import { useId, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Button, ChoiceGroup, Field, Form, InfoDisclosure, Input, ValidationMessage } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import type { FixtureView } from "@/lib/cairn-v2/fixtures";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { displayReadMoney, type DomainRead } from "@/lib/cairn-v2/read-contract";
import { calendarAttributionRange, MAX_ATTRIBUTION_DAYS, validateAttributionRange, type PeriodAttributionRange } from "@/lib/cairn-v2/period-attribution";
import { currentKstDate } from "@/lib/current-kst-date";
import { historySourceView } from "@/lib/cairn-v2/read-display";
import { historyWithCurrentValue, CURRENT_VALUATION_SOURCE } from "@/lib/cairn-v2/history-current";
import { HistoryChart, historyRows } from "./beta-charts";
import { useBetaPreferences, type HistoryStudioPreferences } from "./beta-provider";
import { PeriodControls } from "./history-detail-controls";
import { PeriodAttributionPanel } from "./period-attribution-panel";
import { HistoryBenchmark } from "./history-benchmark";
import styles from "./history-studio.module.css";

type Props = {
  view: FixtureView;
  context: BetaContext;
  historyRead?: Pick<DomainRead, "displayBinding" | "readReceipt">;
  compact?: boolean;
  suspended?: boolean;
  legacyDetail?: ReactNode;
  onAllAccounts?: () => void;
};

export function HistoryStudio({ view, context, historyRead, compact = false, suspended = false, legacyDetail, onAllAccounts }: Props) {
  const { t } = useI18n();
  const preferences = useBetaPreferences();
  const { historyDate, setHistoryDate, setMetric, historyStudio, setHistoryStudio } = preferences;
  const today = context.mode === "domain" ? currentKstDate(new Date()) : view.history.at(-1)?.date ?? currentKstDate(new Date());
  const identity = JSON.stringify([context.mode, context.scope, context.currency, historyRead?.displayBinding]);
  const state: HistoryStudioPreferences = historyStudio?.identity === identity ? historyStudio : {
    identity, mode: preferences.metric, preset: "thisMonth", range: calendarAttributionRange("thisMonth", today),
  };
  const { mode, preset, range } = state;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(range);
  const [attempted, setAttempted] = useState(false);
  const errorId = useId();
  const valid = validateAttributionRange(draft, today);
  const error = !attempted || valid ? "" : !draft.start || !draft.end
    ? t("시작일과 종료일을 입력해 주세요.", "Enter both dates.")
    : draft.start > draft.end ? t("종료일은 시작일 이후로 선택해 주세요.", "Choose an end date on or after the start.")
    : draft.end > today ? t("오늘까지의 날짜를 선택해 주세요.", "Choose a date up to today.")
    : t(`한 번에 ${MAX_ATTRIBUTION_DAYS}일까지 조회할 수 있어요.`, `Choose up to ${MAX_ATTRIBUTION_DAYS} days.`);
  function changeMode(next: HistoryStudioPreferences["mode"]) {
    setHistoryStudio({ ...state, mode: next });
    setMetric(next === "return" ? "return" : "value");
  }
  function changeRange(next: PeriodAttributionRange) {
    setHistoryStudio({ ...state, preset: "custom", range: next });
    setEditing(false);
  }
  const sourceView = historyWithCurrentValue(historySourceView(view, undefined, historyDate).view);
  const historyHidden = !!view.domain && (["loading", "unauthorized"].includes(view.domain.state) || ["loading", "unauthorized"].includes(view.domain.historyState));
  const rows = historyHidden ? [] : historyRows(sourceView, "ALL").filter(row => row.date >= range.start && row.date <= range.end);
  const selected = rows.find(row => row.date === historyDate) ?? rows.at(-1);
  const displayValue = selected ? displayReadMoney(sourceView, selected.valueKrw, context.currency) : "—";
  const binding = historyRead?.displayBinding;
  const scopeReady = context.mode === "domain" && !context.scope.startsWith("portfolio:") && !!binding && !!view.domain && !["loading", "unauthorized"].includes(view.domain.state);
  const awaiting = view.domain?.state === "loading" || view.domain?.historyState === "loading";
  const blocked = context.mode !== "domain"
    ? t("내 계좌를 연결하면 이 기간을 계산할 수 있어요.", "Connect your account to calculate this period.")
    : context.scope.startsWith("portfolio:")
      ? t("계좌 또는 전체 계좌를 선택해 주세요.", "Select an account or all accounts.")
      : awaiting ? t("계좌를 확인하고 있어요.", "Checking your account.")
        : t("계좌 연결을 확인한 뒤 다시 열어 주세요.", "Check your account connection and reopen history.");

  return <section className={styles.studio} data-history-studio data-compact={compact || undefined} data-mode={mode}>
    {mode !== "return" && <div className={styles.periodBar}>
      <ChoiceGroup appearance="segmented" label={t("히스토리 기간", "History period")}>
        {(["thisMonth", "lastMonth"] as const).map(option => <Button variant="bare" type="button" key={option}
          aria-pressed={preset === option} onClick={() => {
            setHistoryStudio({ ...state, preset: option, range: calendarAttributionRange(option, today) });
            setEditing(false); setAttempted(false);
          }}>{option === "thisMonth" ? t("이번 달", "This month") : t("지난달", "Last month")}</Button>)}
        <Button variant="bare" type="button" aria-expanded={editing} aria-pressed={preset === "custom"} onClick={() => {
          setDraft(range); setAttempted(false); setEditing(!editing);
        }}>{t("직접 선택", "Custom")}</Button>
      </ChoiceGroup>
      <span className={styles.range}>{range.start.slice(5).replace("-", ".")} – {range.end.slice(5).replace("-", ".")}</span>
    </div>}
    <div className={styles.modes}>
      <ChoiceGroup appearance="underline" label={t("히스토리 보기", "History view")}>
        {([["value", t("평가 추이", "Value")], ["impact", t("가격·환율", "Price & FX")],
          ["compare", t("가상 비교", "What if")], ["return", t("수익률", "Return")]] as const).map(([key, label]) =>
          <Button variant="bare" type="button" key={key} aria-pressed={mode === key} onClick={() => changeMode(key)}>{label}</Button>)}
      </ChoiceGroup>
    </div>
    {editing && mode !== "return" && <Form className={styles.dates} noValidate onSubmit={event => {
      event.preventDefault(); setAttempted(true); if (valid) changeRange(draft);
    }}>
      {(["start", "end"] as const).map(key => <Field key={key} label={key === "start" ? t("시작일", "Start date") : t("종료일", "End date")}>
        <Input type="date" required max={today} value={draft[key]} aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
      </Field>)}
      <Button type="submit" variant="secondary">{t("적용", "Apply")}</Button>
      {error && <ValidationMessage id={errorId}>{error}</ValidationMessage>}
    </Form>}
    <div className={styles.scene}>
      {mode === "value" && <>
        <div className={styles.selected} data-studio-selected-date={selected?.date}>
          <span>{selected?.date?.slice(5).replace("-", ".") ?? "—"} · {selected?.source === CURRENT_VALUATION_SOURCE ? t("현재 평가", "Current value") : t("저장 평가", "Recorded value")}</span>
          <strong>{displayValue}<small>{context.currency === "KRW" ? t("원", "KRW") : "USD"}</small></strong>
          {selected?.rowKind === "partial" && <small>{t("확인된 종목 소계", "Confirmed holdings subtotal")}</small>}
        </div>
        {historyHidden ? <p role="status" className={styles.empty}>{awaiting ? t("기록을 확인하고 있어요.", "Checking history.") : t("계좌 연결을 확인해 주세요.", "Check your account connection.")}</p>
          : <HistoryChart view={view} compact interactive currency={context.currency} dateRange={range} />}
      </>}
      {mode === "return" && (legacyDetail ?? <>
        <HistoryChart view={view} compact interactive currency={context.currency} />
        <PeriodControls />
      </>)}
      {(mode === "impact" || mode === "compare") && (suspended
        ? <div className={styles.suspended} aria-hidden data-studio-suspended />
        : !scopeReady || awaiting
        ? <div className={styles.empty}><p role="status">{blocked}</p>
          {onAllAccounts && context.scope.startsWith("portfolio:") && <Button variant="secondary" onClick={onAllAccounts}>{t("전체 계좌로 조회", "View all accounts")}</Button>}
        </div>
        : mode === "impact"
          ? <PeriodAttributionPanel key={JSON.stringify([identity, historyRead?.readReceipt])} scope={context.scope} binding={binding!}
              receipt={historyRead?.readReceipt} range={range} compact={compact} selectedDate={historyDate} onDateChange={setHistoryDate} />
          : <HistoryBenchmark context={context} range={range} binding={binding!} receipt={historyRead?.readReceipt}
              selectedDate={historyDate ?? undefined} onDateChange={setHistoryDate} onRangeChange={changeRange} />)}
    </div>
    {mode !== "return" && <div className={styles.nextRow}>
      <span>{context.mode !== "domain" ? t("예시 데이터", "Example data") : (mode === "impact" || mode === "compare") ? t("원화 기준", "KRW basis") : ""}</span>
      <Button variant="bare" type="button" onClick={() => changeMode(mode === "compare" ? "impact" : "compare")}>
        {mode === "compare" ? t("가격·환율 보기", "Explore price & FX") : t("이 기간, 다르게 투자했다면?", "What if I invested differently?")}<ArrowRight size={14} aria-hidden />
      </Button>
    </div>}
    {!compact && mode === "value" && legacyDetail && <InfoDisclosure summary={t("기록과 출처 확인", "Records and sources")} className={styles.evidence}>{legacyDetail}</InfoDisclosure>}
  </section>;
}
