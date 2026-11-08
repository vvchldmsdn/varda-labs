import { T } from "@/components/i18n/localized-text";
import { getLocale } from "@/lib/i18n/server";
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
import { buildDemoPortfolio, demoAccount, demoHref, isDemoView } from "@/lib/demo-portfolio";
import { buildPortfolioRiskDesignPreview } from "@/lib/portfolio-risk-design-preview";
import { selectTodayHoldingHistory } from "@/lib/today-movement-view";
import { formatKrw, formatSignedKrw, formatPercent } from "@/components/home/portfolio-format";
import styles from "@/components/demo/demo.module.css";
import { SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";


export async function generateMetadata(): Promise<Metadata> {
 const en = await getLocale() === "en";
 return { title: en ? "Explore the sample | CAIRN LABS" : "샘플로 Cairn Labs 체험 | CAIRN LABS",
 description: en ? "Explore a sample portfolio, its movements, allocation and possible outcomes without signing up." : "가입 없이 샘플 포트폴리오로 자산의 변동, 구조, 다른 선택과 가능한 미래를 직접 살펴보세요.",
 robots: { index: false, follow: true } };
}
export default async function DemoPage({ params, searchParams }: { params: Promise<{ view: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { view } = await params;
  if (!isDemoView(view)) notFound();
  const query = await searchParams;
  const account = demoAccount(query.account);
  if (view === "lab" || view === "simulation") return <DemoShell view={view} account={account}><DemoResearch key={view} view={view}/></DemoShell>;
  const { dashboard, holdingRows, groupRows } = buildDemoPortfolio(account);
  const closeHref = demoHref("today", account);
  const selected = typeof query.holding === "string" ? dashboard.holdings.find(row => row.id === query.holding) : null;
  return <DemoShell view={view} account={account}>
    <div data-demo-ready="true">
      {view === "home" ? <><div className={styles.overview}><div><span><T ko="샘플 평가액" en="Sample portfolio value" /></span><strong>{formatKrw(dashboard.totalValueKrw)}</strong><p><T ko={`${dashboard.holdings.length}개 종목 · ${dashboard.accountSummaries.length}개 계좌`} en={`${dashboard.holdings.length} ${dashboard.holdings.length === 1 ? "holding" : "holdings"} · ${dashboard.accountSummaries.length} ${dashboard.accountSummaries.length === 1 ? "account" : "accounts"}`} /></p></div><dl><div><dt><T ko="샘플 일일 변동" en="Sample daily change" /></dt><dd>{formatSignedKrw(dashboard.todayChangeKrw)}</dd></div><div><dt><T ko="변동률" en="Change" /></dt><dd>{formatPercent(dashboard.todayReturnPct, true)}</dd></div></dl></div><HoldingMovementHeatmap key={account} stage etfHref={null} history={dashboard.holdingHistory} riskHref={demoHref("structure", account)} structureHref={demoHref("structure", account)}/><Link className={styles.textLink} href={demoHref("today", account)}><T ko="왜 움직였는지 기여도 살펴보기 →" en="Explore what moved →" /></Link></> : null}
      {view === "today" ? <><div className={styles.overview}><div><span><T ko="샘플 일일 변동" en="Sample daily change" /></span><strong>{formatSignedKrw(dashboard.todayChangeKrw)}</strong></div><dl><div><dt><T ko="가격 영향" en="Price impact" /></dt><dd>{formatSignedKrw(dashboard.todayMovement.priceChangeKrw)}</dd></div><div><dt><T ko="환율 영향" en="FX impact" /></dt><dd>{formatSignedKrw(dashboard.todayMovement.fxChangeKrw)}</dd></div></dl></div><p className={styles.explanation}><T ko="종목을 선택해 변동 금액과 가격·환율의 영향을 살펴보세요." en="Select a holding to explore its price and FX changes." /></p><TodayContributionExplorer key={account} rows={dashboard.todayMovement.contributionRows.flatMap(row => {
        const holding = dashboard.holdings.find(item => item.id === row.holdingId); if (!holding) return [];
        return [{ accountLabel: holding.account, changeKrw: row.changeKrw, fxImpactKrw: row.fxChangeKrw, href: demoHref("today", account, holding.id), key: holding.id, name: holding.name, priceImpactKrw: row.priceChangeKrw, returnPct: row.returnPct, selected: selected?.id === holding.id, ticker: holding.ticker, tradeFlowKrw: row.tradeFlowKrw }];
      }).sort((a, b) => Math.abs(b.changeKrw) - Math.abs(a.changeKrw))}/>{selected ? <HoldingDetailDrawer closeHref={closeHref}><CairnSectionTitle id="holding-detail-title">{selected.name}</CairnSectionTitle><div className={styles.detailMetrics}><span><T ko="샘플 변동" en="Sample change" /><strong>{formatSignedKrw(selected.dailyChangeKrw)}</strong></span><span><T ko="샘플 평가액" en="Sample portfolio value" /><strong>{formatKrw(selected.valueKrw)}</strong></span></div><SelectedHoldingHistoryChart currency={selected.currency} name={selected.name} points={selectTodayHoldingHistory(dashboard.holdingHistory, selected.id)}/></HoldingDetailDrawer> : null}</> : null}
      {view === "structure" ? <><PortfolioAllocationExplorer key={account} holdingRows={holdingRows} groupRows={groupRows} accountLabels={{ brokerage: "증권", isa: "ISA", irp: "IRP" }} serviceDate="2026-08-21" summary={<div className={styles.structureSummary}><span><T ko="샘플 평가액" en="Sample portfolio value" /></span><strong>{formatKrw(dashboard.totalValueKrw)}</strong><span><T ko="종목 수" en="Holdings" /></span><strong><T ko={`${holdingRows.length}개`} en={`${holdingRows.length}`} /></strong><p><T ko="원형 조각이나 지도를 눌러 비중을 살펴보세요." en="Select a ring segment or tile to explore its weight." /></p></div>}/><details className={styles.risk}><summary><T ko="위험 분석도 살펴보기" en="Explore portfolio risk" /></summary><p className={styles.disclaimer}><T ko="같은 샘플 보유종목에 가상 과거 시세를 적용한 계산입니다. 실측 위험 지표가 아닙니다." en="Calculated from the same sample holdings and illustrative price history, not measured investment risk." /></p><RiskPortfolioSummary model={buildPortfolioRiskDesignPreview(holdingRows)}/></details></> : null}
      {view === "contribution" ? <DemoContribution key={account} holdings={holdingRows}/> : null}
      {view === "history" ? <><p className={styles.explanation}><T ko="기간을 바꾸거나 날짜를 짚어 가상의 자산 흐름을 살펴보세요." en="Change the period or select a date to explore this illustrative portfolio history." /></p><PortfolioHistoryChart key={account} points={dashboard.recentSnapshots} events={dashboard.eventActivity}/></> : null}
    </div>
  </DemoShell>;
}
