import { AdditionalContributionFlowMap } from "@/components/additional-contribution/additional-contribution-flow-map";
import {
  buildAdditionalContributionView,
  type AdditionalContributionResultPreview,
  type AdditionalContributionResultRow,
} from "@/lib/additional-contribution-view";

export type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";

export function AdditionalContributionResult({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  const view = buildAdditionalContributionView(preview);
  const allocationRows = preview.rows
    .filter((row) => row.allocationKrw > 0)
    .toSorted(
      (left, right) =>
        right.allocationKrw - left.allocationKrw ||
        left.name.localeCompare(right.name, "ko"),
    );
  const zeroRows = preview.rows
    .filter((row) => row.allocationKrw === 0)
    .toSorted((left, right) => left.name.localeCompare(right.name, "ko"));
  const weightScaleMax = Math.max(
    1,
    ...preview.rows.flatMap((row) => [
      row.currentWeightPct,
      row.targetWeightPct,
      row.postTopupWeightPct,
    ]),
  );

  return (
    <>
      <section aria-label="배분 요약" className="border-y border-[#d9ddd7]">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric
            label="배분 금액"
            value={formatKrw(preview.totalAllocatedKrw)}
            detail={`투입금의 ${formatPercent(view.allocatedPct)}`}
          />
          <SummaryMetric
            label="현금 보류"
            value={formatKrw(preview.residualCashKrw)}
            detail={residualDetail(view.totalReductionKrw)}
          />
          <SummaryMetric
            label="배분 종목"
            value={`${view.recipientCount}종목`}
            detail={`전체 목표 종목 ${preview.rows.length}개`}
          />
          <SummaryMetric
            label="목표 거리"
            value={`${formatPercent(view.targetDistanceBeforePct)} → ${formatPercent(view.targetDistanceAfterPct)}`}
            detail={
              view.targetDistanceImprovementPct > 0
                ? `${formatPercent(view.targetDistanceImprovementPct)}p 가까워짐`
                : "현재 비중과 동일"
            }
          />
        </div>
      </section>

      <div className="mt-12">
        <AdditionalContributionFlowMap
          cashAmountKrw={preview.cashAmountKrw}
          rows={view.flowRows}
        />
      </div>

      <section aria-labelledby="weight-map-title" className="mt-14 border-t border-[#d9ddd7] pt-9">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[#7b8079]">TARGET ALIGNMENT</p>
            <h2 id="weight-map-title" className="mt-1 text-xl font-medium">
              비중 변화
            </h2>
          </div>
          <div className="flex flex-wrap gap-5 text-xs text-[#6d736b]">
            <LegendDot className="bg-[#aeb5ad]" label="현재" />
            <LegendDot className="bg-[#20231f]" label="목표" />
            <LegendDot className="bg-[#5f9a82]" label="투입 후" />
          </div>
        </div>

        <div className="mt-6 divide-y divide-[#e1e4df] border-y border-[#d9ddd7]">
          {allocationRows.map((row) => (
            <WeightRow key={rowKey(row)} row={row} scaleMax={weightScaleMax} />
          ))}
        </div>
      </section>

      <section aria-labelledby="allocation-detail-title" className="mt-14">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[#7b8079]">CALCULATION EVIDENCE</p>
            <h2 id="allocation-detail-title" className="mt-1 text-xl font-medium">
              계산 근거
            </h2>
          </div>
          <p className="text-xs text-[#777d75]">
            {preview.policyLabel} · {formatDate(preview.effectiveServiceDate)} 적용 · 기준일 {formatDate(preview.serviceDate)}
          </p>
        </div>

        <div className="mt-6 overflow-x-auto border-y border-[#d9ddd7]">
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <thead className="text-left text-[11px] font-medium text-[#737970]">
              <tr>
                <th className="px-3 py-4">종목</th>
                <th className="px-3 py-4">계좌</th>
                <th className="px-3 py-4 text-right">현재 평가액</th>
                <th className="px-3 py-4 text-right">현재</th>
                <th className="px-3 py-4 text-right">목표</th>
                <th className="px-3 py-4 text-right">MA120 근거</th>
                <th className="px-3 py-4 text-right">최종 투입</th>
                <th className="px-3 py-4 text-right">투입 후</th>
              </tr>
            </thead>
            <tbody>
              {allocationRows.map((row) => (
                <DetailRow key={rowKey(row)} row={row} />
              ))}
            </tbody>
          </table>
        </div>

        {zeroRows.length > 0 ? (
          <details className="border-b border-[#d9ddd7]">
            <summary className="cursor-pointer list-none py-5 text-sm font-medium text-[#535a52] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#347e62]">
              배분하지 않는 목표 종목 {zeroRows.length}개 보기
            </summary>
            <div className="overflow-x-auto pb-5">
              <table className="w-full min-w-[1120px] border-collapse text-sm">
                <tbody>
                  {zeroRows.map((row) => (
                    <DetailRow key={rowKey(row)} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </section>

      <footer className="mt-12 flex flex-col gap-2 border-t border-[#d9ddd7] pt-5 text-[11px] text-[#858a83] sm:flex-row sm:items-center sm:justify-between">
        <p>읽기 전용 계산 · 주문, 저장, 매도 없음</p>
        <p>{ma120SummaryDetail(preview.ma120Evidence)}</p>
      </footer>
    </>
  );
}

function SummaryMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-[#e1e4df] px-5 py-6 last:border-b-0 sm:odd:border-r sm:odd:border-[#e1e4df] lg:border-b-0 lg:border-r lg:border-[#e1e4df] lg:last:border-r-0">
      <p className="text-xs font-medium text-[#6d736b]">{label}</p>
      <p className="mt-3 truncate text-xl font-medium tabular-nums" title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-[#777d75]" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function WeightRow({ row, scaleMax }: { row: AdditionalContributionResultRow; scaleMax: number }) {
  const position = (value: number) => `${Math.min(100, (value / scaleMax) * 100)}%`;

  return (
    <div className="grid gap-4 px-1 py-5 md:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.5fr)_auto] md:items-center md:gap-8">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={row.name}>{row.name}</p>
        <p className="mt-1 truncate text-xs text-[#777d75]">
          {row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}
        </p>
      </div>
      <div className="relative h-6" aria-label={`${row.name} 현재 ${formatPercent(row.currentWeightPct)}, 목표 ${formatPercent(row.targetWeightPct)}, 투입 후 ${formatPercent(row.postTopupWeightPct)}`}>
        <div className="absolute left-0 right-0 top-1/2 h-px bg-[#d8dcd6]" />
        <div
          className="absolute top-1/2 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#aeb5ad]"
          style={{ left: position(row.currentWeightPct), width: 6 }}
          title={`현재 ${formatPercent(row.currentWeightPct)}`}
        />
        <div
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-[#20231f]"
          style={{ left: position(row.targetWeightPct) }}
          title={`목표 ${formatPercent(row.targetWeightPct)}`}
        />
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#5f9a82] ring-2 ring-[#f7f8f5]"
          style={{ left: position(row.postTopupWeightPct) }}
          title={`투입 후 ${formatPercent(row.postTopupWeightPct)}`}
        />
      </div>
      <div className="flex items-baseline justify-between gap-4 md:block md:min-w-32 md:text-right">
        <p className="text-base font-medium tabular-nums text-[#347e62]">
          {formatKrw(row.allocationKrw)}
        </p>
        <p className="mt-1 text-xs tabular-nums text-[#777d75]">
          {formatPercent(row.currentWeightPct)} → {formatPercent(row.postTopupWeightPct)}
        </p>
      </div>
    </div>
  );
}

function DetailRow({ row }: { row: AdditionalContributionResultRow }) {
  return (
    <tr className="border-t border-[#e2e5df] first:border-t-0">
      <td className="px-3 py-4">
        <p className="font-medium">{row.name}</p>
        <p className="mt-1 text-xs text-[#777d75]">
          {row.ticker ?? "티커 없음"} · {row.market ?? "시장 없음"} · {row.currency ?? "통화 없음"}
        </p>
      </td>
      <td className="px-3 py-4 text-[#596057]">{row.accountName}</td>
      <td className="px-3 py-4 text-right tabular-nums">{formatKrw(row.currentValueKrw)}</td>
      <td className="px-3 py-4 text-right tabular-nums">{formatPercent(row.currentWeightPct)}</td>
      <td className="px-3 py-4 text-right tabular-nums">{formatPercent(row.targetWeightPct)}</td>
      <td className="px-3 py-4 text-right"><Ma120EvidenceCell currency={row.currency} evidence={row.ma120Evidence} /></td>
      <td className="px-3 py-4 text-right font-medium tabular-nums text-[#347e62]">
        {formatKrw(row.allocationKrw)}
        {row.ma120ReductionKrw > 0 ? (
          <p className="mt-1 text-xs font-normal text-[#9a6745]">기본안 대비 -{formatKrw(row.ma120ReductionKrw)}</p>
        ) : null}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">{formatPercent(row.postTopupWeightPct)}</td>
    </tr>
  );
}

function Ma120EvidenceCell({ currency, evidence }: { currency: string | null; evidence: AdditionalContributionResultRow["ma120Evidence"] }) {
  if (evidence.status === "insufficient_history") {
    return <span className="text-[#8b6a35]">이력 {evidence.availableObservationCount}/120</span>;
  }
  if (
    evidence.status === "unavailable" ||
    evidence.status === "invalid_history" ||
    evidence.ma120 === null ||
    evidence.distanceFromMaPct === null
  ) {
    return <span className="text-[#81867f]">근거 없음</span>;
  }

  const label = evidence.status === "above_ma" ? "위" : evidence.status === "below_ma" ? "아래" : "근접";
  const tone = evidence.status === "below_ma" ? "text-[#c8544f]" : evidence.status === "above_ma" ? "text-[#347e62]" : "text-[#535a52]";
  return (
    <div>
      <p className={`font-medium ${tone}`}>{label} {formatSignedPercent(evidence.distanceFromMaPct)}</p>
      <p className="mt-1 text-xs text-[#777d75]">MA120 {formatPrice(evidence.ma120, currency)}</p>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${className}`} />{label}</span>;
}

function rowKey(row: AdditionalContributionResultRow) {
  return `${row.accountCode}:${row.market ?? "unknown"}:${row.currency ?? "unknown"}:${row.ticker ?? row.name}`;
}

function residualDetail(totalReductionKrw: number) {
  return totalReductionKrw > 0
    ? `MA120 조정 ${formatKrw(totalReductionKrw)} 포함`
    : "목표 부족분 배분 후 잔액";
}

function ma120SummaryDetail(evidence: AdditionalContributionResultPreview["ma120Evidence"]) {
  if (evidence.mode === "off") return "추세 필터 꺼짐 · 기본 배분 사용";
  if (evidence.status === "read_failed") return "MA120 근거 조회 실패 · 기본 배분 사용";
  if (evidence.status === "unavailable") return "사용 가능한 가격 이력 없음 · 기본 배분 사용";
  if (evidence.status === "partial") return `MA120 일부 적용 · ${formatKrw(evidence.totalReductionKrw)} 현금 보류`;
  return `MA120 ${evidence.usableCount}종목 적용 · ${formatKrw(evidence.totalReductionKrw)} 현금 보류`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10).replaceAll("-", ".") : "-";
}

function formatPrice(value: number, currency: string | null) {
  return new Intl.NumberFormat(currency === "KRW" ? "ko-KR" : "en-US", {
    maximumFractionDigits: currency === "KRW" ? 0 : 4,
  }).format(value);
}
