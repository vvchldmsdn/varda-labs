'use client';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
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
 const refresh=useCallback((message?:string)=>{const nextEpoch=crypto.randomUUID();current.current='refreshing';if(message){setNotice({epoch:nextEpoch,message});focusAfter.current=nextEpoch;}store?.begin(nextEpoch);startTransition(()=>router.replace(targetEditorHref(context,nextEpoch),{scroll:false}));},[context,router,store]);
 const action=useCallback(async(previous:PortfolioTargetPolicyActionState,data:FormData)=>{const result=await saveBetaTargetPolicy(previous,data);if(result.status==='success'&&current.current===generation&&!store?.blocked(read.readReceipt,read.readEpoch))refresh(result.message??'목표비중을 승인했습니다.');return result;},[generation,refresh,store,read.readReceipt,read.readEpoch]);
 useLayoutEffect(()=>{if(readable&&focusAfter.current===read.readEpoch){heading.current?.focus({preventScroll:true});focusAfter.current=null;}},[readable,read.readEpoch]);
 const shell=blankDomainView(blocked?'loading':read.state==='unauthorized'?'unauthorized':'ready',blocked?'사용자·조회 범위를 다시 확인하는 중':read.message);shell.domain!.scopes=blocked?[]:read.scopes;
 const href=(path:Parameters<typeof betaHref>[0],hash='')=>betaReadHref(betaHref(path,context)+hash,store?.pendingEpoch());
 const navigate=(next:typeof context)=>{current.current='navigation';setNotice(null);startTransition(()=>router.push(targetEditorHref(next,store?.pendingEpoch()),{scroll:false}));};
 return <div style={{display:'contents'}} onClickCapture={event=>{if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const link=(event.target as Element).closest?.('a[href]') as HTMLAnchorElement|null;if(link&&link.target!=='_blank'){const next=new URL(link.href,location.href);if(next.pathname+next.search!==location.pathname+location.search)current.current='navigation';}}}><BetaShell context={context} setContext={navigate} readView={shell} workspace="targets" originalPath="/portfolio/targets">
  <section className={styles.workspace} id="target-editor" data-target-editor-state={blocked?'loading':read.state} aria-busy={blocked}>
   <DetailHeader title="목표비중" headingProps={{ref:heading,tabIndex:-1}} actions={<><Link prefetch={false} href={href('/beta/portfolio/structure')}>포트 구조 ↗</Link><Link prefetch={false} href={href('/beta','#beta-contribution')}>추가 투자 계산 ↗</Link><a href={originalHref('/portfolio/targets',context)}>기존 목표 화면 ↗</a></>} />
   <CairnStatus as="p" role="status">{blocked?'사용자·조회 범위를 다시 확인하는 중':read.message}</CairnStatus>
   {!blocked&&<p className={styles.muted}>분석·평가 기준 KRW · 조회 통화 {context.currency}와 별개입니다. 기준일 {read.serviceDate??'—'} · 승인본 {read.approvalRevision} · {read.policyStatus==='available'?'승인 목표':read.startingWeightSource==='current_allocation_starting_point'?'현재 비중에서 시작한 미승인 입력':'승인 근거 확인 필요'}</p>}
   {readable&&read.policyStatus!=='available'&&<p className={styles.warning}>현재 승인 목표로 적용할 수 없는 상태입니다. 편집 시작값을 승인 목표로 표시하지 않습니다. 근거: {read.policyStatus}</p>}
   {readable&&notice&&notice.epoch===read.readEpoch&&<CairnStatus as="p" role="status">{notice.message}</CairnStatus>}
   {!blocked&&read.state==='unavailable'&&<CairnButton variant="secondary" type="button" className={styles.retry} onClick={()=>refresh()}>목표 자료 다시 조회</CairnButton>}
   <div key={generation} hidden={!readable} inert={!enabled} aria-hidden={!readable} onSubmitCapture={(event:FormEvent)=>{if(!enabled)event.preventDefault()}}>
    {readable&&read.universeHash&&<TargetPolicyEditor rows={read.rows} accounts={read.accounts} scopeKey={context.scope} universeHash={read.universeHash} approvalRevision={read.approvalRevision} action={action}/>}
   </div>
   {!blocked&&<details className={styles.evidence}><summary>승인·계산 근거</summary><p>정책 {read.policyVersion??'승인본 없음'} · 적용일 {read.effectiveDate??'—'} · 상태 {read.policyStatus}. 합계 100%, 현재 구성과 승인본 번호는 기존 v2 백엔드가 저장 시 다시 확인합니다. 이전 승인본은 이력으로 남으며 목표 승인은 거래·자산·시세를 생성하지 않습니다.</p><p>구성 기준: {read.universeHash??'—'} · 화면 갱신 {read.readAt??'—'}</p></details>}
  </section>
 </BetaShell></div>;
}
