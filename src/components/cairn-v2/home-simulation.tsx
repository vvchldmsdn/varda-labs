"use client";
import {Suspense,use} from 'react';
import dynamic from 'next/dynamic';
import {betaHref,type BetaContext} from '@/lib/cairn-v2/navigation';
import {simulationKey,type SimulationRead} from '@/lib/cairn-v2/simulation-contract';
import {resolveSimulationFanPathSource,simulationFanPathCount} from './reused/simulation-presentation';
import {useBetaReadFreshness} from './beta-provider';
import {SimulationFanExplorer} from './reused/simulation-fan-explorer';
import styles from './home-simulation.module.css';
import {DetailHeader,EmptyState} from './ui/molecules';

const SimulationResultDetail = dynamic(() => import('./simulation-result-detail'), { loading: () => <HomeSimulationPending detail/> });

type Props={promise:Promise<SimulationRead>|undefined;context:BetaContext;detail?:boolean};
// One request-scoped server promise is shared by the home and its existing dialog.
// Opening, selecting or changing the chart display never issues a research call.
export function HomeSimulation({promise,context,detail=false}:Props){
 return <Suspense fallback={<HomeSimulationPending detail={detail}/>}>
  {promise?<PendingResult promise={promise} context={context} detail={detail}/>:<HomeSimulationMessage detail={detail} message="시뮬레이션 결과를 확인할 수 없습니다."/>}
 </Suspense>;
}
function PendingResult({promise,context,detail}:Props&{promise:Promise<SimulationRead>}){
 const read=use(promise);
 return <HomeSimulationResult read={read} context={context} detail={detail}/>;
}
export function HomeSimulationPending({detail=false}:{detail?:boolean}){
 return <div className={styles.pending} data-detail={detail} data-home-simulation-state="loading" role="status" aria-live="polite">
  <span className={styles.pulse} aria-hidden="true"><i/><i/><i/></span><span>시뮬레이션 계산 중</span>
 </div>;
}
export function HomeSimulationResult({read,context,detail=false}:{read:SimulationRead;context:BetaContext;detail?:boolean}){
 const freshness=useBetaReadFreshness();
 if(simulationKey(read.context)!==simulationKey({...context,run:context.run??'1'})||freshness?.store.blocked(read.readReceipt,read.readEpoch))return <HomeSimulationPending detail={detail}/>;
 const model=read.model,e=model?.execution;
 if(!model||!e||e.status!=='ready'||!e.assumptions||!e.bands.length||!read.resultIdentity)return <HomeSimulationMessage detail={detail} message={read.message} state={read.state} recovery={model?.historyRecovery} context={context}/>;
 const chart={id:read.resultIdentity,name:'현재 보유',assumptions:e.assumptions,bands:e.bands,samplePaths:e.samplePaths,displayPaths:e.displayPaths};
 const paths=resolveSimulationFanPathSource(chart),count=simulationFanPathCount(paths);
 const basis='분석 기준 KRW · 정규화 지수 · 시작 '+e.assumptions.normalizedStartIndex+' · '+e.assumptions.horizon+' 관측 단계 · 계산 '+e.assumptions.pathCount+'경로 / '+(paths.kind==='all'?'전체 ':'표본 ')+count+'개 표시 · 미래 예측 아님';
 if(!detail)return <div className={styles.compact} data-home-simulation-state={read.state} data-result-identity={read.resultIdentity}>
  <span className={styles.srOnly}>{basis}</span>
  {(read.state==='partial'||context.currency==='USD')&&<p className={styles.limit}>{read.state==='partial'?'포함 종목의 부분 연구 · ':''}분석 KRW</p>}
  <div className={styles.compactChart}><SimulationFanExplorer key={read.resultIdentity} execution={chart} compact preview initialMode="paths"/></div>
 </div>;
 return <SimulationResultDetail read={read} context={context}/>;
}

function HomeSimulationMessage({detail,message,state,recovery,context}:{detail?:boolean;message:string;state?:string;recovery?:{requestedEndServiceDate:string;verifiedEndServiceDate:string}|null;context?:BetaContext}){
 const action=recovery&&context?<a href={betaHref('/beta/simulation',{...context,end:recovery.verifiedEndServiceDate,run:'1'})}>검증된 {recovery.verifiedEndServiceDate} 기준으로 보기 ↗</a>:undefined;
 const explanation=recovery?'최근 조정 종가에 확인이 필요한 날짜가 있습니다. 현재 결과 대신 이전의 검증된 구간을 선택할 수 있습니다.':message;
 return detail ? <section className={styles.unavailableDetail} data-home-simulation-state={state}><DetailHeader title="시뮬레이션"/><EmptyState title="현재 연구를 표시할 수 없습니다" description={explanation} action={action}/></section> : <p className={styles.status} role="status" data-home-simulation-state={state}>{explanation}{action&&<><br/>{action}</>}</p>;
}
