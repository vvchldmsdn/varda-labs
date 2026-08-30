import type {
  InvestmentLabScenarioChart,
  InvestmentLabScenarioChartLine,
} from "@/lib/investment-lab-scenario-chart";
import type { InvestmentLabScenarioMatrixId } from "@/lib/investment-lab-scenario-matrix";

export type InvestmentLabTimeMachineScenarioSummary = Readonly<{
  id: InvestmentLabScenarioMatrixId;
  endValueKrw: number | null;
  endDifferenceKrw: number | null;
  returnEstimate: number | null;
  maximumDrawdown: number | null;
  annualizedVolatility: number | null;
}>;

export type UnavailableLabScenario = Readonly<{
  id: InvestmentLabScenarioMatrixId;
  reason: string;
  resolution: string;
}>;

const LABELS: Record<
  InvestmentLabScenarioMatrixId,
  { label: string; detail: string }
> = {
  actual: { label: "실제 포트폴리오", detail: "저장된 실제 평가 이력" },
  kodex200: {
    label: "전액 KODEX 200",
    detail: "동일한 입출금 · 국내 지수 ETF",
  },
  voo: { label: "전액 S&P 500", detail: "Vanguard S&P 500 ETF · 환율 반영" },
  fixed_mix: {
    label: "국내·미국 지수 혼합",
    detail: "KODEX 200 + Vanguard S&P 500 ETF",
  },
  preperiod_min_volatility: {
    label: "변동성 최소 혼합",
    detail: "시작일 이전 자료로 구한 두 ETF 비중",
  },
  zero_return: {
    label: "수익률 0% 기준선",
    detail: "동일 입출금 · 현금수익 가정 없음",
  },
  anchor_basket: {
    label: "처음부터 동일 비중",
    detail: "기준일 종목 · 리밸런싱 없음",
  },
  anchor_value_weight: {
    label: "처음 비중 그대로",
    detail: "기준일 비중 · 리밸런싱 없음",
  },
  anchor_current_weight_monthly: {
    label: "기준 비중 월간 유지",
    detail: "기준일 비중으로 매월 리밸런싱",
  },
  approved_target_weight_monthly: {
    label: "목표 비중 월간 유지",
    detail: "승인 목표로 매월 리밸런싱",
  },
  anchor_equal_weight_monthly: {
    label: "동일 비중 월간 유지",
    detail: "종목별 동일 비중으로 매월 리밸런싱",
  },
};

export function labScenarioLabel(id: InvestmentLabScenarioMatrixId) {
  return LABELS[id].label;
}
export function labScenarioDetail(id: InvestmentLabScenarioMatrixId) {
  return LABELS[id].detail;
}

export function defaultLabScenario(chart: InvestmentLabScenarioChart) {
  const order: readonly InvestmentLabScenarioMatrixId[] = [
    "kodex200",
    "anchor_value_weight",
    "fixed_mix",
    "anchor_equal_weight_monthly",
    "voo",
  ];
  return (
    order.find((id) => chart.lines.some((line) => line.id === id)) ??
    chart.lines.find((line) => line.id !== "actual")?.id ??
    "actual"
  );
}

export function labValueDomain(
  lines: readonly InvestmentLabScenarioChartLine[],
) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const line of lines)
    for (const point of line.points) {
      if (!Number.isFinite(point.valueKrw)) continue;
      minimum = Math.min(minimum, point.valueKrw);
      maximum = Math.max(maximum, point.valueKrw);
    }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum))
    return { minimum: 0, maximum: 1 };
  const padding = Math.max(
    (maximum - minimum) * 0.14,
    Math.abs(maximum) * 0.015,
    1,
  );
  return { minimum: minimum - padding, maximum: maximum + padding };
}

export function nearestLabDateIndex(
  dates: readonly string[],
  timestamp: number,
) {
  if (dates.length === 0) return 0;
  let low = 0;
  let high = dates.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (Date.parse(`${dates[mid]}T00:00:00Z`) < timestamp) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const right = Date.parse(`${dates[low]}T00:00:00Z`);
  const left = Date.parse(`${dates[low - 1]}T00:00:00Z`);
  return timestamp - left <= right - timestamp ? low - 1 : low;
}

export function labKrw(value: number | null, signed = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded < 0 ? "−" : signed && rounded > 0 ? "+" : ""}₩${Math.abs(rounded).toLocaleString("ko-KR")}`;
}

export function labPercent(value: number | null, signed = false) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value < 0 ? "−" : signed && value > 0 ? "+" : ""}${Math.abs(value * 100).toFixed(2)}%`;
}

export function labCompactKrw(value: number) {
  if (Math.abs(value) >= 100_000_000)
    return `${(value / 100_000_000).toFixed(1)}억`;
  if (Math.abs(value) >= 10_000)
    return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return Math.round(value).toLocaleString("ko-KR");
}

export function labMoneyTone(value: number | null) {
  return value === null || Math.abs(value) < 0.5
    ? "text-[#27382e]"
    : value > 0
      ? "text-[#388773]"
      : "text-[#c4615e]";
}
