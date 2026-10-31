'use client';
import { ActionGroup, ActionContent, Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";
import { Wallet } from 'lucide-react';

import { DetailHeader } from './ui/molecules';

import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
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
  startTransition(()=>router.push(carryRecoveryFragment(ownedManagementHref('holdings',{...context,scope:`account:${accountId}`},nextEpoch),location.hash),{scroll:false}));
 },[context,router,store]);
 const action=useOnboardingContinuation(createBetaHoldingBatch,generation,current,accountIds,afterSuccess);
 const retry=()=>{const nextEpoch=crypto.randomUUID();store?.begin(nextEpoch);startTransition(()=>router.replace(carryRecoveryFragment(onboardingHref(context,nextEpoch),location.hash),{scroll:false}));};
 const navigate=(next:typeof context)=>startTransition(()=>router.push(carryRecoveryFragment(onboardingHref(next,store?.pendingEpoch()),location.hash),{scroll:false}));
 const preventBlocked=(event:FormEvent)=>{if(!enabled)event.preventDefault()};
 const state=blocked?'loading':read.state,message=blocked?'사용자·조회 범위를 다시 확인하는 중':read.message;
 const shell=blankDomainView(state,message);shell.domain!.scopes=blocked?[]:read.scopes;
 const cancelHref=ownedManagementHref('holdings',context,store?.pendingEpoch());
 return <BetaShell context={context} setContext={navigate} readView={shell} workspace="holdings" originalPath="/portfolio/holdings/new">
  <section className={styles.workspace} id="holding-onboarding" data-holding-onboarding-read-state={state} aria-busy={blocked}>
   <DetailHeader title="보유종목 추가" headingProps={{ref:heading,tabIndex:-1}} actions={<Link prefetch={false} href={cancelHref}>보유 목록 ↗</Link>} />
   {(blocked||!readable)&&<CairnStatus as="p" role="status">{message}</CairnStatus>}
   {!available&&<p>이 실행 환경에서는 등록 요청을 보낼 수 없습니다.</p>}
   {!blocked&&state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={retry}>등록 자료 다시 조회</CairnButton>}
   {!blocked&&state==='unauthorized'&&<Link prefetch={false} href={onboardingHref({...context,scope:'all'},store?.pendingEpoch())}>전체 범위에서 접근 다시 확인 ↗</Link>}
   <div className={styles.reused} hidden={!readable} aria-hidden={!readable} inert={!enabled} onSubmitCapture={preventBlocked} key={generation}>
    {readable&&(read.options&&read.options.accounts.length>0?<HoldingOnboardingForm options={read.options} action={action} initialAccountId={initialAccountId} nativeAccountIds={read.nativeAccountIds} persistAccountContext={false}/>:<ActionGroup label="계좌 등록"><Link prefetch={false} href={managementHref(context,store?.pendingEpoch())}><ActionContent icon={<Wallet size={22}/>} title="먼저 계좌를 만들어 주세요" description="내 종목을 담을 계좌 등록" /></Link></ActionGroup>)}
   </div>
   <details className={styles.evidence}><summary>등록 안내</summary>
    <p>폼에서 선택한 계좌에 보유 기록을 추가합니다. 매수·매도는 거래 기록에서 입력해 주세요.</p>
    {read.allowUnknownAverageCost&&<p>매입가는 나중에 추가할 수 있어요. 그룹을 선택하지 않으면 기본 그룹을 사용합니다.</p>}
    <p>{collectionEnabled?'가격 확인에 시간이 걸릴 수 있어요. 준비되지 않은 종목은 확인 후 다시 저장해 주세요.':'자동 가격 수집이 꺼져 있어요. 저장할 가격이 없으면 현재가를 직접 입력해 주세요.'}</p>
    <p>종목의 원통화로 저장합니다. 증권사 표시 수익률은 원가를 대신하지 않습니다.</p>
    <p>확인 시각 {readable?(read.readAt??'확인 전'):'확인 중'}</p>
   </details>
  </section>
 </BetaShell>;
}
