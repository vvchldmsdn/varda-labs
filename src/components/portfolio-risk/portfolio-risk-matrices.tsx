import type {
  PortfolioRiskMathInstrument,
  PortfolioRiskPortfolioMetrics,
} from "@/lib/portfolio-risk";

import { formatRiskDecimal, metricReasonLabel } from "./portfolio-risk-format";
import {
  RiskEmptyMessage,
  RiskSection,
  RiskTableCell,
  RiskTableHeader,
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
        detail="calculation instrument order"
        instruments={instruments}
        matrix={portfolio.correlationMatrix}
      />
      <RiskSection
        title="하락 구간 상관"
        marker="stress-correlation"
        detail={`${portfolio.stress.downDayObservations} down days`}
      >
        {portfolio.stress.correlationMatrix ? (
          <RiskMatrix
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
      <RiskMatrix instruments={instruments} matrix={matrix} />
    </RiskSection>
  );
}

function RiskMatrix({
  instruments,
  matrix,
}: {
  instruments: readonly PortfolioRiskMathInstrument[];
  matrix: Array<Array<number | null>>;
}) {
  const minimumWidth = Math.max(720, (instruments.length + 1) * 84);

  return (
    <div className="mt-3 max-w-full overflow-x-auto">
      <table
        className="border-separate border-spacing-0"
        style={{ minWidth: minimumWidth }}
      >
        <thead>
          <tr>
            <RiskTableHeader>종목</RiskTableHeader>
            {instruments.map((instrument) => (
              <RiskTableHeader key={instrument.instrumentKey} align="center">
                {instrument.ticker}
              </RiskTableHeader>
            ))}
          </tr>
        </thead>
        <tbody>
          {instruments.map((instrument, rowIndex) => (
            <tr key={instrument.instrumentKey}>
              <RiskTableCell strong>{instrument.ticker}</RiskTableCell>
              {instruments.map((column, columnIndex) => (
                <RiskTableCell
                  key={column.instrumentKey}
                  align="center"
                >
                  {formatRiskDecimal(
                    matrix[rowIndex]?.[columnIndex] ?? null,
                  )}
                </RiskTableCell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
