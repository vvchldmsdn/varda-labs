import { PortfolioText } from "@/components/portfolio/portfolio-text";
import { portfolioEnglish } from "@/components/portfolio/portfolio-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";
import { AdditionalContributionFlowMap } from "@/components/additional-contribution/additional-contribution-flow-map";
import { AdditionalContributionLogicDialog } from "@/components/additional-contribution/additional-contribution-logic-dialog";
import styles from "./contribution-workspace.module.css";
import {
  buildAdditionalContributionView,
  type AdditionalContributionResultPreview,
  type AdditionalContributionResultRow,
} from "@/lib/additional-contribution-view";

export type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";

export function AdditionalContributionAllocationTable({ preview }: { preview: AdditionalContributionResultPreview }) {
  const orderedRows = preview.rows.toSorted((left, right) => {
    const rank = { buy: 0, trim: 1, hold: 2 };
    return rank[left.action] - rank[right.action] ||
      Math.max(right.allocationKrw, right.trimAmountKrw) - Math.max(left.allocationKrw, left.trimAmountKrw);
  });
  const maxAmount = Math.max(1, ...orderedRows.map((row) => Math.max(row.allocationKrw, row.trimAmountKrw)));
  return (
    <div className={styles.allocationList}>
      <div className={styles.listHeading} aria-hidden="true"><span><PortfolioText ko={"종목 / 계좌"} /></span><span><PortfolioText ko={"현재 → 투입 후"} /></span><span><PortfolioText ko={"계산 금액"} /></span></div>
      <LocalizedElement aria-label="종목별 배분 결과" as="ul" en={{"aria-label": portfolioEnglish("종목별 배분 결과")}}>
        {orderedRows.map((row) => <li key={rowKey(row)} className={styles.allocationRow}>
          <div className={styles.holdingName}><strong>{row.name}</strong><span>{row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}</span></div>
          <div className={styles.weightChange}><span>{formatPercent(row.currentWeightPct)} <span aria-hidden="true">→</span> <strong>{formatPercent(row.postTopupWeightPct)}</strong></span><span><PortfolioText ko={"목표"} />{" "}{formatPercent(row.targetWeightPct)}</span></div>
          <div className={styles.tradeAmount} data-action={row.action}>
            <span><small><PortfolioText ko={row.action === "buy" ? "매수" : row.action === "trim" ? "매도" : "유지"} /></small><strong>{row.action === "hold" ? "—" : formatKrw(row.action === "buy" ? row.allocationKrw : row.trimAmountKrw)}</strong></span>
            <div className={styles.amountTrack} aria-hidden="true"><span style={{ width: `${Math.max(row.allocationKrw, row.trimAmountKrw) / maxAmount * 100}%` }} /></div>
          </div>
        </li>)}
      </LocalizedElement>
    </div>
  );
}

export function AdditionalContributionResult({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  return (
    <>
      <AdditionalContributionFlowScene preview={preview} />
      <AdditionalContributionWeightScene preview={preview} />
      <AdditionalContributionEvidenceScene preview={preview} />
    </>
  );
}

export function AdditionalContributionFlowScene({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  const view = buildAdditionalContributionView({
    ...preview,
    cashAmountKrw: preview.totalAvailableFundsKrw,
  });

  return (
    <div className="varda-presentation-frame justify-center">
      <AdditionalContributionFlowMap
        cashAmountKrw={preview.cashAmountKrw}
        availableFundsKrw={preview.totalAvailableFundsKrw}
        trimProceedsKrw={preview.totalTrimProceedsKrw}
        rows={view.flowRows}
      />
      <LocalizedElement aria-label="배분 요약" className="mt-7 border-y border-[var(--line)]" as="section" en={{"aria-label": portfolioEnglish("배분 요약")}}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4">
          <SummaryMetric
            label="배분 금액"
            value={formatKrw(preview.totalAllocatedKrw)}
            detail={`배분 재원의 ${formatPercent(view.allocatedPct)}`}
          />
          <SummaryMetric
            label="현금 보류"
            value={formatKrw(preview.residualCashKrw)}
            detail="유효 목표 부족분과 원 단위 배분 후 잔액"
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
                : view.targetDistanceImprovementPct < 0
                  ? `${formatPercent(-view.targetDistanceImprovementPct)}p 멀어짐`
                  : "현재 비중과 동일"
            }
          />
        </div>
      </LocalizedElement>
    </div>
  );
}

export function AdditionalContributionWeightScene({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  const allocationRows = preview.rows
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
      <section
        aria-labelledby="weight-map-title"
        className="varda-presentation-frame justify-center"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium text-[var(--muted)]">
              TARGET ALIGNMENT
            </p>
            <h2 id="weight-map-title" className="mt-1 text-xl font-medium">
              <PortfolioText ko={"비중 변화"} />{" "}</h2>
          </div>
          <div className="flex flex-wrap gap-5 text-xs text-[var(--muted)]">
            <LegendDot className="bg-[var(--line)]" label="현재" />
            <LegendDot className="bg-[var(--ink)]" label="목표" />
            <LegendDot className="bg-[var(--brand)]" label="투입 후" />
          </div>
        </div>

        <div className="mt-6 max-h-[min(56dvh,520px)] divide-y divide-[var(--wash)] overflow-auto border-y border-[var(--line)] pr-2">
          {allocationRows.map((row) => (
            <WeightRow key={rowKey(row)} row={row} scaleMax={weightScaleMax} />
          ))}
        </div>
      </section>
  );
}

export function AdditionalContributionEvidenceScene({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  return (
    <div className="varda-presentation-frame justify-center">
      <section
        aria-labelledby="allocation-detail-title"
        className="border-y border-[var(--line)] py-8"
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
              <PortfolioText ko={"계산 근거"} />{" "}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              <PortfolioText ko={"초과 종목의 계산상 매도, 매도금 재사용, MA120 조정과 종목별 최종 금액을 단계별로 확인합니다."} />{" "}</p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <AdditionalContributionLogicDialog preview={preview} />
            <p className="text-xs text-[var(--muted)]">
              {preview.policyLabel} · {formatDate(preview.effectiveServiceDate)}{" "}
              <PortfolioText ko={"적용 · 기준일"} />{" "}{formatDate(preview.serviceDate)}
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-12 flex flex-col gap-2 border-t border-[var(--line)] pt-5 text-[11px] text-[var(--faint)] sm:flex-row sm:items-center sm:justify-between">
        <p><PortfolioText ko={"읽기 전용 계산 · 주문, 저장, 매도 없음"} /></p>
        <p><PortfolioText ko={ma120SummaryDetail(preview.ma120Evidence)} /></p>
      </footer>
    </div>
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
      <p className="text-xs font-medium text-[var(--muted)]"><PortfolioText ko={label} /></p>
      <p
        className="mt-3 truncate text-xl font-medium tabular-nums"
        title={value}
      >
        <PortfolioText ko={value} />
      </p>
      <LocalizedElement className="mt-2 truncate text-xs text-[var(--muted)]" title={detail} as="p" en={{"title": portfolioEnglish(detail)}}>
        <PortfolioText ko={detail} />
      </LocalizedElement>
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
      <LocalizedElement
        className="relative h-6"
        aria-label={`${row.name} 현재 ${formatPercent(row.currentWeightPct)}, 목표 ${formatPercent(row.targetWeightPct)}, 투입 후 ${formatPercent(row.postTopupWeightPct)}`} as="div" en={{"aria-label": portfolioEnglish(`${row.name} 현재 ${formatPercent(row.currentWeightPct)}, 목표 ${formatPercent(row.targetWeightPct)}, 투입 후 ${formatPercent(row.postTopupWeightPct)}`)}}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px bg-[var(--line)]" />
        <LocalizedElement
          className="absolute top-1/2 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--line)]"
          style={{ left: position(row.currentWeightPct), width: 6 }}
          title={`현재 ${formatPercent(row.currentWeightPct)}`} as="div" en={{"title": portfolioEnglish(`현재 ${formatPercent(row.currentWeightPct)}`)}}
        />
        <LocalizedElement
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-[var(--ink)]"
          style={{ left: position(row.targetWeightPct) }}
          title={`목표 ${formatPercent(row.targetWeightPct)}`} as="div" en={{"title": portfolioEnglish(`목표 ${formatPercent(row.targetWeightPct)}`)}}
        />
        <LocalizedElement
          className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--brand)] ring-2 ring-[var(--paper)]"
          style={{ left: position(row.postTopupWeightPct) }}
          title={`투입 후 ${formatPercent(row.postTopupWeightPct)}`} as="div" en={{"title": portfolioEnglish(`투입 후 ${formatPercent(row.postTopupWeightPct)}`)}}
        />
      </LocalizedElement>
      <div className="flex items-baseline justify-between gap-4 md:block md:min-w-32 md:text-right">
        <p className={`text-base font-medium tabular-nums ${row.action === "trim" ? "text-[var(--negative)]" : "text-[var(--brand)]"}`}>
          <PortfolioText ko={row.action === "hold" ? "유지" : `${row.action === "trim" ? "매도" : "매수"} ${formatKrw(row.action === "trim" ? row.trimAmountKrw : row.allocationKrw)}`} />
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
      <PortfolioText ko={label} />
    </span>
  );
}

function rowKey(row: AdditionalContributionResultRow) {
  if (row.allocationKey) return row.allocationKey;
  return `${row.accountCode}:${row.market ?? "unknown"}:${row.currency ?? "unknown"}:${row.ticker ?? row.name}`;
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
    return `MA120 일부 근거 확보 · 기본 매수안 대비 감소액 ${formatKrw(evidence.totalReductionKrw)}`;
  return `MA120 ${evidence.usableCount}종목 근거 확보 · 기본 매수안 대비 감소액 ${formatKrw(evidence.totalReductionKrw)}`;
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
