'use client';
import { DraftPreservationNotice } from '@/components/recovery/draft-preservation-notice';
import { useNavigationDraft } from '@/components/recovery/use-navigation-draft';
import { readLabPeriodDraft, type LabPeriodDraft } from '@/lib/lab-period-draft';
import { HoldingAnalysisRecovery } from '@/components/holding-analysis-recovery';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { useI18n } from '@/components/i18n/locale-provider';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import Link from 'next/link';
import { ActionGroup, ActionContent } from '@/components/cairn-ui';
import { betaHref, betaReadHref } from '@/lib/cairn-v2/navigation';
import {useLayoutEffect,useTransition} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness,useBetaExistingCrudAvailable} from './beta-provider';
import {InvestmentLabComparisonChart} from '@/components/investment-lab/investment-lab-comparison-chart';
import {ObservedHistoryChart} from './reused/lab-observed-chart';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {blankLab,labContext,labHref,labKey,labNumber,labParams,labVisible,type LabParams,type LabRead,type LabModel} from '@/lib/cairn-v2/lab-contract';
import {labPeriodReason,labBlockerLabel,labFundingLabel,labChartPalette} from './lab-presentation';
import styles from './lab.module.css';
export function BetaLab({read}:{read:LabRead}){
 const crudAvailable=useBetaExistingCrudAvailable();
 const router=useRouter(),search=useSearchParams(),freshness=useBetaReadFreshness(),p=labParams(new URLSearchParams(search.toString())),context=labContext(p),key=labKey(p);
 const [pending,startTransition]=useTransition();
 const initial:LabPeriodDraft={version:1,scope:context.scope,currency:context.currency,baseStart:typeof p.start==='string'?p.start:'',baseEnd:typeof p.end==='string'?p.end:'',start:typeof p.start==='string'?p.start:'',end:typeof p.end==='string'?p.end:''};
 const [values,setDraft,draftNotPreserved]=useNavigationDraft({initial,path:'/beta/investment-lab',scope:context.scope,read:query=>readLabPeriodDraft(query.getAll('_labDraft'),initial),write:value=>({_labDraft:JSON.stringify(value)})});
 const observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[observed,epoch,read.readReceipt,read.readEpoch]);
 const dirty=values.start!==(typeof p.start==='string'?p.start:'')||values.end!==(typeof p.end==='string'?p.end:'');
 const visible=labVisible(read,key,pending,!!freshness?.store.blocked(read.readReceipt,read.readEpoch))?read:blankLab(p,'loading','현재 사용자·범위·기간을 확인하는 중');
 const model=dirty?null:visible.model,c=model?.comparison,ready=!!model&&['full','current_writer','selected'].includes(model.period.status)&&c?.status==='ready';
 const nav=(next:LabParams)=>startTransition(()=>router.push(labHref(context,next,freshness?.store.pendingEpoch()),{scroll:false}));
 const shell=blankDomainView(visible.state==='unauthorized'?'unauthorized':visible.state==='loading'?'loading':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 const scopeLabel=visible.scopes.find(s=>s.key===context.scope)?.label??'현재 조회 범위';
 return <BetaShell workspace="lab" context={context} setContext={next=>startTransition(()=>router.push(labHref(next,{...p,run:undefined},freshness?.store.pendingEpoch()),{scroll:false}))} readView={shell} originalPath="/investment-lab">
 <section className={styles.workspace} id="lab-comparison" data-lab-state={dirty?'dirty':visible.state}>
  <header className={styles.heading}><h2>다른 종목에 투자했다면?</h2><p>같은 기간 · 같은 매매 금액 · KRW</p></header>
  <DraftPreservationNotice visible={draftNotPreserved} /><details className={styles.period} open={!ready || undefined}><summary>비교 기간 변경</summary><CairnForm className={styles.conditions} onSubmit={e=>{e.preventDefault();nav({...p,start:values.start||undefined,end:values.end||undefined,run:'1'})}}>
   <CairnField>시작일<CairnInput aria-label="과거 비교 시작일" type="date" value={values.start} onChange={e=>setDraft({...values,start:e.target.value})}/></CairnField>
   <CairnField>종료일<CairnInput aria-label="과거 비교 종료일" type="date" value={values.end} onChange={e=>setDraft({...values,end:e.target.value})}/></CairnField>
   <CairnButton variant="primary" className={styles.primary} type="submit" disabled={pending}>{pending?'비교 확인 중…':'과거 비교 실행'}</CairnButton>
   <CairnButton variant="secondary" type="button" disabled={pending} onClick={()=>{nav({...p,start:undefined,end:undefined,run:undefined})}}>기본 기간 선택</CairnButton>
  </CairnForm>
  <p className={styles.note}>날짜를 비우면 비교 가능한 기본 기간을 사용해요.</p></details>
  {model?.defaultContext && <LabDefaultNote context={model.defaultContext} period={model.period} />}
  {(dirty||visible.state!=="ready")&&<CairnStatus as="p" role="status" className={styles.status}>{dirty?'새 기간으로 비교해 주세요.':visible.message}</CairnStatus>}

  {!!model?.tradeEvidence?.blocked.length && <LabTradeNotice evidence={model.tradeEvidence} onRun={({start,end})=>nav({...p,start,end,run:'1'})} />}
  {crudAvailable&&!dirty&&visible.state!=='loading'&&visible.state!=='idle'&&!ready&&!model?.tradeEvidence?.blocked.length&&<RecoveryNotice source="current" beta scope={context.scope} reasons={c?.blockers} kind={!model?'retry':undefined} draft={{start:values.start,end:values.end}} />}
  {crudAvailable && !ready && visible === read && !['loading','unauthorized','invalid'].includes(visible.state) && <HoldingAnalysisRecovery key={`${context.scope}:${read.readReceipt}:${read.readEpoch}`} scope={context.scope} />}
  {model&&<>
   {ready&&c?.rows.length?<div className={styles.chart} tabIndex={0} role="region" aria-label="KRW 과거 비교 차트 가로 탐색"><InvestmentLabComparisonChart chartId="beta-lab" rows={c.rows} title="실제 평가와 KODEX 200 과거 비교" description="동일 거래금액 기반 KRW 경로. 시세 관측 순서와 원본 지연 체결 표시를 보존합니다." scenarioLabel="KODEX 200 · 가상 과거 경로" palette={labChartPalette}/></div>:model.observedHistory.segments.length>0?<div className={`${styles.chart} ${styles.observedChart}`} tabIndex={0} role="region" aria-label="분절된 저장 관측 이력"><ObservedHistoryChart segments={model.observedHistory.segments}/></div>:<p className={styles.empty}>비교할 평가 기록이 아직 없어요.</p>}
   {ready&&c?.summary&&<dl className={styles.summary}><div data-series="actual"><dt>실제 기말 평가 · KRW</dt><dd>{labNumber(c.summary.actualEndValueKrw)}</dd></div><div data-series="scenario"><dt>KODEX 200 가상 경로 · KRW</dt><dd>{labNumber(c.summary.scenarioEndValueKrw)}</dd></div><div><dt>가상 − 실제 차액 · KRW</dt><dd>{labNumber(c.summary.endDifferenceKrw)}</dd></div></dl>}
   <details className={styles.evidence}><summary>비교 기간과 포함 범위</summary><dl className={styles.context}>
    <div><dt>요청 기간</dt><dd className={styles.dateRange}><span>{model.period.requestedStartServiceDate??'기본'}</span> ~ <span>{model.period.requestedEndServiceDate??'기본'}</span></dd></div>
    <div><dt>{model.tradeEvidence?.blocked.length?'검토 기간':'허용 기간'}</dt><dd className={styles.dateRange}><span>{model.period.selectedStartServiceDate??(ready?c?.summary?.startServiceDate:null)??'—'}</span> ~ <span>{model.period.selectedEndServiceDate??(ready?c?.summary?.endServiceDate:null)??'—'}</span></dd></div>
    <div><dt>포함 범위</dt><dd>{scopeLabel} · {model.scopeEvidence.includedAccountCodes.length}계좌</dd></div>
    <div><dt>관측 기록</dt><dd>{model.observedHistory.coverage.admittedDateCount}일 · 제외 {model.observedHistory.coverage.skippedDateCount}일</dd></div>
   </dl></details>
   {(model.observedHistory.status!=='ready'||!ready)&&<div className={styles.caution} role="note"><strong>일부 기록은 비교할 수 없어요</strong><p>확인된 구간만 표시합니다.</p>{model.period.reason&&<p>{labPeriodReason(model.period.reason)}</p>}{!!c?.blockers.length&&<ul>{c.blockers.map(b=><li key={b}>{labBlockerLabel(b)}</li>)}</ul>}</div>}

   {model.funding&&<dl className={styles.funding}><div><dt>실제 자금 근거</dt><dd>{labFundingLabel(model.funding.actual.status)}</dd></div><div><dt>KODEX 200 자금 근거</dt><dd>{labFundingLabel(model.funding.kodex200.status)}</dd></div></dl>}
   {!!model.tradeEvidence?.valued.historical_fx && <p className={styles.note}>거래 {model.tradeEvidence.valued.historical_fx}건은 당시 저장 환율로 환산했습니다. 원화 결제액은 별도로 확인해야 합니다.</p>}
   {!!model.tradeEvidence?.valued.reported_execution_krw && <p className={styles.note}>거래 {model.tradeEvidence.valued.reported_execution_krw}건은 기록된 원화 체결가 기준입니다. 결제액과 차이가 있을 수 있습니다.</p>}
   <p className={styles.note}>가격 기준 {c?.scenario.priceBasis==='kis_raw_close'?'KIS 원종가 · 총수익 아님':c?.scenario.priceBasis==='provider_adjusted_close'?'제공자 조정종가 · 배당·비용 별도 미관측':'근거 없음'} · 현금 제외 투자경로 · 수수료·세금·주문 실행 가능성 미평가.</p>
   {!!c&&(c.coverage.pendingAtEndRows>0||c.coverage.delayedExecutionRows>0)&&<p className={styles.caution}>지연 실행 {c.coverage.delayedExecutionRows}건 · 기간 말 보류 {c.coverage.pendingAtEndRows}건 · 비교일과 가격 관측일은 근거 표에서 구분합니다.</p>}
   <details className={styles.evidence}><summary>관측·가격·자금 근거</summary>
    {!!model.tradeEvidence?.valued.recorded_krw && <p>원화 거래금액이 기록된 매매 {model.tradeEvidence.valued.recorded_krw}건</p>}
    <p>포함 계좌 코드 {model.scopeEvidence.includedAccountCodes.join(', ')||'없음'} · 원본 계산 축 {model.scopeEvidence.engineAccount}</p>
    <p>관측 상태 {model.observedHistory.status} · {model.tradeEvidence?.blocked.length?'비교 상태':'원본 비교 상태'} {c?.status} · 기간 상태 {model.period.status} · 제외 조정 {model.fount.status}</p>
    <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="비교일별 근거 표"><table><thead><tr><th>비교일</th><th>가격 관측일</th><th>실제 KRW</th><th>가상 KRW</th><th>차액 KRW</th><th>가격 유지 일수</th><th>체결 대기</th></tr></thead><tbody>{(ready?c?.rows:[])?.map(r=><tr key={r.serviceDate}><td>{r.serviceDate}</td><td>{r.valuationPriceDate}</td><td>{labNumber(r.actualMarketValueKrw)}</td><td>{labNumber(r.scenarioMarketValueKrw)}</td><td>{labNumber(r.differenceKrw)}</td><td>{r.valuationCarryDays}</td><td>{r.hasPendingExecution?'있음':'없음'}</td></tr>)}</tbody></table></div>
    <p>수익률은 차액과 다릅니다. 원본 추정 수익률 상태 {c?.returns?.status??'근거 없음'} · 계산 단위 비율(1 = 100%): 실제 {labNumber(ready?c?.returns?.actualReturn:null)}, 가상 {labNumber(ready?c?.returns?.scenarioReturn:null)}.</p>
    <details><summary>{model.tradeEvidence?.blocked.length?'상태·출처 상세':'원본 상태·출처 상세'}</summary><pre>{JSON.stringify({scopeEvidence:model.scopeEvidence,period:model.period,scenario:c?.scenario,coverage:c?.coverage,source:c?.sourceAuthority,blockers:c?.blockers,observed:model.observedHistory,funding:model.funding,fount:model.fount,returns:c?.returns},null,2)}</pre></details>
   </details>
  </>}
  <ActionGroup label="다른 관점으로 살펴보기"><Link href={betaReadHref(betaHref("/beta/simulation",context),freshness?.store.pendingEpoch())}><ActionContent title="여러 시장 경로도 살펴볼까요?" description="현재 구성의 가상 시뮬레이션" /></Link></ActionGroup>
 </section></BetaShell>;
}

function LabTradeNotice({ evidence, onRun }: {
 evidence: NonNullable<LabModel['tradeEvidence']>;
 onRun: (period: {start:string;end:string}) => void;
}) {
 const {t}=useI18n();
 const {blocked,candidate}=evidence;
 const byDate = new Map<string, Set<string>>();
 for (const row of blocked) {
   const descriptions = byDate.get(row.date) ?? new Set<string>();
   descriptions.add([row.label,tradeReasonLabel(row.reason,t)].filter(Boolean).join(' · '));
   byDate.set(row.date,descriptions);
 }
 return <section className={styles.caution} aria-label={t('매매 기록과 비교 기간', 'Trade evidence and comparison dates')}>
   <strong>{blocked.every(row=>row.reason==='fx_missing')
     ? t('거래 당시 원화 금액을 확인할 수 없어요.', 'The KRW value at the time of the trade is unavailable.')
     : t('일부 매매 기록을 이 기간의 비교에 반영할 수 없어요.', 'Some trades cannot be included in this comparison.')}</strong>
   <details><summary>{t('확인이 필요한 날짜', 'Dates to check')} ({byDate.size})</summary>
     <ul>{[...byDate].map(([date,descriptions])=><li key={date}><time dateTime={date}>{date}</time> · {[...descriptions].join(' / ')}</li>)}</ul>
   </details>
   {candidate && <div>
     <p>{t('다음 관측 구간에는 위 기록이 없어요. 실행하면 나머지 비교 조건을 확인해요.', 'This observed period excludes those entries. Run it to check the other comparison requirements.')}</p>
     <CairnButton type="button" variant="secondary" onClick={()=>onRun(candidate)}>{candidate.start} ~ {candidate.end} {t('비교 실행', '· Run comparison')}</CairnButton>
   </div>}
 </section>;
}

function LabDefaultNote({ context, period }: { context: NonNullable<LabModel['defaultContext']>; period: LabModel['period'] }) {
 const {t}=useI18n();
 return <p className={styles.note}>
   {t('기본 구간', 'Default window')} {context.originalStart} ~ {context.originalEnd}
   {' · '}{context.lastBlockedDate} {context.reasons.map(reason=>tradeReasonLabel(reason,t)).join(' / ')}.
   {' '}{t('비교에 사용한 관측 구간', 'Observed window used for comparison')} {period.selectedStartServiceDate} ~ {period.selectedEndServiceDate}.
 </p>;
}

function tradeReasonLabel(reason: NonNullable<LabModel['tradeEvidence']>['blocked'][number]['reason'], t: (ko:string,en:string)=>string) {
 const labels = {
   fx_missing: t('거래 당시 원화 금액·환율 근거 없음', 'No recorded KRW amount or exchange rate at the time of the trade'),
   opening_boundary: t('거래와 시작 보유 관측의 선후 관계 미확인', 'The order of the trade and opening observation is unconfirmed'),
   unsupported: t('거래 내용을 비교에 반영할 근거 부족', 'Insufficient evidence to include this entry in the comparison'),
 };
 return labels[reason];
}
