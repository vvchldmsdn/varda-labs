"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  calculateInvestmentLabContributionExperiment,
  INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY,
  type InvestmentLabContributionExperimentResult,
  type InvestmentLabContributionScenarioEvidence,
  type InvestmentLabContributionScenarioId,
  type InvestmentLabContributionPriceBasis,
} from "@/lib/investment-lab-contribution-experiment";
import {
  calculateInvestmentLabFixedMixContribution,
  createInvestmentLabFixedMixContributionEvidence,
  INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY,
  type InvestmentLabFixedMixContributionResult,
} from "@/lib/investment-lab-fixed-mix-contribution";
import type { InvestmentLabFixedMixWeights } from "@/lib/investment-lab-fixed-mix-types";

type ContributionSelectionId = InvestmentLabContributionScenarioId | "fixed_mix";
type ContributionResult =
  | InvestmentLabContributionExperimentResult
  | InvestmentLabFixedMixContributionResult;

export function InvestmentLabContributionExperiment({
  fixedMixWeights,
  scenarios,
}: {
  fixedMixWeights: InvestmentLabFixedMixWeights | null;
  scenarios: readonly InvestmentLabContributionScenarioEvidence[];
}) {
  const fixedMixEvidence = useMemo(
    () =>
      fixedMixWeights
        ? createInvestmentLabFixedMixContributionEvidence({
            scenarios,
            weights: fixedMixWeights,
          })
        : null,
    [fixedMixWeights, scenarios],
  );
  const [scenarioId, setScenarioId] = useState<ContributionSelectionId | null>(
    fixedMixEvidence ? "fixed_mix" : (scenarios[0]?.scenarioId ?? null),
  );
  const [serviceDate, setServiceDate] = useState(
    fixedMixEvidence?.points[0]?.serviceDate ??
      scenarios[0]?.points[0]?.serviceDate ??
      "",
  );
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<ContributionResult | null>(null);
  const scenario =
    scenarioId === "fixed_mix"
      ? null
      : (scenarios.find((candidate) => candidate.scenarioId === scenarioId) ??
        scenarios[0] ??
        null);
  const points =
    scenarioId === "fixed_mix" ? fixedMixEvidence?.points : scenario?.points;

  function selectScenario(
    selected: InvestmentLabContributionScenarioEvidence,
  ) {
    setScenarioId(selected.scenarioId);
    setServiceDate(selected.points[0]?.serviceDate ?? "");
    setResult(null);
  }

  function selectFixedMix() {
    if (!fixedMixEvidence) return;
    setScenarioId("fixed_mix");
    setServiceDate(fixedMixEvidence.points[0]?.serviceDate ?? "");
    setResult(null);
  }

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (scenarioId === "fixed_mix") {
      if (!fixedMixEvidence) return;
      setResult(
        calculateInvestmentLabFixedMixContribution({
          evidence: fixedMixEvidence,
          contributionServiceDate: serviceDate,
          contributionAmountKrw: Number(amount),
        }),
      );
      return;
    }
    if (!scenario) return;
    setResult(
      calculateInvestmentLabContributionExperiment({
        scenario,
        contributionServiceDate: serviceDate,
        contributionAmountKrw: Number(amount),
      }),
    );
  }

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-contribution-experiment="ephemeral_client_only"
      data-contribution-policy={
        INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY.version
      }
      data-contribution-fixed-mix-kodex-weight-bps={
        fixedMixEvidence?.weights.kodexWeightBps ?? 0
      }
      data-contribution-fixed-mix-policy={
        INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY.version
      }
      data-contribution-fixed-mix-status={
        fixedMixEvidence ? "ready" : "unavailable"
      }
      data-contribution-fixed-mix-voo-weight-bps={
        fixedMixEvidence?.weights.vooWeightBps ?? 0
      }
      data-contribution-scenarios={
        scenarios.length + (fixedMixEvidence ? 1 : 0)
      }
      id="investment-lab-contribution-experiment"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">과거 추가 투입 효과 실험</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            선택한 관측일에 추가 원금이 고정 시나리오에 함께 반영됐다면
            종료 평가액이 어떻게 달라졌는지 계산합니다.
          </p>
        </div>
        <p className="text-xs font-semibold text-[#687064]">
          입력값 저장 안 함
        </p>
      </div>

      {points && points.length > 0 ? (
        <>
          <form
            className="mt-5 grid items-end gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.8fr)_minmax(180px,0.8fr)_auto]"
            onSubmit={calculate}
          >
            <fieldset className="min-w-0">
              <legend className="mb-2 text-xs font-semibold text-[#596255]">
                고정 시나리오
              </legend>
              <div className="flex min-h-10 rounded-md border border-[#d7dccf] bg-white p-1">
                {fixedMixWeights ? (
                  <button
                    className={
                      scenarioId === "fixed_mix"
                        ? "min-w-0 flex-1 rounded bg-[#173f38] px-3 py-2 text-sm font-semibold text-white"
                        : "min-w-0 flex-1 rounded px-3 py-2 text-sm font-semibold text-[#4f594d] hover:bg-[#eef1e9] disabled:cursor-not-allowed disabled:text-[#9ca397]"
                    }
                    disabled={!fixedMixEvidence}
                    onClick={selectFixedMix}
                    type="button"
                  >
                    {fixedMixEvidence
                      ? `선택 배분 ${fixedMixEvidence.weights.kodexWeightBps / 100}:${fixedMixEvidence.weights.vooWeightBps / 100}`
                      : "선택 배분 준비 안 됨"}
                  </button>
                ) : null}
                {scenarios.map((candidate) => (
                  <button
                    className={
                      candidate.scenarioId === scenarioId
                        ? "min-w-0 flex-1 rounded px-3 py-2 text-sm font-semibold text-white bg-[#173f38]"
                        : "min-w-0 flex-1 rounded px-3 py-2 text-sm font-semibold text-[#4f594d] hover:bg-[#eef1e9]"
                    }
                    key={candidate.scenarioId}
                    onClick={() => selectScenario(candidate)}
                    type="button"
                  >
                    {scenarioLabel(candidate.scenarioId)}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="min-w-0 text-xs font-semibold text-[#596255]">
              관측 기준일
              <select
                className="mt-2 h-10 w-full rounded-md border border-[#d7dccf] bg-white px-3 text-sm font-normal text-[#171916]"
                onChange={(event) => {
                  setServiceDate(event.target.value);
                  setResult(null);
                }}
                value={serviceDate}
              >
                {points.map((point) => (
                  <option key={point.serviceDate} value={point.serviceDate}>
                    {formatDate(point.serviceDate)}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0 text-xs font-semibold text-[#596255]">
              추가 원금 (KRW)
              <input
                className="mt-2 h-10 w-full rounded-md border border-[#d7dccf] bg-white px-3 text-sm font-normal text-[#171916]"
                inputMode="numeric"
                min="1"
                onChange={(event) => {
                  setAmount(event.target.value);
                  setResult(null);
                }}
                placeholder="예: 1000000"
                step="1"
                type="number"
                value={amount}
              />
            </label>

            <button
              className="h-10 rounded-md bg-[#173f38] px-5 text-sm font-semibold text-white hover:bg-[#0f302a]"
              type="submit"
            >
              계산
            </button>
          </form>

          <p className="mt-3 text-xs leading-5 text-[#777e73]">
            {scenarioId === "fixed_mix" && fixedMixEvidence
              ? fixedMixPriceBasisLabel(fixedMixEvidence.weights)
              : scenario
                ? priceBasisLabel(scenario.priceBasis)
                : null} · 분수 수량 허용 · 수수료, 세금, 잔여 현금 0 가정
          </p>

          <ContributionResult result={result} />
        </>
      ) : (
        <p className="mt-4 text-sm text-[#725f2d]">
          현재 계산 가능한 고정 시나리오가 없습니다.
        </p>
      )}

      <p className="mt-5 border-t border-[#e1e6dc] pt-3 text-xs leading-5 text-[#777e73]">
        실제 보유 자산, 현금, 거래 기록은 변경하지 않습니다. 이 결과는 목표
        비중이나 매수 추천이 아니며 브라우저를 벗어나 저장되지 않습니다.
        실제 추가 투입 분배 화면과도 연결되지 않는 과거 연구 실험입니다.
      </p>
    </section>
  );
}

function ContributionResult({
  result,
}: {
  result: ContributionResult | null;
}) {
  if (!result) return null;
  if (isFixedMixResult(result)) {
    return <FixedMixContributionResult result={result} />;
  }
  if (result.status === "blocked") {
    return (
      <p className="mt-4 border-t border-[#eadfbe] pt-4 text-sm text-[#725f2d]">
        {blockerLabel(result.blockers[0])}
      </p>
    );
  }

  return (
    <div className="mt-5 border-t border-[#e1e6dc] pt-4">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        <ResultMetric
          label="추가 원금"
          value={formatKrw(result.contributionAmountKrw)}
        />
        <ResultMetric
          label="기존 종료 평가액"
          value={formatKrw(result.baseEndValueKrw)}
        />
        <ResultMetric
          label="투입 후 종료 평가액"
          value={formatKrw(result.projectedEndValueKrw)}
        />
        <ResultMetric
          label="추가 원금 종료 평가액"
          value={formatKrw(result.additionalEndValueKrw)}
        />
        <ResultMetric
          label="추가 원금 손익"
          tone={result.additionalProfitKrw >= 0 ? "positive" : "negative"}
          value={`${formatSignedKrw(result.additionalProfitKrw)} · ${formatSignedPercent(result.additionalReturn)}`}
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-[#687064]">
        관측일 {formatDate(result.contributionServiceDate)} · 가격 근거일{" "}
        {formatDate(result.contributionPriceDate)} · 종료일{" "}
        {formatDate(result.endServiceDate)} · 가정 수량{" "}
        {formatUnits(result.additionalUnits)}
      </p>
    </div>
  );
}

function FixedMixContributionResult({
  result,
}: {
  result: InvestmentLabFixedMixContributionResult;
}) {
  if (result.status === "blocked") {
    return (
      <p className="mt-4 border-t border-[#eadfbe] pt-4 text-sm text-[#725f2d]">
        {fixedMixBlockerLabel(result.blockers[0])}
      </p>
    );
  }

  const kodexWeightPct = result.weights.kodexWeightBps / 100;
  const vooWeightPct = result.weights.vooWeightBps / 100;
  return (
    <div
      className="mt-5 border-t border-[#e1e6dc] pt-4"
      data-fixed-mix-contribution-result="ready"
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        <ResultMetric
          label="추가 원금"
          value={formatKrw(result.contributionAmountKrw)}
        />
        <ResultMetric
          label="기존 배분 경로 종료 평가액"
          value={formatKrw(result.baseEndValueKrw)}
        />
        <ResultMetric
          label="투입 후 종료 평가액"
          value={formatKrw(result.projectedEndValueKrw)}
        />
        <ResultMetric
          label="추가 원금 종료 평가액"
          value={formatKrw(result.additionalEndValueKrw)}
        />
        <ResultMetric
          label="추가 원금 손익"
          tone={result.additionalProfitKrw >= 0 ? "positive" : "negative"}
          value={`${formatSignedKrw(result.additionalProfitKrw)} · ${formatSignedPercent(result.additionalReturn)}`}
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-[#687064]">
        관측일 {formatDate(result.contributionServiceDate)} · KODEX 가격 근거일{" "}
        {formatDate(result.kodexContributionPriceDate)} · VOO 가격 근거일{" "}
        {formatDate(result.vooContributionPriceDate)} · USD/KRW 기준일{" "}
        {formatDate(result.contributionServiceDate)} · 종료일{" "}
        {formatDate(result.endServiceDate)}
      </p>
      <p className="mt-2 text-xs leading-5 text-[#687064]">
        KODEX {kodexWeightPct}% {formatKrw(result.allocation.kodexAmountKrw)} ·{" "}
        {formatUnits(result.allocation.kodexUnits)}주 / VOO {vooWeightPct}%{" "}
        {formatKrw(result.allocation.vooAmountKrw)} ·{" "}
        {formatUnits(result.allocation.vooUnits)}주. 투입 뒤에는 비중을 다시 맞추지
        않습니다.
      </p>
    </div>
  );
}

function ResultMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="min-w-0 border-l-2 border-[#dfe3d5] pl-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p
        className={
          tone === "positive"
            ? "mt-1 break-words text-base font-semibold text-[#087f4f]"
            : tone === "negative"
              ? "mt-1 break-words text-base font-semibold text-[#c43f43]"
              : "mt-1 break-words text-base font-semibold text-[#171916]"
        }
      >
        {value}
      </p>
    </div>
  );
}

function scenarioLabel(scenarioId: InvestmentLabContributionScenarioId) {
  return scenarioId === "kodex200" ? "전액 KODEX 200" : "전액 VOO";
}

function priceBasisLabel(priceBasis: InvestmentLabContributionPriceBasis) {
  return priceBasis === "adjusted_close_krw"
    ? "KODEX 200 조정종가(KRW) 기준"
    : "VOO 원종가 × 저장 USD/KRW 기준(배당 미반영)";
}

function fixedMixPriceBasisLabel(weights: InvestmentLabFixedMixWeights) {
  return `KODEX 200 조정종가 ${weights.kodexWeightBps / 100}% + VOO 원종가 × 저장 USD/KRW ${weights.vooWeightBps / 100}% 기준(VOO 배당 미반영)`;
}

function blockerLabel(
  blocker: InvestmentLabContributionExperimentResult["blockers"][number],
) {
  if (blocker === "invalid_contribution_amount") {
    return "추가 원금은 1원 이상의 정수로 입력해 주세요.";
  }
  if (blocker === "contribution_date_unavailable") {
    return "선택한 관측일의 가격 근거를 사용할 수 없습니다.";
  }
  return "입력 또는 가격 근거를 검증하지 못해 계산을 중단했습니다.";
}

function fixedMixBlockerLabel(
  blocker: InvestmentLabFixedMixContributionResult["blockers"][number],
) {
  if (blocker === "invalid_contribution_amount") {
    return "추가 원금은 1원 이상의 정수로 입력해 주세요.";
  }
  if (blocker === "contribution_date_unavailable") {
    return "선택한 관측일에 두 종목의 가격·환율 근거가 모두 존재하지 않습니다.";
  }
  return "두 종목의 비중 또는 가격·환율 근거를 검증하지 못해 전체 계산을 중단했습니다.";
}

function isFixedMixResult(
  result: ContributionResult,
): result is InvestmentLabFixedMixContributionResult {
  return (
    result.policy.version ===
    INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY.version
  );
}

function formatKrw(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatSignedKrw(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.round(Math.abs(value)).toLocaleString("ko-KR")}원`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatUnits(value: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
}
