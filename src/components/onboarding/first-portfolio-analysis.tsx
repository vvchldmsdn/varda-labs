import Link from "next/link";
import { ArrowUpRight, ChartNoAxesCombined, Check, Clock3 } from "lucide-react";
import { T } from "@/components/i18n/localized-text";
import { HoldingAnalysisDataForm } from "@/components/holding-analysis-data-form";
import { getReadOnlyTenantFirstPortfolioAnalysis, type FirstPortfolioAnalysisQueryResult } from "@/db/queries/first-portfolio-analysis";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import styles from "./first-portfolio-analysis.module.css";

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
      <span className={styles.eyebrow}>YOUR FIRST LOOK</span>
      <h1><T ko="지금 가진 것부터, 한눈에." en="Your portfolio, at a glance." /></h1>
      <p><T ko="매입가와 과거 거래가 없어도 현재 구성을 살펴볼 수 있어요. 시장의 과거 가격은 서비스가 공유하는 자료를 사용합니다." en="Explore what you own without entering purchase prices or past trades. Historical market prices come from shared reference data." /></p>
    </header>
    {designPreview ? <p className={styles.preview}><T ko="예시 포트폴리오 · 실제 자산이 아니며 데이터를 저장하지 않습니다." en="Example portfolio · These are sample holdings. No data is saved." /></p> : null}
    {summary?.state === "empty" ? <section className={styles.empty}><ChartNoAxesCombined size={30} aria-hidden="true" /><h2><T ko="종목 하나로 시작해 보세요." en="Start with one holding." /></h2><p><T ko="종목 이름으로 찾고 보유 수량을 입력하면 첫 분석을 볼 수 있어요. 매입가는 나중에 추가할 수 있습니다." en="Find a holding by name and enter its quantity. You can add its purchase price later." /></p><Link className={styles.primary} href="/portfolio/onboarding"><T ko="첫 종목 추가" en="Add your first holding" /><ArrowUpRight size={17} aria-hidden="true" /></Link></section> : <>
      <section className={styles.overview}>
        <div className={styles.value}>
          <span className={styles.label}><T ko="등록한 투자자산 평가액" en="Value of registered investments" /></span>
          <strong>{money(summary?.totalValueKrw)}</strong>
          <p><T ko="현재 저장된 가격과 환율 기준 · 보유 계좌의 현금은 포함하지 않습니다." en="Based on available prices and exchange rates · Account cash is not included." /></p>
          {summary?.state === "partial" ? <p className={styles.warning}><T ko={`${summary.unvaluedHoldingCount}개 보유종목의 평가 근거를 확인해야 합니다. 전체 금액과 비중은 표시하지 않습니다.`} en={`Valuation evidence is incomplete for ${summary.unvaluedHoldingCount} holdings. The total and weights are unavailable.`} /></p> : null}
          {!summary ? <p className={styles.warning}><T ko="평가액을 읽지 못했습니다. 잠시 후 다시 확인해 주세요." en="Valuation could not be loaded. Please try again shortly." /></p> : null}
        </div>
        <div className={styles.facts}>
          <div><span className={styles.label}><T ko="가장 큰 종목 비중" en="Largest holding weight" /></span><strong>{summary?.largestHolding?.weightPct !== null && summary?.largestHolding?.weightPct !== undefined ? `${summary.largestHolding.weightPct.toFixed(1)}%` : "—"}</strong><small>{summary?.largestHolding?.name ?? <T ko="평가 확인 후 표시" en="Available after valuation" />}</small></div>
          <div><span className={styles.label}><T ko="달러 표시 자산 비중" en="USD-denominated assets" /></span><strong>{summary?.usdWeightPct !== null && summary?.usdWeightPct !== undefined ? `${summary.usdWeightPct.toFixed(1)}%` : "—"}</strong><small><T ko="종목 표시 통화 기준" en="Based on listing currency" /></small></div>
        </div>
      </section>
      {summary && summary.rows.length > 0 ? <section className={styles.holdings}>
        <div className={styles.sectionTitle}><h2 id="first-portfolio-composition"><T ko="내 포트폴리오 구성" en="What you own" /></h2><Link href={href("/portfolio/holdings")}><T ko="보유종목 관리" en="Manage holdings" /><ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        {summary.state === "complete" ? <div className={styles.allocation} role="img" aria-labelledby="first-portfolio-composition">{summary.rows.map((row, index) => <span key={row.key} title={`${row.name} ${row.weightPct?.toFixed(1)}%`} style={{ width: `${row.weightPct}%`, background: `var(--first-allocation-${index % 4})` }} />)}</div> : null}
        <div className={styles.holdingRows}>{summary.rows.slice(0, 5).map((row) => <div key={row.key}><span><b>{row.name}</b><small>{row.ticker}</small></span><strong>{row.weightPct === null ? money(row.valueKrw) : `${row.weightPct.toFixed(1)}%`}</strong></div>)}</div>
        {summary.rows.length > 5 ? <Link className={styles.more} href={href("/portfolio/holdings")}><T ko={`전체 ${summary.rows.length}종목 보기`} en={`View all ${summary.rows.length} holdings`} /><ArrowUpRight size={14} aria-hidden="true" /></Link> : null}
      </section> : null}
      <section className={styles.next}>
        <div className={styles.sectionTitle}><h2><T ko="이제 무엇을 볼까요?" en="What would you like to explore?" /></h2></div>
        <div className={styles.nextRows}>
          <Link href={href("/")}><ChartNoAxesCombined size={21} aria-hidden="true" /><span><b><T ko="홈에서 종목 가격 등락 보기" en="See price moves on your dashboard" /></b><small><T ko="현재 시세와 직전 종가가 준비되면 개인 기록 없이도 종목별 등락을 확인할 수 있어요." en="See each holding's price change when current quotes and prior closes are ready, without waiting for personal snapshots." /></small></span><ArrowUpRight size={19} aria-hidden="true" /></Link>
          <Link href={href("/simulation")}><ChartNoAxesCombined size={21} aria-hidden="true" /><span><b><T ko="지금 구성의 가능한 미래" en="Possible paths for this portfolio" /></b><small><T ko="개인 기록을 기다리지 않고 시장의 가격 이력으로 계산" en="Uses market price history, without waiting for your personal record" /></small></span><ArrowUpRight size={19} aria-hidden="true" /></Link>
          <Link href={replayHref}><ChartNoAxesCombined size={21} aria-hidden="true" /><span><b><T ko="지금 구성으로 과거 시장을 지나가면" en="Take today's mix through past markets" /></b><small><T ko="투자 랩 구성 분석의 과거 시장 비교 · 나의 실제 과거 수익률과는 구분된 가정 실험" en="Past-market replay in Lab composition analysis · A hypothetical experiment, separate from your actual past returns" /></small></span><ArrowUpRight size={19} aria-hidden="true" /></Link>
          <div><Clock3 size={21} aria-hidden="true" /><span><b><T ko="나의 실제 기록은 오늘부터" en="Your actual record starts today" /></b><small><T ko="과거 보유 내역을 추측해 채우지 않습니다. 이후 저장된 평가액과 거래 기록으로 실제 성과를 구분합니다." en="We do not invent past holdings. Saved valuations and transactions will build your actual performance record." /></small></span></div>
        </div>
      </section>
      <section className={styles.readiness}>
        <div className={styles.sectionTitle}><h2><T ko="시장 자료 준비 상태" en="Market data readiness" /></h2>{readiness.state === "ready" && entries.length > 0 ? <span><Check size={15} aria-hidden="true" />{preparedCount}/{entries.length}</span> : null}</div>
        <p><T ko="아래 일수는 가입 후 기록한 기간이 아니라 시장에서 가져온 가격 기록 수입니다. 종목별 자료가 준비되어도 공통 날짜와 환율이 부족하면 일부 분석은 제한될 수 있어요." en="These counts refer to market price records, not days since you joined. Even with individual histories ready, analysis can be limited by shared dates or exchange-rate coverage." /></p>
        {readiness.state !== "ready" ? <p className={styles.warning}><T ko="시장 자료 상태를 확인하지 못했습니다. 현재 구성은 계속 살펴볼 수 있어요." en="Market data readiness could not be checked. You can still explore your current composition." /></p> : null}
        {unprepared.length > 0 ? <div className={styles.preparation}>{unprepared.map((entry) => <div key={entry.holdingId}><b>{entry.name}</b>{designPreview ? <small><T ko={`${entry.readiness.observationCount}개 가격 기록 · 예시에서는 조회하지 않습니다.`} en={`${entry.readiness.observationCount} price records · Preparation is disabled in this example.`} /></small> : <HoldingAnalysisDataForm holdingId={entry.holdingId} readiness={entry.readiness} />}</div>)}</div> : readiness.state === "ready" && entries.length > 0 ? <p className={styles.ready}><Check size={17} aria-hidden="true" /><T ko="등록한 종목의 가격 이력이 준비되어 있습니다." en="Historical prices are available for your registered holdings." /></p> : null}
      </section>
      <footer className={styles.footer}><Link className={styles.primary} href={href("/")}><T ko="내 홈으로 이동" en="Go to my dashboard" /><ArrowUpRight size={18} aria-hidden="true" /></Link><Link href={href("/portfolio/holdings/new")}><T ko="종목 더 추가하기" en="Add another holding" /></Link></footer>
    </>}
  </div>;
}
