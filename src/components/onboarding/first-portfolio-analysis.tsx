import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, Check, FlaskConical } from "lucide-react";
import { T } from "@/components/i18n/localized-text";
import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import { getReadOnlyTenantFirstPortfolioAnalysis, type FirstPortfolioAnalysisQueryResult } from "@/db/queries/first-portfolio-analysis";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import styles from "./first-portfolio-analysis.module.css";
import { ActionContent, ActionGroup, InfoDisclosure, PageTitle as CairnPageTitle, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";
import { RecoveryNotice } from "@/components/recovery/recovery-notice";
import { FirstDayReplay } from "./first-day-replay";


export async function FirstPortfolioAnalysis({ scope, serviceDate, tenantContext }: {
  scope: PortfolioAnalysisScope; serviceDate: string; tenantContext: TenantContext;
}) {
  const result = await getReadOnlyTenantFirstPortfolioAnalysis({ scope, serviceDate, tenantContext });
  return <FirstPortfolioAnalysisView result={result} scopeKey={scope.key} />;
}

export function FirstPortfolioAnalysisView({ result, scopeKey, designPreview = false }: {
  result: FirstPortfolioAnalysisQueryResult; scopeKey: string; designPreview?: boolean;
}) {
  const { summary, readiness } = result;
  const query = new URLSearchParams({ scope: scopeKey });
  if (designPreview) query.set("preview", "design");
  const href = (path: string) => `${path}?${query}`;
  const replayHref = `/investment-lab?${new URLSearchParams({ ...Object.fromEntries(query), view: "composition" })}`;
  const entries = readiness.state === "ready" ? readiness.entries : [];
  const preparedCount = entries.filter((entry) => entry.readiness.state === "ready").length;
  const unprepared = entries.filter((entry) => entry.readiness.state !== "ready");
  const money = (value: number | null | undefined) => value === null || value === undefined ? "—" : `₩${Math.round(value).toLocaleString("en-US")}`;

  return <div className={styles.content}>
    <header className={styles.heading}>
      <CairnPageTitle><T ko="지금 가진 것부터, 한눈에." en="Your portfolio, at a glance." /></CairnPageTitle>
      <p><T ko="등록한 종목으로 시작하는 첫 분석" en="A first look at the holdings you added" /></p>
    </header>
    {designPreview ? <p className={styles.preview}><T ko="예시 포트폴리오 · 실제 자산이 아니며 데이터를 저장하지 않습니다." en="Example portfolio · These are sample holdings. No data is saved." /></p> : null}
    {summary?.state === "empty" ? <section className={styles.empty}><ChartNoAxesCombined size={36} aria-hidden="true" /><CairnSectionTitle><T ko="종목 하나로 시작해 보세요." en="Start with one holding." /></CairnSectionTitle><p><T ko="종목과 수량만 있으면 돼요. 매입가는 나중에 추가할 수 있어요." en="A holding and its quantity are enough. Add purchase prices later." /></p><Link className={styles.primary} href={href("/portfolio/holdings/new")}><T ko="첫 종목 추가" en="Add your first holding" /><ArrowUpRight size={18} aria-hidden="true" /></Link></section> : <>
      <section className={styles.overview}>
        <div className={styles.value}>
          <span className={styles.label}><T ko="현재 투자자산" en="Current investments" /></span>
          <strong>{money(summary?.totalValueKrw)}</strong>
          <p><T ko="저장된 가격·환율 기준 · 현금 제외" en="Available prices and FX · Cash excluded" /></p>
          {summary?.state === "partial" ? <p className={styles.warning}><T ko={`${summary.unvaluedHoldingCount}종목의 평가 자료가 필요해요. 전체 평가액·비중은 보류했어요.`} en={`${summary.unvaluedHoldingCount} holdings need valuation data. Total value and weights are unavailable.`} /></p> : null}
        </div>
        <div className={styles.facts}>
          <div><span className={styles.label}><T ko="가장 큰 종목 비중" en="Largest holding weight" /></span><strong>{summary?.largestHolding?.weightPct !== null && summary?.largestHolding?.weightPct !== undefined ? `${summary.largestHolding.weightPct.toFixed(1)}%` : "—"}</strong><small>{summary?.largestHolding?.name ?? <T ko="평가 확인 후 표시" en="Available after valuation" />}</small></div>
          <div><span className={styles.label}><T ko="달러 표시 자산 비중" en="USD-denominated assets" /></span><strong>{summary?.usdWeightPct !== null && summary?.usdWeightPct !== undefined ? `${summary.usdWeightPct.toFixed(1)}%` : "—"}</strong><small><T ko="종목 표시 통화 기준" en="Based on listing currency" /></small></div>
        </div>
      </section>
      {!summary ? <RecoveryNotice kind="retry" /> : null}
      {summary && summary.rows.length > 0 ? <section className={styles.holdings}>
        <div className={styles.sectionTitle}><CairnSectionTitle id="first-portfolio-composition"><T ko="내 포트폴리오 구성" en="What you own" /></CairnSectionTitle><Link href={href("/portfolio/holdings")}><T ko="보유종목 관리" en="Manage holdings" /><ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        {summary.state === "complete" ? <div className={styles.allocation} role="img" aria-labelledby="first-portfolio-composition">{summary.rows.map((row, index) => <span key={row.key} title={`${row.name} ${row.weightPct?.toFixed(1)}%`} style={{ width: `${row.weightPct}%`, background: `var(--first-allocation-${index % 4})` }} />)}</div> : null}
        <div className={styles.holdingRows}>{summary.rows.slice(0, 5).map((row) => <div key={row.key}><span><b>{row.name}</b><small>{row.ticker}</small></span><strong>{row.weightPct === null ? money(row.valueKrw) : `${row.weightPct.toFixed(1)}%`}</strong></div>)}</div>
        {summary.rows.length > 5 ? <Link className={styles.more} href={href("/portfolio/holdings")}><T ko={`전체 ${summary.rows.length}종목 보기`} en={`View all ${summary.rows.length} holdings`} /><ArrowUpRight size={14} aria-hidden="true" /></Link> : null}
      </section> : null}
      <FirstDayReplay result={result.replay} />
      <section className={styles.readiness} id="first-market-data" tabIndex={-1}>
        <div className={styles.sectionTitle}><CairnSectionTitle><T ko="시장 자료 준비 상태" en="Market data readiness" /></CairnSectionTitle>{readiness.state === "ready" && entries.length > 0 ? <span><Check size={15} aria-hidden="true" />{preparedCount}/{entries.length}</span> : null}</div>
        <InfoDisclosure summary={<T ko="분석 기준" en="Analysis basis" />}><p><T ko="시장 가격 이력으로 분석합니다. 아래 일수는 가입 후 기록한 기간이 아닌 시장 가격 기록 수입니다. 종목별 자료가 준비되어도 공통 날짜나 환율이 부족하면 일부 분석은 제한될 수 있어요." en="Analysis uses market price history. These counts refer to market records, not days since you joined. Shared dates or exchange-rate coverage may still limit analysis." /></p><p><T ko="과거 보유 내역을 추측해 실제 기록으로 채우지 않습니다." en="Past holdings are not inferred or added to your actual record." /></p></InfoDisclosure>
        {readiness.state !== "ready" ? <p className={styles.warning}><T ko="시장 자료 상태를 확인하지 못했습니다. 현재 구성은 계속 살펴볼 수 있어요." en="Market data readiness could not be checked. You can still explore your current composition." /></p> : null}
        {unprepared.length > 0 ? <div className={styles.preparation}>{unprepared.map((entry) => <div key={entry.holdingId}><b>{entry.name}</b>{designPreview ? <small><T ko={`${entry.readiness.observationCount}개 가격 기록 · 예시에서는 조회하지 않습니다.`} en={`${entry.readiness.observationCount} price records · Preparation is disabled in this example.`} /></small> : <HoldingAnalysisDataForm holdingId={entry.holdingId} readiness={entry.readiness} />}</div>)}</div> : readiness.state === "ready" && entries.length > 0 ? <p className={styles.ready}><Check size={17} aria-hidden="true" /><T ko="등록한 종목의 가격 이력이 준비되어 있습니다." en="Historical prices are available for your registered holdings." /></p> : null}
      </section>
      <section className={styles.next}>
        <div className={styles.sectionTitle}><CairnSectionTitle><T ko="조금 더 살펴볼까요?" en="Explore a little further" /></CairnSectionTitle></div>
        <ActionGroup label="첫 분석 다음 탐색">
          <Link href={href("/simulation")}><ActionContent icon={<ChartNoAxesCombined size={23} />} title={<T ko="가능한 흐름 보기" en="Explore possible paths" />} description={<T ko="가상 경로 · 미래 예측 아님" en="Hypothetical paths · Not a forecast" />} /></Link>
          <Link href={replayHref}><ActionContent icon={<FlaskConical size={23} />} title={<T ko="구성 더 살펴보기" en="Explore your composition" />} description={<T ko="가정 실험 · 실제 수익률과 별도" en="An experiment · Separate from actual returns" />} /></Link>
        </ActionGroup>
      </section>
      <footer className={styles.footer}><Link className={styles.primary} href={href("/")}><T ko="내 홈으로 이동" en="Go to my dashboard" /><ArrowUpRight size={18} aria-hidden="true" /></Link><Link href={href("/portfolio/holdings/new")}><T ko="종목 더 추가하기" en="Add another holding" /></Link></footer>
    </>}
  </div>;
}
