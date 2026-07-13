import Link from "next/link";

import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import { InvestmentLabContributionExperiment } from "./investment-lab-contribution-experiment";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";

export function InvestmentLabView({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  return (
    <main
      className="min-h-screen bg-[#f3f4ef] text-[#171916]"
      data-applied-flows={model.coverage.appliedFlowRows}
      data-comparison-dates={model.coverage.completeComparisonDates}
      data-delayed-executions={model.coverage.delayedExecutionRows}
      data-page="investment-lab"
      data-pending-at-end={model.coverage.pendingAtEndRows}
      data-return-status={model.returnEstimate?.status ?? "unavailable"}
      data-scenario-close-rows={model.coverage.scenarioCloseRows}
      data-voo-comparison-status={
        model.vooComparison?.status ?? "unavailable"
      }
      data-voo-readiness={model.vooReadiness?.status ?? "unavailable"}
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
                투자 랩
              </h1>
              <p className="mt-2 text-sm text-[#626b5f]">
                실제 평가액과 동일한 거래금액을 전액 KODEX 200에 적용한 경로 비교
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">홈</NavLink>
              <NavLink href="/today">오늘 변동</NavLink>
              <NavLink href="/portfolio/structure">포트 구조</NavLink>
              <NavLink href="/history">히스토리</NavLink>
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            <StatusPill label="계정" value="전체" />
            <StatusPill label="시나리오" value="전액 KODEX 200" />
            <StatusPill
              label="상태"
              value={model.status === "ready" ? "계산 가능" : "계산 차단"}
            />
          </div>
        </header>

        {model.status === "ready" && model.summary ? (
          <ReadyView model={model} />
        ) : (
          <BlockedView model={model} />
        )}
      </div>
    </main>
  );
}

function ReadyView({ model }: { model: InvestmentLabCounterfactualReadModel }) {
  const summary = model.summary!;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="실제 최종 평가액"
          value={formatKrw(summary.actualEndValueKrw)}
          detail={formatDate(summary.endServiceDate)}
        />
        <SummaryCell
          label="KODEX 200 최종 평가액"
          value={formatKrw(summary.scenarioEndValueKrw)}
          detail="동일 거래금액 반영"
        />
        <SummaryCell
          label="최종 차이"
          value={formatSignedKrw(summary.endDifferenceKrw)}
          detail="가상 경로 - 실제 경로"
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
        />
        <SummaryCell
          label="비교 구간"
          value={`${summary.comparisonDateCount}개 평가일`}
          detail={`${formatDate(summary.startServiceDate)} ~ ${formatDate(summary.endServiceDate)}`}
        />
      </section>

      <ReturnEstimateSection model={model} />

      <VooComparisonSection model={model} />

      <InvestmentLabContributionExperiment
        scenarios={model.contributionExperimentScenarios}
      />

      <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">평가액 경로 비교</h2>
            <p className="mt-1 text-sm text-[#687064]">
              저장된 전체 계정 평가일 기준, 거래비용 0원·소수점 수량 허용
            </p>
          </div>
          <p className="text-sm text-[#687064]">
            KODEX 200 종가 최대 이월 {model.coverage.maxValuationCarryDays ?? 0}일
          </p>
        </div>
        <InvestmentLabComparisonChart
          chartId="investment-lab-kodex200-chart"
          description="저장된 평가일마다 실제 평가액과 동일 거래금액을 KODEX 200에 적용한 가상 평가액을 비교합니다."
          rows={model.rows}
          scenarioLabel="전액 KODEX 200"
          title="실제 포트폴리오와 KODEX 200 시나리오 비교"
        />
        {model.coverage.pendingComparisonRows > 0 ? (
          <p className="mt-3 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-3 py-2 text-sm text-[#725f2d]">
            지연 체결 표시가 있는 {model.coverage.pendingComparisonRows}개 평가일은 가상 경로의 대기 현금 또는 매도 의무를 평가액에 포함하지 않습니다.
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="flex flex-col gap-1 border-b border-[#e1e6dc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">비교 데이터</h2>
            <p className="mt-1 text-sm text-[#687064]">
              평가액과 해당 시점에 사용된 KODEX 200 가격 기준일을 함께 확인합니다.
            </p>
          </div>
          <p className="text-sm text-[#687064]">
            기간 내 반영 거래 {model.coverage.appliedFlowRows}건 · 지연 체결 {model.coverage.delayedExecutionRows}건
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-4 py-3">평가일</th>
                <th className="px-3 py-3 text-right">실제 평가액</th>
                <th className="px-3 py-3 text-right">KODEX 200</th>
                <th className="px-3 py-3 text-right">차이</th>
                <th className="px-4 py-3">가격 기준</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.serviceDate} className="border-t border-[#e1e6dc]">
                  <td className="px-4 py-3 font-medium">{formatDate(row.serviceDate)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.actualMarketValueKrw)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {formatKrw(row.scenarioMarketValueKrw)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-semibold tabular-nums ${moneyTone(row.differenceKrw)}`}
                  >
                    {formatSignedKrw(row.differenceKrw)}
                  </td>
                  <td className="px-4 py-3 text-[#687064]">
                    {formatDate(row.valuationPriceDate)}
                    {row.hasPendingExecution ? " · 지연 체결" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <h2 className="text-lg font-semibold">데이터 상태</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <EvidenceCell label="완전한 비교일" value={`${model.coverage.completeComparisonDates}일`} />
          <EvidenceCell label="평가 스냅샷" value={`${model.coverage.snapshotSourceRows}행`} />
          <EvidenceCell label="KODEX 200 종가" value={`${model.coverage.scenarioCloseRows}행`} />
          <EvidenceCell label="종료 시 대기 거래" value={`${model.coverage.pendingAtEndRows}건`} />
        </div>
      </section>
    </>
  );
}

function ReturnEstimateSection({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  const estimate = model.returnEstimate;
  if (!estimate || estimate.status === "blocked") {
    return (
      <section className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-4">
        <h2 className="text-lg font-semibold text-[#5f5027]">
          현금흐름 조정 추정수익률
        </h2>
        <p className="mt-2 text-sm text-[#725f2d]">
          평가액 비교는 유지하지만 가격 기준 또는 계산 입력이 불충분해 수익률 추정치는 표시하지 않습니다.
        </p>
        {estimate ? (
          <ul className="mt-3 space-y-1 text-sm text-[#725f2d]">
            {estimate.blockers.map((blocker) => (
              <li key={blocker}>{returnBlockerLabel(blocker)}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-return-method={estimate.method.version}
    >
      <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold">현금흐름 조정 추정수익률</h2>
          <p className="mt-1 text-sm text-[#687064]">
            관측 평가일 사이의 일별 가중 현금흐름을 반영한 Modified Dietz 추정치
          </p>
        </div>
        <p className="text-xs text-[#777e73]">
          가격수익 기준 · 배당·수수료·세금 별도 반영 안 함
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ReturnMetricCell
          label="실제 포트폴리오"
          value={formatSignedPercent(estimate.actualReturn)}
          detail={`${estimate.periodCount}개 구간 · 거래 ${estimate.actualFlowCount}건`}
          tone={estimate.actualReturn >= 0 ? "positive" : "negative"}
        />
        <ReturnMetricCell
          label="전액 KODEX 200"
          value={formatSignedPercent(estimate.scenarioReturn)}
          detail={`${estimate.periodCount}개 구간 · 체결 ${estimate.scenarioFlowCount}건`}
          tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
        />
        <ReturnMetricCell
          label="수익률 차이"
          value={formatSignedPercentagePoints(
            estimate.differencePercentagePoints,
          )}
          detail="KODEX 200 - 실제"
          tone={
            estimate.differencePercentagePoints >= 0
              ? "positive"
              : "negative"
          }
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#777e73]">
        현금흐름 직전 전체 평가액이 없는 구간을 날짜 가중 방식으로 추정한 값이며, 정확한 일별 TWR 또는 총수익률을 의미하지 않습니다.
      </p>
    </section>
  );
}

function VooComparisonSection({
  model,
}: {
  model: InvestmentLabCounterfactualReadModel;
}) {
  const readiness = model.vooReadiness;
  const comparison = model.vooComparison;
  if (!readiness || !comparison) return null;

  if (comparison.status === "ready") {
    const summary = comparison.summary;
    const estimate = comparison.returnEstimate;
    return (
      <section
        className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
        data-voo-applied-flows={comparison.coverage.appliedFlowRows}
        data-voo-comparison-dates={summary.comparisonDateCount}
        data-voo-delayed-executions={
          comparison.coverage.delayedExecutionRows
        }
        data-voo-execution-fx-ready={readiness.executionFxReadyCount}
        data-voo-relevant-flows={readiness.relevantFlowCount}
        data-voo-return-method={estimate.method.version}
        data-voo-return-status={estimate.status}
        data-voo-service-dates={readiness.serviceDateCount}
        data-voo-snapshot-fx-provenance-ready={
          readiness.snapshotFxProvenanceReadyCount
        }
        data-voo-snapshot-fx-ready={readiness.snapshotFxReadyCount}
        data-voo-valuation-price-ready={readiness.valuationPriceReadyCount}
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">전액 VOO 비교</h2>
            <p className="mt-1 text-sm text-[#687064]">
              실제와 같은 원화 매수·매도 금액을 VOO에 적용한 가격수익 경로
            </p>
          </div>
          <p className="text-sm font-semibold text-[#087f4f]">
            계산 완료
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ReadinessMetric
            label="VOO 종료 평가액"
            value={formatKrw(summary.scenarioEndValueKrw)}
            detail={`${summary.comparisonDateCount}개 평가일`}
          />
          <ReadinessMetric
            label="실제 대비 차이"
            value={formatSignedKrw(summary.endDifferenceKrw)}
            detail="VOO - 실제"
          />
          <ReadinessMetric
            label="체결 증거"
            value={`${comparison.coverage.appliedFlowRows}/${readiness.relevantFlowCount}`}
            detail={`지연 체결 ${comparison.coverage.delayedExecutionRows}건`}
          />
        </div>

        {estimate.status === "ready" ? (
          <div className="mt-4 grid gap-3 border-t border-[#e1e6dc] pt-4 sm:grid-cols-3">
            <ReturnMetricCell
              label="실제 추정수익률"
              value={formatSignedPercent(estimate.actualReturn)}
              detail={`${estimate.periodCount}개 구간`}
              tone={estimate.actualReturn >= 0 ? "positive" : "negative"}
            />
            <ReturnMetricCell
              label="전액 VOO 추정수익률"
              value={formatSignedPercent(estimate.scenarioReturn)}
              detail={`체결 ${estimate.scenarioFlowCount}건`}
              tone={estimate.scenarioReturn >= 0 ? "positive" : "negative"}
            />
            <ReturnMetricCell
              label="수익률 차이"
              value={formatSignedPercentagePoints(
                estimate.differencePercentagePoints,
              )}
              detail="VOO - 실제"
              tone={
                estimate.differencePercentagePoints >= 0
                  ? "positive"
                  : "negative"
              }
            />
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-3 py-2 text-sm text-[#725f2d]">
            경로는 계산됐지만 현금·이벤트 근거가 불충분해 추정수익률은 표시하지 않습니다.
          </p>
        )}

        <div className="mt-5 border-t border-[#e1e6dc] pt-4">
          <InvestmentLabComparisonChart
            chartId="investment-lab-voo-chart"
            description="저장된 평가일마다 실제 평가액과 동일한 원화 거래금액을 VOO raw close와 당시 저장 환율에 적용한 가상 평가액을 비교합니다."
            rows={comparison.rows}
            scenarioLabel="전액 VOO"
            title="실제 포트폴리오와 VOO 시나리오 비교"
          />
        </div>
        <p className="mt-3 text-xs leading-5 text-[#777e73]">
          소수점 수량을 허용해 잔여 현금을 만들지 않으며, 보유 수량을 넘는 매도는 축소·차입 없이 전체 시나리오를 차단합니다. VOO raw close와 같은 서비스 날짜에 저장된 환율을 사용하고 배당 재투자는 제외합니다.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-voo-execution-fx-ready={readiness.executionFxReadyCount}
      data-voo-relevant-flows={readiness.relevantFlowCount}
      data-voo-service-dates={readiness.serviceDateCount}
      data-voo-snapshot-fx-ready={readiness.snapshotFxReadyCount}
      data-voo-snapshot-fx-provenance-ready={
        readiness.snapshotFxProvenanceReadyCount
      }
      data-voo-valuation-price-ready={readiness.valuationPriceReadyCount}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">전액 VOO 비교 준비도</h2>
          <p className="mt-1 text-sm text-[#687064]">
            미국 종가·환율·체결일 증거가 모두 맞을 때만 다음 단계에서 경로를 계산합니다.
          </p>
        </div>
        <p
          className={
            readiness.status === "ready"
              ? "text-sm font-semibold text-[#087f4f]"
              : "text-sm font-semibold text-[#9a6b18]"
          }
        >
          {readiness.status === "ready" ? "계산 입력 준비" : "증거 보완 필요"}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <ReadinessMetric
          label="VOO 평가 종가"
          value={`${readiness.valuationPriceReadyCount}/${readiness.serviceDateCount}`}
          detail="미국 거래일 raw close"
        />
        <ReadinessMetric
          label="평가 환율"
          value={`${readiness.snapshotFxReadyCount}/${readiness.serviceDateCount}`}
          detail={`출처 합의 ${readiness.snapshotFxProvenanceReadyCount}/${readiness.serviceDateCount}`}
        />
        <ReadinessMetric
          label="체결 환율"
          value={`${readiness.executionFxReadyCount}/${readiness.relevantFlowCount}`}
          detail="체결 가격일 exact FX"
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-[#777e73]">
        실제 포트폴리오와 같은 가격수익 기준을 위해 VOO raw close를 사용하고 배당 재투자는 제외합니다. 준비 전에는 부분 경로나 추정값을 표시하지 않습니다.
      </p>
      {readiness.blockers.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-[#725f2d]">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{vooReadinessBlockerLabel(blocker)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function BlockedView({ model }: { model: InvestmentLabCounterfactualReadModel }) {
  return (
    <section className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-5">
      <h2 className="text-lg font-semibold text-[#5f5027]">현재 계산할 수 없습니다</h2>
      <p className="mt-2 text-sm text-[#725f2d]">
        일부 결과를 추정해서 표시하지 않고 입력 증거를 차단했습니다.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-[#725f2d]">
        {model.blockers.map((blocker) => (
          <li key={blocker}>{blockerLabel(blocker)}</li>
        ))}
      </ul>
    </section>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-[#394138] hover:bg-[#edf1e8]"
    >
      {children}
    </Link>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-[#5d665b]">
      {label} <strong className="ml-1 text-[#1e2821]">{value}</strong>
    </span>
  );
}

function SummaryCell({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#087f4f]"
            : tone === "negative"
              ? "text-[#c43d39]"
              : "text-[#171916]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ReturnMetricCell({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "positive" | "negative";
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "positive" ? "text-[#087f4f]" : "text-[#c43d39]"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function ReadinessMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function blockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    snapshot_evidence_invalid: "평가 스냅샷 형식 또는 중복을 확인해야 합니다.",
    actual_path_reconciliation_mismatch: "저장된 전체 평가액과 계정별 합계가 일치하지 않습니다.",
    actual_path_incomplete: "비교 가능한 전체 계정 평가일이 부족합니다.",
    event_evidence_unsupported: "거래 금액 또는 이벤트 유형을 확인해야 합니다.",
    scenario_close_evidence_invalid: "KODEX 200 조정종가 증거를 확인해야 합니다.",
    flow_schedule_blocked: "거래일 이후 7일 안에 체결 가능한 종가가 없습니다.",
    path_calculation_blocked: "가상 경로 계산의 보존 조건을 충족하지 못했습니다.",
    pending_flows_at_window_end: "마지막 평가일까지 처리되지 않은 거래가 있습니다.",
  };
  return labels[blocker] ?? "입력 증거를 확인해야 합니다.";
}

function returnBlockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    valuation_axis_mismatch: "실제 경로와 가상 경로의 평가일이 일치하지 않습니다.",
    price_basis_unavailable: "비교 구간의 종가 기준을 확인할 수 없습니다.",
    price_basis_mismatch: "종가와 조정종가 기준이 섞여 있어 동일 기준 비교가 아닙니다.",
    actual_return_calculation_blocked: "실제 포트폴리오 수익률 입력을 확인해야 합니다.",
    scenario_return_calculation_blocked: "KODEX 200 수익률 입력을 확인해야 합니다.",
    cash_evidence_unavailable: "평가일별 현금 제외 근거를 확인할 수 없습니다.",
    nonzero_cash_evidence: "현금이 있는 구간의 수익률 정책이 아직 확정되지 않았습니다.",
    ambiguous_position_metadata_event:
      "자산 추가·제외 이벤트에 재무 값이 섞여 있어 별도 분류가 필요합니다.",
    unmodeled_return_event: "수익률에 영향을 줄 수 있는 미분류 이벤트가 있습니다.",
  };
  return labels[blocker] ?? "수익률 계산 입력을 확인해야 합니다.";
}

function vooReadinessBlockerLabel(blocker: string) {
  const labels: Record<string, string> = {
    invalid_service_date_axis: "비교 평가일 축을 확인해야 합니다.",
    missing_valuation_price: "일부 평가일의 미국 거래일 종가가 없습니다.",
    duplicate_valuation_price: "같은 날짜의 VOO 종가가 중복되어 있습니다.",
    invalid_valuation_price: "사용할 수 없는 VOO 종가가 있습니다.",
    missing_snapshot_fx: "일부 평가일의 저장 환율이 없습니다.",
    ambiguous_snapshot_fx: "같은 평가일의 계좌별 환율이 일치하지 않습니다.",
    invalid_flow_date: "거래 기준일을 확인해야 합니다.",
    missing_execution_price: "거래 이후 체결 가능한 VOO 종가가 없습니다.",
    duplicate_execution_price: "체결 기준일의 VOO 종가가 중복되어 있습니다.",
    invalid_execution_price: "체결 기준일의 VOO 종가를 사용할 수 없습니다.",
    execution_price_too_late: "거래와 체결 가능일 간격이 허용 범위를 넘었습니다.",
    execution_after_window: "비교 종료일까지 체결되지 않는 거래가 있습니다.",
    missing_execution_fx: "일부 체결 가격일의 USD/KRW가 없습니다.",
    duplicate_execution_fx: "일부 체결 가격일의 USD/KRW가 중복되어 있습니다.",
    invalid_execution_fx: "일부 체결 가격일의 USD/KRW를 사용할 수 없습니다.",
  };
  return labels[blocker] ?? "VOO 비교 입력을 확인해야 합니다.";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrw(value: number) {
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}₩${Math.round(Math.abs(value)).toLocaleString("ko-KR")}`;
}

function formatSignedPercent(value: number) {
  if (Math.abs(value) < 0.0000005) return "0.00%";
  return `${value > 0 ? "+" : "-"}${(Math.abs(value) * 100).toFixed(2)}%`;
}

function formatSignedPercentagePoints(value: number) {
  if (Math.abs(value) < 0.0005) return "0.00%p";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%p`;
}

function moneyTone(value: number) {
  return value > 0
    ? "text-[#087f4f]"
    : value < 0
      ? "text-[#c43d39]"
      : "text-[#5d665b]";
}
