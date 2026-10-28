'use client';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';

import Link from 'next/link';
import {useCallback,useLayoutEffect,useMemo,useRef,useTransition,type FormEvent,type MutableRefObject} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {createBetaHoldingBatch} from '@/app/beta/portfolio/holdings/new/actions';
import {HoldingOnboardingForm} from '@/components/holding-onboarding-form';
import type {HoldingBatchState} from '@/lib/holding-batch';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {onboardingKey,onboardingHref,onboardingGeneration,type HoldingOnboardingRead} from '@/lib/cairn-v2/onboarding-contract';
import {ownedManagementHref} from '@/lib/cairn-v2/owned-management-contract';
import {managementHref} from '@/lib/cairn-v2/account-management-contract';
import {BetaShell} from './beta-shell';
import {useBetaExistingCrudAvailable,useBetaReadFreshness} from './beta-provider';
import styles from './onboarding.module.css';

type OnboardingAction=(previous:HoldingBatchState,data:FormData)=>Promise<HoldingBatchState>;
function useOnboardingContinuation(action:OnboardingAction,generation:string,current:MutableRefObject<string>,accountIds:readonly string[],onSuccess:(accountId:string)=>void){
 return useCallback(async(previous:HoldingBatchState,data:FormData)=>{
  const accountId=data.get('accountId');
  const result=await action(previous,data);
  if(result.status==='complete'&&current.current===generation&&typeof accountId==='string'&&accountIds.includes(accountId))onSuccess(accountId);
  return result;
 },[action,generation,current,accountIds,onSuccess]);
}

export function BetaHoldingOnboarding({read,collectionEnabled=false}:{read:HoldingOnboardingRead;collectionEnabled?:boolean}){
 const search=useSearchParams(),router=useRouter(),query=search.toString();
 const context=useMemo(()=>domainQueryContext(query),[query]),freshness=useBetaReadFreshness(),available=useBetaExistingCrudAvailable();
 const [pending,startTransition]=useTransition(),heading=useRef<HTMLHeadingElement>(null),previousReceipt=useRef(read.readReceipt);
 const observed=freshness?.observed,epoch=freshness?.epoch,store=freshness?.store;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
 const blocked=pending||onboardingKey(context)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch);
 const readable=!blocked&&(read.state==='ready'||read.state==='empty'),enabled=available&&readable;
 const generation=onboardingGeneration(context,store?.pendingEpoch()??read.readEpoch,read.readReceipt),current=useRef(generation);
 useLayoutEffect(()=>{current.current=generation;return ()=>{current.current='unmounted'}},[generation]);
 useLayoutEffect(()=>{if(previousReceipt.current!==read.readReceipt){previousReceipt.current=read.readReceipt;if(readable&&document.activeElement===document.body)heading.current?.focus({preventScroll:true});}},[read.readReceipt,readable]);
 const accountIds=useMemo(()=>read.options?.accounts.map(account=>account.id)??[],[read.options]);
 const initialAccountId=context.scope.startsWith('account:')&&accountIds.includes(context.scope.slice(8))?context.scope.slice(8):'';
 const afterSuccess=useCallback((accountId:string)=>{
  const nextEpoch=crypto.randomUUID();store?.begin(nextEpoch);
  startTransition(()=>router.push(ownedManagementHref('holdings',{...context,scope:`account:${accountId}`},nextEpoch),{scroll:false}));
 },[context,router,store]);
 const action=useOnboardingContinuation(createBetaHoldingBatch,generation,current,accountIds,afterSuccess);
 const retry=()=>{const nextEpoch=crypto.randomUUID();store?.begin(nextEpoch);startTransition(()=>router.replace(onboardingHref(context,nextEpoch),{scroll:false}));};
 const navigate=(next:typeof context)=>startTransition(()=>router.push(onboardingHref(next,store?.pendingEpoch()),{scroll:false}));
 const preventBlocked=(event:FormEvent)=>{if(!enabled)event.preventDefault()};
 const state=blocked?'loading':read.state,message=blocked?'사용자·조회 범위를 다시 확인하는 중':read.message;
 const shell=blankDomainView(state,message);shell.domain!.scopes=blocked?[]:read.scopes;
 const cancelHref=ownedManagementHref('holdings',context,store?.pendingEpoch());
 return <BetaShell context={context} setContext={navigate} readView={shell} workspace="holdings" originalPath="/portfolio/holdings/new">
  <section className={styles.workspace} id="holding-onboarding" data-holding-onboarding-read-state={state} aria-busy={blocked}>
   <DetailHeader title="보유종목 추가" headingProps={{ref:heading,tabIndex:-1}} />
   <CairnStatus as="p" role="status">{message}</CairnStatus>
   <p className={styles.muted}>잔고 사진을 올리거나 종목을 검색해 목록에 담으세요. 저장 전에 수량과 매입가를 확인할 수 있습니다.</p>
   <p className={styles.muted}>{collectionEnabled?'등록 요청에 필요한 가격·환율 수집이 활성화되어 있습니다. 수집 결과를 기다려야 할 수 있습니다.':'자동 수집이 꺼져 있습니다. 저장 가격을 확인할 수 없으면 등록이 보류됩니다.'}</p>
   {!available&&<p>이 실행 환경에서는 등록 요청을 보낼 수 없습니다.</p>}
   {!blocked&&state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={retry}>등록 자료 다시 조회</CairnButton>}
   {!blocked&&state==='unauthorized'&&<Link prefetch={false} href={onboardingHref({...context,scope:'all'},store?.pendingEpoch())}>전체 범위에서 접근 다시 확인 ↗</Link>}
   <Link prefetch={false} href={cancelHref}>보유 목록으로 돌아가기 ↗</Link>
   <div className={styles.reused} hidden={!readable} aria-hidden={!readable} inert={!enabled} onSubmitCapture={preventBlocked} key={generation}>
    {readable&&(read.options&&read.options.accounts.length>0?<HoldingOnboardingForm options={read.options} action={action} initialAccountId={initialAccountId} nativeAccountIds={read.nativeAccountIds}/>:<p>먼저 보유 계좌가 필요합니다. <Link prefetch={false} href={managementHref(context,store?.pendingEpoch())}>계좌 관리 열기 ↗</Link></p>)}
   </div>
   <details className={styles.evidence}><summary>등록 기준과 지원 범위</summary>
    <p>상단 범위는 접근·이동 문맥이며, 저장할 계좌는 폼에서 선택합니다. 본인의 활성 계좌·분석 범위를 저장 요청마다 다시 확인합니다. URL과 읽기 세대는 권한 증거가 아닙니다.</p>
    {read.allowUnknownAverageCost&&<p>기존 분석 범위와 새 그룹 이름을 모두 비우면 원문 정책에 따라 기본 포트폴리오 그룹을 생성하거나 재사용합니다.</p>}
    <p>표시 통화와 별개로 입력한 종목의 원통화가 저장됩니다. 증권사 표시 수익률은 검산용 근거이며 원가나 손익을 대신하지 않습니다.</p>
    <p>{collectionEnabled?'등록 요청의 기존 정책에 따라 필요한 가격·환율 수집을 예약합니다. 자료가 준비되지 않았다면 저장 성공으로 표시하지 않습니다.':'이 환경에서는 수집을 예약하지 않습니다. 가격 근거가 없으면 안내를 확인한 뒤 현재 1좌 가격을 직접 입력하거나 다시 요청해 주세요.'} 화면 열람·조건 편집만으로는 수집하지 않습니다.</p>
    <p>native 원장 계좌는 기존 등록 정책의 제한을 따릅니다. 거래 내역은 매수·매도 기록 화면에서 등록해 주세요.</p>
    <p>자료를 읽은 시각 {readable?(read.readAt??'확인 전'):'확인 중'} · 저장 결과는 요청 후 상태에서 확인합니다.</p>
   </details>
  </section>
 </BetaShell>;
}
