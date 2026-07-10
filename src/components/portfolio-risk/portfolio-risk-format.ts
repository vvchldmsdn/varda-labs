import type {
  PortfolioRiskCalculationReason,
  PortfolioRiskCalculationStatus,
  PortfolioRiskMetric,
  PortfolioRiskMetricReason,
} from "@/lib/portfolio-risk";
import type { PortfolioRiskInputStatus } from "@/lib/portfolio-risk-input";

export function formatRiskDecimal(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatRiskRatioPercent(value: number | null) {
  return value === null ? "n/a" : formatRiskPercentValue(value * 100);
}

export function formatRiskPercentValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatRiskMetric(
  metric: PortfolioRiskMetric,
  mode: "decimal" | "percent" = "decimal",
) {
  if (metric.value === null) return "n/a";
  return mode === "percent"
    ? formatRiskPercentValue(metric.value)
    : formatRiskDecimal(metric.value);
}

export function inputStatusLabel(status: PortfolioRiskInputStatus) {
  const labels: Record<PortfolioRiskInputStatus, string> = {
    blocked: "입력 차단",
    ready: "계산 준비 완료",
    partial: "부분 관측치",
    insufficient_coverage: "관측치 부족",
    insufficient_instruments: "종목 수 부족",
  };
  return labels[status];
}

export function calculationStatusLabel(
  status: PortfolioRiskCalculationStatus,
) {
  const labels: Record<PortfolioRiskCalculationStatus, string> = {
    complete: "전체 계산 완료",
    standalone_only: "단일 종목만 계산",
    unavailable: "계산 불가",
    invalid: "입력 오류",
  };
  return labels[status];
}

export function calculationReasonLabel(
  reason: PortfolioRiskCalculationReason | null,
) {
  if (reason === null) return null;
  const labels: Record<PortfolioRiskCalculationReason, string> = {
    input_blocked: "중복 데이터로 입력이 차단됐습니다.",
    input_insufficient_coverage: "요청한 기간의 관측치가 부족합니다.",
    no_instruments: "계산 가능한 종목이 없습니다.",
    invalid_input: "정규화된 계산 입력이 유효하지 않습니다.",
    insufficient_observations: "수익률 계산에 필요한 관측치가 부족합니다.",
    invalid_covariance: "공분산 행렬을 안전하게 계산할 수 없습니다.",
  };
  return labels[reason];
}

export function metricReasonLabel(reason: PortfolioRiskMetricReason | null) {
  if (reason === null) return null;
  const labels: Record<PortfolioRiskMetricReason, string> = {
    insufficient_observations: "관측치 부족",
    zero_variance: "변동성 0",
    zero_portfolio_volatility: "포트폴리오 변동성 0",
    insufficient_instruments: "종목 수 부족",
    undefined_pair_correlation: "정의되지 않은 종목 쌍 포함",
    no_positive_weight_pairs: "양수 비중 종목 쌍 없음",
    insufficient_down_days: "하락일 관측치 부족",
  };
  return labels[reason];
}

export function accountLabel(account: string) {
  if (account === "brokerage") return "증권";
  if (account === "all") return "전체";
  return account.toUpperCase();
}

export function displayInstrumentKey(instrumentKey: string) {
  return instrumentKey.split("|").at(-1) || "n/a";
}
