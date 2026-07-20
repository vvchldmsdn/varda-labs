import type { InvestmentLabAnchorBasketScenario } from "@/lib/investment-lab-anchor-basket-scenario";
import type { InvestmentLabAnchorValueWeightScenario } from "@/lib/investment-lab-anchor-value-weight-scenario";
import type { InvestmentLabCounterfactualReadModel } from "@/lib/investment-lab-counterfactual-read-model";
import {
  buildInvestmentLabScenarioMatrix,
  type InvestmentLabScenarioFxBasis,
  type InvestmentLabScenarioMatrixId,
  type InvestmentLabScenarioMatrixRow,
  type InvestmentLabScenarioPriceBasis,
} from "@/lib/investment-lab-scenario-matrix";

export function InvestmentLabScenarioMatrix({
  anchorBasketScenario,
  anchorValueWeightScenario,
  model,
}: {
  anchorBasketScenario: InvestmentLabAnchorBasketScenario;
  anchorValueWeightScenario: InvestmentLabAnchorValueWeightScenario;
  model: InvestmentLabCounterfactualReadModel;
}) {
  const matrix = buildInvestmentLabScenarioMatrix({
    model,
    anchorBasketScenario,
    anchorValueWeightScenario,
  });

  return (
    <section
      className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
      data-scenario-matrix-ready-rows={matrix.coverage.readyRowCount}
      data-scenario-matrix-rows={matrix.coverage.rowCount}
      data-scenario-matrix-status={matrix.status}
      data-scenario-matrix-unavailable-rows={
        matrix.coverage.unavailableRowCount
      }
      data-section="investment-lab-scenario-matrix"
    >
      <div className="border-b border-[#e1e6dc] px-4 py-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">시나리오 한눈에 비교</h2>
            <p className="mt-1 text-sm leading-6 text-[#687064]">
              이미 계산된 경로만 같은 기간으로 맞춰 표시합니다. 순위나 추천이
              아니라 계산 근거와 불가 사유를 확인하는 연구용 비교표입니다.
            </p>
          </div>
          <p className="text-xs leading-5 text-[#73786c]">
            {matrix.period
              ? `${formatDate(matrix.period.startServiceDate)} ~ ${formatDate(matrix.period.endServiceDate)} · ${matrix.period.comparisonDateCount}개 평가일`
              : "공통 비교 구간 없음"}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1380px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
              <th className="px-4 py-3">시나리오</th>
              <th className="px-3 py-3">상태</th>
              <th className="px-3 py-3 text-right">종료 평가액</th>
              <th className="px-3 py-3 text-right">실제 대비</th>
              <th className="px-3 py-3 text-right">추정수익률</th>
              <th className="px-3 py-3 text-right">최대낙폭 (MDD)</th>
              <th className="px-3 py-3 text-right">연환산 변동성</th>
              <th className="px-3 py-3 text-right">흐름 / 대기 평가일</th>
              <th className="px-4 py-3">가격·환율 근거</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <ScenarioRow key={row.id} model={model} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-[#e1e6dc] px-4 py-3 text-xs leading-5 text-[#73786c]">
        최대낙폭과 변동성은 외부 입출금을 조정한 Modified Dietz
        기간수익률을 연결해 계산하며, 변동성은 252 관측일 기준으로
        연환산합니다. KODEX 200은 adjusted close, VOO는 raw close와 저장
        USD/KRW를 사용합니다. 제로수익 경로는 실제 현금계좌가 아닙니다.
      </p>
    </section>
  );
}

function ScenarioRow({
  row,
  model,
}: {
  row: InvestmentLabScenarioMatrixRow;
  model: InvestmentLabCounterfactualReadModel;
}) {
  return (
    <tr
      className="border-t border-[#e1e6dc] align-top"
      data-scenario-row={row.id}
      data-scenario-status={row.status}
      data-scenario-risk-status={row.riskMetrics.status}
    >
      <td className="px-4 py-3">
        <p className="font-semibold text-[#171916]">
          {scenarioLabel(row.id, model)}
        </p>
        <p className="mt-1 text-xs text-[#73786c]">
          {scenarioDetail(row.id)}
        </p>
      </td>
      <td className="px-3 py-3">
        <span
          className={
            row.status === "ready"
              ? "font-semibold text-[#08784d]"
              : "font-semibold text-[#9a6b18]"
          }
        >
          {row.status === "ready" ? "경로 계산" : "계산 불가"}
        </span>
        {row.status === "unavailable" ? (
          <p className="mt-1 max-w-52 text-xs leading-5 text-[#7b6232]">
            {reasonLabel(row.reasonCodes)}
          </p>
        ) : row.returnEstimate.status === "unavailable" ? (
          <p className="mt-1 text-xs text-[#7b6232]">수익률 근거 부족</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">
        {formatKrwOrDash(row.endValueKrw)}
      </td>
      <td
        className={`px-3 py-3 text-right font-semibold tabular-nums ${moneyTone(
          row.endDifferenceKrw,
        )}`}
      >
        {formatSignedKrwOrDash(row.endDifferenceKrw)}
      </td>
      <td
        className={`px-3 py-3 text-right font-semibold tabular-nums ${percentTone(
          row.returnEstimate.value,
        )}`}
      >
        {formatPercentOrDash(row.returnEstimate.value)}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#4f584f]">
        {formatRiskPercentOrDash(row.riskMetrics.maximumDrawdown)}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums text-[#4f584f]">
        <p>
          {formatRiskPercentOrDash(row.riskMetrics.annualizedVolatility)}
        </p>
        <p className="mt-1 text-xs font-normal text-[#73786c]">
          {row.riskMetrics.periodCount > 0
            ? `${row.riskMetrics.periodCount}개 기간`
            : "근거 없음"}
        </p>
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-[#4f584f]">
        <p>{row.flowCount === null ? "-" : `${row.flowCount}건`}</p>
        <p className="mt-1 text-xs text-[#73786c]">
          {row.pendingComparisonCount === null
            ? "대기 해당 없음"
            : `대기 ${row.pendingComparisonCount}일`}
        </p>
      </td>
      <td className="px-4 py-3 text-xs leading-5 text-[#5f685d]">
        <p>{priceBasisLabel(row.priceBasis)}</p>
        <p className="text-[#73786c]">{fxBasisLabel(row.fxBasis)}</p>
      </td>
    </tr>
  );
}

function scenarioLabel(
  id: InvestmentLabScenarioMatrixId,
  model: InvestmentLabCounterfactualReadModel,
) {
  const labels: Record<InvestmentLabScenarioMatrixId, string> = {
    actual: "실제 포트폴리오",
    kodex200: "전액 KODEX 200 연구 경로",
    voo: "전액 VOO 연구 경로",
    fixed_mix: fixedMixLabel(model),
    zero_return: "제로수익 동일흐름 현금 기준선",
    anchor_basket: "기준일 바스켓",
    anchor_value_weight: "기준일 비중 유지",
  };
  return labels[id];
}

function fixedMixLabel(model: InvestmentLabCounterfactualReadModel) {
  const weights = model.fixedMixScenario?.weights;
  return weights
    ? `고정혼합 KODEX ${weights.kodexWeightBps / 100}% · VOO ${weights.vooWeightBps / 100}%`
    : "고정혼합 KODEX · VOO";
}

function scenarioDetail(id: InvestmentLabScenarioMatrixId) {
  const details: Record<InvestmentLabScenarioMatrixId, string> = {
    actual: "저장 포지션 평가액",
    kodex200: "동일 외부 흐름 · 주문 가능성 미검증",
    voo: "동일 원화 외부 흐름 · 계정 매수 가능성 미검증",
    fixed_mix: "초기·외부 흐름 고정 배분",
    zero_return: "외부 흐름만 반영한 수익률 0% 가상 장부",
    anchor_basket: "초기 동일비중·이후 흐름 균등배분",
    anchor_value_weight:
      "기준일 저장 평가액 비중으로 초기·외부 흐름 배분 · 리밸런싱 없음",
  };
  return details[id];
}

function priceBasisLabel(value: InvestmentLabScenarioPriceBasis) {
  const labels: Record<InvestmentLabScenarioPriceBasis, string> = {
    stored_position_market_value: "저장 포지션 원화 평가액",
    kodex200_adjusted_close: "KODEX 200 adjusted close",
    voo_raw_close: "VOO raw close",
    kodex_adjusted_and_voo_raw_close:
      "KODEX adjusted close + VOO raw close",
    zero_return_no_price: "가격 경로 미사용",
    anchor_instrument_raw_close: "기준일 종목별 raw close",
    anchor_instrument_close_and_stored_manual:
      "종목별 저장 종가 또는 저장 수동 평가",
  };
  return labels[value];
}

function fxBasisLabel(value: InvestmentLabScenarioFxBasis) {
  const labels: Record<InvestmentLabScenarioFxBasis, string> = {
    stored_krw_market_value: "저장된 원화 환산 결과",
    krw_not_applicable: "KRW · 별도 환율 없음",
    stored_snapshot_and_execution_usdkrw: "저장 평가·체결 USD/KRW",
    krw_and_stored_usdkrw: "KRW + 저장 USD/KRW",
    zero_return_not_applicable: "환율 경로 미사용",
    stored_usdkrw_for_usd_legs: "USD leg만 저장 USD/KRW",
  };
  return labels[value];
}

function reasonLabel(reasonCodes: readonly string[]) {
  if (reasonCodes.includes("period_mismatch")) return "공통 비교 기간 불일치";
  if (
    reasonCodes.includes("tickerless_anchor_holding") ||
    reasonCodes.includes("physical_anchor_holding")
  ) {
    return "기준일 미식별·특수 포지션 존재";
  }
  if (reasonCodes.some((reason) => reason.includes("price"))) {
    return "가격 근거 부족 또는 중복";
  }
  if (reasonCodes.some((reason) => reason.includes("fx"))) {
    return "환율 근거 부족 또는 중복";
  }
  if (reasonCodes.includes("base_period_unavailable")) {
    return "기본 비교 구간 계산 불가";
  }
  return "필요한 계산 근거가 완전하지 않음";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKrwOrDash(value: number | null) {
  return value === null
    ? "-"
    : `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrwOrDash(value: number | null) {
  return value === null
    ? "-"
    : `${value >= 0 ? "+" : "-"}₩${Math.abs(Math.round(value)).toLocaleString(
        "ko-KR",
      )}`;
}

function formatPercentOrDash(value: number | null) {
  return value === null
    ? "-"
    : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatRiskPercentOrDash(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function moneyTone(value: number | null) {
  if (value === null || value === 0) return "text-[#4f584f]";
  return value > 0 ? "text-[#08784d]" : "text-[#bd2929]";
}

function percentTone(value: number | null) {
  return moneyTone(value);
}
