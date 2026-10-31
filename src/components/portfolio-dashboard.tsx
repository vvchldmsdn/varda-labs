import { QuickTradeActions } from "@/components/quick-trade-actions";
import { RecoveredPortfolioHistoryChart } from "@/components/recovered-return-section";

import { LocalizedLink } from "@/components/i18n/localized-link";

import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { LocalizedElement } from "@/components/i18n/localized-element";
import Link from "next/link";
import { ArrowUpRight, Plus, ChartPie, Target } from "lucide-react";
import home from "@/components/home/dashboard-discovery.module.css";
import styles from "@/components/home/portfolio-overview.module.css";

import { FxImpactPopover } from "@/components/home/fx-impact-popover";
import { HoldingMovementHeatmap } from "@/components/home/holding-movement-heatmap";

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
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import { selectLargestMovementContributor } from "@/lib/home-metrics";
import type { DashboardData } from "@/lib/portfolio-dashboard";
import { buildPortfolioTargetNavigation } from "@/lib/portfolio-target-navigation";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";
import { PageTitle as CairnPageTitle, SectionTitle as CairnSectionTitle, ActionGroup, ActionContent } from "@/components/cairn-ui";


export function PortfolioDashboard({
  data,
  designPreview = false,
  liveSyncEnabled = false,
}: {
  data: DashboardData;
  designPreview?: boolean;
  liveSyncEnabled?: boolean;
}) {
  const movementReady = data.dataHealth.movementReady;
  const baselineIsDelayed = data.dataHealth.movementReason === "stale_baseline_snapshot";
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
  const structureHref = scopedHref("/portfolio/structure", data.selectedScope.key, designPreview);
  const riskHref = scopedHref("/portfolio/risk", data.selectedScope.key, designPreview);
  const targetNavigation = buildPortfolioTargetNavigation({ scopeKey: data.selectedScope.key, from: "home", isDesignPreview: designPreview });

  return (
    <main className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]" data-page="home">
      <PortfolioPrimaryNavigation
        activePath="/"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content varda-stage-content">
        <div className={`${styles.stage} ${home.stage}`}>
          <header className={styles.stageHeader}>
            <CairnPageTitle id="portfolio-overview-title" className={styles.stageTitle}><T ko="자산의 흐름" en="Your portfolio, over time"/></CairnPageTitle>
            <div className={styles.stageScope}>
            <PortfolioAnalysisScopeTabs
              basePath="/"
              query={designPreview ? { preview: "design" } : undefined}
              scopes={[...data.analysisScopes].toSorted(compareHomeScope)}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
            </div>
            <div className={styles.stageRefresh}>
              <LocalizedLink href={targetNavigation.settingsHref} className={styles.targetEntry} aria-label="목표비중 설정" en={{ "aria-label": "Set target weights" }}>
                <Target size={17} strokeWidth={1.6} aria-hidden="true" /><T ko="목표비중" en="Targets" />
              </LocalizedLink>
              <span className={styles.secondaryRefresh}><PortfolioRefreshButton autoSync={liveSyncEnabled} designPreview={designPreview} /></span>
            </div>
          </header>

          <div className={home.overview}>
          <section className={`${styles.stageSummary} ${home.summary}`} aria-labelledby="portfolio-overview-title">
            <div className={styles.balance}>
              <span><T ko={homeScopeLabel(data.selectedScope)} en={data.selectedScope.kind === "all" ? "All assets" : data.selectedScope.label}/> <T ko="투자자산 평가액" en="Invested asset value"/></span>
              <strong>{<T ko={formatKrw(data.totalValueKrw)} en={translateHomeHistory(formatKrw(data.totalValueKrw))}/>}</strong>
              <p><T ko={`${data.holdings.length}개 보유 종목 · ${data.accountSummaries.length}개 계좌`} en={`${data.holdings.length} holdings · ${data.accountSummaries.length} accounts`}/></p>
            </div>
            <dl className={styles.summaryMetric}>
              <dt><T ko="오늘 변동" en="Today"/></dt>
              <dd className={toneClass(todayChangeKrw)}>
                {<T ko={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"} en={translateHomeHistory(movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기")}/>}
              </dd>
              <dd className={styles.status}><T ko={baselineIsDelayed ? "마지막 기준일" : "기준일"} en={baselineIsDelayed ? "Last baseline" : "As of"}/> {<T ko={formatDate(data.movementBaselineDate)} en={translateHomeHistory(formatDate(data.movementBaselineDate))}/>}</dd>
            </dl>
            <dl className={styles.summaryMetric}>
              <dt><T ko="투자자산 수익률" en="Investment return"/></dt>
              <dd className={toneClass(data.totalReturnPct)}>{formatPercent(data.totalReturnPct, true)}</dd>
              <dd className={styles.status}><T ko="현금 제외 · " en="Excludes cash · " />{data.totalReturnPct === null ? <T ko="원가·거래 근거 부족" en="Cost or trade evidence is incomplete" /> : <T ko={`누적 손익 ${formatSignedKrw(data.totalPnlKrw)}`} en={translateHomeHistory(`누적 손익 ${formatSignedKrw(data.totalPnlKrw)}`)} />}</dd>
            </dl>
            <div className={`${styles.stageNote} ${baselineIsDelayed ? styles.stageWarning : ""}`}>
              <span><T ko={baselineIsDelayed ? "오늘 변동" : "오늘의 최대 기여"} en={baselineIsDelayed ? "Today's change" : "Largest contributor today"}/></span>
              <strong><T ko={movementReady ? topContributor?.name ?? "변동 없음" : "계산 대기"} en={movementReady ? topContributor?.name ?? "No change" : "Awaiting data"}/></strong>
              <p><T ko={movementReady ? dataStatusText(data, data.dataHealth.movementExcludedAssetCount) : movementPendingReason(data)} en={movementReady ? dataStatusText(data, data.dataHealth.movementExcludedAssetCount, "en") : translateHomeHistory(movementPendingReason(data))}/></p>
              {baselineIsDelayed ? <p><T ko="새 기준 기록이 준비되면 오늘 변동이 계산됩니다. 현재 평가액은 최신 시세로 표시합니다." en="Today's change will appear when the new baseline is ready. Current value still uses the latest prices."/></p> : null}
            </div>
          </section>

          <ActionGroup label="내 자산 더 살펴보기">
            <Link href={scopedHref("/additional-contribution", data.selectedScope.key, designPreview)} data-primary="true"><ActionContent icon={<Plus size={22} />} title={<T ko="추가 투자 계산하기" en="Plan a contribution" />} description={<T ko="내 목표에 맞는 배분을 찾아요" en="Find an allocation for your targets" />} /></Link>
            <Link href={structureHref}><ActionContent icon={<ChartPie size={22} />} title={<T ko="내 자산 비중 살펴보기" en="Explore your allocation" />} description={<T ko="목표와 얼마나 가까울까요?" en="How close are you to your targets?" />} /></Link>
          </ActionGroup>

          <div className={styles.stageVisual}>
              <LocalizedElement as="section" en={{"aria-label": "Asset history"}} className={styles.chartPanel} aria-label="자산 이력">
              <RecoveredPortfolioHistoryChart accountId={!designPreview && data.selectedScope.kind === 'account' ? data.selectedScope.accountId : undefined}
                key={data.selectedScope.key}
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
              </LocalizedElement>

          </div>
          </div>



          <footer className={styles.stageFooter}>
            <div className={styles.stageLaunchers}>
              <PresentationDialog label="종목별 흐름 보기" labelEn="Explore holding trends" title="종목별 흐름" titleEn="Holding trends" wide>
              <HoldingMovementHeatmap key={data.selectedScope.key} history={data.holdingHistory} riskHref={riskHref} structureHref={structureHref} />
              </PresentationDialog>

              <PresentationDialog label="변동 근거" labelEn={"Change details"} title="오늘의 근거와 자산 흐름" titleEn={"Today's changes and their sources"} wide>
              <LocalizedElement as="aside" en={{"aria-label": "Today's changes and their sources"}} className={styles.evidence} aria-label="오늘의 근거와 자산 흐름">
              <div>
                <div className={styles.panelHeader}>
                  <CairnSectionTitle className={styles.panelTitle}><T ko="오늘의 핵심 근거" en="Today's key sources"/></CairnSectionTitle>
                  <LocalizedLink en={{"aria-label": translateHomeHistory("오늘 변동 상세 보기"), "title": translateHomeHistory("오늘 변동 상세 보기")}} className="varda-icon-button" href={scopedHref("/today", data.selectedScope.key, designPreview)} aria-label="오늘 변동 상세 보기" title="오늘 변동 상세 보기">
                    <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.6} />
                  </LocalizedLink>
                </div>
                <p className={styles.evidenceIntro}><T ko="평가액의 변화를 가격과 환율로 나누어 확인합니다." en="See how prices and exchange rates contributed to the change in value."/></p>
              </div>
              <dl className={styles.metrics}>
                <RailMetric label="평가액 변동" value={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"} tone={todayChangeKrw} />
                <RailMetric label="가격 영향" value={movementReady ? formatSignedKrw(priceImpactKrw ?? 0) : "계산 대기"} tone={priceImpactKrw} />
                <RailMetric label="환율 영향" value={formatSignedKrw(data.todayFxChangeKrw)} tone={data.todayFxChangeKrw} />
                <RailMetric label="최대 기여" value={movementReady ? topContributor?.name ?? "변동 없음" : "계산 대기"} valueEn={movementReady ? topContributor?.name ?? "No change" : "Awaiting data"} tone={topContributor?.dailyChangeKrw ?? null} />
                <RailMetric label="변동 비교 근거" value={`${movementEvidenceCount}/${data.dataHealth.movementEligibleAssetCount}`} />
                <RailMetric label="USD/KRW" value={data.usdKrwRate > 0 ? data.usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"} />
              </dl>
              <div>
                <FxImpactPopover compact basisDate={data.movementBaselineDate} impactKrw={data.todayFxChangeKrw} impactPct={fxImpactPct} points={data.fxTrend} />
                <p className={`${styles.status} mt-3`}>
                  {<T ko={movementReady ? dataStatusText(data, data.dataHealth.movementExcludedAssetCount) : movementPendingReason(data)} en={translateHomeHistory(movementReady ? dataStatusText(data, data.dataHealth.movementExcludedAssetCount) : movementPendingReason(data))}/>}
                </p>
              </div>
              </LocalizedElement>
              </PresentationDialog>
            </div>
            <p>
              USD/KRW {data.usdKrwRate > 0 ? data.usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}
              {<T ko={data.dataHealth.latestFxRateDate ? ` · ${formatDate(data.dataHealth.latestFxRateDate)}` : ""} en={translateHomeHistory(data.dataHealth.latestFxRateDate ? ` · ${formatDate(data.dataHealth.latestFxRateDate)}` : "")}/>}
              {<T ko={` · ${movementBasisText(data)}`} en={translateHomeHistory(` · ${movementBasisText(data)}`)}/>}
            </p>
          </footer>
        </div>
        {!designPreview ? <section className={styles.tradeHoldings} aria-label="Holdings">
          <CairnSectionTitle><T ko="보유종목" en="Holdings" /></CairnSectionTitle>
          {data.holdings.filter(row => row.market === "us" || row.market === "korea").map(row => <div key={row.id}><span>{row.name}<small>{row.ticker} · {row.quantity}</small></span><QuickTradeActions assetId={row.id} name={row.name} quantity={String(row.quantity)} /></div>)}
          <QuickTradeActions accountId={data.selectedScope.kind === "account" ? data.selectedScope.accountId : undefined} />
        </section> : null}
      </div>
    </main>
  );
}

function RailMetric({
  label,
  tone = null,
  value,
  valueEn,
}: {
  label: string;
  tone?: number | null;
  value: string;
  valueEn?: string;
}) {
  return (
    <div className={styles.metric}>
      <dt>{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <LocalizedElement as="dd" className={toneClass(tone)} title={value} en={{title: valueEn ?? translateHomeHistory(value)}}><T ko={value} en={valueEn ?? translateHomeHistory(value)}/></LocalizedElement>
    </div>
  );
}

function dataStatusText(
  data: DashboardData,
  movementExcludedAssetCount: number,
  locale: "ko" | "en" = "ko",
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

  return [evidenceText, exclusionText]
    .filter((text): text is string => text !== null)
    .map((text) => locale === "en" ? translateHomeHistory(text) : text)
    .join(" · ");
}

function movementBasisText(data: DashboardData) {
  if (!data.dataHealth.movementReady) return "오늘 변동 근거 일부 부족";
  if (data.dataHealth.movementSource === "daily_position_snapshot") return "오늘 변동: 기준 스냅샷 대비";
  if (data.dataHealth.movementSource === "asset_price_snapshot") return "오늘 변동: 최근 종가 대비";
  return "오늘 변동 근거 확인 중";
}

function movementPendingReason(data: DashboardData) {
  if (data.dataHealth.movementReason === "stale_baseline_snapshot") return "일일 기준 기록 준비 중";
  if (data.dataHealth.movementReason === "missing_current_price") return "현재가 근거 부족";
  if (data.dataHealth.movementReason === "missing_baseline_snapshot") return "기준 스냅샷 부족";
  if (data.dataHealth.movementReason === "missing_fresh_live_prices") return "실시간 시세 갱신 필요";
  return "변동 근거 확인 중";
}

function percentageOfPrevious(value: number | null, previousValue: number) {
  if (value === null || previousValue <= 0) return null;
  return (value / previousValue) * 100;
}

function scopedHref(path: string, selectedScopeKey: PortfolioAnalysisScopeKey, designPreview = false) {
  return buildPortfolioAnalysisScopeHref(path, selectedScopeKey, designPreview ? { preview: "design" } : {});
}

function homeScopeLabel(scope: PortfolioAnalysisScope) {
  return scope.kind === "all" ? "전체 자산" : scope.label;
}

function compareHomeScope(left: PortfolioAnalysisScope, right: PortfolioAnalysisScope) {
  const rank = { all: 0, account: 1, portfolio_group: 2 } as const;
  return rank[left.kind] - rank[right.kind];
}
