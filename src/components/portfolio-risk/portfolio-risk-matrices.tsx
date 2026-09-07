import type {
  PortfolioRiskMathInstrument,
  PortfolioRiskPortfolioMetrics,
} from "@/lib/portfolio-risk";

import { ChevronDown } from "lucide-react";
import { metricReasonLabel } from "./portfolio-risk-format";
import { RiskCorrelationMatrix } from "./risk-correlation-matrix";
import styles from "./risk-workspace.module.css";
import {
  RiskEmptyMessage,
  RiskSection,
} from "./portfolio-risk-primitives";

export function RiskCorrelationSections({
  instruments,
  portfolio,
}: {
  instruments: readonly PortfolioRiskMathInstrument[];
  portfolio: PortfolioRiskPortfolioMetrics;
}) {
  return (
    <>
      <RiskMatrixSection
        title="상관관계 행렬"
        marker="correlation-matrix"
        detail="같은 기간에 관측한 종목별 수익률"
        instruments={instruments}
        matrix={portfolio.correlationMatrix}
      />
      <details className={styles.stressDisclosure}>
      <summary><span>하락일에도 함께 움직였을까?</span><small>{portfolio.stress.downDayObservations}개 하락일</small><ChevronDown size={16} aria-hidden="true" /></summary>
      <RiskSection
        title="하락 구간 상관"
        marker="stress-correlation"
        detail={`${portfolio.stress.downDayObservations}개 하락일`}
      >
        {portfolio.stress.correlationMatrix ? (
          <RiskCorrelationMatrix
            instruments={instruments}
            matrix={portfolio.stress.correlationMatrix}
          />
        ) : (
          <RiskEmptyMessage>
            하락일 {portfolio.stress.downDayObservations}개로 최소{" "}
            {portfolio.stress.minimumObservations}개 기준을 충족하지 못했습니다.
            {" "}
            {metricReasonLabel(
              portfolio.stress.weightedAverageCorrelation.reason,
            ) ?? "행렬을 계산할 수 없습니다."}
          </RiskEmptyMessage>
        )}
      </RiskSection>
      </details>
    </>
  );
}

function RiskMatrixSection({
  title,
  marker,
  detail,
  instruments,
  matrix,
}: {
  title: string;
  marker: string;
  detail: string;
  instruments: readonly PortfolioRiskMathInstrument[];
  matrix: Array<Array<number | null>>;
}) {
  return (
    <RiskSection title={title} marker={marker} detail={detail}>
      <RiskCorrelationMatrix instruments={instruments} matrix={matrix} />
    </RiskSection>
  );
}
