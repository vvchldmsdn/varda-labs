'use client';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
import { RecoveryBackLink, RecoveryJourneyLink } from '@/components/recovery/recovery-return';
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';

import {useCallback,useLayoutEffect,useMemo,useRef,useState,useTransition,type FormEvent} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {saveBetaTargetPolicy} from '@/app/beta/portfolio/targets/actions';
import type {PortfolioTargetPolicyActionState} from '@/lib/shared-backend/target-policy';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {targetEditorGeneration,targetEditorHref,targetEditorKey,type TargetEditorRead} from '@/lib/cairn-v2/target-editor-contract';
import {betaHref,betaReadHref,originalHref} from '@/lib/cairn-v2/navigation';
import {TargetPolicyEditor} from './reused/target-policy-editor';
import {BetaShell} from './beta-shell';
import {useBetaExistingCrudAvailable,useBetaReadFreshness} from './beta-provider';
import styles from './owned-management.module.css';
export function BetaTargetEditor({read}:{read:TargetEditorRead}){
 const router=useRouter(),search=useSearchParams(),query=search.toString(),context=useMemo(()=>domainQueryContext(query),[query]),freshness=useBetaReadFreshness(),available=useBetaExistingCrudAvailable(),store=freshness?.store,observed=freshness?.observed,epoch=freshness?.epoch;
 const [pending,startTransition]=useTransition(),[notice,setNotice]=useState<{epoch:string;message:string}|null>(null),heading=useRef<HTMLHeadingElement>(null),focusAfter=useRef<string|null>(null);
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
 const blocked=pending||targetEditorKey(context)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch),readable=!blocked&&read.state==='ready',enabled=available&&readable;
 const generation=targetEditorGeneration(context,store?.pendingEpoch()??read.readEpoch,read.readReceipt),current=useRef(generation);
 useLayoutEffect(()=>{if(!pending)current.current=generation},[generation,pending]);
 useLayoutEffect(()=>()=>{current.current='unmounted'},[]);
 const refresh=useCallback((message?:string)=>{const nextEpoch=crypto.randomUUID();current.current='refreshing';if(message){setNotice({epoch:nextEpoch,message});focusAfter.current=nextEpoch;}store?.begin(nextEpoch);startTransition(()=>router.replace(carryRecoveryFragment(targetEditorHref(context,nextEpoch),location.hash),{scroll:false}));},[context,router,store]);
 const action=useCallback(async(previous:PortfolioTargetPolicyActionState,data:FormData)=>{const result=await saveBetaTargetPolicy(previous,data);if(result.status==='success'&&current.current===generation&&!store?.blocked(read.readReceipt,read.readEpoch))refresh(result.message??'목표비중을 승인했습니다.');return result;},[generation,refresh,store,read.readReceipt,read.readEpoch]);
 useLayoutEffect(()=>{if(readable&&focusAfter.current===read.readEpoch){heading.current?.focus({preventScroll:true});focusAfter.current=null;}},[readable,read.readEpoch]);
 const shell=blankDomainView(blocked?'loading':read.state==='unauthorized'?'unauthorized':'ready',blocked?'사용자·조회 범위를 다시 확인하는 중':read.message);shell.domain!.scopes=blocked?[]:read.scopes;
 const href=(path:Parameters<typeof betaHref>[0],hash='')=>betaReadHref(betaHref(path,context)+hash,store?.pendingEpoch());
 const navigate=(next:typeof context)=>{current.current='navigation';setNotice(null);startTransition(()=>router.push(carryRecoveryFragment(targetEditorHref(next,store?.pendingEpoch()),location.hash),{scroll:false}));};
 return <div style={{display:'contents'}} onClickCapture={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const link=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement|null;if(link&&link.target!=='_blank'){const next=new URL(link.href,location.href);if(next.pathname+next.search!==location.pathname+location.search)current.current='navigation';}}}><BetaShell context={context} setContext={navigate} readView={shell} workspace="targets" originalPath="/portfolio/targets">
  <section className={styles.workspace} id="target-editor" data-target-editor-state={blocked?'loading':read.state} aria-busy={blocked}>
   <DetailHeader title="목표비중" headingProps={{ref:heading,tabIndex:-1}} actions={<><RecoveryJourneyLink prefetch={false} href={href('/beta/portfolio/structure')}>포트 구조 ↗</RecoveryJourneyLink><RecoveryBackLink href={href('/beta','#beta-contribution')}>추가 투자 계산 ↗</RecoveryBackLink><RecoveryJourneyLink prefetch={false} href={originalHref('/portfolio/targets',context)}>기존 목표 화면 ↗</RecoveryJourneyLink></>} />
   {(blocked||read.state!=='ready')&&<CairnStatus as="p" role="status">{blocked?'불러오는 중…':read.message}</CairnStatus>}
   {readable&&<p className={styles.muted}>KRW 기준 · {read.rows.length}종목 · {read.policyStatus==='available'?'저장된 목표': '저장 전'}</p>}
   {readable&&read.policyStatus!=='available'&&<p className={styles.warning}>{read.startingWeightSource==='current_allocation_starting_point'?'현재 비중에서 시작해요. 원하는 비중으로 바꾼 뒤 저장하세요.':'종목별 비중을 확인한 뒤 합계 100%로 저장하세요.'}</p>}
   {readable&&notice&&notice.epoch===read.readEpoch&&<CairnStatus as="p" role="status">{notice.message}</CairnStatus>}
   {!blocked&&read.state==='unavailable'&&<CairnButton variant="secondary" type="button" className={styles.retry} onClick={()=>refresh()}>목표 자료 다시 조회</CairnButton>}
   {!blocked&&read.state==='blocked'&&available&&<RecoveryNotice beta kind="holdings" scope={context.scope} />}
   <div key={generation} hidden={!readable} inert={!enabled} aria-hidden={!readable} onSubmitCapture={(event:FormEvent)=>{if(!enabled)event.preventDefault()}}>
    {readable&&read.universeHash&&<TargetPolicyEditor rows={read.rows} accounts={read.accounts} scopeKey={context.scope} universeHash={read.universeHash} approvalRevision={read.approvalRevision} action={action}/>}
   </div>
   {!blocked&&<details className={styles.evidence}><summary>승인·계산 근거</summary><p>정책 {read.policyVersion??'승인본 없음'} · 적용일 {read.effectiveDate??'—'} · 상태 {read.policyStatus}. 합계 100%, 현재 구성과 승인본 번호는 기존 v2 백엔드가 저장 시 다시 확인합니다. 이전 승인본은 이력으로 남으며 목표 승인은 거래·자산·시세를 생성하지 않습니다.</p><p>구성 기준: {read.universeHash??'—'} · 화면 갱신 {read.readAt??'—'}</p></details>}
  </section>
 </BetaShell></div>;
}
