import Link from "next/link";

import { FxImpactPopover } from "@/components/home/fx-impact-popover";
import { HoldingMovementHeatmap } from "@/components/home/holding-movement-heatmap";
import { PortfolioHistoryChart } from "@/components/home/portfolio-history-chart";
import {
  formatDate,
  formatKrw,
  formatKstTime,
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";
import { PortfolioRefreshButton } from "@/components/home/portfolio-refresh-button";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type { DashboardData, DashboardHolding } from "@/lib/portfolio-dashboard";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";

const HOME_NAV_ITEMS = [
  { label: "홈", href: "/" },
  { label: "포트폴리오", href: "/portfolio/structure" },
  { label: "추가 투입", href: "/additional-contribution" },
  { label: "히스토리", href: "/history" },
  { label: "분석", href: "/investment-lab" },
  { label: "시뮬레이션", href: "/simulation" },
] as const;

const LIVE_QUOTE_TYPES = new Set(["live", "delayed", "realtime"]);

export function PortfolioDashboard({ data }: { data: DashboardData }) {
  const movementReady = data.dataHealth.movementReady;
  const todayChangeKrw = movementReady ? data.todayChangeKrw ?? 0 : null;
  const topContributor = movementReady ? largestPositiveContributor(data.holdings) : null;
  const priceImpactKrw = movementReady
    ? (data.todayChangeKrw ?? 0) - (data.todayFxChangeKrw ?? 0) - data.tradeFlowKrw
    : null;
  const priceImpactPct = percentageOfPrevious(priceImpactKrw, data.todayMovement.previousTotalKrw);
  const fxImpactPct = percentageOfPrevious(
    data.todayFxChangeKrw,
    data.todayMovement.previousTotalKrw,
  );
  const liveEvidenceCount = data.holdings.filter(hasLivePriceEvidence).length;
  const storedPriceCount = Math.max(0, data.holdings.length - liveEvidenceCount);
  const structureHref = scopedHref("/portfolio/structure", data.selectedScope.key);
  const riskHref = scopedHref("/portfolio/risk", data.selectedScope.key);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8f5] text-[#20231f]">
      <HomeNavigation
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="mx-auto w-full max-w-[1540px] px-5 pb-10 pt-8 sm:px-8 lg:px-10 lg:pb-14 lg:pt-10">
        <section aria-labelledby="portfolio-overview-title">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-medium text-[#7b8079]">PORTFOLIO / OVERVIEW</p>
                <h1 id="portfolio-overview-title" className="sr-only">포트폴리오 홈</h1>
              </div>
              <p className="text-xs text-[#7b8079]">
                기준일 {formatDate(data.latestSnapshotReferenceDate ?? data.latestSnapshotDate)}
              </p>
            </div>

            <PortfolioAnalysisScopeTabs
              basePath="/"
              scopes={[...data.analysisScopes].toSorted(compareHomeScope)}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
          </div>

          <div className="pb-10 pt-12 text-center sm:pb-12 sm:pt-14 lg:pb-14 lg:pt-16">
            <p className="text-xs font-medium text-[#737970]">
              {homeScopeLabel(data.selectedScope)}
            </p>
            <p className="mt-3 text-5xl font-normal tabular-nums text-[#151714] sm:text-6xl lg:text-[80px]">
              {formatKrw(data.totalValueKrw)}
            </p>
            <dl className="mx-auto mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-y-3 text-sm">
              <HeroMetric
                label="오늘"
                value={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"}
                tone={todayChangeKrw}
              />
              <HeroMetric label="누적" value={formatPercent(data.totalReturnPct, true)} tone={data.totalReturnPct} divided />
              <HeroMetric label="환율" value={formatSignedKrw(data.todayFxChangeKrw)} tone={data.todayFxChangeKrw} divided />
            </dl>
          </div>
        </section>

        <div className="grid gap-12 border-t border-[#d9ddd7] pt-9 lg:gap-14">
          <div className="min-w-0">
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
          </div>
          <div className="min-w-0 border-t border-[#d9ddd7] pt-9">
            <HoldingMovementHeatmap
              history={data.holdingHistory}
              riskHref={riskHref}
              structureHref={structureHref}
            />
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Link
            className="inline-flex items-center gap-3 text-sm font-medium text-[#343833] hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]"
            href={scopedHref("/today", data.selectedScope.key)}
          >
            오늘의 흐름 전체 보기 <span aria-hidden="true">→</span>
          </Link>
        </div>

        <section aria-label="오늘의 핵심 근거" className="mt-5 border-y border-[#d9ddd7]">
          <div className="grid sm:grid-cols-2 lg:grid-cols-5">
            <EvidenceMetric
              label="평가액 변동"
              value={movementReady ? formatSignedKrw(todayChangeKrw) : "계산 대기"}
              subValue={movementReady ? formatPercent(data.todayReturnPct ?? 0, true) : movementPendingReason(data)}
              tone={todayChangeKrw}
            />
            <EvidenceMetric
              label="최대 기여"
              value={movementReady ? topContributor?.name ?? "변동 없음" : "계산 대기"}
              subValue={movementReady ? formatSignedKrw(topContributor?.dailyChangeKrw ?? 0) : movementPendingReason(data)}
              tone={topContributor?.dailyChangeKrw ?? null}
            />
            <EvidenceMetric
              label="가격 영향"
              value={movementReady ? formatSignedKrw(priceImpactKrw ?? 0) : "계산 대기"}
              subValue={movementReady ? formatPercent(priceImpactPct ?? 0, true) : movementPendingReason(data)}
              tone={priceImpactKrw}
            />
            <FxImpactPopover
              basisDate={data.latestSnapshotDate}
              impactKrw={data.todayFxChangeKrw}
              impactPct={fxImpactPct}
              points={data.fxTrend}
            />
            <EvidenceMetric
              label="데이터 상태"
              value={`현재가 ${liveEvidenceCount}/${data.holdings.length}`}
              subValue={dataStatusText(data, storedPriceCount)}
            />
          </div>
        </section>

        <section aria-label="빠른 작업" className="grid gap-6 border-b border-[#d9ddd7] py-7 sm:grid-cols-3 sm:gap-0">
          <div className="flex justify-center sm:border-r sm:border-[#d9ddd7]">
            <PortfolioRefreshButton />
          </div>
          <div className="flex justify-center sm:border-r sm:border-[#d9ddd7]">
            <Link
              className="inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]"
              href="/portfolio/holdings/new"
            >
              <span aria-hidden="true" className="text-xl">＋</span>
              보유 종목 추가
            </Link>
          </div>
          <div className="flex justify-center">
            <Link
              className="inline-flex min-h-11 items-center gap-3 px-1 text-sm font-medium hover:text-[#347e62] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]"
              href={scopedHref("/additional-contribution", data.selectedScope.key)}
            >
              <span aria-hidden="true" className="text-xl">Σ</span>
              투입 금액 계산
            </Link>
          </div>
        </section>

        <footer className="flex flex-col gap-2 pt-5 text-[11px] text-[#858a83] sm:flex-row sm:items-center sm:justify-between">
          <p>
            USD/KRW {data.usdKrwRate > 0 ? data.usdKrwRate.toLocaleString("ko-KR", { maximumFractionDigits: 2 }) : "-"}
            {data.dataHealth.latestFxRateDate ? ` · ${formatDate(data.dataHealth.latestFxRateDate)} 기준` : ""}
          </p>
          <p>{movementBasisText(data)}</p>
        </footer>
      </div>
    </main>
  );
}

function HomeNavigation({
  generatedAt,
  selectedScopeKey,
}: {
  generatedAt: string;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  return (
    <header className="border-b border-[#e1e4df] bg-[#fafbf8]">
      <div className="mx-auto flex min-h-16 w-full max-w-[1540px] items-center justify-between gap-5 px-5 sm:px-8 lg:px-10">
        <Link className="shrink-0 text-sm font-semibold text-[#171a16] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]" href={scopedHref("/", selectedScopeKey)}>
          VARDA
        </Link>
        <nav aria-label="주요 메뉴" className="min-w-0 overflow-x-auto">
          <div className="flex min-w-max items-center gap-7 text-sm lg:gap-12">
            {HOME_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                aria-current={item.href === "/" ? "page" : undefined}
                className={`border-b py-5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62] ${
                  item.href === "/"
                    ? "border-[#20231f] text-[#20231f]"
                    : "border-transparent text-[#61675f] hover:text-[#20231f]"
                }`}
                href={scopedHref(item.href, selectedScopeKey)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-xs text-[#6f756d] md:inline">{formatKstTime(generatedAt)} 기준</span>
          <PortfolioRefreshButton compact />
          <Link
            aria-label="세션 정보"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#d8dcd6] bg-[#f2f4f0] text-xs font-semibold hover:border-[#aeb4ac] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#347e62]"
            href="/auth/session"
          >
            V
          </Link>
        </div>
      </div>
    </header>
  );
}

function HeroMetric({
  divided = false,
  label,
  tone,
  value,
}: {
  divided?: boolean;
  label: string;
  tone: number | null;
  value: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 ${divided ? "border-l border-[#d3d7d1]" : ""}`}>
      <dt className="text-[#666c64]">{label}</dt>
      <dd className={`font-medium tabular-nums ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function EvidenceMetric({
  label,
  subValue,
  tone = null,
  value,
}: {
  label: string;
  subValue: string;
  tone?: number | null;
  value: string;
}) {
  return (
    <div className="min-w-0 border-b border-[#e2e5df] px-5 py-6 last:border-b-0 sm:odd:border-r sm:odd:border-[#e2e5df] lg:border-b-0 lg:border-r lg:border-[#e2e5df] lg:last:border-r-0">
      <p className="text-xs font-medium text-[#6d736b]">{label}</p>
      <p className={`mt-3 truncate text-xl font-medium tabular-nums ${toneClass(tone)}`} title={value}>
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-[#747a72]" title={subValue}>{subValue}</p>
    </div>
  );
}

function largestPositiveContributor(holdings: readonly DashboardHolding[]) {
  return holdings
    .filter((holding) => holding.dailyChangeKrw !== null)
    .toSorted((left, right) => (right.dailyChangeKrw ?? 0) - (left.dailyChangeKrw ?? 0))[0] ?? null;
}

function hasLivePriceEvidence(holding: DashboardHolding) {
  return holding.priceStatus === "ok" && LIVE_QUOTE_TYPES.has(holding.priceQuoteType ?? "");
}

function dataStatusText(data: DashboardData, storedPriceCount: number) {
  const historyCoverage = data.holdingHistory.coveragePct;
  if (storedPriceCount > 0) return `${storedPriceCount}종목 저장 가격 사용`;
  if (historyCoverage !== null) return `변동 이력 ${formatPercent(historyCoverage)} 커버리지`;
  return "종목별 이력 수집 대기";
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
