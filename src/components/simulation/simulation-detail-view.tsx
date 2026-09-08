import {
  SimulationLink as Link,
} from "./simulation-query-controls";
import type { ReactNode } from "react";
import type { SimulationPanel } from "@/lib/simulation-panel";

import { InvestmentLabDisclosure as SimulationDisclosure } from "@/components/investment-lab/investment-lab-disclosure";
import styles from "./simulation-workspace.module.css";
import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";
import { buildSimulationHref } from "@/lib/simulation-navigation";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";
import { SIMULATION_RESEARCH_HORIZON_POLICY } from "@/lib/simulation-research-horizon";

import { FixedMixResearchComparisonSection } from "./fixed-mix-research-comparison-section";
import { FixedMixResearchExecutionSection } from "./fixed-mix-research-execution-section";
import { FixedResearchExecutionSection } from "./fixed-research-execution-section";
import { ObservedReturnAlignmentEvidencePanel } from "./observed-return-alignment-evidence-panel";
import { ObservedReturnComparisonPanel } from "./observed-return-comparison-panel";
import {
  ObservedReturnSeriesPanel,
  resolveObservedReturnScale,
  resolveSharedObservedReturnScale,
} from "./observed-return-series-panel";
import { WalkForwardMinimumVolatilitySection } from "./walk-forward-min-volatility-section";
import { WalkForwardStabilityHistorySection } from "./walk-forward-stability-history-section";

type InputReadiness = SimulationInputReadinessPageModel["inputs"][number];
type HistoryRow = SimulationInputReadinessPageModel["history"][number];

export function SimulationDetailView({
  model,
  historicalOutcomeValidation,
  ownerCandidateComparison,
  ownerHistoricalValidation,
  ownerInputPreflight,
  ownerModelCalibration,
  ownerModelComparison,
  ownerParametricFactor,
  ownerWalkForwardValidation,
  researchUniverse,
  researchUniversePreflight,
  regimeHistoricalOutcomeValidation,
  regimeBootstrap,
  selectedScopeKey,
  panel,
}: {
  model: SimulationInputReadinessPageModel | null;
  historicalOutcomeValidation?: ReactNode;
  ownerCandidateComparison?: ReactNode;
  ownerHistoricalValidation?: ReactNode;
  ownerInputPreflight?: ReactNode;
  ownerModelCalibration?: ReactNode;
  ownerModelComparison?: ReactNode;
  ownerParametricFactor?: ReactNode;
  ownerResearchExecution?: ReactNode;
  ownerWalkForwardValidation?: ReactNode;
  researchUniverse: string | null;
  researchUniversePreflight?: ReactNode;
  regimeHistoricalOutcomeValidation?: ReactNode;
  regimeBootstrap?: ReactNode;
  selectedScopeKey: PortfolioAnalysisScopeKey;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  panel: SimulationPanel;
}) {
  if (!model) {
    return <div className={styles.details} data-simulation-partial-detail={panel}>
      <p role="status" className="py-3 text-sm text-[var(--warning)]">고정 종목의 연구 입력을 읽지 못했습니다. 준비된 보유 구성의 분석 결과는 계속 확인할 수 있습니다.</p>
      {ownerCandidateComparison}
      {ownerWalkForwardValidation}
      {ownerHistoricalValidation}
      {ownerInputPreflight}
      {ownerModelComparison}
      {ownerParametricFactor}
      {ownerModelCalibration}
      {historicalOutcomeValidation}
      {regimeHistoricalOutcomeValidation}
      {regimeBootstrap}
      {researchUniversePreflight}
    </div>;
  }
  const sharedReturnScale = resolveSharedObservedReturnScale(model.inputs);
  const recommendedEndServiceDate = sharedNearestPriorDate(model.inputs);
  const selectedKodexWeightPct = model.fixedMixSelection.kodexWeightPct;
  const selectedResearchHorizon =
    model.researchHorizonSelection.horizon ??
    SIMULATION_RESEARCH_HORIZON_POLICY.defaultHorizon;
  const readySingleExecutionCount = model.researchExecutions.filter(
    (execution) => execution.status === "ready",
  ).length;
  const comparisonScenarioCount = model.fixedMixResearchComparison ? 3 : 0;
  const readyComparisonScenarioCount =
    model.fixedMixResearchComparison?.status === "ready"
      ? model.fixedMixResearchComparison.scenarios.length
      : 0;
  const totalExecutionCount =
    model.researchExecutions.length +
    (model.fixedMixResearchExecution ? 1 : 0) +
    comparisonScenarioCount +
    (model.walkForwardMinimumVolatility ? 1 : 0);
  const readyExecutionCount =
    readySingleExecutionCount +
    (model.fixedMixResearchExecution?.status === "ready" ? 1 : 0) +
    readyComparisonScenarioCount +
    (model.walkForwardMinimumVolatility?.status === "ready" ? 1 : 0);

  return panel === "weights" ? (<div className={styles.details} id="simulation-weight-experiment">
              {ownerCandidateComparison}
            </div>) : panel === "validation" ? (<div className={styles.details} id="simulation-validation">
              {ownerWalkForwardValidation}
              <SimulationDisclosure
                title="예측 범위와 실제 결과"
                detail="보유 구성의 과거 시점별 결과 대조"
              >
                {ownerHistoricalValidation}
              </SimulationDisclosure>
              <SimulationDisclosure
                title="고정 종목의 과거 검증"
                detail="분포 구간·하방 위험·시점별 안정성"
              >
                {historicalOutcomeValidation}
                <WalkForwardMinimumVolatilitySection
                  result={model.walkForwardMinimumVolatility}
                />
                <WalkForwardStabilityHistorySection
                  result={model.walkForwardStabilityHistory}
                />
              </SimulationDisclosure>
              <SimulationDisclosure
                title="시장 국면 모델 검증"
                detail="시장 조건별 분포와 실제 결과"
              >
                {regimeHistoricalOutcomeValidation}
              </SimulationDisclosure>
            </div>) : (<div className={styles.details} id="simulation-model-diagnostics">
              {ownerInputPreflight}
              <SimulationDisclosure
                title="두 확률모형 비교"
                detail="블록 재표본 추출과 환율·금리 요인 모형"
              >
                {ownerModelComparison}
                {ownerParametricFactor}
              </SimulationDisclosure>
              <SimulationDisclosure
                title="모형 보정과 시장 국면"
                detail="과거 검증·시장 조건별 연구"
              >
                {ownerModelCalibration}
                {regimeBootstrap}
              </SimulationDisclosure>
              <SimulationDisclosure
                title="고정 종목 연구와 데이터 근거"
                detail="KODEX 200·Vanguard S&P 500 ETF 독립 연구"
              >
                {researchUniversePreflight}
                <section
                  aria-label="검사 요약"
                  className="grid border-b border-[var(--line)] py-4 sm:grid-cols-2 xl:grid-cols-4"
                >
                  <SummaryItem
                    label="검사 기준일"
                    value={formatDate(model.requestedEndServiceDate)}
                  />
                  <SummaryItem
                    label="검사 범위"
                    value={`${model.summary.returnStepCount}개 수익률`}
                    detail={`${model.summary.requiredPointCount}개 관측점 필요`}
                  />
                  <SummaryItem
                    label="준비된 연구 입력"
                    value={`${model.summary.readyInputCount}/${model.summary.totalInputCount}`}
                    detail={`${model.summary.unavailableInputCount}개 확인 필요`}
                  />
                  <SummaryItem
                    label="실행 상태"
                    value={
                      readyExecutionCount > 0
                        ? `${readyExecutionCount}/${totalExecutionCount} 계산 완료`
                        : "실행 안 함"
                    }
                    detail="연구용 · 저장 안 함"
                  />
                </section>

                <ObservedReturnComparisonPanel
                  comparison={model.observedReturnComparison}
                />
                <ObservedReturnAlignmentEvidencePanel
                  evidence={model.observedReturnAlignmentEvidence}
                />
                <FixedResearchExecutionSection
                  executions={model.researchExecutions}
                  recommendedEndHref={
                    recommendedEndServiceDate
                      ? simulationDateHref(
                          recommendedEndServiceDate,
                          selectedKodexWeightPct,
                          selectedResearchHorizon,
                          researchUniverse,
                          selectedScopeKey,
                        )
                      : null
                  }
                  recommendedEndServiceDate={recommendedEndServiceDate}
                  researchHorizon={selectedResearchHorizon}
                />
                <FixedMixResearchExecutionSection
                  scopeKey={selectedScopeKey}
                  endServiceDate={model.requestedEndServiceDate}
                  execution={model.fixedMixResearchExecution}
                  researchHorizon={selectedResearchHorizon}
                  researchUniverse={researchUniverse}
                  selection={model.fixedMixSelection}
                />
                <FixedMixResearchComparisonSection
                  comparison={model.fixedMixResearchComparison}
                  selectedKodexWeightPct={selectedKodexWeightPct}
                />

                <section
                  aria-label="독립 연구 입력"
                  className="grid gap-4 py-5 lg:grid-cols-2"
                >
                  {model.inputs.map((input) => (
                    <InputPanel
                      key={input.id}
                      input={input}
                      observedReturnScale={
                        sharedReturnScale ?? resolveObservedReturnScale(input)
                      }
                      returnScaleMode={
                        sharedReturnScale ? "shared" : "individual"
                      }
                      selectedKodexWeightPct={selectedKodexWeightPct}
                      selectedResearchHorizon={selectedResearchHorizon}
                      selectedScopeKey={selectedScopeKey}
                      researchUniverse={researchUniverse}
                    />
                  ))}
                </section>

                {model.history.length > 0 ? (
                  <ReadinessHistory
                    rows={model.history}
                    selectedKodexWeightPct={selectedKodexWeightPct}
                    selectedResearchHorizon={selectedResearchHorizon}
                    selectedScopeKey={selectedScopeKey}
                    selectedServiceDate={model.requestedEndServiceDate}
                    researchUniverse={researchUniverse}
                  />
                ) : null}

                <footer className="border-t border-[var(--line)] pt-4 text-sm leading-6 text-[var(--muted)]">
                  두 종목은 서로 독립적으로 검사합니다. 현재 보유 종목, 기본
                  포트폴리오, 목표 비중 또는 승인된 실행 벡터로 해석하지
                  않습니다. 결손이 있으면 과거 날짜로 자동 대체하거나 범위를
                  임의로 줄이지 않습니다. VOO는 투자 랩의 가격수익률 준비 상태를
                  재사용하지 않고 별도의 조정종가·환율 증거를 검사합니다.
                </footer>
              </SimulationDisclosure>
            </div>);
}

function sharedNearestPriorDate(inputs: readonly InputReadiness[]) {
  const dates = inputs
    .map((input) => input.nearestPriorObservedServiceDate)
    .filter((date): date is string => Boolean(date));
  return dates.length === inputs.length && new Set(dates).size === 1
    ? dates[0]
    : null;
}

function ReadinessHistory({
  rows,
  selectedKodexWeightPct,
  selectedResearchHorizon,
  selectedScopeKey,
  selectedServiceDate,
  researchUniverse,
}: {
  rows: readonly HistoryRow[];
  selectedKodexWeightPct: number | null;
  selectedResearchHorizon: 63 | 126;
  selectedScopeKey: PortfolioAnalysisScopeKey;
  selectedServiceDate: string;
  researchUniverse: string | null;
}) {
  return (
    <section
      data-simulation-readiness-history
      aria-labelledby="simulation-readiness-history-title"
      className="border-t border-[var(--line)] py-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="simulation-readiness-history-title"
            className="text-lg font-semibold"
          >
            최근 기준일 검사
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            저장된 실행 기록이 아니라, 최근 7개 기준일을 현재 저장 증거로 다시
            검사한 결과입니다.
          </p>
        </div>
        <p className="text-xs text-[var(--muted)]">날짜 자동 대체 없음</p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-3 font-semibold">기준일</th>
              <th className="px-3 py-3 font-semibold">KODEX 200</th>
              <th className="px-3 py-3 font-semibold">VOO</th>
              <th className="px-3 py-3 text-right font-semibold">검사</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const kodex200 = row.inputs.find(
                (input) => input.id === "kodex200",
              );
              const voo = row.inputs.find((input) => input.id === "voo");
              const selected = row.serviceDate === selectedServiceDate;

              return (
                <tr
                  key={row.serviceDate}
                  data-readiness-history-row={row.serviceDate}
                  data-kodex200-status={kodex200?.status ?? "unavailable"}
                  data-voo-status={voo?.status ?? "unavailable"}
                  className="border-b border-[var(--line)] align-top"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">
                    {formatDate(row.serviceDate)}
                    {selected ? (
                      <span className="ml-2 text-xs font-medium text-[var(--brand)]">
                        선택됨
                      </span>
                    ) : null}
                  </td>
                  <HistoryStatusCell input={kodex200} />
                  <HistoryStatusCell input={voo} />
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {selected ? (
                      <span className="text-xs font-semibold text-[var(--muted)]">
                        현재 결과
                      </span>
                    ) : (
                      <Link
                        href={simulationDateHref(
                          row.serviceDate,
                          selectedKodexWeightPct,
                          selectedResearchHorizon,
                          researchUniverse,
                          selectedScopeKey,
                        )}
                        className="inline-flex rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
                      >
                        이 날짜 검사
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryStatusCell({
  input,
}: {
  input: HistoryRow["inputs"][number] | undefined;
}) {
  const ready = input?.status === "matrix_ready";
  return (
    <td className="px-3 py-3">
      <p
        className={
          ready
            ? "font-semibold text-[var(--brand)]"
            : "font-semibold text-[var(--warning)]"
        }
      >
        {ready ? "준비됨" : "사용 불가"}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {formatHistoryCoverage(input)}
      </p>
      {!ready && input?.issueLabels[0] ? (
        <p className="mt-1 max-w-[300px] text-xs leading-5 text-[var(--warning)]">
          {input.issueLabels[0]}
        </p>
      ) : null}
    </td>
  );
}

function formatHistoryCoverage(
  input: HistoryRow["inputs"][number] | undefined,
) {
  if (!input) return "커버리지 없음";
  if (input.returnCoverage) {
    return `${input.returnCoverage.readyReturnCount}/${input.returnCoverage.requiredReturnCount} 수익률 행`;
  }
  return `${input.resolvedPointCount}/${input.requiredPointCount ?? "-"} 관측점`;
}

function InputPanel({
  input,
  observedReturnScale,
  researchUniverse,
  returnScaleMode,
  selectedKodexWeightPct,
  selectedResearchHorizon,
  selectedScopeKey,
}: {
  input: InputReadiness;
  observedReturnScale: number;
  researchUniverse: string | null;
  returnScaleMode: "shared" | "individual";
  selectedKodexWeightPct: number | null;
  selectedResearchHorizon: 63 | 126;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  const ready = input.status === "matrix_ready";

  return (
    <article
      data-simulation-input={input.id}
      data-readiness-status={input.status}
      data-nearest-prior-date={input.nearestPriorObservedServiceDate ?? ""}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface)]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-4">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            {input.marketLabel} · {input.currency}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal">
            {input.ticker} · {input.name}
          </h2>
        </div>
        <span
          className={
            ready
              ? "rounded-md bg-[var(--wash)] px-2.5 py-1 text-xs font-semibold text-[var(--brand)]"
              : "rounded-md bg-[var(--brand-wash)] px-2.5 py-1 text-xs font-semibold text-[var(--warning)]"
          }
        >
          {ready ? "준비됨" : "사용 불가"}
        </span>
      </header>

      <dl className="grid sm:grid-cols-2">
        <EvidenceItem label="가격 기준" value={input.priceBasisLabel} />
        <EvidenceItem label="환율 기준" value={input.fxBasisLabel} />
        <EvidenceItem
          label="요청 종료일"
          value={formatDate(input.requestedEndServiceDate)}
        />
        <EvidenceItem
          label="확정 종료일"
          value={formatDate(input.resolvedEndServiceDate)}
        />
        <EvidenceItem
          label="관측 범위"
          value={formatRange(
            input.observedServiceDateFrom,
            input.observedServiceDateTo,
          )}
        />
        <EvidenceItem
          label="기간 축"
          value={`${input.resolvedPointCount}/${input.requiredPointCount ?? "-"} 관측점`}
        />
        <EvidenceItem
          label="가격 커버리지"
          value={formatCoverage(input.priceCoverage)}
        />
        <EvidenceItem
          label="환율 커버리지"
          value={
            input.currency === "KRW"
              ? "불필요"
              : formatCoverage(input.fxCoverage)
          }
        />
        <EvidenceItem
          label="수익률 행 커버리지"
          value={formatReturnCoverage(input.returnCoverage)}
        />
        <EvidenceItem label="자동 재시도·날짜 대체" value="없음" />
      </dl>

      {ready && input.observedReturns ? (
        <ObservedReturnSeriesPanel
          input={input}
          rows={input.observedReturns}
          chartScale={observedReturnScale}
          scaleMode={returnScaleMode}
        />
      ) : null}

      <div className="border-t border-[var(--line)] p-4">
        <h3 className="text-sm font-semibold">
          {ready ? "증거 결손" : "확인할 항목"}
        </h3>
        {input.issues.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--brand)]">확인된 결손이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-[var(--warning)]">
            {input.issues.map((issue) => (
              <li key={`${issue.code}-${issue.dates.join("-")}`}>
                {issue.label}
                {issue.dates.length > 0
                  ? ` (${issue.dates.map(formatDate).join(", ")})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
        {!ready && input.nearestPriorObservedServiceDate ? (
          <Link
            data-review-nearest-prior
            href={simulationDateHref(
              input.nearestPriorObservedServiceDate,
              selectedKodexWeightPct,
              selectedResearchHorizon,
              researchUniverse,
              selectedScopeKey,
            )}
            className="mt-4 inline-flex rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          >
            최근 관측 기준일 {formatDate(input.nearestPriorObservedServiceDate)}
            로 다시 검사
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border-[var(--line)] px-4 py-2 first:pl-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p> : null}
    </div>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--wash)] px-4 py-3 sm:odd:border-r">
      <dt className="text-xs font-medium text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function formatCoverage(
  coverage: Readonly<{
    coveredServiceDateCount: number;
    requiredServiceDateCount: number;
    coveragePct: number;
  }> | null,
) {
  if (!coverage) return "검사 전";
  return `${coverage.coveredServiceDateCount}/${coverage.requiredServiceDateCount} · ${formatPct(coverage.coveragePct)}`;
}

function formatReturnCoverage(
  coverage: Readonly<{
    readyReturnCount: number;
    requiredReturnCount: number;
    coveragePct: number;
  }> | null,
) {
  if (!coverage) return "검사 전";
  return `${coverage.readyReturnCount}/${coverage.requiredReturnCount} · ${formatPct(coverage.coveragePct)}`;
}

function formatRange(from: string | null, to: string | null) {
  if (!from || !to) return "관측 없음";
  return `${formatDate(from)} ~ ${formatDate(to)}`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}

function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

function simulationDateHref(
  endServiceDate: string,
  kodexWeightPct: number | null,
  horizon: 63 | 126,
  researchUniverse: string | null,
  scopeKey: PortfolioAnalysisScopeKey,
) {
  return buildSimulationHref({
    scope: scopeKey,
    endServiceDate,
    kodexWeightPct,
    researchHorizon: horizon,
    researchUniverse,
  });
}
