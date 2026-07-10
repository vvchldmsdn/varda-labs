import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

import {
  displayInstrumentKey,
  formatRiskPercentValue,
} from "./portfolio-risk-format";
import {
  RiskEmptyMessage,
  RiskSection,
  RiskSummaryCard,
  RiskTableCell,
  RiskTableHeader,
} from "./portfolio-risk-primitives";

export function RiskDataHealth({
  model,
}: {
  model: PortfolioRiskReadModel;
}) {
  const { provenance, inputHealth } = model;

  return (
    <RiskSection
      title="데이터 상태"
      detail="sanitized read-only evidence"
      marker="data-health"
    >
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RiskSummaryCard
          label="보유 종목 선택"
          value={`${provenance.eligibleHoldingCount}/${provenance.selectedHoldingCount}`}
          detail={`${provenance.excludedHoldingCount} excluded`}
        />
        <RiskSummaryCard
          label="가격 행"
          value={`${inputHealth.sourceRows.price.canonical}/${inputHealth.sourceRows.price.queried}`}
          detail={`${inputHealth.sourceRows.price.sampleExcluded} sample excluded`}
        />
        <RiskSummaryCard
          label="환율 행"
          value={`${inputHealth.sourceRows.fx.canonical}/${inputHealth.sourceRows.fx.queried}`}
          detail={`${inputHealth.sourceRows.fx.sampleExcluded} sample, ${inputHealth.sourceRows.fx.invalidStatusExcluded} status excluded`}
        />
        <RiskSummaryCard
          label="정의되지 않은 상관 쌍"
          value={
            inputHealth.undefinedCorrelationPairCount === null
              ? "n/a"
              : String(inputHealth.undefinedCorrelationPairCount)
          }
          detail={`${inputHealth.zeroVarianceInstruments.length} zero-variance instruments`}
        />
        <RiskSummaryCard
          label="가격 carry"
          value={formatCarry(
            provenance.maxObservedPriceCarryDays,
            provenance.maxPriceCarryDaysPolicy,
          )}
          detail="observed / policy days"
        />
        <RiskSummaryCard
          label="환율 carry"
          value={formatCarry(
            provenance.maxObservedFxCarryDays,
            provenance.maxFxCarryDaysPolicy,
          )}
          detail="observed / policy days"
        />
        <RiskSummaryCard
          label="유효하지 않은 행"
          value={String(
            inputHealth.invalidPriceRowCount + inputHealth.invalidFxRowCount,
          )}
          detail={`${inputHealth.invalidPriceRowCount} price, ${inputHealth.invalidFxRowCount} FX`}
        />
        <RiskSummaryCard
          label="수익률 관측치"
          value={`${provenance.usableReturnObservations}/${provenance.requestedReturnObservations}`}
          detail={formatRiskPercentValue(provenance.returnCoveragePct)}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">차단 및 제외</h3>
          <BlockerList blockers={inputHealth.blockers} />
          <ExclusionTable exclusions={inputHealth.exclusions} />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Source 집계</h3>
          <SourceCounts
            title="Price"
            sources={inputHealth.sourceRows.price.sources}
          />
          <SourceCounts title="FX" sources={inputHealth.sourceRows.fx.sources} />
          {inputHealth.zeroVarianceInstruments.length > 0 ? (
            <div className="mt-3 text-sm text-[#687064]">
              변동성 0 종목:{" "}
              {inputHealth.zeroVarianceInstruments
                .map(displayInstrumentKey)
                .join(", ")}
            </div>
          ) : null}
        </div>
      </div>
    </RiskSection>
  );
}

function BlockerList({
  blockers,
}: {
  blockers: PortfolioRiskReadModel["inputHealth"]["blockers"];
}) {
  if (blockers.length === 0) {
    return <RiskEmptyMessage>차단 항목이 없습니다.</RiskEmptyMessage>;
  }
  return (
    <ul className="mt-3 space-y-2 text-sm text-[#7a2e2e]">
      {blockers.map((blocker) => (
        <li key={`${blocker.reason}-${blocker.dates.join("-")}`}>
          {blockerDescription(blocker)}
        </li>
      ))}
    </ul>
  );
}

function ExclusionTable({
  exclusions,
}: {
  exclusions: PortfolioRiskReadModel["inputHealth"]["exclusions"];
}) {
  if (exclusions.length === 0) {
    return <RiskEmptyMessage>제외된 보유 종목이 없습니다.</RiskEmptyMessage>;
  }
  return (
    <div className="mt-3 max-w-full overflow-x-auto">
      <table className="w-full min-w-[620px] border-separate border-spacing-0">
        <thead>
          <tr>
            <RiskTableHeader>종목</RiskTableHeader>
            <RiskTableHeader>계좌</RiskTableHeader>
            <RiskTableHeader>사유</RiskTableHeader>
          </tr>
        </thead>
        <tbody>
          {exclusions.map((exclusion, index) => (
            <tr
              key={`${exclusion.account}-${exclusion.ticker ?? exclusion.name}-${index}`}
            >
              <RiskTableCell strong>
                {exclusion.ticker ?? exclusion.name}
              </RiskTableCell>
              <RiskTableCell>{exclusion.account}</RiskTableCell>
              <RiskTableCell>{exclusionReasonLabel(exclusion.reason)}</RiskTableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceCounts({
  title,
  sources,
}: {
  title: string;
  sources: Record<string, number>;
}) {
  const rows = Object.entries(sources);
  return (
    <div className="mt-3 border-l-2 border-[#c5ccbf] pl-3 text-sm">
      <div className="font-semibold">{title}</div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[#687064]">
        {rows.length > 0
          ? rows.map(([source, count]) => (
              <span key={source}>
                {source}: {count}
              </span>
            ))
          : "n/a"}
      </div>
    </div>
  );
}

function blockerDescription(
  blocker: PortfolioRiskReadModel["inputHealth"]["blockers"][number],
) {
  if (blocker.reason === "duplicate_fx_date") {
    return `환율 기준일 중복: ${blocker.dates.join(", ")}`;
  }
  return `${displayInstrumentKey(blocker.instrumentKey)} 가격 기준일 중복: ${blocker.dates.join(", ")}`;
}

function exclusionReasonLabel(
  reason: PortfolioRiskReadModel["inputHealth"]["exclusions"][number]["reason"],
) {
  if (reason === "missing_ticker") return "ticker 없음";
  if (reason === "non_positive_holding") return "보유 수량 0 이하";
  return "지원하지 않는 통화";
}

function formatCarry(observed: number | null, policy: number) {
  return `${observed === null ? "n/a" : observed} / ${policy}`;
}
