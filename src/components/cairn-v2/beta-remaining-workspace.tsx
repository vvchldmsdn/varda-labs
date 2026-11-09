'use client';
import { parseMoneyInput } from '@/lib/money';
import { PlanProjection } from './plan-projection';
import type {UserAllocationBasis} from '@/lib/user-allocation-comparison';
import { DetailHeader } from './ui/molecules';
import {Status as CairnStatus} from '@/components/cairn-ui';
import {T} from '@/components/i18n/localized-text';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
import { ContributionNextSteps } from '@/components/additional-contribution/contribution-journey';
import Link from 'next/link';
import {useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,useTransition} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {remainingWorkspaceHref,remainingWorkspaceQueryKey,type RemainingWorkspaceRead} from '@/lib/cairn-v2/remaining-workspace-contract';
import {betaHref,betaReadHref} from '@/lib/cairn-v2/navigation';
import {NativeLedgerView} from './reused/native-ledger-view';
import {betaLedgerNavigation} from './reused/native-ledger-navigation';
import {LocaleProvider} from './reused/native-locale';
import {SavedPlanLibrary} from './reused/saved-plan-library';
import {useBetaExistingCrudAvailable,useBetaReadFreshness} from './beta-provider';
import {BetaShell} from './beta-shell';
import styles from './remaining-workspace.module.css';
function subscribeToFragment(notify:()=>void) {
 window.addEventListener('hashchange',notify);
 window.addEventListener('popstate',notify);
 return ()=>{window.removeEventListener('hashchange',notify);window.removeEventListener('popstate',notify)};
}
export function BetaRemainingWorkspace({read,projection,reason,projectionOwner,unavailableHoldings}:{read:RemainingWorkspaceRead;projection?:UserAllocationBasis;reason?:string;unavailableHoldings?:string[];projectionOwner?:string}){
 const [budgetDraft,setBudgetDraft]=useState<{generation:string;amount:string}|null>(null);
 const [saved,setSaved]=useState<{epoch:string;queryKey:string}|null>(null);
 const router=useRouter(),search=useSearchParams(),query=search.toString(),context=useMemo(()=>domainQueryContext(query),[query]),freshness=useBetaReadFreshness(),store=freshness?.store,observed=freshness?.observed,available=useBetaExistingCrudAvailable(),[pending,start]=useTransition();
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[observed,read.readReceipt,read.readEpoch,freshness?.epoch]);
 const blocked=pending||remainingWorkspaceQueryKey(read.kind,query)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch),ready=!blocked&&available&&read.state==='ready';
 const generation=JSON.stringify([read.queryKey,read.readReceipt,read.readEpoch]),current=useRef(generation);useLayoutEffect(()=>{current.current=generation;return()=>{current.current='unmounted'}},[generation]);
 const move=(next:typeof context)=>{setSaved(null);current.current='navigation';start(()=>router.push(carryRecoveryFragment(remainingWorkspaceHref(read.kind,next,store?.pendingEpoch()),location.hash),{scroll:false}));};
 const shell=blankDomainView(blocked?'loading':read.state==='unauthorized'?'unauthorized':'ready',read.message);shell.domain!.scopes=blocked?[]:read.scopes;
 const home=betaReadHref(betaHref('/beta',context),store?.pendingEpoch());
 const budget=budgetDraft?.generation===generation ? budgetDraft.amount : typeof context.cashAmountKrw==='string'?context.cashAmountKrw:'1,000,000';
 const budgetKrw=parseMoneyInput(budget,'KRW');
 const journalLanding = useSyncExternalStore(subscribeToFragment,()=>location.hash==='#choose-record-account',()=>true);
 const selectLedgerAccount = journalLanding && read.kind==='ledger' && !read.selection.accountId && !context.scope.startsWith('account:');
 const ledgerSelection = read.selection.accountId || !context.scope.startsWith('account:') ? read.selection : {...read.selection,accountId:context.scope.slice(8)};
 const ledgerNavigation=betaLedgerNavigation(context,store?.pendingEpoch(),read.selection);
 return <BetaShell workspace={read.kind} context={context} setContext={move} readView={shell} originalPath={read.kind==='ledger'?'/portfolio/ledger':'/plans'}>
  <section className={styles.workspace} id={read.kind==='ledger'?'trade-ledger':'saved-plans'} data-remaining-kind={read.kind} data-remaining-state={blocked?'loading':read.state} aria-busy={blocked}>
   {!ready && <DetailHeader title={read.kind==='ledger'?'거래·현금 기록':'저장된 투자계획'} actions={<Link prefetch={false} href={home}>홈으로 ↗</Link>} />}
   {(blocked||read.state!=='ready')&&<p role="status">{blocked?'불러오는 중…':read.message}</p>}

   {ready&&saved&&saved.epoch===read.readEpoch&&saved.queryKey===read.queryKey&&<CairnStatus as="p" tone="success" role="status"><T ko="기록했어요. 아래 거래 목록에서 확인할 수 있어요." en="Recorded. You can review it in the transaction list below." /></CairnStatus>}
   {ready && selectLedgerAccount && <p id="choose-record-account" role="status">계좌별 거래 기록은 상단에서 계좌를 선택해 확인하세요. <Link prefetch={false} href={betaReadHref(betaHref("/beta/history",context),store?.pendingEpoch())}>이 범위의 평가 기록 보기 →</Link></p>}
   {read.kind==='plans'?<div hidden={!ready} inert={!ready} aria-hidden={!ready}><SavedPlanLibrary generation={generation} suspended={!ready} projectionOwner={projectionOwner} projection={ready && <PlanProjection key={generation} amount={budget} onAmountChange={amount=>setBudgetDraft({generation,amount})} basis={projection} reason={reason} unavailableHoldings={unavailableHoldings} context={context}/>}/></div>:<div key={generation} hidden={!ready} inert={!ready} aria-hidden={!ready}>
    {ready&&!selectLedgerAccount&&<div onInputCapture={()=>setSaved(null)}><LocaleProvider initialLocale="ko"><NativeLedgerView embedded homeHref={home} reportingCurrency={context.currency} {...ledgerNavigation} initialSelection={ledgerSelection} onSaved={()=>{if(current.current!==generation||store?.blocked(read.readReceipt,read.readEpoch))return;const epoch=crypto.randomUUID();setSaved({epoch,queryKey:read.queryKey});store?.begin(epoch);start(()=>router.replace(carryRecoveryFragment(remainingWorkspaceHref('ledger',context,epoch,read.selection),location.hash),{scroll:false}));}}/></LocaleProvider></div>}
   </div>}
   {ready&&read.kind==='plans'&&budgetKrw!==null&&budgetKrw>0&&budgetKrw<=100_000_000_000&&<ContributionNextSteps compact journey={{scope:context.scope,currency:'KRW',reportingCurrency:context.currency,beta:true,amount:String(budgetKrw)}} />}
  </section>
 </BetaShell>;
}
