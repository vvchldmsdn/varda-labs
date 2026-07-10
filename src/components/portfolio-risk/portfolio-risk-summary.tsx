import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

import {
  accountLabel,
  calculationReasonLabel,
  calculationStatusLabel,
  formatRiskMetric,
  formatRiskPercentValue,
  formatRiskRatioPercent,
  inputStatusLabel,
  metricReasonLabel,
} from "./portfolio-risk-format";
import {
  RiskNotice,
  RiskSection,
  RiskSummaryCard,
} from "./portfolio-risk-primitives";

export function RiskAnalysisBasis({
  model,
}: {
  model: PortfolioRiskReadModel;
}) {
  const { provenance, calculation, inputHealth, selection } = model;
  const dateRange =
    provenance.firstServiceDate && provenance.lastServiceDate
      ? `${provenance.firstServiceDate} ~ ${provenance.lastServiceDate}`
      : "n/a";

  return (
    <RiskSection
      title="분석 기준"
      detail={`service cycle ${provenance.serviceCycleDate}`}
      marker="analysis-basis"
    >
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <RiskSummaryCard
          label="계좌 / 기간"
          value={`${accountLabel(selection.account)} / ${selection.window}일`}
          detail={`${provenance.usableReturnObservations}/${provenance.requestedReturnObservations} observations`}
        />
        <RiskSummaryCard
          label="계산 상태"
          value={calculationStatusLabel(calculation.calculationStatus)}
          detail={inputStatusLabel(inputHealth.status)}
        />
        <RiskSummaryCard
          label="분석 service date"
          value={dateRange}
          detail={`비중 기준일 ${provenance.weightAsOfServiceDate ?? "n/a"}`}
        />
        <RiskSummaryCard
          label="관측치 커버리지"
          value={formatRiskPercentValue(provenance.returnCoveragePct)}
          detail={`${provenance.includedInstrumentCount} instruments`}
        />
        <RiskSummaryCard
          label="수익률 기준"
          value="KRW investor"
          detail={`${provenance.returnType} returns`}
        />
        <RiskSummaryCard
          label="무위험 수익률 (가정)"
          value={formatRiskRatioPercent(provenance.annualRiskFreeRate)}
          detail={`canonical source 미확정 · daily ${formatRiskRatioPercent(provenance.dailyRiskFreeRate)}`}
        />
        <RiskSummaryCard
          label="연환산 기준"
          value={`${provenance.annualizationFactor}일`}
          detail={provenance.formulaVersion}
        />
        <RiskSummaryCard
          label="조회 source date"
          value={`${provenance.priceSourceDateFrom} ~ ${provenance.sourceDateTo}`}
          detail={`FX from ${provenance.fxSourceDateFrom}`}
        />
      </div>
      <RiskCalculationNotice model={model} />
    </RiskSection>
  );
}

export function RiskPortfolioSummary({
  model,
}: {
  model: PortfolioRiskReadModel;
}) {
  const portfolio = model.calculation.portfolio;
  if (!portfolio) return null;

  return (
    <RiskSection
      title="포트폴리오 위험 요약"
      detail={`${portfolio.observationCount} return observations`}
      marker="portfolio-summary"
    >
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RiskSummaryCard
          label="연환산 변동성"
          value={formatRiskRatioPercent(portfolio.volatilityAnnualized)}
          detail={`daily ${formatRiskRatioPercent(portfolio.volatilityDaily)}`}
        />
        <RiskSummaryCard
          label="Sharpe"
          value={formatRiskMetric(portfolio.sharpe)}
          detail={metricDetail(portfolio.sharpe.reason, "RF 0% assumption")}
        />
        <RiskSummaryCard
          label="평균 상관"
          value={formatRiskMetric(portfolio.weightedAverageCorrelation)}
          detail={metricDetail(
            portfolio.weightedAverageCorrelation.reason,
            "positive-weight pairs",
          )}
        />
        <RiskSummaryCard
          label="Risk-contribution ENB"
          value={formatRiskMetric(portfolio.riskContributionEnb)}
          detail={metricDetail(
            portfolio.riskContributionEnb.reason,
            "absolute risk shares",
          )}
        />
        <RiskSummaryCard
          label="분산 효과"
          value={formatRiskMetric(
            portfolio.diversificationBenefitPct,
            "percent",
          )}
          detail={metricDetail(
            portfolio.diversificationBenefitPct.reason,
            "vs weighted standalone volatility",
          )}
        />
        <RiskSummaryCard
          label="하락 구간 평균 상관"
          value={formatRiskMetric(portfolio.stress.weightedAverageCorrelation)}
          detail={metricDetail(
            portfolio.stress.weightedAverageCorrelation.reason,
            `${portfolio.stress.downDayObservations} down days`,
          )}
        />
      </div>
    </RiskSection>
  );
}

export function RiskStandaloneSummary({
  model,
}: {
  model: PortfolioRiskReadModel;
}) {
  if (model.calculation.calculationStatus !== "standalone_only") return null;
  const instrument = model.calculation.instruments[0];
  if (!instrument) return null;

  return (
    <RiskSection
      title="단일 종목 위험"
      detail="correlation, RC, ENB 제외"
      marker="standalone-summary"
    >
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <RiskSummaryCard
          label="종목"
          value={instrument.ticker}
          detail={instrument.names.join(", ")}
        />
        <RiskSummaryCard
          label="연환산 변동성"
          value={formatRiskRatioPercent(instrument.volatilityAnnualized)}
          detail={`${instrument.observationCount} observations`}
        />
        <RiskSummaryCard
          label="Sharpe"
          value={formatRiskMetric(instrument.sharpe)}
          detail={metricDetail(instrument.sharpe.reason, "RF 0% assumption")}
        />
      </div>
    </RiskSection>
  );
}

function RiskCalculationNotice({ model }: { model: PortfolioRiskReadModel }) {
  const { calculation, inputHealth, provenance } = model;
  if (
    calculation.calculationStatus === "complete" &&
    inputHealth.status !== "partial"
  ) {
    return null;
  }

  if (inputHealth.status === "partial") {
    return (
      <RiskNotice tone="warning">
        일부 관측치만으로 계산했습니다. 실제 사용 관측치는{" "}
        {provenance.usableReturnObservations}/
        {provenance.requestedReturnObservations}입니다.
      </RiskNotice>
    );
  }

  if (calculation.calculationStatus === "standalone_only") {
    return (
      <RiskNotice>
        계산 가능한 종목이 1개이므로 변동성과 Sharpe만 표시합니다. 상관,
        위험 기여와 ENB는 계산하지 않습니다.
      </RiskNotice>
    );
  }

  const reason = calculationReasonLabel(calculation.reason);
  const coverageDetail =
    inputHealth.status === "insufficient_coverage"
      ? ` ${provenance.usableReturnObservations}/${provenance.requestedReturnObservations} 관측치이며 더 짧은 기간으로 자동 대체하지 않습니다.`
      : "";
  return (
    <RiskNotice
      tone={calculation.calculationStatus === "invalid" ? "danger" : "warning"}
    >
      {reason ?? inputStatusLabel(inputHealth.status)}
      {coverageDetail}
    </RiskNotice>
  );
}

function metricDetail(
  reason: Parameters<typeof metricReasonLabel>[0],
  fallback: string,
) {
  return metricReasonLabel(reason) ?? fallback;
}
