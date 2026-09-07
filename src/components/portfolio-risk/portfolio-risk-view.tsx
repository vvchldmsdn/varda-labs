import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";
import { PortfolioRiskControls } from "./portfolio-risk-controls";
import { RiskDataHealth } from "./portfolio-risk-data-health";
import { RiskInstrumentTable } from "./portfolio-risk-instrument-table";
import { RiskCorrelationSections } from "./portfolio-risk-matrices";
import { RiskCorrelationMatrix } from "./risk-correlation-matrix";
import { RiskAnalysisBasis, RiskCalculationNotice, RiskPortfolioSummary, RiskStandaloneSummary } from "./portfolio-risk-summary";
import { calculationStatusLabel, formatRiskMetric, formatRiskRatioPercent, metricReasonLabel } from "./portfolio-risk-format";
import styles from "./risk-stage.module.css";

export function PortfolioRiskView({model,scopes,selectedScope,isDesignPreview=false}:{
  model:PortfolioRiskReadModel;
  scopes:readonly PortfolioAnalysisScope[];
  selectedScope:PortfolioAnalysisScope;
  isDesignPreview?:boolean;
}) {
  const portfolio=model.calculation.portfolio;
  const featured=model.calculation.instruments.map((instrument,index)=>({instrument,index})).toSorted((a,b)=>(b.instrument.weight??0)-(a.instrument.weight??0)||a.index-b.index).slice(0,10);
  const featuredMatrix=featured.map(({index})=>featured.map(({index:column})=>portfolio?.correlationMatrix[index]?.[column]??null));
  return <main data-page="portfolio-risk" className="varda-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]">
    <PortfolioPrimaryNavigation activePath="/portfolio/structure" generatedAt={new Date().toISOString()} selectedScopeKey={selectedScope.key}/>
    <div className={`varda-content varda-stage-content ${styles.page}`}>
      <header className={styles.header}><div className={styles.title}><h1>위험과 분산.</h1>{isDesignPreview?<span className={styles.previewNote} title="실제 보유자산과 연결되지 않은 90일 분석 미리보기입니다.">예시 데이터</span>:null}</div><div className={styles.controls}><PortfolioRiskControls scopes={scopes} selectedScope={selectedScope} selection={model.selection} isDesignPreview={isDesignPreview}/></div><Link className={styles.headerLink} href={`/portfolio/structure?scope=${encodeURIComponent(selectedScope.key)}${isDesignPreview?"&preview=design":""}`}><ArrowLeft size={13} aria-hidden="true"/>포트 구조</Link></header>
      <div className={styles.statusLine}><strong>{calculationStatusLabel(model.calculation.calculationStatus)}</strong><span>관측 {model.provenance.usableReturnObservations}/{model.provenance.requestedReturnObservations}일</span><span>분석 종목 {model.provenance.includedInstrumentCount}개</span></div>
      <div className={styles.notice}><RiskCalculationNotice model={model}/></div>
      {portfolio?<div className={styles.riskStage}>
        <section className={styles.matrix} aria-label="보유 종목 상관관계"><div className={styles.matrixHeading}><h2>상관관계 행렬</h2><p>{featured.length<model.calculation.instruments.length?`비중 상위 ${featured.length} / 전체 ${model.calculation.instruments.length}종목`:`전체 ${featured.length}종목`} · KRW 환산</p></div><RiskCorrelationMatrix compact instruments={featured.map(row=>row.instrument)} matrix={featuredMatrix}/></section>
        <dl className={styles.coreSummary}><div className={styles.coreMetric}><dt>연환산 변동성</dt><dd>{formatRiskRatioPercent(portfolio.volatilityAnnualized)}<small>관측 {portfolio.observationCount}일 기준</small></dd></div><div className={styles.coreMetric}><dt>유효 분산 수 ENB</dt><dd>{formatRiskMetric(portfolio.riskContributionEnb)}<small>{metricReasonLabel(portfolio.riskContributionEnb.reason)??"절대 위험 기여도 기준"}</small></dd></div><div className={styles.coreMetric}><dt>Sharpe</dt><dd>{formatRiskMetric(portfolio.sharpe)}<small>{metricReasonLabel(portfolio.sharpe.reason)??"무위험 수익률 0% 가정"}</small></dd></div></dl>
      </div>:<section className={styles.emptyStage}><h2>{model.calculation.calculationStatus==="standalone_only"?"한 종목의 위험을 확인합니다.":"상관관계를 계산할 근거가 부족합니다."}</h2><p>관측 {model.provenance.usableReturnObservations}/{model.provenance.requestedReturnObservations}일 · 분석 가능한 종목 {model.provenance.includedInstrumentCount}개</p><RiskStandaloneSummary model={model}/></section>}
      <footer className={styles.footer}><span>KRW 환산 · {model.provenance.firstServiceDate??"근거 없음"} — {model.provenance.lastServiceDate??"근거 없음"}</span><div className={styles.launchers}>
        {portfolio?<PresentationDialog label="전체 상관계수" title="전체 종목과 하락일 상관관계" wide><RiskCorrelationSections instruments={model.calculation.instruments} portfolio={portfolio}/></PresentationDialog>:null}
        <PresentationDialog label="위험 수치·기여" title="위험 요약과 종목별 기여" wide><RiskPortfolioSummary model={model}/><RiskStandaloneSummary model={model}/><div className={styles.modalSection}><RiskInstrumentTable model={model}/></div></PresentationDialog>
        <PresentationDialog label="계산·데이터 근거" title="분석 기준과 데이터 근거" wide><RiskAnalysisBasis model={model} scopeLabel={selectedScope.label}/><div className={styles.modalSection}><RiskDataHealth model={model}/></div></PresentationDialog>
      </div></footer>
    </div>
  </main>;
}
