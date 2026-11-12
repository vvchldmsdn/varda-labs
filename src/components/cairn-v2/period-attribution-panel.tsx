"use client";

import { useEffect, useId, useState } from "react";
import { Button, ChoiceGroup, Field, Form, InfoDisclosure, Input, ValidationMessage } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { currentKstDate } from "@/lib/current-kst-date";
import {
  calendarAttributionRange, MAX_ATTRIBUTION_DAYS, validateAttributionRange,
  type PeriodAttribution, type PeriodAttributionRange, type PeriodGapReason,
} from "@/lib/cairn-v2/period-attribution";
import { PeriodImpactChart, formatWon } from "./period-impact-chart";
import styles from "./period-attribution.module.css";

type ReadContext = { scope: string; binding: string; receipt?: string };
type Preset = "thisMonth" | "lastMonth" | "custom";

export function PeriodAttributionPanel({ scope, binding, receipt }: ReadContext) {
  const { t } = useI18n();
  const today = currentKstDate(new Date());
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [draft, setDraft] = useState(() => calendarAttributionRange("thisMonth", today));
  const [custom, setCustom] = useState<PeriodAttributionRange | null>(null);
  const [attempted, setAttempted] = useState(false);
  const errorId = useId();
  const range = preset === "custom" ? custom : calendarAttributionRange(preset, today);
  const error = !attempted || validateAttributionRange(draft, today) ? "" :
    !draft.start || !draft.end ? t("시작일과 종료일을 입력해 주세요.", "Enter both dates.") :
    draft.start > draft.end ? t("종료일은 시작일과 같거나 늦어야 해요.", "End date must be on or after start date.") :
    draft.end > today ? t("오늘까지의 날짜를 선택해 주세요.", "Choose a date up to today.") :
    t(`한 번에 ${MAX_ATTRIBUTION_DAYS}일까지 조회할 수 있어요.`, `Choose up to ${MAX_ATTRIBUTION_DAYS} days at a time.`);

  return <section className={styles.panel} data-period-attribution aria-label={t("기간별 가격·환율 영향", "Price and FX impact by period")}>
    <ChoiceGroup appearance="segmented" label={t("영향 조회 기간", "Impact period")}>
      {(["thisMonth", "lastMonth", "custom"] as const).map(option => <Button key={option} variant="bare" type="button"
        aria-pressed={option === preset} onClick={() => { setPreset(option); setAttempted(false); }}>
        {option === "thisMonth" ? t("이번 달", "This month") : option === "lastMonth" ? t("지난달", "Last month") : t("직접 선택", "Custom")}
      </Button>)}
    </ChoiceGroup>
    {preset === "custom" && <Form noValidate className={styles.dates} onSubmit={event => {
      event.preventDefault();
      setAttempted(true);
      if (validateAttributionRange(draft, today)) setCustom(draft);
    }}>
      {(["start", "end"] as const).map(key => <Field key={key} label={key === "start" ? t("시작일", "Start date") : t("종료일", "End date")}>
        <Input type="date" required max={today} value={draft[key]} aria-describedby={error ? errorId : undefined}
          aria-invalid={!!error || undefined} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
      </Field>)}
      <Button type="submit" variant="primary">{t("기간 적용", "Apply dates")}</Button>
      {error && <ValidationMessage id={errorId} className={styles.error}>{error}</ValidationMessage>}
    </Form>}
    {range && <PeriodRead key={JSON.stringify([binding, receipt, scope, range.start, range.end])}
      range={range} scope={scope} binding={binding} />}
  </section>;
}

type ReadResult = { kind: "ready"; data: PeriodAttribution } | { kind: "error" | "session" };

function PeriodRead({ range, scope, binding }: ReadContext & { range: PeriodAttributionRange }) {
  const { t } = useI18n();
  const [result, setResult] = useState<ReadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { start, end } = range;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ scope, start, end });
        const response = await fetch("/beta/api/history/period-attribution?" + query, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "X-Cairn-Display-Binding": binding },
        });
        if (controller.signal.aborted) return;
        if ([401, 403, 409].includes(response.status) || (response.ok && response.headers.get("X-Cairn-Display-Binding") !== binding)) {
          setResult({ kind: "session" });
          return;
        }
        if (!response.ok) throw new Error("Attribution read failed");
        const data: PeriodAttribution = await response.json();
        if (data.range.start !== start || data.range.end !== end) throw new Error("Mismatched attribution range");
        if (!controller.signal.aborted) setResult({ kind: "ready", data });
      } catch {
        if (!controller.signal.aborted) setResult({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, binding, end, scope, start]);

  if (result?.kind === "ready") return <AttributionResult data={result.data} />;
  return <div className={styles.status}>
    <p role="status">{!result ? t("기간 기록을 불러오고 있어요.", "Loading period records.") :
      result.kind === "session" ? t("계좌 연결이 바뀌었어요. 화면을 새로고침해 주세요.", "Your account connection changed. Refresh this page.") :
      t("기간 기록을 불러오지 못했어요.", "Could not load period records.")}</p>
    {result && <Button variant="secondary" type="button" onClick={() => {
      if (result.kind === "session") { window.location.reload(); return; }
      setResult(null);
      setAttempt(value => value + 1);
    }}>{result.kind === "session" ? t("새로고침", "Refresh") : t("다시 조회", "Try again")}</Button>}
  </div>;
}

const reasons: Record<PeriodGapReason, [string, string]> = {
  account_history: ["계좌 잔고 기록 부족", "Account balance history missing"],
  holding_history: ["보유 종목·수량 기록 부족", "Holdings or quantities missing"],
  price: ["가격 기록 부족", "Price missing"],
  fx: ["환율 기록 부족", "Exchange rate missing"],
  trade: ["거래 기록 확인 필요", "Trade history incomplete"],
  valuation: ["평가 근거 확인 필요", "Valuation evidence incomplete"],
};

const dateLabel = (value: string) => value.replaceAll("-", ".");
const rangeLabel = ({ start, end }: PeriodAttributionRange) => start === end ? dateLabel(start) : dateLabel(start) + " – " + dateLabel(end);

function AttributionResult({ data }: { data: PeriodAttribution }) {
  const { locale, t } = useI18n();
  const money = (value: number | null) => formatWon(value, locale);
  const partial = data.state === "partial";
  const totalLabel = partial ? t("확인 구간 소계", "Confirmed subtotal") : t("합계", "Combined impact");
  const priceLabel = t("가격 영향", "Price impact");
  const fxLabel = t("환율 영향", "FX impact");
  return <div data-attribution-result data-state={data.state} className={styles.result}>
    <p className={styles.range}>{rangeLabel(data.range)}</p>
    {data.state === "unavailable" ? <p role="status" className={styles.unavailable}>{t("이 기간에 가격과 환율을 함께 확인할 수 있는 기록이 없어요.", "No records confirm both price and FX impact in this period.")}</p> :
      <>
        <dl className={styles.numbers}>
          <div data-factor="total"><dt>{totalLabel}</dt><dd>{money(data.totalKrw)}</dd></div>
          <div data-factor="price"><dt>{priceLabel}</dt><dd>{money(data.priceKrw)}</dd></div>
          <div data-factor="fx"><dt>{fxLabel}</dt><dd>{money(data.fxKrw)}</dd></div>
        </dl>
        <PeriodImpactChart days={data.days} />
      </>}
    {!!data.gaps.length && <InfoDisclosure summary={t(`자료가 빠진 구간 · ${data.gaps.length}건`, `Missing records · ${data.gaps.length}`)} className={styles.disclosure}>
      <ul className={styles.gaps}>{data.gaps.map(gap => <li key={JSON.stringify([gap.start,gap.end,gap.account,gap.holding,gap.reason])}>
        <span>{rangeLabel(gap)}</span><div><strong>{t(...reasons[gap.reason])}</strong>
          <small>{[gap.account, gap.holding].filter(Boolean).join(" · ")}</small></div>
      </li>)}</ul>
    </InfoDisclosure>}
    {!!data.holdings.length && <InfoDisclosure summary={t(`종목별 영향 · ${data.holdings.length}건`, `Impact by holding · ${data.holdings.length}`)} className={styles.disclosure}>
      <p>{t("매매 원금을 제외하고, 전량 매도한 날은 실제 체결가와 체결 환율로 계산해요.", "Trade principal is excluded. On a full sale, the calculation uses the execution price and exchange rate.")}</p>
      {partial && <p>{t("확인된 구간의 금액만 표시합니다.", "Amounts cover confirmed records only.")}</p>}
      <table className={styles.holdings}><thead><tr><th scope="col">{t("종목 · 계좌", "Holding · account")}</th><th scope="col">{priceLabel}</th><th scope="col">{fxLabel}</th></tr></thead>
        <tbody>{data.holdings.map(row => <tr key={row.key}><th scope="row">{row.name}<small>{row.account}</small></th><td>{money(row.priceKrw)}</td><td>{money(row.fxKrw)}</td></tr>)}</tbody>
      </table>
    </InfoDisclosure>}
  </div>;
}
