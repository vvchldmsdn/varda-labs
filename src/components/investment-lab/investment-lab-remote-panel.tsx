"use client";
import type { InvestmentLabDetailData } from "@/db/queries/investment-lab-detail";
import type { InvestmentLabWeightEvidence } from "@/lib/investment-lab-weight-evidence";
import { useResearchDetail, ResearchDetailStatus } from "./research-detail-resource";
import { InvestmentLabEtfXray } from "./investment-lab-etf-xray";
import { InvestmentLabStressReplayView } from "./investment-lab-stress-replay";
import { InvestmentLabSmallAdjustment } from "./investment-lab-small-adjustment";
import { InvestmentLabPreperiodOptimizerView } from "./investment-lab-preperiod-optimizer";
import { InvestmentLabFixedMix } from "./investment-lab-fixed-mix";
import { InvestmentLabPreperiodMinVolatilityView } from "./investment-lab-preperiod-min-volatility";
import { InvestmentLabAnchorBasket } from "./investment-lab-anchor-basket";
import { InvestmentLabRollingComparisonView } from "./investment-lab-rolling-comparison";
import { InvestmentLabDisclosure } from "./investment-lab-disclosure";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";

export default function InvestmentLabRemotePanel({ query, weights, scopeKey }: { query: string; weights: InvestmentLabWeightEvidence; scopeKey: PortfolioAnalysisScopeKey }) {
  const { data, error, retry } = useResearchDetail<InvestmentLabDetailData>("/api/research/investment-lab", query);
  if (!data) return <ResearchDetailStatus error={error} retry={retry} />;
  if (data.panel === "composition") return <div className="space-y-8 py-5">
    {data.unavailableSections.length ? <p role="status" className="text-sm text-[var(--warning)]">읽지 못한 근거: {data.unavailableSections.join(", ")}</p> : null}
    {data.xray && <div id="investment-lab-etf-xray"><InvestmentLabEtfXray model={data.xray} /></div>}{data.stress && <InvestmentLabStressReplayView model={data.stress} />}
  </div>;
  return <div className="space-y-8 py-7">
    {weights.optimizer && <div id="investment-lab-optimizer"><InvestmentLabPreperiodOptimizerView model={weights.optimizer} /></div>}
    <InvestmentLabDisclosure title="국내·미국 지수 비중 조정" detail="KODEX 200 · Vanguard S&P 500 ETF" open>
      <InvestmentLabFixedMix comparison={weights.fixedMixComparison} model={weights.fixedMixScenario} period={weights.period} scopeKey={scopeKey} selection={weights.selection} />
      <InvestmentLabPreperiodMinVolatilityView model={weights.preperiodMinVolatility} />
    </InvestmentLabDisclosure>
    <InvestmentLabDisclosure title="시작일 바스켓과 반복 비교" detail="동일 비중 · 시간별 검증">
      {weights.anchorBasket && <InvestmentLabAnchorBasket fixedMixSelection={weights.selection} model={weights.anchorBasket} period={weights.period} scopeKey={scopeKey} />}
      {weights.rollingComparison && <InvestmentLabRollingComparisonView model={weights.rollingComparison} />}
    </InvestmentLabDisclosure>
    {data.adjustment && <div id="investment-lab-small-adjustment"><InvestmentLabDisclosure title="작은 조정 실험" detail="보유 비중 변경 전후 구조"><InvestmentLabSmallAdjustment model={data.adjustment} /></InvestmentLabDisclosure></div>}
  </div>;
}
