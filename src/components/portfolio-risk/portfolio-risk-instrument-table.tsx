import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

import {
  formatRiskMetric,
  formatRiskPercentValue,
  formatRiskRatioPercent,
  metricReasonLabel,
} from "./portfolio-risk-format";
import {
  RiskEmptyMessage,
  RiskSection,
  RiskTableCell,
  RiskTableHeader,
} from "./portfolio-risk-primitives";

export function RiskInstrumentTable({
  model,
}: {
  model: PortfolioRiskReadModel;
}) {
  const instruments = model.calculation.instruments;
  if (instruments.length === 0) return null;

  return (
    <RiskSection
      title="종목별 위험 기여"
      detail={`${instruments.length} instruments`}
      marker="instrument-risk"
    >
      {instruments.length === 0 ? (
        <RiskEmptyMessage>계산 가능한 종목이 없습니다.</RiskEmptyMessage>
      ) : (
        <div className="mt-3 max-w-full overflow-x-auto">
          <table className="w-full min-w-[1040px] border-separate border-spacing-0">
            <thead>
              <tr>
                <RiskTableHeader>종목</RiskTableHeader>
                <RiskTableHeader>시장 / 통화</RiskTableHeader>
                <RiskTableHeader>계좌</RiskTableHeader>
                <RiskTableHeader align="right">계산 비중</RiskTableHeader>
                <RiskTableHeader align="right">관측치</RiskTableHeader>
                <RiskTableHeader align="right">연환산 변동성</RiskTableHeader>
                <RiskTableHeader align="right">Sharpe</RiskTableHeader>
                <RiskTableHeader align="right">Signed RC</RiskTableHeader>
                <RiskTableHeader align="right">Absolute share</RiskTableHeader>
              </tr>
            </thead>
            <tbody>
              {instruments.map((instrument) => (
                <tr key={instrument.instrumentKey}>
                  <RiskTableCell strong>
                    <div>{instrument.ticker}</div>
                    <div className="max-w-56 truncate text-xs font-normal text-[#687064]">
                      {instrument.names.join(", ")}
                    </div>
                  </RiskTableCell>
                  <RiskTableCell>
                    {instrument.market} / {instrument.currency}
                  </RiskTableCell>
                  <RiskTableCell>{instrument.accounts.join(", ")}</RiskTableCell>
                  <RiskTableCell align="right">
                    {formatRiskRatioPercent(instrument.weight)}
                  </RiskTableCell>
                  <RiskTableCell align="right">
                    {instrument.observationCount}
                  </RiskTableCell>
                  <RiskTableCell align="right">
                    {formatRiskRatioPercent(instrument.volatilityAnnualized)}
                  </RiskTableCell>
                  <RiskTableCell align="right">
                    <MetricTableValue
                      value={formatRiskMetric(instrument.sharpe)}
                      reason={instrument.sharpe.reason}
                    />
                  </RiskTableCell>
                  <RiskTableCell align="right">
                    <MetricTableValue
                      value={formatRiskPercentValue(
                        instrument.signedRiskContributionPct,
                      )}
                      reason={instrument.riskContributionReason}
                    />
                  </RiskTableCell>
                  <RiskTableCell align="right">
                    <MetricTableValue
                      value={formatRiskPercentValue(
                        instrument.absoluteRiskSharePct,
                      )}
                      reason={instrument.riskContributionReason}
                    />
                  </RiskTableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RiskSection>
  );
}

function MetricTableValue({
  value,
  reason,
}: {
  value: string;
  reason: Parameters<typeof metricReasonLabel>[0];
}) {
  const detail = metricReasonLabel(reason);
  return (
    <div>
      <div>{value}</div>
      {detail ? <div className="text-xs text-[#8a5b32]">{detail}</div> : null}
    </div>
  );
}
