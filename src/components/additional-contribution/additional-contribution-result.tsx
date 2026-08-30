import { AdditionalContributionFlowMap } from "@/components/additional-contribution/additional-contribution-flow-map";
import { AdditionalContributionLogicDialog } from "@/components/additional-contribution/additional-contribution-logic-dialog";
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
  const view = buildAdditionalContributionView({
    ...preview,
    cashAmountKrw: preview.totalAvailableFundsKrw,
  });
  const allocationRows = preview.rows
    .filter((row) => row.allocationKrw > 0)
    .toSorted(
      (left, right) =>
        right.allocationKrw - left.allocationKrw ||
        left.name.localeCompare(right.name, "ko"),
    );
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
      <div className="mb-9">
        <AdditionalContributionFlowMap
          cashAmountKrw={preview.cashAmountKrw}
          availableFundsKrw={preview.totalAvailableFundsKrw}
          trimProceedsKrw={preview.totalTrimProceedsKrw}
          rows={view.flowRows}
        />
      </div>
      <section aria-label="배분 요약" className="border-y border-[var(--line)]">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric
            label="배분 금액"
            value={formatKrw(preview.totalAllocatedKrw)}
            detail={`배분 재원의 ${formatPercent(view.allocatedPct)}`}
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

      <section
        aria-labelledby="weight-map-title"
        className="mt-14 border-t border-[var(--line)] pt-9"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">
              TARGET ALIGNMENT
            </p>
            <h2 id="weight-map-title" className="mt-1 text-xl font-medium">
              비중 변화
            </h2>
          </div>
          <div className="flex flex-wrap gap-5 text-xs text-[var(--muted)]">
            <LegendDot className="bg-[var(--line)]" label="현재" />
            <LegendDot className="bg-[var(--ink)]" label="목표" />
            <LegendDot className="bg-[var(--brand)]" label="투입 후" />
          </div>
        </div>

        <div className="mt-6 divide-y divide-[var(--wash)] border-y border-[var(--line)]">
          {allocationRows.map((row) => (
            <WeightRow key={rowKey(row)} row={row} scaleMax={weightScaleMax} />
          ))}
        </div>
      </section>

      <section
        aria-labelledby="allocation-detail-title"
        className="mt-14 border-y border-[var(--line)] py-6"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">
              CALCULATION EVIDENCE
            </p>
            <h2
              id="allocation-detail-title"
              className="mt-1 text-xl font-medium"
            >
              계산 근거
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              초과 종목의 계산상 매도, 매도금 재사용, MA120 조정과 종목별 최종
              금액을 단계별로 확인합니다.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <AdditionalContributionLogicDialog preview={preview} />
            <p className="text-xs text-[var(--muted)]">
              {preview.policyLabel} · {formatDate(preview.effectiveServiceDate)}{" "}
              적용 · 기준일 {formatDate(preview.serviceDate)}
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-12 flex flex-col gap-2 border-t border-[var(--line)] pt-5 text-[11px] text-[var(--faint)] sm:flex-row sm:items-center sm:justify-between">
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
    <div className="min-w-0 border-b border-[var(--wash)] px-5 py-6 last:border-b-0 sm:odd:border-r sm:odd:border-[var(--wash)] lg:border-b-0 lg:border-r lg:border-[var(--wash)] lg:last:border-r-0">
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <p
        className="mt-3 truncate text-xl font-medium tabular-nums"
        title={value}
      >
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-[var(--muted)]" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function WeightRow({
  row,
  scaleMax,
}: {
  row: AdditionalContributionResultRow;
  scaleMax: number;
}) {
  const position = (value: number) =>
    `${Math.min(100, (value / scaleMax) * 100)}%`;

  return (
    <div className="grid gap-4 px-1 py-5 md:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.5fr)_auto] md:items-center md:gap-8">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={row.name}>
          {row.name}
        </p>
        <p className="mt-1 truncate text-xs text-[var(--muted)]">
          {row.accountName}
          {row.ticker ? ` · ${row.ticker}` : ""}
        </p>
      </div>
      <div
        className="relative h-6"
        aria-label={`${row.name} 현재 ${formatPercent(row.currentWeightPct)}, 목표 ${formatPercent(row.targetWeightPct)}, 투입 후 ${formatPercent(row.postTopupWeightPct)}`}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--line)]" />
        <div
          className="absolute top-1/2 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--line)]"
          style={{ left: position(row.currentWeightPct), width: 6 }}
          title={`현재 ${formatPercent(row.currentWeightPct)}`}
        />
        <div
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--ink)]"
          style={{ left: position(row.targetWeightPct) }}
          title={`목표 ${formatPercent(row.targetWeightPct)}`}
        />
        <div
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand)] ring-2 ring-[var(--paper)]"
          style={{ left: position(row.postTopupWeightPct) }}
          title={`투입 후 ${formatPercent(row.postTopupWeightPct)}`}
        />
      </div>
      <div className="flex items-baseline justify-between gap-4 md:block md:min-w-32 md:text-right">
        <p className="text-base font-medium tabular-nums text-[var(--brand)]">
          {formatKrw(row.allocationKrw)}
        </p>
        <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">
          {formatPercent(row.currentWeightPct)} →{" "}
          {formatPercent(row.postTopupWeightPct)}
        </p>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function rowKey(row: AdditionalContributionResultRow) {
  return `${row.accountCode}:${row.market ?? "unknown"}:${row.currency ?? "unknown"}:${row.ticker ?? row.name}`;
}

function residualDetail(totalReductionKrw: number) {
  return totalReductionKrw > 0
    ? `MA120 조정 ${formatKrw(totalReductionKrw)} 포함`
    : "목표 부족분 배분 후 잔액";
}

function ma120SummaryDetail(
  evidence: AdditionalContributionResultPreview["ma120Evidence"],
) {
  if (evidence.mode === "off") return "추세 필터 꺼짐 · 기본 배분 사용";
  if (evidence.status === "read_failed")
    return "MA120 근거 조회 실패 · 기본 배분 사용";
  if (evidence.status === "unavailable")
    return "사용 가능한 가격 이력 없음 · 기본 배분 사용";
  if (evidence.status === "partial")
    return `MA120 일부 적용 · ${formatKrw(evidence.totalReductionKrw)} 현금 보류`;
  return `MA120 ${evidence.usableCount}종목 적용 · ${formatKrw(evidence.totalReductionKrw)} 현금 보류`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 10).replaceAll("-", ".") : "-";
}
