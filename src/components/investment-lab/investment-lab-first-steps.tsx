import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, Layers3, SlidersHorizontal } from "lucide-react";
import { T } from "@/components/i18n/localized-text";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import type { InvestmentLabPanel } from "@/lib/investment-lab-panel";
import styles from "./investment-lab-modern.module.css";

export function InvestmentLabFirstSteps({ scopeKey, onOpenPanel }: {
  scopeKey: PortfolioAnalysisScopeKey;
  onOpenPanel: (panel: InvestmentLabPanel) => void;
}) {
  return (
    <section className={styles.firstSteps} data-lab-first-steps>
      <div className={styles.firstStepsIntro}>
        <p className="varda-kicker"><T ko="지금 구성으로 시작하기" en="Start with what you own" /></p>
        <h2><T ko="내 종목으로, 다른 가능성을 살펴보세요." en="Explore another possibility with your holdings." /></h2>
        <p><T ko="내 실제 기록과 투자 방법을 비교하려면 서로 다른 날짜의 평가 기록이 더 필요해요. 그동안 현재 보유 구성으로 이런 질문을 살펴볼 수 있어요." en="Comparing investment methods against your own results needs more valuation records from different dates. Meanwhile, explore these questions using your current holdings." /></p>
        <p className={styles.firstStepsBoundary}><T ko="각 실험은 확인된 가격·평가액 범위에서 계산해요. 지금 구성으로 만든 가정이며, 내 과거 수익이나 실제 매매 기록이 되지 않아요." en="Each experiment uses verified price and valuation evidence. These are hypothetical results for your current holdings, not your past returns or actual trades." /></p>
      </div>
      <div className={styles.firstStepActions}>
        <button type="button" className={styles.firstStepAction} onClick={() => onOpenPanel("weights")}>
          <SlidersHorizontal aria-hidden="true" size={21} />
          <span><strong><T ko="두 종목의 비중을 바꾸면?" en="What if I shifted weight between two holdings?" /></strong><span><T ko="금액을 옮겨 보고 구성의 차이 살펴보기" en="Try moving an amount and compare the allocation" /></span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
        <Link className={styles.firstStepAction} href={`/simulation?${new URLSearchParams({ scope: scopeKey })}`}>
          <ChartNoAxesCombined aria-hidden="true" size={21} />
          <span><strong><T ko="내 포트폴리오는 얼마나 흔들릴까?" en="How much could my portfolio fluctuate?" /></strong><span><T ko="과거 가격으로 만든 여러 가능성 살펴보기" en="Explore possible paths drawn from historical prices" /></span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </Link>
        <button type="button" className={styles.firstStepAction} onClick={() => onOpenPanel("composition")}>
          <Layers3 aria-hidden="true" size={21} />
          <span><strong><T ko="지금 구성으로 과거를 지나갔다면?" en="What if I held this mix through the past?" /></strong><span><T ko="과거 구간과 ETF 안의 겹치는 종목 살펴보기" en="Explore past periods and overlapping ETF holdings" /></span></span>
          <ArrowUpRight aria-hidden="true" size={18} />
        </button>
      </div>
    </section>
  );
}
