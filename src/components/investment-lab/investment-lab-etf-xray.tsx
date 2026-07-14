import type {
  InvestmentLabEtfXrayEtfRow,
  InvestmentLabEtfXrayModel,
} from "@/lib/investment-lab-etf-xray";
import { InvestmentLabEtfShock } from "@/components/investment-lab/investment-lab-etf-shock";

export function InvestmentLabEtfXray({
  model,
}: {
  model: InvestmentLabEtfXrayModel;
}) {
  const summary = model.summary;
  const exposureScopeLabel =
    summary.exposureScope === "whole_portfolio"
      ? "전체 포트폴리오"
      : "평가 가능한 하위집합";
  const topComponents = model.componentRows.slice(0, 15);
  const overlapRows = model.componentRows
    .filter((row) => row.hasDirectOverlap || row.hasMultiEtfOverlap)
    .slice(0, 15);

  return (
    <section
      aria-labelledby="investment-lab-etf-xray-title"
      className="mx-auto w-full max-w-[1500px] space-y-4 px-4 pb-4"
      data-ambiguous-valued-etf-references={
        summary.ambiguousReferenceValuedEtfCount
      }
      data-base-portfolio-coverage={summary.basePortfolioCoverageStatus}
      data-excluded-etf-holdings={summary.excludedEtfHoldingCount}
      data-excluded-holdings={summary.excludedHoldingCount}
      data-exposure-scope={summary.exposureScope}
      data-matched-valued-etfs={summary.matchedValuedEtfCount}
      data-missing-valued-etf-references={
        summary.missingReferenceValuedEtfCount
      }
      data-observed-valued-subset-exposure={
        summary.observedValuedSubsetExposurePct.toFixed(6)
      }
      data-section="investment-lab-etf-xray"
      data-uncovered-valued-subset-exposure={
        summary.uncoveredValuedSubsetExposurePct.toFixed(6)
      }
      data-valued-etf-weight={summary.valuedSubsetEtfWeightPct.toFixed(6)}
      data-valued-etfs={summary.valuedEtfCount}
      data-valued-holdings={summary.valuedHoldingCount}
      data-xray-as-of-date-count={summary.asOfDates.length}
      data-xray-component-count={summary.componentCount}
      data-xray-mixed-as-of={String(summary.mixedAsOfDates)}
      data-xray-overlap-count={summary.overlapCount}
      data-xray-status={model.status}
    >
      <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold text-[#687064]">Read-only evidence</p>
            <h2
              id="investment-lab-etf-xray-title"
              className="mt-1 text-xl font-semibold sm:text-2xl"
            >
              포트폴리오 ETF X-ray
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#626b5f]">
              보유 ETF를 구성종목까지 펼쳐 직접 보유와 ETF 간 중복을 확인합니다.
              ETF별 최신 기준일을 각각 유지하며, 관측된 노출을 100%로
              재정규화하지 않습니다.
            </p>
          </div>
          <p className="text-sm font-semibold text-[#3f4b40]">
            {xrayStatusLabel(model.status)}
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCell
          label="기초 포트폴리오"
          value={
            summary.basePortfolioCoverageStatus === "complete"
              ? "평가 완전"
              : "평가 부분"
          }
          detail={`평가 가능 ${summary.valuedHoldingCount} · 제외 ${summary.excludedHoldingCount}`}
        />
        <SummaryCell
          label="평가된 보유 ETF"
          value={`${summary.valuedEtfCount}개`}
          detail={`reference 일치 ${summary.matchedValuedEtfCount}개`}
        />
        <SummaryCell
          label="구성종목 근거"
          value={`${summary.evidenceAvailableEtfCount}/${summary.valuedEtfCount}`}
          detail={`완전 커버 ${summary.completeEvidenceEtfCount}개`}
        />
        <SummaryCell
          label="관측된 ETF 경유 노출"
          value={formatPercent(summary.observedValuedSubsetExposurePct)}
          detail={`${exposureScopeLabel} 기준, 재정규화 안 함`}
        />
        <SummaryCell
          label="미커버 ETF 노출"
          value={formatPercent(summary.uncoveredValuedSubsetExposurePct)}
          detail={`reference 누락 ${summary.missingReferenceValuedEtfCount}개`}
        />
      </div>

      {summary.basePortfolioCoverageStatus === "partial" ? (
        <p className="rounded-md border border-[#d8c7a1] bg-[#fff8e6] px-4 py-3 text-sm leading-6 text-[#725f2d]">
          가격·환율 근거가 없어 평가에서 제외된 자산이 {summary.excludedHoldingCount}
          개이며, 그중 ETF 후보는 {summary.excludedEtfHoldingCount}개입니다. 따라서
          아래 비중은 전체 포트폴리오가 아니라 평가 가능한 하위집합 기준입니다.
          제외 사유: 가격 {summary.exclusionReasonCounts.missing_price} · 환율 {" "}
          {summary.exclusionReasonCounts.missing_fx} · 미지원 통화 {" "}
          {summary.exclusionReasonCounts.unsupported_currency}.
        </p>
      ) : null}

      {summary.mixedAsOfDates ? (
        <p className="rounded-md border border-[#eadfbe] bg-[#fff9e8] px-4 py-3 text-sm leading-6 text-[#725f2d]">
          ETF별 구성종목 기준일이 {summary.asOfDates.length}개로 섞여 있습니다.
          아래 수치는 각 ETF의 최신 저장 근거를 합친 참고값이며, 하나의 공통
          시점 포트폴리오로 해석하지 않습니다.
        </p>
      ) : null}

      <InvestmentLabEtfShock
        components={model.componentRows}
        excludedHoldingCount={summary.excludedHoldingCount}
        exposureScope={summary.exposureScope}
        uncoveredEtfExposurePct={summary.uncoveredValuedSubsetExposurePct}
        valuedSubsetCurrentValueKrw={summary.valuedSubsetCurrentValueKrw}
      />

      <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="border-b border-[#e1e6dc] px-4 py-3">
          <h3 className="text-lg font-semibold">보유 ETF 커버리지</h3>
          <p className="mt-1 text-sm text-[#687064]">
            reference 매핑, ETF별 기준일, 구성종목 비중 누락을 함께 표시합니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-4 py-3">ETF</th>
                <th className="px-3 py-3">계정</th>
                <th className="px-3 py-3">구성 기준일</th>
                <th className="px-3 py-3 text-right">평가 하위집합 비중</th>
                <th className="px-3 py-3 text-right">구성종목</th>
                <th className="px-3 py-3 text-right">관측 비중</th>
                <th className="px-3 py-3 text-right">미커버</th>
                <th className="px-4 py-3">상태</th>
              </tr>
            </thead>
            <tbody>
              {model.etfRows.map((row) => (
                <EtfCoverageRow
                  key={`${row.market}:${row.currency}:${row.ticker ?? row.name}`}
                  row={row}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="border-b border-[#e1e6dc] px-4 py-3">
          <h3 className="text-lg font-semibold">상위 구성종목 노출</h3>
          <p className="mt-1 text-sm text-[#687064]">
            유효한 market · currency · ticker와 비중이 모두 있는 구성종목만
            합산합니다.
          </p>
        </div>
        {topComponents.length > 0 ? (
          <ComponentTable rows={topComponents} />
        ) : (
          <EmptyState>표시할 수 있는 구성종목 근거가 없습니다.</EmptyState>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="border-b border-[#e1e6dc] px-4 py-3">
          <h3 className="text-lg font-semibold">숨은 중복 노출</h3>
          <p className="mt-1 text-sm text-[#687064]">
            두 개 이상의 보유 ETF가 공유하거나, 같은 종목을 포트폴리오에서
            직접 보유한 경우입니다.
          </p>
        </div>
        {overlapRows.length > 0 ? (
          <ComponentTable rows={overlapRows} />
        ) : (
          <EmptyState>현재 exact identity 기준의 중복 노출이 없습니다.</EmptyState>
        )}
      </section>
    </section>
  );
}

export function InvestmentLabEtfXraySkeleton() {
  return (
    <section className="mx-auto w-full max-w-[1500px] space-y-3 px-4 pb-4">
      <div className="h-32 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-24 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
          />
        ))}
      </div>
    </section>
  );
}

export function InvestmentLabEtfXrayUnavailable() {
  return (
    <section
      aria-labelledby="investment-lab-etf-xray-unavailable-title"
      className="mx-auto w-full max-w-[1500px] px-4 pb-4"
      data-section="investment-lab-etf-xray"
      data-xray-status="unavailable"
    >
      <div className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-4">
        <h2
          id="investment-lab-etf-xray-unavailable-title"
          className="text-lg font-semibold text-[#5f5027]"
        >
          포트폴리오 ETF X-ray
        </h2>
        <p className="mt-2 text-sm text-[#725f2d]">
          ETF reference 근거를 읽지 못해 이 섹션만 표시할 수 없습니다.
        </p>
      </div>
    </section>
  );
}

function EtfCoverageRow({ row }: { row: InvestmentLabEtfXrayEtfRow }) {
  return (
    <tr className="border-t border-[#e1e6dc]">
      <td className="px-4 py-3">
        <p className="font-semibold">{row.ticker ?? "ticker 없음"}</p>
        <p className="mt-0.5 max-w-[240px] truncate text-xs text-[#687064]">
          {row.name}
        </p>
      </td>
      <td className="px-3 py-3">{row.accounts.join(", ")}</td>
      <td className="px-3 py-3 tabular-nums">
        {row.asOfDate ? formatDate(row.asOfDate) : "n/a"}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPercent(row.valuedSubsetWeightPct)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {row.componentCount}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {row.observedWeightPct === null
          ? "n/a"
          : formatPercent(row.observedWeightPct)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPercent(row.uncoveredWeightPct)}
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{coverageStatusLabel(row)}</p>
        {row.unmappedComponentCount > 0 || row.missingWeightCount > 0 ? (
          <p className="mt-1 text-xs text-[#8a6a2f]">
            identity {row.unmappedComponentCount} · weight {row.missingWeightCount}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

function ComponentTable({
  rows,
}: {
  rows: InvestmentLabEtfXrayModel["componentRows"];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead>
          <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
            <th className="px-4 py-3">구성종목</th>
            <th className="px-3 py-3">identity</th>
            <th className="px-3 py-3 text-right">ETF 경유 노출</th>
            <th className="px-3 py-3 text-right">직접 보유</th>
            <th className="px-3 py-3">경유 ETF</th>
            <th className="px-4 py-3">근거 기준일</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.market}:${row.currency}:${row.symbol}`}
              className="border-t border-[#e1e6dc]"
            >
              <td className="px-4 py-3">
                <p className="font-semibold">{row.symbol}</p>
                <p className="mt-0.5 max-w-[260px] truncate text-xs text-[#687064]">
                  {row.name}
                </p>
              </td>
              <td className="px-3 py-3 text-[#5f685d]">
                {row.market} · {row.currency}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">
                {formatPercent(row.valuedSubsetExposurePct)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatPercent(row.directValuedSubsetWeightPct)}
              </td>
              <td className="px-3 py-3">
                {row.throughEtfs.join(", ")}
                {row.hasMultiEtfOverlap ? (
                  <span className="ml-2 text-xs font-semibold text-[#9a6b18]">
                    {row.throughEtfCount}개 중복
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 tabular-nums text-[#5f685d]">
                {row.asOfDates.map(formatDate).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-sm text-[#687064]">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <p className="px-4 py-6 text-sm text-[#687064]">{children}</p>;
}

function coverageStatusLabel(row: InvestmentLabEtfXrayEtfRow) {
  if (row.mappingStatus === "missing_reference") return "reference 없음";
  if (row.mappingStatus === "ambiguous_reference") return "reference 중복";
  if (row.evidenceStatus === "missing") return "구성종목 없음";
  if (row.evidenceStatus === "invalid_weight_total") return "비중 합계 오류";
  if (row.evidenceStatus === "partial") return "부분 관측";
  return "완전 관측";
}

function xrayStatusLabel(status: InvestmentLabEtfXrayModel["status"]) {
  if (status === "complete_common_date") return "공통 기준일 · 완전 관측";
  if (status === "complete_mixed_dates") return "기준일 혼합 · 완전 관측";
  if (status === "partial") return "부분 관측";
  return "사용 가능한 근거 없음";
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
