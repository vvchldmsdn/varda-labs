import type { InvestmentLabFixedMixBlocker } from "@/lib/investment-lab-fixed-mix";

export function investmentLabFixedMixBlockerLabel(
  blocker: InvestmentLabFixedMixBlocker,
) {
  const labels: Record<InvestmentLabFixedMixBlocker, string> = {
    invalid_weight_selection: "배분 입력을 확인해야 합니다.",
    component_path_unavailable: "두 종목의 완전한 경로가 모두 필요합니다.",
    valuation_axis_mismatch: "두 종목의 비교 날짜축이 일치하지 않습니다.",
    invalid_component_value: "구성 종목 평가액 근거를 확인해야 합니다.",
    component_flow_mismatch: "두 종목의 현금흐름 원본이 일치하지 않습니다.",
    return_evidence_unavailable: "수익률 근거가 완전하지 않습니다.",
    actual_return_mismatch: "실제 수익률 기준이 서로 일치하지 않습니다.",
    scenario_return_calculation_blocked: "시나리오 수익률을 계산할 수 없습니다.",
    account_composition_incomplete: "계좌별 시나리오 근거가 모두 필요합니다.",
    account_composition_mismatch: "계좌별 합계와 전체 결과가 일치하지 않습니다.",
  };
  return labels[blocker];
}

export function formatInvestmentLabKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatInvestmentLabSignedKrw(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatInvestmentLabKrw(value)}`;
}

export function formatInvestmentLabSignedPercent(value: number) {
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}
