"use client";
import { Button as CairnButton, Field as CairnField, Select as CairnNativeSelect, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import {useLayoutEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {BetaShell} from './beta-shell';
import {useBetaContext} from './use-beta-context';
import {useBetaReadFreshness} from './beta-provider';
import {analysisKey,blankAnalysis,type AnalysisRead} from '@/lib/cairn-v2/analysis-contract';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import styles from './analysis.module.css';
import {preciseNumber as number} from './reused/display-format';
import {RiskCorrelationMatrix} from './reused/risk-correlation-matrix';
import {CairnSelect} from './reused/cairn-select';

const percent=(value:number|null|undefined)=>value==null?'—':number(value*100)+'%';
const instrumentName=(row:{ticker:string;names:readonly string[]})=>row.names.filter(name=>name.trim()).join(' / ')||row.ticker;

export function BetaAnalysis({read}:{read:AnalysisRead}) {
 const [context,setContext]=useBetaContext(read.context),freshness=useBetaReadFreshness(),router=useRouter();
 const observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch);},[read.readReceipt,read.readEpoch,observed,epoch]);
 const visible=analysisKey(context)!==analysisKey(read.context)||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankAnalysis(context,'loading','사용자·분석 조건을 다시 확인하는 중'):read;
 const shell=blankDomainView(visible.state,visible.message);shell.domain!.scopes=visible.scopes;
 const [down,setDown]=useState(false),[selected,setSelected]=useState('');
 const model=visible.risk,c=model?.calculation,p=c?.portfolio;
 const matrix=down?p?.stress.correlationMatrix:p?.correlationMatrix;
 const active=c?.instruments.find(r=>r.instrumentKey===selected)??c?.instruments[0];
 const direct=visible.direct,m=direct?.metrics;

 return <BetaShell context={context} setContext={setContext} readView={shell} workspace="analysis" originalPath={context.analysis==='holdings'?'/portfolio/structure':'/portfolio/risk'}>
 <section className={styles.workspace} data-analysis-state={visible.state} data-analysis-kind={context.analysis??'risk'}>
  <nav className={styles.mobileNav} aria-label="분석 작업 화면"><CairnButton variant="selection" aria-pressed={context.analysis!=='holdings'} onClick={()=>setContext({...context,analysis:'risk'})}>위험·분산</CairnButton><CairnButton variant="selection" aria-pressed={context.analysis==='holdings'} onClick={()=>setContext({...context,analysis:'holdings'})}>집중·통화</CairnButton></nav>
  <DetailHeader title={context.analysis==='holdings'?'집중도와 통화 노출':'위험과 분산'} description={context.analysis==='holdings'?'직접 보유 기준 · ETF 내부 기업 노출 미포함':'현재 보유 비중으로 살펴보는 과거 위험 · 미래 수익 예측 아님'} />
  <div className={styles.readState} data-read-state={visible.state}><CairnStatus as="p" role="status">{visible.message}{context.currency==='USD'?' · 표시 통화 USD와 별개로 분석 기준 KRW':''}</CairnStatus>{visible.state==='unavailable'&&<CairnButton variant="secondary" type="button" onClick={()=>router.refresh()}>분석 다시 조회</CairnButton>}</div>
  {context.analysis!=='holdings'&&<div className={styles.toolbar}><div role="group" aria-label="상관 관측 기준"><CairnButton variant="selection" type="button" aria-pressed={!down} onClick={()=>setDown(false)}>전체 관측일</CairnButton><CairnButton variant="selection" type="button" aria-pressed={down} onClick={()=>setDown(true)}>하락일</CairnButton></div><CairnField>분석 기간<CairnNativeSelect aria-label="분석 관측 수" value={typeof context.window==='string'?context.window:'90'} onChange={e=>setContext({...context,window:e.target.value})}>{[30,90,252].map(w=><option key={w} value={w}>{w}개 관측</option>)}</CairnNativeSelect></CairnField></div>}
  {model&&<>
   <dl className={styles.basis} aria-label="위험 분석 기준"><div><dt>관측 기간</dt><dd>{model.provenance.firstServiceDate??'—'} ~ {model.provenance.lastServiceDate??'—'}</dd></div><div><dt>유효 공동 관측</dt><dd>{model.provenance.usableReturnObservations}/{model.provenance.requestedReturnObservations}</dd></div><div><dt>포함 범위</dt><dd>종목 {model.provenance.includedInstrumentCount} · 제외 보유 {model.provenance.excludedHoldingCount}</dd></div><div><dt>분석 통화</dt><dd>KRW</dd></div></dl>
   <section className={styles.correlation} aria-label="상관관계">
    {matrix?<><div className={styles.sectionHeading}><CairnSectionTitle level="h3">{down?'하락일':'전체 관측일'} 상관</CairnSectionTitle><p>{down?p?.stress.downDayObservations:c?.observationCount}개 관측 · 상관의 부호는 수익·손실이 아닙니다</p></div><RiskCorrelationMatrix key={visible.readReceipt+':'+down} instruments={c?.instruments??[]} matrix={matrix}/></>:<div className={styles.noMatrix} role="note"><CairnSectionTitle level="h3">{down?'하락일 상관을 계산할 수 없습니다':'공동 상관을 계산할 수 없습니다'}</CairnSectionTitle><p>{down?'하락일 관측 부족 · 최소 '+(p?.stress.minimumObservations??'—')+'개 필요':'선택 범위의 종목·관측 자료가 계산 조건을 충족하는지 확인해 주세요.'}</p><p>상단의 조회 범위·분석 기간을 바꾸거나 아래 관측·제외 근거를 확인할 수 있습니다.</p></div>}
   </section>
   {p&&<dl className={styles.summary} aria-label="위험 핵심 지표"><div><dt>연환산 변동성</dt><dd>{percent(p.volatilityAnnualized)}</dd></div><div><dt>위험 기여 ENB</dt><dd>{number(p.riskContributionEnb.value)}</dd></div><div><dt>Sharpe · 무위험금리 0% 가정</dt><dd>{number(p.sharpe.value)}</dd><small>{p.sharpe.reason?'계산 제한 · 상세 근거 확인':'시장 무위험금리 자료 사용 아님'}</small></div><div><dt>분산 효과</dt><dd title={p.diversificationBenefitPct.value==null?undefined:String(p.diversificationBenefitPct.value)+"% · 원본 정밀도"}>{p.diversificationBenefitPct.value==null?'—':number(p.diversificationBenefitPct.value)+'%'}</dd></div></dl>}
   {active&&<section className={styles.evidence} aria-label="선택 종목 기여 근거"><div className={styles.selectionHeading}><div><CairnSectionTitle level="h3">{instrumentName(active)}</CairnSectionTitle><p>{active.ticker} · {active.market} · {active.currency} · {active.accounts.join(' / ')}</p></div><CairnSelect label="기여 근거 종목 선택" value={active.instrumentKey} options={(c?.instruments??[]).map(row=>({value:row.instrumentKey,label:instrumentName(row)+" · "+row.ticker+" · "+row.accounts.join(' / ')}))} onValueChange={setSelected}/></div><p className={styles.selectionNote}>이 종목의 위험 기여 근거입니다. 위 행렬에서 선택한 두 종목의 상관과는 별개입니다.</p><dl className={styles.inlineMetrics}><div><dt>현재 분석 비중</dt><dd>{percent(active.weight)}</dd></div><div><dt>연환산 변동성</dt><dd>{percent(active.volatilityAnnualized)}</dd></div><div><dt>부호 있는 위험 기여</dt><dd>{active.signedRiskContributionPct==null?'—':number(active.signedRiskContributionPct)+'%'}</dd></div><div><dt>절대 위험 비중</dt><dd>{active.absoluteRiskSharePct==null?'—':number(active.absoluteRiskSharePct)+'%'}</dd></div></dl><p>{active.riskContributionReason??'기존 엔진의 부호·분모 유지'}</p></section>}
   <details className={styles.evidence}><summary>관측 정렬·제외·계산 근거</summary><p>단순 KRW 수익률 · 날짜별 FX · 표본 공분산 · 연환산 {model.provenance.annualizationFactor} · 무위험금리 {percent(model.provenance.annualRiskFreeRate)} 가정</p><p>가격 이월 최대 {model.provenance.maxPriceCarryDaysPolicy}일 · FX 이월 최대 {model.provenance.maxFxCarryDaysPolicy}일 · 가중치 기준일 {model.provenance.weightAsOfServiceDate??'—'}</p><p>선택 보유 {model.provenance.selectedHoldingCount} · 포함 종목 {model.provenance.includedInstrumentCount} · 제외 {model.provenance.excludedHoldingCount}</p><p>조정가격 admission과 서비스 날짜 정렬은 기존 모델 기준입니다. 벤치마크·베타는 미연결입니다.</p><pre>{JSON.stringify({status:model.inputHealth.status,blockers:model.inputHealth.blockers,exclusions:model.inputHealth.exclusions,missingEvidence:model.inputHealth.missingEvidence,zeroVariance:model.inputHealth.zeroVarianceInstruments,sourceRows:model.inputHealth.sourceRows,metricEvidence:p?{sharpe:p.sharpe,riskContributionEnb:p.riskContributionEnb,diversificationBenefitPct:p.diversificationBenefitPct}:null},null,2)}</pre></details>
  </>}
  {direct&&<>
   <dl className={styles.basis} aria-label="직접 보유 분석 기준"><div><dt>기준일</dt><dd>{visible.serviceDate??'—'}</dd></div><div><dt>{direct.status==='partial'?'확인 평가 소계':'분석 평가 합계'}</dt><dd>{number(m?.totalValueKrw,0)} KRW</dd></div><div><dt>확인 범위</dt><dd>입력 {direct.inputHoldingCount} · 확인 {direct.resolvedInputHoldingCount} · 제외 {direct.excludedHoldingCount}</dd></div></dl>
   <p className={styles.scopeNote}>{direct.status==='partial'?'확인 소계 기준 · 전체 비중 아님':'직접 보유 종목 기준'} · KRW 평가 비중</p>
   <div className={styles.exposureLayout}><section aria-label="통화 노출"><CairnSectionTitle level="h3">통화 노출</CairnSectionTitle>{m?m.currencyExposures.map(row=><div className={styles.exposure} key={row.currency}><p><strong>{row.currency}</strong><span>{number(row.currentWeightPct)}%</span></p><div role="img" aria-label={row.currency+' '+number(row.currentWeightPct)+'%'}><span style={{width:row.currentWeightPct+'%'}} /></div></div>):<p className={styles.noExposure}>통화 비중을 계산할 수 있는 평가 근거가 없습니다.</p>}<p>{direct.directHoldingCount}개 직접 보유 종목 · 환율 충격 계산 미연결</p></section><section className={styles.selected}><p className={styles.eyebrow}>가장 큰 직접 보유</p><CairnSectionTitle level="h3">{direct.largestHolding?.name||direct.largestHolding?.ticker||'확인 근거 없음'}</CairnSectionTitle>{direct.largestHolding&&<p>{direct.largestHolding.ticker} · {direct.largestHolding.market} · {direct.largestHolding.currency}</p>}<p className={styles.largestWeight}>{m?number(m.largestHoldingWeightPct)+'%':'—'}</p><p>현재 분석 범위의 평가 비중</p></section></div>
   <dl className={styles.directSummary} aria-label="직접 보유 핵심 지표"><div><dt>최대 보유 비중</dt><dd>{m?number(m.largestHoldingWeightPct)+'%':'—'}</dd></div><div><dt>상위 3종목 합계</dt><dd>{m?number(m.topThreeWeightPct)+'%':'—'}</dd></div><div><dt>직접 보유 유효 종목 수</dt><dd>{number(m?.effectiveHoldingCount)}</dd></div><div><dt>HHI</dt><dd>{number(m?.hhiPoints)}</dd></div></dl>
   <details className={styles.evidence}><summary>범위와 제외 기준 확인</summary><p>입력 {direct.inputHoldingCount} · 확인 {direct.resolvedInputHoldingCount} · 제외 {direct.excludedHoldingCount} · 식별 불가 {direct.unresolvedIdentityCount} · 금액 불가 {direct.invalidValueCount}</p><p>계좌 범위는 account/market/currency/ticker, 전체 범위는 기존 모델의 market/currency/ticker 병합 규칙을 유지합니다. 직접 보유 집중도이며 ETF look-through가 아닙니다.</p><pre>{JSON.stringify(visible.exclusions,null,2)}</pre></details>
  </>}
 </section></BetaShell>;
}
