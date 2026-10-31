'use client';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import Link from 'next/link';
import { ActionGroup, ActionContent } from '@/components/cairn-ui';
import { betaHref, betaReadHref } from '@/lib/cairn-v2/navigation';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness,useBetaExistingCrudAvailable} from './beta-provider';
import {InvestmentLabComparisonChart} from '@/components/investment-lab/investment-lab-comparison-chart';
import {ObservedHistoryChart} from './reused/lab-observed-chart';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {blankLab,labContext,labHref,labKey,labNumber,labParams,labVisible,type LabParams,type LabRead} from '@/lib/cairn-v2/lab-contract';
import {labPeriodReason,labBlockerLabel,labFundingLabel,labChartPalette} from './lab-presentation';
import styles from './lab.module.css';
export function BetaLab({read}:{read:LabRead}){
 const crudAvailable=useBetaExistingCrudAvailable();
 const router=useRouter(),search=useSearchParams(),freshness=useBetaReadFreshness(),p=labParams(new URLSearchParams(search.toString())),context=labContext(p),key=labKey(p);
 const [pending,startTransition]=useTransition(),[draft,setDraft]=useState<{key:string;start:string;end:string}|null>(null);
 const observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[observed,epoch,read.readReceipt,read.readEpoch]);
 const values=draft?.key===key?draft:{key,start:typeof p.start==='string'?p.start:'',end:typeof p.end==='string'?p.end:''};
 const dirty=values.start!==(typeof p.start==='string'?p.start:'')||values.end!==(typeof p.end==='string'?p.end:'');
 const visible=labVisible(read,key,pending,!!freshness?.store.blocked(read.readReceipt,read.readEpoch))?read:blankLab(p,'loading','현재 사용자·범위·기간을 확인하는 중');
 const model=dirty?null:visible.model,c=model?.comparison,ready=!!model&&['full','current_writer','selected'].includes(model.period.status)&&c?.status==='ready';
 const nav=(next:LabParams)=>startTransition(()=>router.push(labHref(context,next,freshness?.store.pendingEpoch()),{scroll:false}));
 const shell=blankDomainView(visible.state==='unauthorized'?'unauthorized':visible.state==='loading'?'loading':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 const scopeLabel=visible.scopes.find(s=>s.key===context.scope)?.label??'현재 조회 범위';
 return <BetaShell workspace="lab" context={context} setContext={next=>startTransition(()=>router.push(labHref(next,{...p,run:undefined},freshness?.store.pendingEpoch()),{scroll:false}))} readView={shell} originalPath="/investment-lab">
 <section className={styles.workspace} id="lab-comparison" data-lab-state={dirty?'dirty':visible.state}>
  <header className={styles.heading}><h2>다른 종목에 투자했다면?</h2><p>같은 기간 · 같은 매매 금액 · KRW</p></header>
  <CairnForm className={styles.conditions} onSubmit={e=>{e.preventDefault();nav({...p,start:values.start||undefined,end:values.end||undefined,run:'1'})}}>
   <CairnField>시작일<CairnInput aria-label="과거 비교 시작일" type="date" value={values.start} onChange={e=>setDraft({...values,start:e.target.value})}/></CairnField>
   <CairnField>종료일<CairnInput aria-label="과거 비교 종료일" type="date" value={values.end} onChange={e=>setDraft({...values,end:e.target.value})}/></CairnField>
   <CairnButton variant="primary" className={styles.primary} type="submit" disabled={pending}>{pending?'비교 확인 중…':'과거 비교 실행'}</CairnButton>
   <CairnButton variant="secondary" type="button" disabled={pending} onClick={()=>{setDraft(null);nav({...p,start:undefined,end:undefined,run:undefined})}}>기본 기간 선택</CairnButton>
  </CairnForm>
  {(dirty||visible.state!=="ready")&&<CairnStatus as="p" role="status" className={styles.status}>{dirty?'새 기간으로 비교해 주세요.':visible.message}</CairnStatus>}
  <p className={styles.note}>날짜를 비우면 비교 가능한 기본 기간을 사용해요. 분석 기준은 KRW입니다.</p>
  {crudAvailable&&!dirty&&visible.state!=='loading'&&visible.state!=='idle'&&!ready&&<RecoveryNotice beta scope={context.scope} reasons={c?.blockers} kind={!model?'retry':undefined} draft={{start:values.start,end:values.end}} />}
  {model&&<>
   <details className={styles.evidence}><summary>비교 기간과 포함 범위</summary><dl className={styles.context}>
    <div><dt>요청 기간</dt><dd className={styles.dateRange}><span>{model.period.requestedStartServiceDate??'기본'}</span> ~ <span>{model.period.requestedEndServiceDate??'기본'}</span></dd></div>
    <div><dt>허용 기간</dt><dd className={styles.dateRange}><span>{model.period.selectedStartServiceDate??(ready?c?.summary?.startServiceDate:null)??'—'}</span> ~ <span>{model.period.selectedEndServiceDate??(ready?c?.summary?.endServiceDate:null)??'—'}</span></dd></div>
    <div><dt>포함 범위</dt><dd>{scopeLabel} · {model.scopeEvidence.includedAccountCodes.length}계좌</dd></div>
    <div><dt>관측 기록</dt><dd>{model.observedHistory.coverage.admittedDateCount}일 · 제외 {model.observedHistory.coverage.skippedDateCount}일</dd></div>
   </dl></details>
   {(model.observedHistory.status!=='ready'||!ready)&&<div className={styles.caution} role="note"><strong>일부 기록은 비교할 수 없어요</strong><p>확인된 구간만 표시합니다.</p>{model.period.reason&&<p>{labPeriodReason(model.period.reason)}</p>}{!!c?.blockers.length&&<ul>{c.blockers.map(b=><li key={b}>{labBlockerLabel(b)}</li>)}</ul>}</div>}
   {ready&&c?.summary&&<dl className={styles.summary}><div data-series="actual"><dt>실제 기말 평가 · KRW</dt><dd>{labNumber(c.summary.actualEndValueKrw)}</dd></div><div data-series="scenario"><dt>KODEX 200 가상 경로 · KRW</dt><dd>{labNumber(c.summary.scenarioEndValueKrw)}</dd></div><div><dt>가상 − 실제 차액 · KRW</dt><dd>{labNumber(c.summary.endDifferenceKrw)}</dd></div></dl>}
   {ready&&c?.rows.length?<div className={styles.chart} tabIndex={0} role="region" aria-label="KRW 과거 비교 차트 가로 탐색"><InvestmentLabComparisonChart chartId="beta-lab" rows={c.rows} title="실제 평가와 KODEX 200 과거 비교" description="동일 거래금액 기반 KRW 경로. 시세 관측 순서와 원본 지연 체결 표시를 보존합니다." scenarioLabel="KODEX 200 · 가상 과거 경로" palette={labChartPalette}/></div>:model.observedHistory.segments.length>0?<div className={styles.chart} tabIndex={0} role="region" aria-label="분절된 저장 관측 이력"><ObservedHistoryChart segments={model.observedHistory.segments}/></div>:<p className={styles.empty}>비교할 평가 기록이 아직 없어요.</p>}

   <dl className={styles.funding}><div><dt>실제 자금 근거</dt><dd>{labFundingLabel(model.funding.actual.status)}</dd></div><div><dt>KODEX 200 자금 근거</dt><dd>{labFundingLabel(model.funding.kodex200.status)}</dd></div></dl>
   <p className={styles.note}>가격 기준 {c?.scenario.priceBasis==='kis_raw_close'?'KIS 원종가 · 총수익 아님':c?.scenario.priceBasis==='provider_adjusted_close'?'제공자 조정종가 · 배당·비용 별도 미관측':'근거 없음'} · 현금 제외 투자경로 · 수수료·세금·주문 실행 가능성 미평가.</p>
   {!!c&&(c.coverage.pendingAtEndRows>0||c.coverage.delayedExecutionRows>0)&&<p className={styles.caution}>지연 실행 {c.coverage.delayedExecutionRows}건 · 기간 말 보류 {c.coverage.pendingAtEndRows}건 · 비교일과 가격 관측일은 근거 표에서 구분합니다.</p>}
   <details className={styles.evidence}><summary>관측·가격·자금 근거</summary>
    <p>포함 계좌 코드 {model.scopeEvidence.includedAccountCodes.join(', ')||'없음'} · 원본 계산 축 {model.scopeEvidence.engineAccount}</p>
    <p>관측 상태 {model.observedHistory.status} · 원본 비교 상태 {c?.status} · 기간 상태 {model.period.status} · 제외 조정 {model.fount.status}</p>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="비교일별 근거 표"><table><thead><tr><th>비교일</th><th>가격 관측일</th><th>실제 KRW</th><th>가상 KRW</th><th>차액 KRW</th><th>가격 유지 일수</th><th>체결 대기</th></tr></thead><tbody>{(ready?c?.rows:[])?.map(r=><tr key={r.serviceDate}><td>{r.serviceDate}</td><td>{r.valuationPriceDate}</td><td>{labNumber(r.actualMarketValueKrw)}</td><td>{labNumber(r.scenarioMarketValueKrw)}</td><td>{labNumber(r.differenceKrw)}</td><td>{r.valuationCarryDays}</td><td>{r.hasPendingExecution?'있음':'없음'}</td></tr>)}</tbody></table></div>
    <p>수익률은 차액과 다릅니다. 원본 추정 수익률 상태 {c?.returns?.status??'근거 없음'} · 계산 단위 비율(1 = 100%): 실제 {labNumber(ready?c?.returns?.actualReturn:null)}, 가상 {labNumber(ready?c?.returns?.scenarioReturn:null)}.</p>
    <details><summary>원본 상태·출처 상세</summary><pre>{JSON.stringify({scopeEvidence:model.scopeEvidence,period:model.period,scenario:c?.scenario,coverage:c?.coverage,source:c?.sourceAuthority,blockers:c?.blockers,observed:model.observedHistory,funding:model.funding,fount:model.fount,returns:c?.returns},null,2)}</pre></details>
   </details>
  </>}
  <ActionGroup label="다른 관점으로 살펴보기"><Link href={betaReadHref(betaHref("/beta/simulation",context),freshness?.store.pendingEpoch())}><ActionContent title="여러 시장 경로도 살펴볼까요?" description="현재 구성의 가상 시뮬레이션" /></Link></ActionGroup>
 </section></BetaShell>;
}
