import Link from "next/link";
import type { ReactNode } from "react";

import type { SimulationInputReadinessPageModel } from "@/lib/simulation-input-readiness";

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

type InputReadiness = SimulationInputReadinessPageModel["inputs"][number];
type HistoryRow = SimulationInputReadinessPageModel["history"][number];

export function SimulationInputReadinessView({
  model,
  regimeBootstrap,
}: {
  model: SimulationInputReadinessPageModel;
  regimeBootstrap?: ReactNode;
}) {
  const sharedReturnScale = resolveSharedObservedReturnScale(model.inputs);
  const recommendedEndServiceDate = sharedNearestPriorDate(model.inputs);
  const selectedKodexWeightPct = model.fixedMixSelection.kodexWeightPct;
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

  return (
    <main
      data-page="simulation-input-readiness"
      data-runtime-trust-status={model.runtimeTrustStatus}
      data-end-query-status={model.endServiceDateSelection.status}
      className="min-h-screen overflow-x-hidden bg-[#f3f4ef] text-[#171916]"
    >
      <div className="mx-auto w-full max-w-[1400px] px-4 py-5">
        <header className="border-b border-[#d7ddcf] pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
                시뮬레이션 검증
              </h1>
              <p className="mt-2 text-sm text-[#596158]">
                연구 입력 증거 준비도와 고정 연구 실행
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">대시보드</NavLink>
              <NavLink href="/investment-lab">투자 랩</NavLink>
              <NavLink href="/portfolio/risk">포트 구조</NavLink>
            </nav>
          </div>
          <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#62542c]">
            기준일을 직접 선택하고 입력이 완전할 때만 연구용 재표본 경로를
            계산합니다. 결과는 미래 예측, 비중 추천 또는 주문 근거가 아닙니다.
          </div>
        </header>

        {model.endServiceDateSelection.status === "invalid" ? (
          <section
            data-invalid-end-query
            className="border-b border-[#d7ddcf] py-4 text-sm text-[#7a5117]"
          >
            기준일은 하나의 <code>YYYY-MM-DD</code> 값으로 입력해야 합니다. 빈 값,
            공백이 포함된 값, 중복된 값은 데이터 조회 전에 차단합니다.
          </section>
        ) : null}

        <section
          aria-label="검사 요약"
          className="grid border-b border-[#d7ddcf] py-4 sm:grid-cols-2 xl:grid-cols-4"
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
                )
              : null
          }
          recommendedEndServiceDate={recommendedEndServiceDate}
        />
        <FixedMixResearchExecutionSection
          endServiceDate={model.requestedEndServiceDate}
          execution={model.fixedMixResearchExecution}
          selection={model.fixedMixSelection}
        />
        <FixedMixResearchComparisonSection
          comparison={model.fixedMixResearchComparison}
          selectedKodexWeightPct={selectedKodexWeightPct}
        />
        <WalkForwardMinimumVolatilitySection
          result={model.walkForwardMinimumVolatility}
        />
        {regimeBootstrap}

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
              returnScaleMode={sharedReturnScale ? "shared" : "individual"}
              selectedKodexWeightPct={selectedKodexWeightPct}
            />
          ))}
        </section>

        {model.history.length > 0 ? (
          <ReadinessHistory
            rows={model.history}
            selectedKodexWeightPct={selectedKodexWeightPct}
            selectedServiceDate={model.requestedEndServiceDate}
          />
        ) : null}

        <footer className="border-t border-[#d7ddcf] pt-4 text-sm leading-6 text-[#687064]">
          두 종목은 서로 독립적으로 검사합니다. 현재 보유 종목, 기본 포트폴리오,
          목표 비중 또는 승인된 실행 벡터로 해석하지 않습니다. 결손이 있으면 과거
          날짜로 자동 대체하거나 범위를 임의로 줄이지 않습니다. VOO는 투자 랩의
          가격수익률 준비 상태를 재사용하지 않고 별도의 조정종가·환율 증거를
          검사합니다.
        </footer>
      </div>
    </main>
  );
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
  selectedServiceDate,
}: {
  rows: readonly HistoryRow[];
  selectedKodexWeightPct: number | null;
  selectedServiceDate: string;
}) {
  return (
    <section
      data-simulation-readiness-history
      aria-labelledby="simulation-readiness-history-title"
      className="border-t border-[#d7ddcf] py-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="simulation-readiness-history-title"
            className="text-lg font-semibold"
          >
            최근 기준일 검사
          </h2>
          <p className="mt-1 text-sm text-[#687064]">
            저장된 실행 기록이 아니라, 최근 7개 기준일을 현재 저장 증거로 다시
            검사한 결과입니다.
          </p>
        </div>
        <p className="text-xs text-[#7a8175]">날짜 자동 대체 없음</p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
            <tr>
              <th className="px-3 py-3 font-semibold">기준일</th>
              <th className="px-3 py-3 font-semibold">KODEX 200</th>
              <th className="px-3 py-3 font-semibold">VOO</th>
              <th className="px-3 py-3 text-right font-semibold">검사</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const kodex200 = row.inputs.find((input) => input.id === "kodex200");
              const voo = row.inputs.find((input) => input.id === "voo");
              const selected = row.serviceDate === selectedServiceDate;

              return (
                <tr
                  key={row.serviceDate}
                  data-readiness-history-row={row.serviceDate}
                  data-kodex200-status={kodex200?.status ?? "unavailable"}
                  data-voo-status={voo?.status ?? "unavailable"}
                  className="border-b border-[#e1e5da] align-top"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-semibold">
                    {formatDate(row.serviceDate)}
                    {selected ? (
                      <span className="ml-2 text-xs font-medium text-[#47624d]">
                        선택됨
                      </span>
                    ) : null}
                  </td>
                  <HistoryStatusCell input={kodex200} />
                  <HistoryStatusCell input={voo} />
                  <td className="whitespace-nowrap px-3 py-3 text-right">
                    {selected ? (
                      <span className="text-xs font-semibold text-[#687064]">
                        현재 결과
                      </span>
                    ) : (
                      <Link
                        href={simulationDateHref(
                          row.serviceDate,
                          selectedKodexWeightPct,
                        )}
                        className="inline-flex rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-xs font-semibold text-[#253029] hover:bg-[#eef1e8]"
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
      <p className={ready ? "font-semibold text-[#226039]" : "font-semibold text-[#7a5117]"}>
        {ready ? "준비됨" : "사용 불가"}
      </p>
      <p className="mt-1 text-xs text-[#687064]">
        {formatHistoryCoverage(input)}
      </p>
      {!ready && input?.issueLabels[0] ? (
        <p className="mt-1 max-w-[300px] text-xs leading-5 text-[#7a6b4e]">
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
  returnScaleMode,
  selectedKodexWeightPct,
}: {
  input: InputReadiness;
  observedReturnScale: number;
  returnScaleMode: "shared" | "individual";
  selectedKodexWeightPct: number | null;
}) {
  const ready = input.status === "matrix_ready";

  return (
    <article
      data-simulation-input={input.id}
      data-readiness-status={input.status}
      data-nearest-prior-date={input.nearestPriorObservedServiceDate ?? ""}
      className="rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[#e1e5da] p-4">
        <div>
          <p className="text-xs font-semibold text-[#687064]">
            {input.marketLabel} · {input.currency}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal">
            {input.ticker} · {input.name}
          </h2>
        </div>
        <span
          className={
            ready
              ? "rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]"
              : "rounded-md bg-[#fff1dc] px-2.5 py-1 text-xs font-semibold text-[#7a5117]"
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
        <EvidenceItem
          label="자동 재시도·날짜 대체"
          value="없음"
        />
      </dl>

      {ready && input.observedReturns ? (
        <ObservedReturnSeriesPanel
          input={input}
          rows={input.observedReturns}
          chartScale={observedReturnScale}
          scaleMode={returnScaleMode}
        />
      ) : null}

      <div className="border-t border-[#e1e5da] p-4">
        <h3 className="text-sm font-semibold">
          {ready ? "증거 결손" : "확인할 항목"}
        </h3>
        {input.issues.length === 0 ? (
          <p className="mt-2 text-sm text-[#47624d]">확인된 결손이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm text-[#6b5227]">
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
            )}
            className="mt-4 inline-flex rounded-md border border-[#cfd6c8] bg-white px-3 py-2 text-sm font-semibold text-[#253029] hover:bg-[#eef1e8]"
          >
            최근 관측 기준일 {formatDate(input.nearestPriorObservedServiceDate)}로 다시 검사
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
    <div className="border-[#d7ddcf] px-4 py-2 first:pl-0 sm:border-r sm:last:border-r-0">
      <p className="text-xs font-medium text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[#7a8175]">{detail}</p> : null}
    </div>
  );
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[#e8ebe3] px-4 py-3 sm:odd:border-r">
      <dt className="text-xs font-medium text-[#687064]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#253029] hover:bg-[#eef1e8]"
    >
      {children}
    </Link>
  );
}

function formatCoverage(
  coverage:
    | Readonly<{
        coveredServiceDateCount: number;
        requiredServiceDateCount: number;
        coveragePct: number;
      }>
    | null,
) {
  if (!coverage) return "검사 전";
  return `${coverage.coveredServiceDateCount}/${coverage.requiredServiceDateCount} · ${formatPct(coverage.coveragePct)}`;
}

function formatReturnCoverage(
  coverage:
    | Readonly<{
        readyReturnCount: number;
        requiredReturnCount: number;
        coveragePct: number;
      }>
    | null,
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
) {
  const params = new URLSearchParams({ end: endServiceDate });
  if (kodexWeightPct !== null) {
    params.set("kodexWeight", String(kodexWeightPct));
  }
  return `/simulation?${params}`;
}
