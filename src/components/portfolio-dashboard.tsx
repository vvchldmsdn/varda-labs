import Link from "next/link";
import { ArrowUpRight, Plus, Sigma } from "lucide-react";

import { FxImpactPopover } from "@/components/home/fx-impact-popover";
import { HoldingMovementHeatmap } from "@/components/home/holding-movement-heatmap";
import { PortfolioHistoryChart } from "@/components/home/portfolio-history-chart";
import {
  formatDate,
  formatKrw,
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { selectLargestMovementContributor } from "@/lib/home-metrics";
import type { DashboardData } from "@/lib/portfolio-dashboard";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

export function PortfolioDashboard({
  data,
  liveSyncEnabled = false,
}: {
  data: DashboardData;
  liveSyncEnabled?: boolean;
}) {
  const movementReady = data.dataHealth.movementReady;
  const todayChangeKrw = movementReady ? data.todayChangeKrw ?? 0 : null;
  const topContributor = movementReady
    ? selectLargestMovementContributor(data.holdings)
    : null;
  const priceImpactKrw = movementReady
    ? (data.todayChangeKrw ?? 0) - (data.todayFxChangeKrw ?? 0)
    : null;
  const fxImpactPct = percentageOfPrevious(
    data.todayFxChangeKrw,
    data.todayMovement.previousTotalKrw,
  );
  const contributionEvidenceCount = new Set(
    data.todayMovement.contributionRows.map((row) => row.holdingId),
  ).size;
  const movementEvidenceCount = contributionEvidenceCount > 0
    ? contributionEvidenceCount
    : movementReady
      ? data.holdings.filter(
          (holding) => holding.movementEligible && holding.dailyChangeKrw !== null,
        ).length
      : 0;
  const structureHref = scopedHref("/portfolio/structure", data.selectedScope.key);
  const riskHref = scopedHref("/portfolio/risk", data.selectedScope.key);

  return (
    <main className="varda-page varda-presentation-page bg-[var(--paper)] text-[var(--ink)]" data-page="home">
      <PortfolioPrimaryNavigation
        activePath="/"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content">
        <div className="varda-screen">
          <header className="varda-screen-header">
            <div className="varda-screen-heading">
              <div className="varda-screen-title-row">
                <div>
                  <p className="varda-kicker">PORTFOLIO / OVERVIEW</p>
                  <h1 id="portfolio-overview-title" className="varda-page-title">자산의 흐름</h1>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  기준일 {formatDate(data.movementBaselineDate)}
                </p>
              </div>
            </div>
            <div className="varda-screen-scope">
              <PortfolioAnalysisScopeTabs
                basePath="/"
                scopes={[...data.analysisScopes].toSorted(compareHomeScope)}
                selectedScopeKey={data.selectedScope.key}
                variant="underline"
              />
            </div>
          </header>

          <section className="varda-hero-strip" aria-labelledby="portfolio-overview-title">
            <div className="varda-hero-value">
              <span className="text-xs font-medium text-[var(--muted)]">
                {homeScopeLabel(data.selectedScope)} 현재 평가액
              </span>
              <strong>{formatKrw(data.totalValueKrw)}</strong>
            </div>
            <dl className="varda-hero-metrics">
              <HeroMetric
                label="오늘 변동"
                value={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"}
                tone={todayChangeKrw}
              />
              <HeroMetric
                label="누적 수익률"
                value={formatPercent(data.totalReturnPct, true)}
                tone={data.totalReturnPct}
              />
              <HeroMetric
                label="환율 영향"
                value={formatSignedKrw(data.todayFxChangeKrw)}
                tone={data.todayFxChangeKrw}
              />
            </dl>
          </section>

          <div className="varda-workspace-grid">
            <div className="varda-main-visual varda-home-main">
              <HoldingMovementHeatmap
                history={data.holdingHistory}
                riskHref={riskHref}
                structureHref={structureHref}
              />
            </div>

            <aside className="varda-context-rail" aria-label="오늘의 근거와 자산 흐름">
              <section className="varda-rail-section">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="varda-kicker">TODAY / EVIDENCE</p>
                    <h2 className="mt-1 text-sm font-medium">오늘의 핵심 근거</h2>
                  </div>
                  <Link
                    className="varda-icon-button"
                    href={scopedHref("/today", data.selectedScope.key)}
                    aria-label="오늘 변동 상세 보기"
                    title="오늘 변동 상세 보기"
                  >
                    <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.6} />
                  </Link>
                </div>
                <dl className="varda-rail-metrics mt-3">
                  <RailMetric
                    label="평가액 변동"
                    value={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"}
                    tone={todayChangeKrw}
                  />
                  <RailMetric
                    label="최대 기여"
                    value={movementReady ? topContributor?.name ?? "변동 없음" : "계산 대기"}
                    tone={topContributor?.dailyChangeKrw ?? null}
                  />
                  <RailMetric
                    label="가격 영향"
                    value={movementReady ? formatSignedKrw(priceImpactKrw ?? 0) : "계산 대기"}
                    tone={priceImpactKrw}
                  />
                  <RailMetric
                    label="시세 근거"
                    value={`${movementEvidenceCount}/${data.dataHealth.movementEligibleAssetCount}`}
                  />
                </dl>
                <div className="varda-compact-fx">
                  <FxImpactPopover
                    basisDate={data.movementBaselineDate}
                    impactKrw={data.todayFxChangeKrw}
                    impactPct={fxImpactPct}
                    points={data.fxTrend}
                  />
                </div>
                <p className="mt-3 truncate text-[10px] text-[var(--faint)]" title={dataStatusText(data, data.dataHealth.movementExcludedAssetCount)}>
                  {movementReady
                    ? dataStatusText(data, data.dataHealth.movementExcludedAssetCount)
                    : movementPendingReason(data)}
                </p>
              </section>

              <section className="varda-rail-section varda-home-history">
                <PortfolioHistoryChart
                  events={data.eventActivity.map((event) => ({
                    id: event.id,
                    eventDate: event.eventDate,
                    eventType: event.eventType,
                    accountLabel: event.accountLabel,
                    assetName: event.assetName,
                    ticker: event.ticker,
                    amountKrw: event.amountKrw,
                    quantityDelta: event.quantityDelta,
                  }))}
                  points={data.recentSnapshots}
                />
              </section>
            </aside>
          </div>

          <footer className="varda-screen-footer">
            <div className="varda-inline-actions" aria-label="빠른 작업">
              <PortfolioRefreshButton autoSync={liveSyncEnabled} />
              <Link className="varda-inline-action" href="/portfolio/holdings/new">
                <Plus aria-hidden="true" size={15} strokeWidth={1.6} />
                보유 종목 추가
              </Link>
              <Link className="varda-inline-action" href={scopedHref("/additional-contribution", data.selectedScope.key)}>
                <Sigma aria-hidden="true" size={15} strokeWidth={1.6} />
                투입 금액 계산
              </Link>
            </div>
            <p>
              USD/KRW {data.usdKrwRate > 0 ? data.usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}
              {data.dataHealth.latestFxRateDate ? ` · ${formatDate(data.dataHealth.latestFxRateDate)}` : ""}
              {` · ${movementBasisText(data)}`}
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}

function HeroMetric({
  label,
  tone,
  value,
}: {
  label: string;
  tone: number | null;
  value: string;
}) {
  return (
    <div className="varda-hero-metric">
      <dt>{label}</dt>
      <dd className={toneClass(tone)} title={value}>{value}</dd>
    </div>
  );
}

function RailMetric({
  label,
  tone = null,
  value,
}: {
  label: string;
  tone?: number | null;
  value: string;
}) {
  return (
    <div className="varda-rail-metric">
      <dt>{label}</dt>
      <dd className={toneClass(tone)} title={value}>{value}</dd>
    </div>
  );
}

function dataStatusText(
  data: DashboardData,
  movementExcludedAssetCount: number,
) {
  const historyCoverage = data.holdingHistory.coveragePct;
  const evidenceText = data.dataHealth.movementReason === "missing_fresh_live_prices"
    ? "실시간 시세 갱신 필요"
    : historyCoverage !== null
      ? `변동 이력 ${formatPercent(historyCoverage)} 커버리지`
      : "종목별 이력 수집 대기";
  const exclusionText = movementExcludedAssetCount > 0
    ? `수동 평가 ${movementExcludedAssetCount}종 제외`
    : null;

  return [evidenceText, exclusionText].filter(Boolean).join(" · ");
}

function movementBasisText(data: DashboardData) {
  if (!data.dataHealth.movementReady) return "오늘 변동 근거 일부 부족";
  if (data.dataHealth.movementSource === "daily_position_snapshot") return "오늘 변동: 기준 스냅샷 대비";
  if (data.dataHealth.movementSource === "asset_price_snapshot") return "오늘 변동: 최근 종가 대비";
  return "오늘 변동 근거 확인 중";
}

function movementPendingReason(data: DashboardData) {
  if (data.dataHealth.movementReason === "missing_current_price") return "현재가 근거 부족";
  if (data.dataHealth.movementReason === "missing_baseline_snapshot") return "기준 스냅샷 부족";
  if (data.dataHealth.movementReason === "missing_fresh_live_prices") return "실시간 시세 갱신 필요";
  return "변동 근거 확인 중";
}

function percentageOfPrevious(value: number | null, previousValue: number) {
  if (value === null || previousValue <= 0) return null;
  return (value / previousValue) * 100;
}

function scopedHref(path: string, selectedScopeKey: PortfolioAnalysisScopeKey) {
  return buildPortfolioAnalysisScopeHref(path, selectedScopeKey);
}

function homeScopeLabel(scope: PortfolioAnalysisScope) {
  return scope.kind === "all" ? "전체 자산" : scope.label;
}

function compareHomeScope(left: PortfolioAnalysisScope, right: PortfolioAnalysisScope) {
  const rank = { all: 0, account: 1, portfolio_group: 2 } as const;
  return rank[left.kind] - rank[right.kind];
}
