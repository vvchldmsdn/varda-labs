import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoContribution } from "@/components/demo/demo-contribution";
import { DemoResearch } from "@/components/demo/demo-research";
import { HoldingMovementHeatmap } from "@/components/home/holding-movement-heatmap";
import { PortfolioHistoryChart } from "@/components/home/portfolio-history-chart";
import { TodayContributionExplorer } from "@/components/today/today-contribution-explorer";
import { SelectedHoldingHistoryChart } from "@/components/today/selected-holding-history-chart";
import { HoldingDetailDrawer } from "@/components/today/holding-detail-drawer";
import { PortfolioAllocationExplorer } from "@/components/portfolio/portfolio-allocation-explorer";
import { RiskPortfolioSummary } from "@/components/portfolio-risk/portfolio-risk-summary";
import { buildDemoPortfolio, demoAccount, isDemoView } from "@/lib/demo-portfolio";
import { buildPortfolioRiskDesignPreview } from "@/lib/portfolio-risk-design-preview";
import { selectTodayHoldingHistory } from "@/lib/today-movement-view";
import { formatKrw, formatSignedKrw, formatPercent } from "@/components/home/portfolio-format";
import styles from "@/components/demo/demo.module.css";

export const metadata: Metadata = { title: "샘플로 Varda 체험 | VARDA LABS", description: "가입 없이 샘플 포트폴리오로 자산의 변동, 구조, 다른 선택과 가능한 미래를 직접 살펴보세요.", robots: { index: false, follow: true } };
export default async function DemoPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { view } = await params;
  if (!isDemoView(view)) notFound();
  const query = await searchParams;
  const account = demoAccount(query.account);
  if (view === "lab" || view === "simulation") return <DemoShell view={view} account={account}><DemoResearch key={view} view={view}/></DemoShell>;
  const { dashboard, holdingRows, groupRows } = buildDemoPortfolio(account);
  const closeHref = `/demo/today?account=${account}`;
  const selected = typeof query.holding === "string" ? dashboard.holdings.find(row => row.id === query.holding) : null;
  return <DemoShell view={view} account={account}>
    <div data-demo-ready="true">
      {view === "home" ? <><div className={styles.overview}><div><span>샘플 평가액</span><strong>{formatKrw(dashboard.totalValueKrw)}</strong><p>{dashboard.holdings.length}개 종목 · {dashboard.accountSummaries.length}개 계좌</p></div><dl><div><dt>샘플 일일 변동</dt><dd>{formatSignedKrw(dashboard.todayChangeKrw)}</dd></div><div><dt>변동률</dt><dd>{formatPercent(dashboard.todayReturnPct, true)}</dd></div></dl></div><HoldingMovementHeatmap key={account} stage etfHref={null} history={dashboard.holdingHistory} riskHref={`/demo/structure?account=${account}`} structureHref={`/demo/structure?account=${account}`}/><Link className={styles.textLink} href={`/demo/today?account=${account}`}>왜 움직였는지 기여도 살펴보기 →</Link></> : null}
      {view === "today" ? <><div className={styles.overview}><div><span>샘플 일일 변동</span><strong>{formatSignedKrw(dashboard.todayChangeKrw)}</strong></div><dl><div><dt>가격 영향</dt><dd>{formatSignedKrw(dashboard.todayMovement.priceChangeKrw)}</dd></div><div><dt>환율 영향</dt><dd>{formatSignedKrw(dashboard.todayMovement.fxChangeKrw)}</dd></div></dl></div><p className={styles.explanation}>종목을 선택해 변동 금액과 가격·환율의 영향을 살펴보세요.</p><TodayContributionExplorer key={account} rows={dashboard.todayMovement.contributionRows.flatMap(row => {
        const holding = dashboard.holdings.find(item => item.id === row.holdingId); if (!holding) return [];
        return [{ accountLabel: holding.account, changeKrw: row.changeKrw, fxImpactKrw: row.fxChangeKrw, href: `${closeHref}&holding=${encodeURIComponent(holding.id)}`, key: holding.id, name: holding.name, priceImpactKrw: row.priceChangeKrw, returnPct: row.returnPct, selected: selected?.id === holding.id, ticker: holding.ticker, tradeFlowKrw: row.tradeFlowKrw }];
      }).sort((a, b) => Math.abs(b.changeKrw) - Math.abs(a.changeKrw))}/>{selected ? <HoldingDetailDrawer closeHref={closeHref}><h2 id="holding-detail-title">{selected.name}</h2><div className={styles.detailMetrics}><span>샘플 변동<strong>{formatSignedKrw(selected.dailyChangeKrw)}</strong></span><span>샘플 평가액<strong>{formatKrw(selected.valueKrw)}</strong></span></div><SelectedHoldingHistoryChart currency={selected.currency} name={selected.name} points={selectTodayHoldingHistory(dashboard.holdingHistory, selected.id)}/></HoldingDetailDrawer> : null}</> : null}
      {view === "structure" ? <><PortfolioAllocationExplorer key={account} holdingRows={holdingRows} groupRows={groupRows} accountLabels={{ brokerage: "증권", isa: "ISA", irp: "IRP" }} serviceDate="2026-08-21" summary={<div className={styles.structureSummary}><span>샘플 평가액</span><strong>{formatKrw(dashboard.totalValueKrw)}</strong><span>종목 수</span><strong>{holdingRows.length}개</strong><p>원형 조각이나 지도를 눌러 비중을 살펴보세요.</p></div>}/><details className={styles.risk}><summary>위험 분석도 살펴보기</summary><p className={styles.disclaimer}>같은 샘플 보유종목에 가상 과거 시세를 적용한 계산입니다. 실측 위험 지표가 아닙니다.</p><RiskPortfolioSummary model={buildPortfolioRiskDesignPreview(holdingRows)}/></details></> : null}
      {view === "contribution" ? <DemoContribution key={account} holdings={holdingRows}/> : null}
      {view === "history" ? <><p className={styles.explanation}>기간을 바꾸거나 날짜를 짚어 가상의 자산 흐름을 살펴보세요.</p><PortfolioHistoryChart key={account} points={dashboard.recentSnapshots} events={dashboard.eventActivity}/></> : null}
    </div>
  </DemoShell>;
}
