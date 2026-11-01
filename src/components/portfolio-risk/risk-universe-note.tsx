import { PortfolioText } from "@/components/portfolio/portfolio-text";
import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

/** Weight coverage is separate from the calculation's observation status. */
export function RiskUniverseNote({ model }: { model: PortfolioRiskReadModel }) {
  if (model.provenance.excludedHoldingCount === 0 || model.calculation.instruments.length === 0) return null;
  return <p data-risk-universe="partial" role="status"><PortfolioText
    ko={`일부 종목 분석 · 제외 ${model.provenance.excludedHoldingCount}개. 분석 가능한 종목의 비중을 합계 100%로 환산했어요.`}
    en={`Partial holdings analysis · ${model.provenance.excludedHoldingCount} excluded. Eligible holdings are reweighted to 100%.`}
  /></p>;
}
