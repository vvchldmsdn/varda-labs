import Link from "next/link";
import { ChartNoAxesCombined, Layers3, SlidersHorizontal } from "lucide-react";
import { T } from "@/components/i18n/localized-text";
import { useI18n } from "@/components/i18n/locale-provider";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import type { InvestmentLabPanel } from "@/lib/investment-lab-panel";
import styles from "./investment-lab-modern.module.css";
import { ActionGroup, ActionContent, Button as CairnButton, SectionTitle } from "@/components/cairn-ui";

export function InvestmentLabFirstSteps({ scopeKey, onOpenPanel, preview = false }: {
  scopeKey: PortfolioAnalysisScopeKey;
  preview?: boolean;
  onOpenPanel: (panel: InvestmentLabPanel) => void;
}) {
  const { t } = useI18n();
  const query = new URLSearchParams({ scope: scopeKey });
  if (preview) query.set("preview", "design");
  return <section className={styles.firstSteps} data-lab-first-steps>
    <div className={styles.firstStepsIntro}>
      <SectionTitle><T ko="내 종목으로 시작하는 실험" en="Explore your portfolio" /></SectionTitle>
      <p><T ko="내 기록이 없어도 지금 구성으로 살펴볼 수 있어요." en="Explore your current allocation while your history builds." /></p>
    </div>
    <ActionGroup label={t("시작할 실험", "Choose an experiment")} className={styles.firstStepActions}>
      <CairnButton variant="bare" type="button" onClick={() => onOpenPanel("weights")}><ActionContent icon={<SlidersHorizontal />} title={<T ko="두 종목의 비중을 바꾸면?" en="What if I shifted the weights?" />} description={<T ko="금액을 옮겨 구성 비교" en="Move an amount and compare" />} /></CairnButton>
      <Link href={"/simulation?" + query}><ActionContent icon={<ChartNoAxesCombined />} title={<T ko="내 포트는 얼마나 흔들릴까?" en="How much could it fluctuate?" />} description={<T ko="과거 가격으로 만든 가상 경로" en="Hypothetical paths from past prices" />} /></Link>
      <CairnButton variant="bare" type="button" onClick={() => onOpenPanel("composition")}><ActionContent icon={<Layers3 />} title={<T ko="지금 구성으로 과거를 지났다면?" en="What if I held this mix before?" />} description={<T ko="과거 구간과 ETF 구성 살펴보기" en="Explore past periods and ETF holdings" />} /></CairnButton>
    </ActionGroup>
    <p className={styles.firstStepsBoundary}><T ko="확인된 시장 자료로 만든 가정 · 내 과거 수익률 아님" en="Based on verified market history · Not your historical return" /></p>
  </section>;
}
