"use client";

import { useState } from "react";

import type { SimulationOwnerCandidateComparisonResult } from "@/lib/simulation-owner-candidate-comparison";

import {
  ResearchFanChart,
  resolveResearchFanChartValueDomain,
} from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

type ReadyComparison = Extract<
  SimulationOwnerCandidateComparisonResult,
  { status: "ready" }
>;
type OutcomeCandidate = ReadyComparison["outcomeCandidates"][number];

export function OwnerOutcomeCandidateExplorer({
  account,
  candidates,
  currentExecution,
  reason,
  status,
}: {
  account: string;
  candidates: ReadyComparison["outcomeCandidates"];
  currentExecution: ReadyComparison["currentExecution"];
  reason: ReadyComparison["outcomeCandidateReason"];
  status: ReadyComparison["outcomeCandidateStatus"];
}) {
  const [selectedObjective, setSelectedObjective] =
    useState<OutcomeCandidate["objective"] | null>(
      candidates[0]?.objective ?? null,
    );
  const selected =
    candidates.find((candidate) => candidate.objective === selectedObjective) ??
    candidates[0] ??
    null;

  return (
    <div
      className="mt-6 border-t border-[var(--line)] pt-5"
      data-owner-outcome-candidates
      data-owner-outcome-candidates-status={status}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            확률 경로를 비중으로 역산
          </p>
          <h3 className="mt-1 text-base font-semibold">목적별 비중 후보</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            500개 경로를 탐색용 250개와 확인용 250개로 분리합니다. 현재
            비중보다 확인용 경로에서도 나아진 경우만 보여주며, 같은 종목·환율
            자료와 같은 무작위 경로를 사용합니다.
          </p>
        </div>
        {selected ? (
          <div
            aria-label="비중 후보 목적"
            className="flex w-fit flex-wrap rounded-md border border-[var(--line)] bg-[var(--surface)] p-1"
            role="tablist"
          >
            {candidates.map((candidate) => (
              <button
                aria-selected={candidate.objective === selected.objective}
                className={`min-h-9 px-3 text-sm font-semibold ${
                  candidate.objective === selected.objective
                    ? "rounded bg-[var(--ink)] text-white"
                    : "text-[var(--muted)]"
                }`}
                key={candidate.objective}
                onClick={() => setSelectedObjective(candidate.objective)}
                role="tab"
                type="button"
              >
                {objectiveLabel(candidate.objective)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {selected ? (
        <ReadyOutcomeCandidate
          account={account}
          candidate={selected}
          currentExecution={currentExecution}
        />
      ) : (
        <div className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-4">
          <p className="font-semibold">확인 경로를 통과한 비중 후보가 없습니다.</p>
          <p className="mt-1 text-sm leading-6 text-[var(--warning)]">
            {outcomeUnavailableLabel(reason)} 현재 비중의 확률 경로와 기존
            변동성 완화 후보는 그대로 확인할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}

function ReadyOutcomeCandidate({
  account,
  candidate,
  currentExecution,
}: {
  account: string;
  candidate: OutcomeCandidate;
  currentExecution: ReadyComparison["currentExecution"];
}) {
  const current = {
    ...currentExecution,
    id: `owner-current-outcome-${account}`,
    name: "현재 비중",
  };
  const alternative = {
    ...candidate.execution,
    id: `owner-${candidate.objective}-${account}`,
    name: objectiveLabel(candidate.objective),
  };
  const valueDomain = resolveResearchFanChartValueDomain([
    current,
    alternative,
  ]);

  return (
    <div
      className="mt-4"
      data-owner-outcome-candidate-objective={candidate.objective}
    >
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail="확인용 250개 경로"
          label={objectiveMetricLabel(candidate.objective)}
          value={formatSignedPct(
            candidate.confirmation.objectiveImprovementPctPoints,
          )}
        />
        <Metric
          detail="전체 500개 경로 · 후보 - 현재"
          label="중앙값 수익률 차이"
          value={formatSignedPct(candidate.deltas.p50ReturnPctPoints)}
        />
        <Metric
          detail="낮을수록 방어적"
          label="손실 확률 차이"
          value={formatSignedPct(candidate.deltas.lossProbabilityPctPoints)}
        />
        <Metric
          detail={`상한 ${formatWeight(candidate.constraints.maximumOneWayTurnoverBps)}`}
          label="필요한 비중 이동"
          value={formatWeight(candidate.constraints.oneWayTurnoverBps)}
        />
      </dl>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <OutcomeChartCard
          execution={current}
          label="현재 비중"
          valueDomain={valueDomain}
        />
        <OutcomeChartCard
          execution={alternative}
          label={objectiveLabel(candidate.objective)}
          valueDomain={valueDomain}
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full min-w-[620px] border-collapse text-left text-sm">
          <thead className="text-xs text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3 font-semibold">종목</th>
              <th className="px-4 py-3 text-right font-semibold">현재</th>
              <th className="px-4 py-3 text-right font-semibold">후보</th>
              <th className="px-4 py-3 text-right font-semibold">변화</th>
            </tr>
          </thead>
          <tbody>
            {[...candidate.weights]
              .sort(
                (left, right) =>
                  Math.abs(right.changeBps) - Math.abs(left.changeBps) ||
                  asciiCompare(left.instrumentKey, right.instrumentKey),
              )
              .map((row) => (
                <tr
                  className="border-t border-[var(--line)]"
                  key={row.instrumentKey}
                >
                  <td className="px-4 py-3">
                    <p className="font-semibold">{row.ticker}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {row.market} · {row.currency}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatWeight(row.currentWeightBps)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatWeight(row.candidateWeightBps)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatSignedWeight(row.changeBps)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
        이 후보는 종목당 최대 {formatWeight(candidate.constraints.maximumInstrumentWeightBps)},
        한 방향 비중 이동 최대 {formatWeight(candidate.constraints.maximumOneWayTurnoverBps)},
        외화 비중 변화 최대 {formatWeight(candidate.constraints.maximumFxExposureChangeBps)}를
        지킵니다. 조회 시 계산되는 연구 결과이며 수수료·세금·주문 가능 여부를
        반영한 투자 추천이 아닙니다.
      </p>
    </div>
  );
}

function OutcomeChartCard({
  execution,
  label,
  valueDomain,
}: {
  execution: ReadyComparison["currentExecution"] & {
    id: string;
    name: string;
  };
  label: string;
  valueDomain: ReturnType<typeof resolveResearchFanChartValueDomain>;
}) {
  return (
    <article className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
      <h4 className="border-b border-[var(--line)] px-4 py-3 font-semibold">
        {label}
      </h4>
      <SimulationTerminalRiskMetrics compact terminal={execution.terminal} />
      <ResearchFanChart execution={execution} valueDomain={valueDomain} />
    </article>
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
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[var(--muted)]">{detail}</dd>
    </div>
  );
}

function objectiveLabel(objective: OutcomeCandidate["objective"]) {
  const labels = {
    median_growth: "중앙값 수익",
    downside_floor: "하방 방어",
    balanced_growth_defense: "수익·방어 균형",
  } as const;
  return labels[objective];
}

function objectiveMetricLabel(objective: OutcomeCandidate["objective"]) {
  return objective === "median_growth"
    ? "중앙값 개선"
    : objective === "downside_floor"
      ? "P10 개선"
      : "균형 점수 개선";
}

function outcomeUnavailableLabel(
  reason: ReadyComparison["outcomeCandidateReason"],
) {
  const labels = {
    input_shape_mismatch: "계산 가능한 종목과 현재 비중의 순서가 맞지 않습니다.",
    insufficient_partition_paths: "탐색·확인에 필요한 경로 수가 부족합니다.",
    outcome_evaluation_failed: "확률 경로의 결과 지표를 계산하지 못했습니다.",
    no_confirmed_candidate:
      "회전율·집중도·외화 제약과 확인 경로 개선을 함께 만족한 대안이 없습니다.",
  } as const;
  return reason && reason in labels
    ? labels[reason as keyof typeof labels]
    : "현재 입력에서는 목적별 대안을 만들지 못했습니다.";
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}

function formatSignedWeight(weightBps: number) {
  const value = weightBps / 100;
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%p`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function asciiCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
