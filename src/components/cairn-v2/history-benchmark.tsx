"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, ChoiceGroup, InfoDisclosure } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { labHref } from "@/lib/cairn-v2/lab-contract";
import type { PeriodAttributionRange } from "@/lib/cairn-v2/period-attribution";
import type { BenchmarkChoice, BenchmarkIssue, HistoryBenchmarkRead } from "@/lib/cairn-v2/history-benchmark";
import { HistoryBenchmarkChart } from "./history-benchmark-chart";
import styles from "./history-benchmark.module.css";

type Props = {
  context: BetaContext; range: PeriodAttributionRange; binding: string; receipt?: string;
  selectedDate?: string | null; onDateChange?: (date: string) => void;
  onRangeChange?: (range: PeriodAttributionRange) => void;
};
type Result = { kind: "ready"; data: HistoryBenchmarkRead } | { kind: "session" | "error" };
const labels: Record<BenchmarkChoice, string> = { mix: "KODEX 200 + VOO", kodex: "KODEX 200", voo: "VOO" };
const issueLabels: Record<BenchmarkIssue, [string, string]> = {
  period: ["시작일과 종료일의 잔고 기록이 필요해요.", "Balance records are needed at both period endpoints."],
  valuation: ["같은 기준으로 비교할 잔고·평가 기록이 부족해요.", "Comparable balance or valuation records are missing."],
  trade: ["거래 당시 금액이나 시작일의 거래 순서를 확인해야 해요.", "Trade amounts or the opening-day trade order need verification."],
  price: ["이 기간의 종가 자료가 부족해요.", "Closing-price records are missing for this period."],
  fx: ["거래·평가 당시 환율 자료가 부족해요.", "Exchange rates at trade or valuation time are missing."],
  execution: ["기간 안에 처리할 수 없는 가상 매매 금액이 있어요.", "Some hypothetical trade amounts cannot be processed within this period."],
};

export function HistoryBenchmark(props: Props) {
  const { t } = useI18n();
  if (props.context.mode !== "domain") return <p className={styles.notice}>{t("내 계좌의 기록으로 가상 배분을 비교할 수 있어요.", "Compare hypothetical allocations using your account records.")}</p>;
  if (props.range.start >= props.range.end) return <p role="status" className={styles.notice}>{t("비교할 시작일과 그 이후의 종료일을 선택해 주세요.", "Choose a starting date and a later ending date.")}</p>;
  return <BenchmarkRead key={JSON.stringify([props.binding, props.receipt, props.context.scope, props.range])} {...props} />;
}

function BenchmarkRead(props: Props) {
  const { context, range, binding } = props;
  const { start, end } = range;
  const { t } = useI18n();
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); setResult({ kind: "error" }); }, 45_000);
    async function read() {
      try {
        const response = await fetch("/beta/api/history/comparison?" + new URLSearchParams({ scope: context.scope, start, end }), {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "X-Cairn-Display-Binding": binding },
        });
        if (controller.signal.aborted) return;
        if ([401, 403, 409].includes(response.status) || (response.ok && response.headers.get("X-Cairn-Display-Binding") !== binding)) {
          setResult({ kind: "session" }); return;
        }
        if (!response.ok) throw new Error("Comparison unavailable");
        const data: HistoryBenchmarkRead = await response.json();
        if (data.range.start !== start || data.range.end !== end || data.currency !== "KRW" || !Array.isArray(data.scenarios)) throw new Error("Comparison mismatch");
        if (!controller.signal.aborted) setResult({ kind: "ready", data });
      } catch {
        if (!controller.signal.aborted) setResult({ kind: "error" });
      } finally { clearTimeout(timeout); }
    }
    void read();
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [attempt, binding, context.scope, start, end]);
  if (result?.kind === "ready") return <HistoryBenchmarkResult {...props} data={result.data} />;
  return <div className={styles.status}>
    <p role="status">{!result ? t("같은 조건으로 비교하고 있어요.", "Comparing on the same basis.") : result.kind === "session" ?
      t("계좌 연결이 바뀌었어요. 새로고침해 주세요.", "Your account connection changed. Refresh the page.") :
      t("비교 기록을 불러오지 못했어요.", "Could not load comparison records.")}</p>
    {result && <Button variant="secondary" type="button" onClick={() => {
      if (result.kind === "session") { window.location.reload(); return; }
      setResult(null); setAttempt(value => value + 1);
    }}>{result.kind === "session" ? t("새로고침", "Refresh") : t("다시 조회", "Try again")}</Button>}
  </div>;
}

export function HistoryBenchmarkResult({ data, context, selectedDate, onDateChange, onRangeChange }: Pick<Props, "context" | "selectedDate" | "onDateChange" | "onRangeChange"> & { data: HistoryBenchmarkRead }) {
  const { locale, t } = useI18n();
  const [choice, setChoice] = useState<BenchmarkChoice>("mix");
  const [date, setDate] = useState<string | null>(null);
  const scenario = data.scenarios.find(row => row.choice === choice);
  const points = scenario?.points ?? [];
  const selected = selectedDate ?? date;
  const point = points.find(row => row.date === selected) ?? points.at(-1);
  const money = (value: number, signed = false) => value.toLocaleString(locale, { maximumFractionDigits: 0, signDisplay: signed ? "exceptZero" : "auto" }) + t("원", " KRW");
  const select = (next: string) => { setDate(next); onDateChange?.(next); };
  return <section className={styles.panel} data-history-benchmark data-state={scenario?.state} aria-label={t("다르게 투자했다면", "What if I invested differently")}>
    <header className={styles.heading}>
      <h3>{t("다르게 투자했다면", "What if I invested differently")}</h3>
      <span>{t("같은 시작 금액·매매 금액 · KRW", "Same starting value and trade amounts · KRW")}</span>
    </header>
    <ChoiceGroup appearance="segmented" label={t("가상 배분", "Hypothetical allocation")}>
      {(["mix", "kodex", "voo"] as const).map(id => <Button variant="bare" type="button" key={id} aria-pressed={id === choice} onClick={() => setChoice(id)}>
        {id === "mix" ? "50 : 50" : labels[id]}
      </Button>)}
    </ChoiceGroup>
    {point ? <>
      <div className={styles.date}><time dateTime={point.date}>{point.date.replaceAll("-", ".")}</time><span>{labels[choice]}{choice === "mix" ? " · 50 : 50" : ""}</span></div>
      <dl className={styles.numbers}>
        <div><dt>{t("내 포트폴리오", "My portfolio")}</dt><dd>{money(point.actual)}</dd></div>
        <div data-series="scenario"><dt>{t("가상 배분", "Hypothetical allocation")}</dt><dd>{money(point.hypothetical)}</dd></div>
        <div><dt>{t("가상 − 실제", "Hypothetical − actual")}</dt><dd>{money(point.difference, true)}</dd></div>
      </dl>
      <HistoryBenchmarkChart points={points} selectedDate={point.date} onSelect={select} label={labels[choice]} />
      {point.pending && <p className={styles.notice}>{t("이 날짜에는 아직 가상 매매가 반영되지 않은 금액이 있어요.", "Some hypothetical trade amounts are pending on this date.")}</p>}
    </> : <div className={styles.unavailable}>
      <p role="status">{t("이 조건으로는 아직 비교할 수 없어요.", "This comparison is not available yet.")}</p>
      <ul>{scenario?.issues.map(issue => <li key={issue}>{t(...issueLabels[issue])}</li>)}</ul>
      {data.suggestedRange && onRangeChange ? <Button variant="secondary" type="button" onClick={() => onRangeChange(data.suggestedRange!)}>
        {data.suggestedRange.start.replaceAll("-", ".")}–{data.suggestedRange.end.replaceAll("-", ".")} {t("비교", "Compare")}
      </Button> : <Link href={labHref(context, { start: data.range.start, end: data.range.end, run: "1" })}>{t("부족한 기록 확인", "Review missing records")} →</Link>}
    </div>}
    {data.excludedFount && <p className={styles.notice}>{t("Fount를 제외한 비교예요. 홈 전체 평가액과 범위가 달라요.", "This comparison excludes Fount and differs from the full home valuation.")}</p>}
    <InfoDisclosure className={styles.details} summary={t("비교 기준", "Comparison basis")}>
      <p>{t("시작일의 저장 평가액으로 시작하고, 이후 실제 매수·매도와 같은 원화 금액을 가상 경로에도 반영해요. 중간 매매가 있다면 단순 보유 비교와 달라요.", "Starts from the saved opening valuation and applies the same KRW buy/sell amounts to the hypothetical path. With intervening trades, this is not a buy-and-hold comparison.")}</p>
      <p>{t("50:50은 시작 금액과 이후 매매 금액의 배분이에요. 가격이 달라져도 비중을 다시 맞추지 않아요. 각 시장에서 확인된 종가와 당시 환율을 사용해요. 실제 주문이나 추천이 아니에요.", "50:50 allocates opening value and each later trade amount equally, without rebalancing as prices move. Uses confirmed historical closes and exchange rates. No orders or recommendations.")}</p>
      <p>{t("선을 잇는 사이는 저장된 관측일 사이의 연결이며, 누락 날짜의 평가액을 생성하지 않아요. 수수료·세금·거래단위 차이는 반영하지 않아요.", "Lines connect saved observations and do not create valuations on missing dates. Fees, taxes and trading-lot differences are not included.")}</p>
      {data.trades.length > 0 && <ul>{data.trades.map((trade, i) => <li key={i}>{trade.date} · {trade.label ?? t("거래 기록", "Trade record")} · {trade.reason === "opening_boundary" ? t("시작일 순서 확인 필요", "Opening-day order unknown") : trade.reason === "fx_missing" ? t("당시 환율 확인 필요", "Historical FX needed") : t("거래 금액 확인 필요", "Trade amount needed")}</li>)}</ul>}
    </InfoDisclosure>
  </section>;
}
