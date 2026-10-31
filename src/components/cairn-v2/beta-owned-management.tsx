'use client';
import { ActionGroup, ActionContent, Button as CairnButton, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";
import { Plus, Wallet } from 'lucide-react';

import { DetailHeader } from './ui/molecules';
import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
import {useCallback,useLayoutEffect,useMemo,useRef,useState,useTransition,type FormEvent,type ReactNode} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {correctBetaHolding,archiveBetaHolding,restoreBetaHolding} from '@/app/beta/portfolio/holdings/manage/actions';
import {saveBetaGroup,archiveBetaGroup} from '@/app/beta/portfolio/groups/actions';
import {HoldingStateCorrectionForm} from '@/components/holding-state-correction-form';
import {HoldingArchiveForm,HoldingRestoreForm} from '@/components/holding-lifecycle-forms';
import {PortfolioGroupCreateForm,PortfolioGroupEditor} from '@/components/portfolio-group-management';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {ownedManagementKey,ownedManagementHref,ownedManagementGeneration,type OwnedManagementRead} from '@/lib/cairn-v2/owned-management-contract';
import {onboardingHref} from '@/lib/cairn-v2/onboarding-contract';
import {holdingsHref} from '@/lib/cairn-v2/holding-contract';
import {BetaShell} from './beta-shell';
import {useBetaExistingCrudAvailable,useBetaReadFreshness} from './beta-provider';
import styles from './owned-management.module.css';
import {ManagementWorkbench} from './management-workbench';

type ActionState={status:string;message:string|null};
function useManagementContinuation<T extends ActionState>(action:(previous:T,data:FormData)=>Promise<T>,generation:string,current:React.MutableRefObject<string>,onSuccess:()=>void){return useCallback(async(previous:T,data:FormData)=>{const result=await action(previous,data);if(result.status==='success'&&current.current===generation)onSuccess();return result;},[action,generation,current,onSuccess]);}
export function BetaOwnedManagement({read}:{read:OwnedManagementRead}){
 const search=useSearchParams(),router=useRouter(),query=search.toString();
 const context=useMemo(()=>domainQueryContext(query),[query]),freshness=useBetaReadFreshness(),available=useBetaExistingCrudAvailable();
 const headingRef=useRef<HTMLHeadingElement>(null),focusAfter=useRef<string|null>(null),previousReceipt=useRef(read.readReceipt);
 const [pending,startTransition]=useTransition(),observed=freshness?.observed,epoch=freshness?.epoch,store=freshness?.store;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
 const blocked=pending||ownedManagementKey(read.kind,context)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch);
 const readable=!blocked&&['ready','partial','empty'].includes(read.state),enabled=available&&readable;
 const generation=ownedManagementGeneration(read.kind,context,store?.pendingEpoch()??read.readEpoch,read.readReceipt),current=useRef(generation);
 useLayoutEffect(()=>{current.current=generation},[generation]);
 const refresh=useCallback((moveFocus=false)=>{const nextEpoch=crypto.randomUUID();if(moveFocus)focusAfter.current=nextEpoch;store?.begin(nextEpoch);startTransition(()=>router.replace(carryRecoveryFragment(ownedManagementHref(read.kind,context,nextEpoch),location.hash),{scroll:false}));},[read.kind,context,router,store]);
 const afterSuccess=useCallback(()=>refresh(true),[refresh]);
 useLayoutEffect(()=>{if(!blocked&&readable&&focusAfter.current===read.readEpoch){headingRef.current?.focus({preventScroll:true});focusAfter.current=null;}},[blocked,readable,read.readEpoch]);
 useLayoutEffect(()=>{if(previousReceipt.current!==read.readReceipt){previousReceipt.current=read.readReceipt;if(!blocked&&readable&&document.activeElement===document.body)headingRef.current?.focus({preventScroll:true});}},[read.readReceipt,blocked,readable]);
 const correct=useManagementContinuation(correctBetaHolding,generation,current,afterSuccess),archive=useManagementContinuation(archiveBetaHolding,generation,current,afterSuccess),restore=useManagementContinuation(restoreBetaHolding,generation,current,afterSuccess),saveGroup=useManagementContinuation(saveBetaGroup,generation,current,afterSuccess),archiveGroup=useManagementContinuation(archiveBetaGroup,generation,current,afterSuccess);
 const state=blocked?'loading':read.state,message=blocked?'사용자·조회 범위를 다시 확인하는 중':read.message;
 const shell=blankDomainView(state==='loading'?'loading':state==='unauthorized'?'unauthorized':'ready',message);shell.domain!.scopes=blocked?[]:read.scopes;
 const navigate=(next:typeof context)=>startTransition(()=>router.push(carryRecoveryFragment(ownedManagementHref(read.kind,next,store?.pendingEpoch()),location.hash),{scroll:false}));
 const preventBlocked=(event:FormEvent)=>{if(!enabled)event.preventDefault()};
 return <BetaShell context={context} setContext={navigate} readView={shell} workspace={read.kind==='groups'?'groups':'holdings'} originalPath={read.kind==='groups'?'/portfolio/groups':'/portfolio/holdings'}>
  <section className={styles.workspace} id={read.kind==='groups'?'group-management':'holdings-management'} data-owned-management-state={state} data-owned-management-kind={read.kind} aria-busy={blocked}>
   <DetailHeader title={read.kind==='groups'?'자산 그룹 관리':'보유 관리'} headingProps={{ref:headingRef,tabIndex:-1}} actions={<>{read.kind==='holdings'&&enabled&&<Link prefetch={false} href={onboardingHref(context,store?.pendingEpoch())}>보유종목 추가 ↗</Link>}{read.kind==='holdings'&&<Link prefetch={false} href={holdingsHref(context,store?.pendingEpoch())}>저장 보유 근거 ↗</Link>}</>} />
   {(blocked||!['ready','partial'].includes(state))&&<CairnStatus as="p" role="status">{message}</CairnStatus>}
   <p className={styles.muted}>{read.kind==='groups'?'계좌와 종목을 하나의 분석 범위로 묶어요.':'현재 보유 정보 정정 · 매수·매도는 거래 기록에서 입력해 주세요.'}</p>
   {!available&&<p>이 실행 환경에서는 관리 요청을 보낼 수 없습니다.</p>}
   {!blocked&&state==='partial'&&<p className={styles.warning}>제외된 보유 자료 {read.excludedHoldingCount}개 · 확인한 행만 표시하며 전체 자료로 간주하지 않습니다.</p>}
   {!blocked&&state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={()=>refresh()}>관리 자료 다시 조회</CairnButton>}
   {!blocked&&state==='unauthorized'&&<Link prefetch={false} href={ownedManagementHref(read.kind,{...context,scope:'all'},store?.pendingEpoch())}>전체 범위에서 접근 다시 확인 ↗</Link>}
   <div className={styles.reusedForms} inert={!enabled} aria-hidden={!readable} hidden={!readable} onSubmitCapture={preventBlocked} key={generation}>
    {read.kind==='groups'&&read.groups&&<ManagementWorkbench label="범위" create={<section className={styles.create}><CairnSectionTitle level="h3">새 범위 만들기</CairnSectionTitle><GroupSelectionEvidence><PortfolioGroupCreateForm accounts={read.groups.accounts} assets={read.groups.assets} action={saveGroup}/></GroupSelectionEvidence></section>} items={read.groups.groups.map(group=>({id:group.id,name:group.name,meta:'계좌 '+group.accountIds.length+' · 개별 종목 '+group.assetIds.length,group:'저장된 범위',content:<><CairnSectionTitle level="h3">{group.name}</CairnSectionTitle><GroupSelectionEvidence accounts={group.accountIds.length} assets={group.assetIds.length}><PortfolioGroupEditor key={group.id+':'+group.updatedAt} accounts={read.groups!.accounts} assets={read.groups!.assets} group={group} saveAction={saveGroup} archiveAction={archiveGroup}/></GroupSelectionEvidence></>}))}/>}
    {read.kind==='holdings'&&<ManagementWorkbench label="보유 기록" items={[...read.holdings.filter(row=>!row.archivedAt),...read.holdings.filter(row=>row.archivedAt)].map(row=>({id:row.holdingId,name:row.name,meta:row.accountName+' · '+(row.ticker??'심볼 없음')+' · '+row.currency,group:row.archivedAt?'종료·보관 기록':'보유 중',content:<article className={styles.holding} key={row.holdingId+':'+row.updatedAt}>
     <CairnSectionTitle level="h3">{row.name}<small>{row.accountName} · {row.ticker??'심볼 없음'} · {row.market} · {row.currency}{row.archivedAt?' · 보관 기록':''}</small></CairnSectionTitle>
     <dl className={styles.facts}><div><dt>보유 수량</dt><dd>{row.quantity}</dd></div><div><dt>평균 매입가 ({row.currency})</dt><dd>{row.averageCost??'미등록'}</dd></div></dl>
     <div className={styles.holdingActions}>{row.archivedAt?<HoldingRestoreForm holdingId={row.holdingId} updatedAt={row.updatedAt} action={restore}/>:<><HoldingStateCorrectionForm holdingId={row.holdingId} updatedAt={row.updatedAt} quantity={row.quantity} averageCost={row.averageCost} currency={row.currency} action={correct}/><HoldingArchiveForm holdingId={row.holdingId} updatedAt={row.updatedAt} action={archive}/></>}</div>
    </article>}))}/>}

   </div>
   {readable&&<ActionGroup label="자산 관리 이어가기" className={styles.related}>{read.kind==='holdings'&&enabled?<Link prefetch={false} href={onboardingHref(context,store?.pendingEpoch())}><ActionContent icon={<Plus size={22}/>} title="보유 종목 추가" description="새로운 종목 등록" /></Link>:<Link prefetch={false} href={holdingsHref(context,store?.pendingEpoch())}><ActionContent icon={<Wallet size={22}/>} title="보유 종목 확인" description="내 자산과 수량 보기" /></Link>}</ActionGroup>}
   <details className={styles.evidence}><summary>관리 기준과 지원 범위</summary>
    <p>기존 화면과 같은 writer가 매 요청의 로그인·소유권·갱신 버전을 다시 확인합니다. URL 범위, 종목 ID, 읽기 세대는 권한 증거가 아닙니다. 충돌 시 최신 자료를 다시 읽고 확인해 주세요.</p>
    {read.kind==='groups'?<p>빈 그룹을 만들 수 있습니다. 계좌 전체 포함과 같은 계좌의 개별 종목은 원본 정책에 따라 정리됩니다. 그룹 삭제는 과거 구성 이력을 보존하는 보관이며 계좌나 보유 기록을 삭제하지 않습니다. 그룹 복원은 기존 관리 동작에서 지원하지 않습니다.</p>:<p>수량·평균매입가 정정은 현재 상태의 오입력 정정이며 과거 거래나 현금 흐름을 만들지 않습니다. 보유 종료는 수량·원가·과거 기록을 보존합니다. 기존 native 원장 계좌의 정정 제한도 유지합니다. 원가를 비우면 기존 값을 유지하는 기능은 해당 원본 정책이 지원되는 경우만 제공됩니다. 신규 종목 등록은 상단 진입에서 진행합니다. 시세 수집·수동 가격·거래 작성은 이 정정 폼의 동작에 포함하지 않습니다.</p>}
    <p>자료 기준일 {readable?(read.serviceDate??'확인 전'):'확인 중'} · 읽은 시각 {readable?(read.readAt??'확인 전'):'확인 중'} · 저장 결과는 각 항목의 상태에서 확인합니다.</p>
   </details>
  </section>
 </BetaShell>;
}

function GroupSelectionEvidence({children,accounts=0,assets=0}:{children:ReactNode;accounts?:number;assets?:number}){const [selection,setSelection]=useState({accounts,assets});return <div onChangeCapture={event=>{const target=event.target;if(!(target instanceof HTMLInputElement)||!target.form||!['accountId','assetId'].includes(target.name))return;const data=new FormData(target.form);if(data.has('archiveConfirmed'))return;setSelection({accounts:data.getAll('accountId').length,assets:data.getAll('assetId').length});}}><p className={styles.muted} aria-live="polite">현재 선택 · 계좌 전체 {selection.accounts}개 · 개별 종목 {selection.assets}개. 겹치는 선택은 기존 저장 규칙으로 처리됩니다.</p>{children}</div>}
