import Link from "next/link";
import styles from "@/components/home/portfolio-overview.module.css";
import type { ReactNode } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import {
  TodayContributionExplorer,
  type TodayContributionDisplayRow,
} from "@/components/today/today-contribution-explorer";
import { SelectedHoldingHistoryChart } from "@/components/today/selected-holding-history-chart";
import { HoldingDetailDrawer } from "@/components/today/holding-detail-drawer";
import type {
  DashboardData,
  DashboardHolding,
} from "@/lib/portfolio-dashboard";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";
import {
  selectTodayHoldingDetail,
  todayHoldingDetailHref,
  type TodayHoldingDetailQuery,
  type TodayHoldingDetailResult,
} from "@/lib/today-holding-detail";
import {
  buildTodayMovementAttribution,
  selectTodayHoldingHistory,
} from "@/lib/today-movement-view";

export function TodayMovement({
  data,
  designPreview = false,
  detailQuery = { holdingAccount: null, ticker: null, market: null },
}: {
  data: DashboardData;
  designPreview?: boolean;
  detailQuery?: TodayHoldingDetailQuery;
}) {
  const movement = data.todayMovement;
  const attribution = buildTodayMovementAttribution(movement);
  const detail = selectTodayHoldingDetail(data, detailQuery);
  const holdingById = new Map(
    data.holdings.map((holding) => [holding.id, holding]),
  );
  const accountLabelByCode = new Map(
    data.accountSummaries.map((account) => [account.code, account.label]),
  );
  const rows = movement.contributionRows
    .map((row): TodayContributionDisplayRow | null => {
      const holding = holdingById.get(row.holdingId);
      if (!holding) return null;
      return {
        accountLabel:
          accountLabelByCode.get(holding.account) ?? holding.account,
        changeKrw: row.changeKrw,
        fxImpactKrw: row.fxChangeKrw,
        href: previewHref(todayHoldingDetailHref(data.selectedScope.key, holding), designPreview),
        key: [
          holding.account,
          holding.market,
          holding.ticker ?? holding.name,
        ].join("|"),
        name: holding.name,
        priceImpactKrw: row.priceChangeKrw,
        returnPct: row.returnPct,
        selected: isSelectedHolding(detail, holding),
        ticker: holding.ticker,
        tradeFlowKrw: row.tradeFlowKrw,
      };
    })
    .filter((row): row is TodayContributionDisplayRow => row !== null)
    .toSorted(compareContributionRows);
  const hasHoldingDetail = detail.status !== "empty";

  return (
    <main
      className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]"
      data-page="today"
    >
      <PortfolioPrimaryNavigation
        activePath="/today"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content varda-stage-content">
        <div className={styles.stage}>
          <header className={styles.stageHeader}>
            <h1 id="today-movement-title" className={styles.stageTitle}>오늘의 움직임</h1>
            <div className={styles.stageScope}>
            <PortfolioAnalysisScopeTabs
              basePath="/today"
              query={{ ...(detailQuery.ticker ? detailQuery : {}), ...(designPreview ? { preview: "design" } : {}) }}
              scopes={[...data.analysisScopes].toSorted(compareTodayScope)}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
            </div>
          </header>

          <div className={styles.todayStageMain}>
          <section className={styles.stageSummary} aria-labelledby="today-movement-title">
            <div className={styles.balance}>
              <span>{scopeLabel(data.selectedScope)} 오늘 평가액 변동</span>
              <strong className={toneClass(attribution.changeKrw)}>
                {movement.ready ? formatSignedKrw(attribution.changeKrw) : "계산 대기"}
              </strong>
              <p>변동률 <span className={toneClass(movement.returnPct)}>{formatPercent(movement.returnPct, true)}</span></p>
            </div>
            <dl className={styles.summaryMetric}>
              <dt>가격 영향</dt>
              <dd className={toneClass(attribution.priceImpactKrw)}>{formatSignedKrw(attribution.priceImpactKrw)}</dd>
              <dd className={styles.status}>보유 종목의 가격 변화</dd>
            </dl>
            <dl className={styles.summaryMetric}>
              <dt>환율 영향</dt>
              <dd className={toneClass(attribution.fxImpactKrw)}>{formatSignedKrw(attribution.fxImpactKrw)}</dd>
              <dd className={styles.status}>원화 환산 가치의 변화</dd>
            </dl>
          {!movement.ready ? (
            <div className={`${styles.stageNote} ${styles.stageWarning} text-[var(--warning)]`}>
              <p className="text-sm font-medium">{reasonLabel(movement.reason)}</p>
              <p className="mt-2 text-xs leading-5">현재가와 기준 스냅샷이 연결되기 전에는 값을 추정하지 않습니다.</p>
            </div>
          ) : (
            <div className={styles.stageNote}>
              <span>비교 기준</span>
              <strong>{formatDate(data.movementBaselineDate)}</strong>
              <p>{sourceLabel(movement.source)} · {rows.length}개 기여 근거</p>
            </div>
          )}
          </section>

          <section className={styles.stageContribution} aria-labelledby="contribution-title">
            <div className={`${styles.panelHeader} ${styles.contributionHeader}`}>
              <div>
                <h2 id="contribution-title" className={styles.panelTitle}>종목별 기여</h2>
                <p className={styles.evidenceIntro}>점의 길이는 실제 변동액에 비례합니다.</p>
              </div>
              <p className={styles.status}>절대 변동액 순 · {rows.length}개 종목</p>
            </div>
            <TodayContributionExplorer rows={rows} />
          </section>
          </div>

          <footer className={styles.stageFooter}>
          <div className={styles.stageLaunchers}>
          <PresentationDialog label="변동 구성·계산 근거" title="오늘 변동의 구성과 근거" description="가격·환율·순매매를 실제 기준 가격과 현재 가격으로 비교합니다." wide>
          <div className={styles.detailStack}>
          <section aria-label="평가액 구성">
            <MovementBridge
              currentEvidenceKrw={attribution.currentEvidenceKrw}
              movementExcludedCurrentValueKrw={attribution.movementExcludedCurrentValueKrw}
              fxImpactKrw={attribution.fxImpactKrw}
              previousTotalKrw={attribution.previousEvidenceKrw}
              priceImpactKrw={attribution.priceImpactKrw}
              tradeFlowKrw={attribution.tradeFlowKrw}
            />
          </section>

          <div className={styles.todayEvidence}>
            <div>
              <h2 className={styles.panelTitle}>계산 근거</h2>
              <p className={styles.evidenceIntro}>
                {movement.contributionRows.length}개 기여 근거 · {formatDate(data.dataHealth.latestFxRateDate)} 환율
              </p>
            </div>
            <dl className={styles.metrics}>
              <RailEvidence label="기준 근거" value={sourceLabel(movement.source)} />
              <RailEvidence label="현재가" value={formatCoverage(movement.coverage.currentCoveragePct)} />
              <RailEvidence label="스냅샷" value={formatCoverage(movement.coverage.snapshotCoveragePct)} />
              <RailEvidence label="USD/KRW" value={formatNumber(data.usdKrwRate)} />
            </dl>
          </div>

          <p className={styles.footer}>
            <span>평가액 변동 = 가격 영향 + 환율 영향</span>
            <span>순매매는 성과와 분리해 현재 비교 평가액에만 반영</span>
          </p>
          </div>
          </PresentationDialog>
          {movement.exclusions.length > 0 ? (
            <PresentationDialog
              description="현재 변동 합계에서 제외된 항목과 그 이유를 원문 근거대로 표시합니다."
              label={`계산 제외 ${movement.exclusions.length}건`}
              title="변동 계산 제외 근거"
              wide
            >
              <div className="divide-y divide-[var(--wash)] border-y border-[var(--wash)]">
                {movement.exclusions.map((row, index) => (
                  <div key={`${row.subject}-${row.reason}-${row.holdingId ?? row.snapshotId ?? index}`} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] sm:gap-5">
                    <span className="font-medium">{row.assetName ?? row.ticker ?? row.subject}</span>
                    <span className="text-[var(--muted)]">{reasonLabel(row.reason)}</span>
                    <span className="text-[var(--muted)]">{row.account ?? sourceLabel(row.source)}</span>
                  </div>
                ))}
              </div>
            </PresentationDialog>
          ) : null}
          </div>
          <p>가격 영향 + 환율 영향 = 평가액 변동</p>
          </footer>
        </div>
        {hasHoldingDetail ? (
          <HoldingDetailPanel data={data} designPreview={designPreview} detail={detail} selectedScopeKey={data.selectedScope.key} />
        ) : null}
      </div>
    </main>
  );
}

function MovementBridge({
  currentEvidenceKrw,
  movementExcludedCurrentValueKrw,
  fxImpactKrw,
  previousTotalKrw,
  priceImpactKrw,
  tradeFlowKrw,
}: {
  currentEvidenceKrw: number | null;
  movementExcludedCurrentValueKrw: number;
  fxImpactKrw: number | null;
  previousTotalKrw: number | null;
  priceImpactKrw: number | null;
  tradeFlowKrw: number | null;
}) {
  const steps = [
    { label: "기준 평가액", value: previousTotalKrw, signed: false },
    { label: "가격 영향", value: priceImpactKrw, signed: true },
    { label: "환율 영향", value: fxImpactKrw, signed: true },
    { label: "순매매", value: tradeFlowKrw, signed: true },
    { label: "현재 비교 평가액", value: currentEvidenceKrw, signed: false },
  ];

  return (
    <section aria-labelledby="movement-bridge-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="movement-bridge-title" className={styles.panelTitle}>오늘 변동 구성</h2>
          <p className={styles.evidenceIntro}>저장된 기준과 현재 근거 비교</p>
        </div>
        {movementExcludedCurrentValueKrw > 0 ? (
          <p className={styles.status}>변동 제외 보유액 {formatKrw(movementExcludedCurrentValueKrw)} 정적 포함</p>
        ) : null}
      </div>
      <dl className={styles.bridge}>
        {steps.map((step) => (
          <div key={step.label} className={styles.bridgeStep}>
            <dt>{step.label}</dt>
            <dd className={step.signed ? toneClass(step.value) : "text-[var(--ink)]"}>
              {step.signed ? formatSignedKrw(step.value) : formatNullableKrw(step.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
function HoldingDetailPanel({
  data,
  designPreview,
  detail,
  selectedScopeKey,
}: {
  data: DashboardData;
  designPreview: boolean;
  detail: TodayHoldingDetailResult;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  if (detail.status === "empty") return null;
  const clearHref = buildPortfolioAnalysisScopeHref("/today", selectedScopeKey, designPreview ? { preview: "design" } : {});

  if (detail.status === "not_found" || detail.status === "ambiguous") {
    return (
      <HoldingDetailDrawer closeHref={clearHref}>
      <section className="py-7 text-sm text-[var(--warning)]">
        <h2 id="holding-detail-title" className="text-xl font-medium">
          {detail.status === "not_found"
            ? "선택한 종목을 찾지 못했습니다."
            : "같은 티커가 여러 계좌에 있어 계좌 선택이 필요합니다."}
        </h2>
        {detail.status === "ambiguous" ? (
          <div className="mt-3 flex flex-wrap gap-4">
            {detail.candidates.map((candidate) => (
              <Link
                key={`${candidate.account}-${candidate.market}-${candidate.ticker}`}
                className="border-b border-[var(--warning)] pb-0.5 text-xs font-medium"
                href={previewHref(todayHoldingDetailHref(selectedScopeKey, candidate), designPreview)}
                scroll={false}
              >
                {candidate.name} · {candidate.account}
              </Link>
            ))}
          </div>
        ) : null}
        <Link className="mt-6 inline-flex border-b border-current pb-1" href={clearHref} scroll={false}>선택 해제</Link>
      </section>
      </HoldingDetailDrawer>
    );
  }

  const holding = detail.holding;
  const contribution = detail.contribution;
  const changeKrw = contribution?.changeKrw ?? holding.dailyChangeKrw;
  const fxImpactKrw = contribution?.fxChangeKrw ?? holding.fxDailyChangeKrw;
  const priceImpactKrw =
    contribution?.priceChangeKrw ?? holding.priceDailyChangeKrw;
  const tradeFlowKrw = contribution?.tradeFlowKrw ?? 0;
  const previousValueKrw =
    contribution?.previousValueKrw ?? holding.previousCloseValueKrw;
  const currentEvidenceKrw =
    previousValueKrw === null || changeKrw === null
      ? null
      : previousValueKrw + changeKrw + tradeFlowKrw;
  const historyHolding = data.holdings.find(
    (candidate) =>
      candidate.account === holding.account &&
      candidate.market === holding.market &&
      candidate.ticker === holding.ticker,
  );
  const historyPoints = historyHolding
    ? selectTodayHoldingHistory(data.holdingHistory, historyHolding.id)
    : [];

  return (
    <HoldingDetailDrawer closeHref={clearHref}>
    <section>
      <div className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            SELECTED HOLDING
          </p>
          <h2 id="holding-detail-title" className="mt-1 text-2xl font-medium">
            {holding.name}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {holding.account} · {holding.ticker ?? "티커 없음"} ·{" "}
            {holding.market.toUpperCase()} · {holding.currency}
          </p>
        </div>
        <Link
          className="w-fit border-b border-[var(--ink)] pb-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
          href={clearHref}
          scroll={false}
        >
          선택 해제
        </Link>
      </div>

      <SelectedHoldingHistoryChart
        currency={holding.currency}
        name={holding.name}
        points={historyPoints}
      />

      <div className="grid lg:grid-cols-3">
        <DetailColumn title="현재 근거">
          <DetailRow
            label="현재 비교 평가액"
            value={formatNullableKrw(currentEvidenceKrw)}
          />
          <DetailRow label="수량" value={formatNumber(holding.quantity)} />
          <DetailRow
            label="현재가"
            value={formatNumber(holding.currentPrice)}
          />
          <DetailRow
            label="현재 USD/KRW"
            value={
              holding.currency === "USD"
                ? formatNumber(contribution?.currentFxRate ?? data.usdKrwRate)
                : "해당 없음"
            }
          />
          <DetailRow label="가격 출처" value={holding.priceSource ?? "-"} />
          <DetailRow
            label="가격 시각"
            value={formatDateTime(holding.priceAsOf)}
          />
        </DetailColumn>

        <DetailColumn divided title="기준 근거">
          <DetailRow
            label="기준일"
            value={formatDate(data.movementBaselineDate)}
          />
          <DetailRow
            label="가격 근거일"
            value={formatDate(data.marketPriceReferenceDate)}
          />
          <DetailRow
            label="기준 평가액"
            value={formatNullableKrw(previousValueKrw)}
          />
          <DetailRow
            label="기준가"
            value={formatNumber(contribution?.previousPrice ?? null)}
          />
          <DetailRow
            label="근거 유형"
            value={sourceLabel(contribution?.source ?? holding.dailySource)}
          />
          <DetailRow
            label="기준 USD/KRW"
            value={
              holding.currency === "USD"
                ? formatNumber(contribution?.previousFxRate ?? null)
                : "해당 없음"
            }
          />
        </DetailColumn>

        <DetailColumn divided title="변동 분해">
          <DetailRow
            label="평가액 변동"
            value={formatSignedKrw(changeKrw)}
            tone={changeKrw}
          />
          <DetailRow
            label="가격 영향"
            value={formatSignedKrw(priceImpactKrw)}
            tone={priceImpactKrw}
          />
          <DetailRow
            label="환율 영향"
            value={formatSignedKrw(fxImpactKrw)}
            tone={fxImpactKrw}
          />
          <DetailRow
            label="순매매"
            value={formatSignedKrw(tradeFlowKrw)}
            tone={tradeFlowKrw}
          />
        </DetailColumn>
      </div>
    </section>
    </HoldingDetailDrawer>
  );
}

function RailEvidence({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metric}>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function DetailColumn({
  children,
  divided = false,
  title,
}: {
  children: ReactNode;
  divided?: boolean;
  title: string;
}) {
  return (
    <div
      className={`min-h-64 py-6 lg:px-7 ${divided ? "border-t border-[var(--wash)] lg:border-l lg:border-t-0" : "lg:pr-7"}`}
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="mt-5 divide-y divide-[var(--wash)]">{children}</dl>
    </div>
  );
}

function DetailRow({
  label,
  tone = null,
  value,
}: {
  label: string;
  tone?: number | null;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 text-sm">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd
        className={`max-w-[65%] text-right font-medium break-words ${tone === null ? "text-[var(--ink)]" : toneClass(tone)}`}
      >
        {value}
      </dd>
    </div>
  );
}

function isSelectedHolding(
  detail: TodayHoldingDetailResult,
  holding: DashboardHolding,
) {
  return (
    detail.status === "selected" &&
    detail.holding.account === holding.account &&
    detail.holding.market === holding.market &&
    detail.holding.ticker === holding.ticker
  );
}

function compareContributionRows(
  left: TodayContributionDisplayRow,
  right: TodayContributionDisplayRow,
) {
  const magnitude = Math.abs(right.changeKrw) - Math.abs(left.changeKrw);
  if (magnitude !== 0) return magnitude;
  return left.name.localeCompare(right.name, "ko");
}

function compareTodayScope(
  left: PortfolioAnalysisScope,
  right: PortfolioAnalysisScope,
) {
  const rank = { all: 0, account: 1, portfolio_group: 2 } as const;
  return rank[left.kind] - rank[right.kind];
}

function scopeLabel(scope: PortfolioAnalysisScope) {
  return scope.kind === "all" ? "전체 자산" : scope.label;
}

function sourceLabel(source: string | null) {
  if (source === "daily_position_snapshot") return "일일 포지션 스냅샷";
  if (source === "asset_price_snapshot") return "전일 종가 근거";
  return "근거 없음";
}

function reasonLabel(reason: string | null) {
  if (!reason) return "오늘 변동 계산 근거를 준비하고 있습니다.";
  const labels: Record<string, string> = {
    missing_baseline_snapshot: "비교할 기준 스냅샷이 없습니다.",
    missing_fresh_live_prices: "현재 가격 근거가 부족합니다.",
    manual_valuation_not_updated_in_cycle:
      "이번 주기에 수동 평가 종목이 갱신되지 않았습니다.",
    missing_previous_close_fallback: "비교할 전일 종가가 없습니다.",
    unsupported_currency: "지원하지 않는 통화가 포함되어 있습니다.",
    missing_current_fx: "현재 환율 근거가 없습니다.",
    missing_baseline_fx: "기준 환율 근거가 없습니다.",
    coverage_below_threshold:
      "현재 가격 또는 기준 스냅샷의 커버리지가 부족합니다.",
  };
  return labels[reason] ?? reason;
}

function formatNullableKrw(value: number | null) {
  return value === null ? "-" : formatKrw(value);
}

function previewHref(href: string, designPreview: boolean) {
  return designPreview ? `${href}${href.includes("?") ? "&" : "?"}preview=design` : href;
}

function formatCoverage(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(
    value,
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}
