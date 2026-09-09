"use client";

import { LabText } from "./lab-text";
import { T } from "@/components/i18n/localized-text";
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
    {data.unavailableSections.length ? <p role="status" className="text-sm text-[var(--warning)]"><LabText value="읽지 못한 근거: " />{data.unavailableSections.join(", ")}</p> : null}
    {data.stress && <InvestmentLabStressReplayView model={data.stress} />}
    {data.xray && <details className="border-t border-[var(--line)] py-4"><summary className="cursor-pointer text-sm font-medium"><T ko="ETF 안의 겹치는 종목 살펴보기" en="Explore overlapping ETF holdings" /></summary><div id="investment-lab-etf-xray"><InvestmentLabEtfXray model={data.xray} /></div></details>}
  </div>;
  return <div className="space-y-8 py-7">
    {data.adjustment && <div id="investment-lab-small-adjustment"><InvestmentLabSmallAdjustment model={data.adjustment} /></div>}
    <details className="border-t border-[var(--line)] py-4">
      <summary className="cursor-pointer text-sm font-medium"><T ko="기록이 필요한 과거 비중 실험" en="Historical allocation experiments that need records" /></summary>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]"><T ko="실제 평가 기록과 투자금 흐름이 준비된 기간에서 비교해요. 아래에서 필요한 근거와 준비 상태를 확인할 수 있어요." en="These compare periods with recorded valuations and investment flows. Open an experiment below to check its required evidence and availability." /></p>
    {weights.optimizer && <InvestmentLabDisclosure title="과거 학습 비중 실험"><div id="investment-lab-optimizer"><InvestmentLabPreperiodOptimizerView model={weights.optimizer} /></div></InvestmentLabDisclosure>}
    <InvestmentLabDisclosure title="국내·미국 지수 비중 조정" detail="KODEX 200 · Vanguard S&P 500 ETF" open>
      <InvestmentLabFixedMix comparison={weights.fixedMixComparison} model={weights.fixedMixScenario} period={weights.period} scopeKey={scopeKey} selection={weights.selection} />
      <InvestmentLabPreperiodMinVolatilityView model={weights.preperiodMinVolatility} />
    </InvestmentLabDisclosure>
    <InvestmentLabDisclosure title="시작일 바스켓과 반복 비교" detail="동일 비중 · 시간별 검증">
      {weights.anchorBasket && <InvestmentLabAnchorBasket fixedMixSelection={weights.selection} model={weights.anchorBasket} period={weights.period} scopeKey={scopeKey} />}
      {weights.rollingComparison && <InvestmentLabRollingComparisonView model={weights.rollingComparison} />}
    </InvestmentLabDisclosure>
    </details>
  </div>;
}
