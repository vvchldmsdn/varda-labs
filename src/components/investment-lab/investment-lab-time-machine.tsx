"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Info } from "lucide-react";
import type {
  InvestmentLabScenarioChart,
  InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";
import type { InvestmentLabScenarioMatrixId } from "@/lib/investment-lab-scenario-matrix";
import { buildMonotoneCurvePath } from "@/lib/svg-monotone-curve";
import { InvestmentLabChartCanvas } from "./investment-lab-chart-canvas";
import { InvestmentLabDialog } from "./investment-lab-dialog";
import styles from "./investment-lab-modern.module.css";
import {
  defaultLabScenario,
  labKrw,
  labMoneyTone,
  labPercent,
  labScenarioDetail,
  labScenarioLabel,
  type InvestmentLabTimeMachineScenarioSummary,
  type UnavailableLabScenario,
} from "./investment-lab-chart-presentation";

export type { InvestmentLabTimeMachineScenarioSummary } from "./investment-lab-chart-presentation";

export function InvestmentLabTimeMachine({
  chart,
  details,
  scenarioSummaries,
  unavailableScenarios = [],
}: {
  chart: InvestmentLabScenarioChart;
  details?: ReactNode;
  scenarioSummaries: readonly InvestmentLabTimeMachineScenarioSummary[];
  unavailableScenarios?: readonly UnavailableLabScenario[];
}) {
  const [requested, setRequested] = useState<InvestmentLabScenarioMatrixId>(
    () => defaultLabScenario(chart),
  );
  const [unavailable, setUnavailable] =
    useState<InvestmentLabScenarioMatrixId | null>(null);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const actual = chart.lines.find((line) => line.id === "actual");
  const selected =
    chart.lines.find((line) => line.id === requested) ??
    chart.lines.find((line) => line.id === defaultLabScenario(chart));
  const summaries = useMemo(
    () => new Map(scenarioSummaries.map((row) => [row.id, row])),
    [scenarioSummaries],
  );
  if (!actual || !selected || !chart.period) return null;

  const summary = summaries.get(selected.id);
  const actualSummary = summaries.get("actual");
  const ready = chart.lines.filter((line) => line.id !== "actual");
  const unavailableDetail = unavailableScenarios.find(
    (item) => item.id === unavailable,
  );

  return (
    <div className={styles.comparison} data-lab-comparison="interactive" data-selected-scenario={selected.id}>
      <InvestmentLabChartCanvas actual={actual} chart={chart} selected={selected} sidebar={
          <div className={styles.headline}>
            {unavailableScenarios.length ? <p className={styles.readinessNote}>{unavailableScenarios.length}개 시나리오 · 추가 근거 필요</p> : null}
            <div>
              <h2>
                비교 시나리오
              </h2>

            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="sr-only" htmlFor="investment-lab-scenario-select">
                비교 시나리오
              </label>
              <select
                className="min-h-10 max-w-[230px] rounded-full border border-[var(--line)] bg-transparent px-4 text-xs"
                id="investment-lab-scenario-select"
                onChange={(event) => {
                  setRequested(event.target.value as InvestmentLabScenarioMatrixId);
                  setUnavailable(null);
                }}
                value={selected.id}
              >
                {ready.map((line) => (
                  <option key={line.id} value={line.id}>
                    {labScenarioLabel(line.id)}
                  </option>
                ))}
              </select>
              <InvestmentLabDialog
                icon="info"
                label="비교 기준"
                title="무엇을 비교하나요?"
                compactLabel
              >
              <div className="max-w-2xl space-y-5 text-sm leading-7 text-[var(--muted)]">
                <p>
                  <strong className="font-medium text-[var(--ink)]">
                    같은 기간, 같은 외부 입출금
                  </strong>
                  <br />
                  검은 선은 저장된 실제 평가액, 주황 선은 같은 시작 평가액과
                  입출금으로 계산한 선택 시나리오입니다. 계좌 사이의 이동은
                  선택한 분석 범위에 맞춰 처리합니다.
                </p>
                <p>
                  <strong className="font-medium text-[var(--ink)]">
                    평가액 차이와 수익률은 다릅니다
                  </strong>
                  <br />
                  평가액에는 입출금이 포함됩니다. 아래 추정수익률과 낙폭은 외부
                  흐름을 조정한 기존 계산 결과를 사용합니다. 계산 근거가 없으면
                  숫자를 만들지 않습니다.
                </p>
                <p>
                  <strong className="font-medium text-[var(--ink)]">
                    과거 비교이지 미래 예측이 아닙니다
                  </strong>
                  <br />
                  KIS 원종가 경로에는 배당·기업행사 조정과 투자자 수준의
                  거래비용·세금이 포함되지 않습니다. 곡선은 저장된 관측점을
                  부드럽게 연결한 표시이며, 새로운 평가 데이터를 생성하지
                  않습니다.
                </p>
              </div>
              </InvestmentLabDialog>
            </div>
          </div>


      } />
          <div className={styles.chartFooter}>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-2">
                <i aria-hidden="true" className="h-0.5 w-5 bg-[var(--ink)]" />
                실제 포트폴리오
              </span>
              {selected.id !== "actual" ? (
                <span className="inline-flex items-center gap-2">
                  <i aria-hidden="true" className="h-0.5 w-5 bg-[var(--accent)]" />
                  {labScenarioLabel(selected.id)}
                </span>
              ) : null}
            </div>
            <InvestmentLabDialog
              icon="table"
              label="날짜별 수치"
              size="wide"
              title={`${labScenarioLabel(selected.id)} · 날짜별 비교`}
            >
              {() => (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead className="text-left text-xs text-[var(--muted)]">
                    <tr>
                      <th className="py-3">평가일</th>
                      <th className="p-3 text-right">실제 평가액</th>
                      <th className="p-3 text-right">비교 평가액</th>
                      <th className="py-3 pl-3 text-right">차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actual.points.map((point, index) => {
                      const alternative = selected.points[index];
                      if (
                        !alternative ||
                        alternative.serviceDate !== point.serviceDate
                      )
                        return null;
                      const delta = alternative.valueKrw - point.valueKrw;
                      return (
                        <tr
                          className="border-t border-[var(--wash)] tabular-nums"
                          key={point.serviceDate}
                        >
                          <th className="py-3 text-left font-normal">
                            {point.serviceDate}
                          </th>
                          <td className="p-3 text-right">
                            {labKrw(point.valueKrw)}
                          </td>
                          <td className="p-3 text-right">
                            {labKrw(alternative.valueKrw)}
                            {alternative.hasPendingExecution ? (
                              <span className="ml-1 text-xs text-[var(--warning)]">
                                대기 거래
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`py-3 pl-3 text-right ${labMoneyTone(delta)}`}
                          >
                            {labKrw(delta, true)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </InvestmentLabDialog>
          <InvestmentLabDialog label="시나리오·성과" title="시나리오와 성과 비교" size="wide">
        {() => <>
        {details ? <div className="mb-6 flex flex-wrap gap-3">{details}</div> : null}
        <aside
          className={styles.scenarios}
          aria-label="비교 시나리오"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-[var(--muted)]">
              비교 시나리오
            </h3>
            <span className="text-[10px] tabular-nums text-[var(--faint)]">
              {ready.length}개 경로
            </span>
          </div>
          <div className="mb-4 flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-[var(--ink)]" />
              실제 포트폴리오
            </span>
            <span className="font-medium tabular-nums">
              {labKrw(
                actualSummary?.endValueKrw ?? actual.points.at(-1)!.valueKrw,
              )}
            </span>
          </div>
          <div
            className={styles.scenarioList}
            data-lab-scenario-list
          >
            {ready.map((line) => {
              const active = line.id === selected.id;
              return (
                <button
                  aria-pressed={active}
                  className={`${styles.scenario} ${active ? styles.scenarioActive : ""}`}
                  key={line.id}
                  onClick={() => {
                    setRequested(line.id);
                    setUnavailable(null);
                  }}
                  title={line.label}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[12px] font-medium leading-5">
                      {labScenarioLabel(line.id)}
                      {active ? (
                        <Check
                          aria-hidden="true"
                          className="shrink-0 text-[var(--brand)]"
                          size={12}
                        />
                      ) : null}
                    </span>
                    <span className="mt-1 block text-[11px] tabular-nums text-[var(--faint)]">
                      {labKrw(
                        summaries.get(line.id)?.endDifferenceKrw ?? null,
                        true,
                      )}
                    </span>
                  </span>
                  <MiniPath line={line} active={active} />
                </button>
              );
            })}
          </div>
          {unavailableScenarios.length > 0 ? (
            <div className="mt-4 border-t border-[var(--wash)] pt-3">
              <button
                aria-expanded={showUnavailable}
                className="flex min-h-9 w-full items-center justify-between text-xs text-[var(--muted)]"
                onClick={() => setShowUnavailable(!showUnavailable)}
                type="button"
              >
                <span>
                  추가 근거가 필요한 경로 {unavailableScenarios.length}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={showUnavailable ? "rotate-180" : ""}
                  size={14}
                />
              </button>
              {showUnavailable ? (
                <div className="space-y-1">
                  {unavailableScenarios.map((item) => (
                    <button
                      aria-expanded={unavailable === item.id}
                      className="flex w-full items-start gap-2 rounded py-2 text-left text-xs text-[var(--warning)] hover:text-[var(--ink)]"
                      key={item.id}
                      onClick={() =>
                        setUnavailable(item.id === unavailable ? null : item.id)
                      }
                      type="button"
                    >
                      <Info
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                        size={13}
                      />
                      {labScenarioLabel(item.id)}
                    </button>
                  ))}
                </div>
              ) : null}
              {showUnavailable && unavailableDetail ? (
                <div
                  className="mt-2 border-l-2 border-[var(--warning-soft)] pl-3 text-xs leading-6"
                  role="status"
                >
                  <p className="text-[var(--warning)]">{unavailableDetail.reason}</p>
                  <p className="mt-2 text-[var(--muted)]">
                    {unavailableDetail.resolution}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>      <dl
        className={styles.metrics}
        data-lab-metrics
      >
        <Metric
          label="비교 종료 평가액"
          value={labKrw(summary?.endValueKrw ?? null)}
          baseline={`실제 ${labKrw(actualSummary?.endValueKrw ?? null)}`}
        />
        <Metric
          label="추정수익률"
          value={labPercent(summary?.returnEstimate ?? null, true)}
          baseline={`실제 ${labPercent(actualSummary?.returnEstimate ?? null, true)}`}
        />
        <Metric
          label="최대 낙폭"
          value={labPercent(
            summary?.maximumDrawdown == null
              ? null
              : -Math.abs(summary.maximumDrawdown),
          )}
          baseline={`실제 ${labPercent(actualSummary?.maximumDrawdown == null ? null : -Math.abs(actualSummary.maximumDrawdown))}`}
        />
        <Metric
          label="연환산 변동성"
          value={labPercent(summary?.annualizedVolatility ?? null)}
          baseline={
            summary?.annualizedVolatility == null
              ? "연속 일간 수익률 근거 필요"
              : `실제 ${labPercent(actualSummary?.annualizedVolatility ?? null)}`
          }
        />
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2 py-4 text-[11px] text-[var(--faint)]">
        <span>{labScenarioDetail(selected.id)}</span>
        <span>
          {chart.period!.comparisonDateCount}개 평가일 · 같은 기간·입출금
        </span>
      </div>
           </>}
           </InvestmentLabDialog>
          </div>
    </div>
  );
}

function Metric({
  label,
  value,
  baseline,
}: {
  label: string;
  value: string;
  baseline: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-[var(--faint)]">{label}</dt>
      <dd className="mt-2 break-words text-lg font-medium tabular-nums sm:text-xl">
        {value}
      </dd>
      <dd className="mt-2 text-[11px] tabular-nums text-[var(--faint)]">
        {baseline}
      </dd>
    </div>
  );
}

function MiniPath({
  line,
  active,
}: {
  line: InvestmentLabScenarioChartLine;
  active: boolean;
}) {
  const values = line.points.map((point) => point.valueKrw);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const path = buildMonotoneCurvePath(
    values.map((value, index) => ({
      x: 2 + (index / Math.max(values.length - 1, 1)) * 54,
      y: 28 - ((value - min) / range) * 24,
    })),
  );
  return (
    <svg aria-hidden="true" className="h-8 w-[58px]" viewBox="0 0 58 32">
      <path
        d={path}
        fill="none"
        stroke={active ? "var(--brand)" : "var(--line)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}
