'use client';
import { DetailHeader } from './ui/molecules';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
import { ContributionNextSteps } from '@/components/additional-contribution/contribution-journey';
import Link from 'next/link';
import {useLayoutEffect,useMemo,useRef,useTransition} from 'react';
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
export function BetaRemainingWorkspace({read}:{read:RemainingWorkspaceRead}){
 const router=useRouter(),search=useSearchParams(),query=search.toString(),context=useMemo(()=>domainQueryContext(query),[query]),freshness=useBetaReadFreshness(),store=freshness?.store,observed=freshness?.observed,available=useBetaExistingCrudAvailable(),[pending,start]=useTransition();
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[observed,read.readReceipt,read.readEpoch,freshness?.epoch]);
 const blocked=pending||remainingWorkspaceQueryKey(read.kind,query)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch),ready=!blocked&&available&&read.state==='ready';
 const generation=JSON.stringify([read.queryKey,read.readReceipt,read.readEpoch]),current=useRef(generation);useLayoutEffect(()=>{current.current=generation;return()=>{current.current='unmounted'}},[generation]);
 const move=(next:typeof context)=>{current.current='navigation';start(()=>router.push(carryRecoveryFragment(remainingWorkspaceHref(read.kind,next,store?.pendingEpoch()),location.hash),{scroll:false}));};
 const shell=blankDomainView(blocked?'loading':read.state==='unauthorized'?'unauthorized':'ready',read.message);shell.domain!.scopes=blocked?[]:read.scopes;
 const home=betaReadHref(betaHref('/beta',context),store?.pendingEpoch());
 const ledgerNavigation=betaLedgerNavigation(context,store?.pendingEpoch(),read.selection);
 return <BetaShell workspace={read.kind} context={context} setContext={move} readView={shell} originalPath={read.kind==='ledger'?'/portfolio/ledger':'/plans'}>
  <section className={styles.workspace} id={read.kind==='ledger'?'trade-ledger':'saved-plans'} data-remaining-kind={read.kind} data-remaining-state={blocked?'loading':read.state} aria-busy={blocked}>
   <DetailHeader title={read.kind==='ledger'?'거래·현금 기록':'저장된 투자계획'} actions={<Link prefetch={false} href={home}>홈으로 ↗</Link>} />
   {(blocked||read.state!=='ready')&&<p role="status">{blocked?'불러오는 중…':read.message}</p>}
   {ready&&read.kind==='plans'&&<ContributionNextSteps journey={{scope:context.scope,currency:'KRW',reportingCurrency:context.currency,beta:true,amount:typeof context.cashAmountKrw==='string'?context.cashAmountKrw:undefined}} />}
   {ready&&read.kind==='ledger'&&<Link className={styles.importLink} prefetch={false} href="/portfolio/trades/import">사진으로 거래 가져오기 ↗</Link>}
   {read.kind==='plans'?<div hidden={!ready} inert={!ready} aria-hidden={!ready}><SavedPlanLibrary generation={generation} suspended={!ready}/></div>:<div key={generation} hidden={!ready} inert={!ready} aria-hidden={!ready}>
    {ready&&<LocaleProvider initialLocale="ko"><NativeLedgerView embedded homeHref={home} {...ledgerNavigation} initialSelection={read.selection} onSaved={()=>{if(current.current!==generation||store?.blocked(read.readReceipt,read.readEpoch))return;const epoch=crypto.randomUUID();store?.begin(epoch);start(()=>router.replace(carryRecoveryFragment(remainingWorkspaceHref('ledger',context,epoch,read.selection),location.hash),{scroll:false}));}}/></LocaleProvider>}
   </div>}
  </section>
 </BetaShell>;
}
