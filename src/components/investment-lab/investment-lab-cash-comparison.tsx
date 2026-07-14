import type { InvestmentLabCashComparison } from "@/lib/investment-lab-cash-comparison";

import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";

export function InvestmentLabCashComparisonView({
  comparison,
}: {
  comparison: InvestmentLabCashComparison | null;
}) {
  if (!comparison || comparison.status === "unavailable") {
    return (
      <section
        className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-4"
        data-cash-comparison-status="unavailable"
        data-section="investment-lab-cash-comparison"
      >
        <h2 className="text-lg font-semibold text-[#5f5027]">
          전액 현금 기준선
        </h2>
        <p className="mt-2 text-sm text-[#725f2d]">
          동일 자금 흐름으로 현금 기준선을 계산할 수 없습니다.
        </p>
      </section>
    );
  }

  const { summary, returnComparison } = comparison;

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-cash-applied-flows={comparison.coverage.appliedFlowRows}
      data-cash-comparison-dates={summary.comparisonDateCount}
      data-cash-comparison-status="ready"
      data-cash-policy={comparison.policy.version}
      data-cash-return-status={returnComparison.status}
      data-section="investment-lab-cash-comparison"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">전액 현금 기준선</h2>
          <p className="mt-1 text-sm text-[#687064]">
            첫 평가액과 실제 매수·매도 원화 금액은 같게 두고, 가격 수익은
            0%라고 가정합니다.
          </p>
        </div>
        <p className="text-sm font-semibold text-[#087f4f]">계산 완료</p>
      </div>

      <div className="mt-4 grid gap-3 border-y border-[#e1e6dc] py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="현금 최종값" value={formatKrw(summary.scenarioEndValueKrw)} />
        <Metric
          label="실제 대비 차이"
          value={formatSignedKrw(summary.endDifferenceKrw)}
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
        />
        <Metric
          label="반영한 자금 흐름"
          value={`${comparison.coverage.appliedFlowRows}건`}
        />
        <Metric
          label="현금 수익률"
          value={
            returnComparison.cashReturn === null
              ? "-"
              : formatSignedPercent(returnComparison.cashReturn)
          }
        />
      </div>

      {returnComparison.status === "ready" ? (
        <p className="mt-3 text-sm text-[#687064]">
          같은 기간 실제 추정수익률 대비 차이{" "}
          <strong
            className={
              returnComparison.differencePercentagePoints >= 0
                ? "text-[#087f4f]"
                : "text-[#c43d39]"
            }
          >
            {formatSignedPercentagePoints(
              returnComparison.differencePercentagePoints,
            )}
          </strong>
        </p>
      ) : (
        <p className="mt-3 text-sm text-[#725f2d]">
          현금 경로는 계산됐지만 실제 포트폴리오 추정수익률 근거가 부족해
          수익률 차이는 표시하지 않습니다.
        </p>
      )}

      <div className="mt-5 border-t border-[#e1e6dc] pt-4">
        <InvestmentLabComparisonChart
          chartId="investment-lab-cash-chart"
          description="저장된 평가일마다 실제 평가액과 동일한 매수·매도 원화 흐름을 적용한 무이자 현금 기준선을 비교합니다."
          rows={comparison.rows}
          scenarioLabel="전액 현금"
          title="실제 포트폴리오와 전액 현금 기준선 비교"
        />
      </div>

      <p className="mt-3 text-xs leading-5 text-[#777e73]">
        이 기준선은 현재 현금 잔액이나 추가투입 분배 계산이 아닙니다. 이자,
        세금, 수수료, 주문 가능 여부를 반영하지 않으며 저장하거나 주문으로
        연결하지 않습니다.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#087f4f]"
            : tone === "negative"
              ? "text-[#c43d39]"
              : "text-[#171916]"
        }`}
      >
        {value}
      </p>
    </div>
  );
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
