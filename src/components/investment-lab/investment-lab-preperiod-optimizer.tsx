"use client";

import { useState } from "react";

import { InvestmentLabComparisonChart } from "@/components/investment-lab/investment-lab-comparison-chart";
import type {
  InvestmentLabPreperiodOptimizer,
  InvestmentLabPreperiodOptimizerCandidate,
} from "@/lib/investment-lab-preperiod-optimizer";
import type { InvestmentLabOptimizerObjective } from "@/lib/investment-lab-preperiod-optimizer-math";

const OBJECTIVES: readonly Readonly<{
  id: InvestmentLabOptimizerObjective;
  label: string;
}>[] = [
  { id: "highest_return", label: "학습 수익 최대" },
  { id: "minimum_volatility", label: "학습 변동성 최소" },
  { id: "minimum_drawdown", label: "학습 낙폭 최소" },
  { id: "maximum_sharpe", label: "학습 샤프 최대" },
];

export function InvestmentLabPreperiodOptimizerView({
  model,
}: {
  model: InvestmentLabPreperiodOptimizer;
}) {
  const initialObjective =
    model.candidates.find(
      (candidate) => candidate.objective === "minimum_volatility",
    )?.objective ?? model.candidates[0]?.objective ?? "minimum_volatility";
  const [selectedObjective, setSelectedObjective] =
    useState<InvestmentLabOptimizerObjective>(initialObjective);
  const candidate =
    model.candidates.find((row) => row.objective === selectedObjective) ??
    model.candidates[0];

  return (
    <section
      className="border-t border-[#dde1db] bg-[#f8f9f6] px-5 py-12 sm:px-8 lg:px-10"
      data-optimizer-candidate-count={model.candidates.length}
      data-optimizer-status={model.status}
      data-section="investment-lab-preperiod-optimizer"
    >
      <div className="mx-auto w-full max-w-[1540px] overflow-hidden">
        <header className="border-b border-[#dde1db] pb-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-[11px] font-medium text-[#777d75]">OBJECTIVE LAB</p>
              <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">과거 학습 비중 실험</h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-[#687064]">
                비교 시작일 이전의 공통 가격 60개 수익률만으로 비중 후보를
                만들고, 이후 실제 기간에는 같은 입출금과 리밸런싱하지 않는
                조건으로 비교합니다. 수동 평가 종목은 시작 비중을 유지합니다.
              </p>
            </div>
            <p className="text-sm font-semibold text-[#4f584f]">
              {statusLabel(model.status)}
            </p>
          </div>
        </header>

        {candidate && model.training ? (
          <>
            <div className="border-b border-[#dde1db] py-3">
              <div
                aria-label="비중 후보 선택"
                className="grid grid-cols-2 gap-x-6 lg:inline-grid lg:grid-cols-4"
                role="group"
              >
                {OBJECTIVES.map((objective) => (
                  <button
                    aria-pressed={candidate.objective === objective.id}
                    className={`min-h-10 border-b-2 px-1 py-2 text-sm font-semibold ${
                      candidate.objective === objective.id
                        ? "border-[#20231f] text-[#20231f]"
                        : "border-transparent text-[#777d75] hover:text-[#20231f]"
                    }`}
                    key={objective.id}
                    onClick={() => setSelectedObjective(objective.id)}
                    type="button"
                  >
                    {objective.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid border-b border-[#dde1db] sm:grid-cols-2 xl:grid-cols-5">
              <Metric
                detail={`${model.training.returnObservationCount}개 수익률 · 상장 ${model.training.instrumentCount}개`}
                label="학습 구간"
                value={`${formatDate(model.training.startPriceDate)} ~ ${formatDate(model.training.endPriceDate)}`}
              />
              <Metric
                detail="KIS 원종가 · 배당/분할 미조정"
                label="누적 수익"
                value={formatPercent(candidate.trainingMetrics.terminalReturn)}
              />
              <Metric
                detail="252일 환산"
                label="변동성"
                value={formatPercent(
                  candidate.trainingMetrics.annualizedVolatility,
                )}
              />
              <Metric
                detail="학습 구간 최대 하락"
                label="최대 낙폭"
                value={formatPercent(
                  -candidate.trainingMetrics.maximumDrawdown,
                )}
              />
              <Metric
                detail="무위험 수익률 0% 가정"
                label="샤프"
                value={formatNumber(
                  candidate.trainingMetrics.annualizedSharpe,
                )}
              />
            </div>

            {candidate.scenario.status === "ready" ? (
              <ReadyCandidate candidate={candidate} />
            ) : (
              <div className="px-4 py-5">
                <p className="font-semibold text-[#8a641f]">
                  비중 후보는 계산됐지만 이후 비교 경로 근거가 부족합니다.
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6d6657]">
                  이 실험만 숨기며 실제 포트폴리오와 다른 계산 가능한 시나리오는
                  계속 표시합니다.
                </p>
                <WeightTable candidate={candidate} />
              </div>
            )}
          </>
        ) : (
          <Unavailable model={model} />
        )}

        <p className="border-t border-[#dde1db] py-4 text-xs leading-5 text-[#73786c]">
          학습 지표는 수동 평가 종목을 제외한 상장 종목 부분 기준입니다. 이
          결과는 과거 학습 구간을 뒤늦게 보고 만든 연구 후보이며 미래 성과,
          주문 가능성, 세금·거래비용을 보장하지 않습니다. 현재 보유비중이나
          목표비중도 자동으로 바꾸지 않습니다.
        </p>
      </div>
    </section>
  );
}

function ReadyCandidate({
  candidate,
}: {
  candidate: InvestmentLabPreperiodOptimizerCandidate;
}) {
  if (
    candidate.scenario.status !== "ready" ||
    !candidate.scenario.returnEstimate ||
    !candidate.scenario.summary
  ) {
    return null;
  }
  const estimate = candidate.scenario.returnEstimate;
  const summary = candidate.scenario.summary;
  return (
    <div className="grid gap-8 py-7 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <InvestmentLabComparisonChart
          chartId={`investment-lab-optimizer-${candidate.objective}`}
          description="같은 비교 기간과 입출금 조건에서 실제 평가액과 과거 학습 비중 후보의 평가액 경로를 비교합니다."
          rows={candidate.scenario.rows}
          scenarioLabel={objectiveLabel(candidate.objective)}
          title="실제 포트폴리오와 학습 비중 후보 비교"
        />
      </div>
      <div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-[#e1e6dc] pb-4 text-sm">
          <EvidenceRow
            label="후보 기간 수익률"
            value={formatPercent(estimate.scenarioReturn)}
          />
          <EvidenceRow
            label="실제 기간 수익률"
            value={formatPercent(estimate.actualReturn)}
          />
          <EvidenceRow
            label="종료 평가액 차이"
            value={formatKrw(summary.endDifferenceKrw)}
          />
          <EvidenceRow
            label="비교 관측일"
            value={`${summary.comparisonDateCount}일`}
          />
        </dl>
        <WeightTable candidate={candidate} />
      </div>
    </div>
  );
}

function WeightTable({
  candidate,
}: {
  candidate: InvestmentLabPreperiodOptimizerCandidate;
}) {
  const rows = [...candidate.weights].sort(
    (left, right) =>
      right.weightBps - left.weightBps ||
      left.instrumentKey.localeCompare(right.instrumentKey),
  );
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[320px] text-left text-sm">
        <thead className="text-xs text-[#687064]">
          <tr>
            <th className="pb-2 font-semibold">종목</th>
            <th className="pb-2 text-right font-semibold">학습 비중</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e1e6dc]">
          {rows.map((row) => (
            <tr key={row.instrumentKey}>
              <td className="py-2">
                <span className="font-semibold">{row.label}</span>
                <span className="ml-2 text-xs text-[#73786c]">
                  {row.instrumentKey}
                </span>
                {row.allocationRole === "fixed_manual" ? (
                  <span className="ml-2 text-xs font-semibold text-[#8a641f]">
                    시작 비중 고정
                  </span>
                ) : null}
              </td>
              <td className="py-2 text-right font-semibold tabular-nums">
                {(row.weightBps / 100).toFixed(
                  row.weightBps % 100 === 0 ? 0 : 2,
                )}
                %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Unavailable({ model }: { model: InvestmentLabPreperiodOptimizer }) {
  return (
    <div className="py-6">
      <p className="font-semibold text-[#8a641f]">
        현재 계정 범위에서는 학습 비중 후보를 만들 수 없습니다.
      </p>
      <p className="mt-2 text-sm leading-6 text-[#6d6657]">
        필요한 모든 종목의 비교 시작일 이전 공통 종가가 61개 이상 있어야
        합니다. 수동 평가 종목은 과거 가격을 임의로 채우지 않고 시작일 저장
        비중으로 고정합니다.
      </p>
      <dl className="mt-4 grid max-w-xl grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <EvidenceRow
          label="공통 가격일"
          value={`${model.coverage.commonPriceDateCount}/61`}
        />
        <EvidenceRow
          label="가격 원본 행"
          value={String(model.coverage.sourcePriceRows)}
        />
        <EvidenceRow
          label="환율 원본 행"
          value={String(model.coverage.sourceFxRows)}
        />
        <EvidenceRow
          label="차단 사유"
          value={blockerLabel(model.blockers[0])}
        />
      </dl>
    </div>
  );
}

function Metric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-[#dde1db] px-4 py-5 xl:border-b-0 xl:border-r xl:last:border-r-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-base font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#73786c]">{detail}</p>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-[#687064]">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function objectiveLabel(objective: InvestmentLabOptimizerObjective) {
  return OBJECTIVES.find((row) => row.id === objective)?.label ?? objective;
}

function statusLabel(status: InvestmentLabPreperiodOptimizer["status"]) {
  if (status === "ready") return "비교 가능";
  if (status === "path_unavailable") return "비중만 계산";
  return "학습 근거 부족";
}

function blockerLabel(value?: string) {
  switch (value) {
    case "manual_valuation_preperiod_unavailable":
      return "수동 평가 종목 포함";
    case "insufficient_common_preperiod_rows":
      return "공통 과거 종가 부족";
    case "unsupported_optimizer_instrument_count":
      return "지원 종목 수 범위 밖";
    case "anchor_selection_unavailable":
      return "비교 시작점 없음";
    default:
      return value ? "계산 근거 확인 필요" : "-";
  }
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null) {
  return value === null ? "-" : value.toFixed(2);
}

function formatKrw(value: number) {
  return `${value >= 0 ? "+" : "-"}₩${Math.abs(Math.round(value)).toLocaleString("ko-KR")}`;
}
