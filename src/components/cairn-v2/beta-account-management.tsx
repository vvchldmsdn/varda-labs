'use client';
import {useActionFormReset} from '@/components/cairn-ui/client';
import { ActionGroup, ActionContent, Button as CairnButton, Checkbox as CairnCheckbox, Field as CairnField, Fieldset as CairnFieldset, Form as CairnForm, Input as CairnInput, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";
import { Wallet } from 'lucide-react';

import { DetailHeader } from './ui/molecules';

import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { carryRecoveryFragment } from '@/lib/recovery-navigation';
import {useActionState,useCallback,useLayoutEffect,useMemo,useRef,useState,useTransition,type FormEvent} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {createBetaAccount,updateBetaAccount,archiveBetaAccount,restoreBetaAccount} from '@/app/beta/portfolio/accounts/manage/actions';
import type {AccountManagementActionState} from '@/lib/account-management';
import {managementHref,managementKey,type AccountManagementRead,type ManagedAccount} from '@/lib/cairn-v2/account-management-contract';
import {accountsHref} from '@/lib/cairn-v2/account-contract';
import {ownedManagementHref} from '@/lib/cairn-v2/owned-management-contract';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {BetaShell} from './beta-shell';
import {useBetaExistingCrudAvailable,useBetaReadFreshness} from './beta-provider';
import styles from './account-management.module.css';
import {ManagementWorkbench} from './management-workbench';

const INITIAL_STATE:AccountManagementActionState=Object.freeze({status:'idle',message:null});
type ManagementAction=(previous:AccountManagementActionState,data:FormData)=>Promise<AccountManagementActionState>;
type ActionCompletion=(state:AccountManagementActionState,generation:string)=>void;

// The submission generation is a freshness check, never session or ownership
// evidence. The original server action still authorizes every mutation.
function useManagementAction(action:ManagementAction,generation:string,enabled:boolean,onSuccess:ActionCompletion) {
  const currentGeneration=useRef(generation);
  useLayoutEffect(()=>{currentGeneration.current=generation},[generation]);
  // A successful archive/restore may remove this row in the returned RSC tree.
  // Report completion from the action promise, not an effect on that row.
  const run=useCallback(async(previous:AccountManagementActionState,data:FormData)=>{
    const result=await action(previous,data);
    if(result.status==='success'&&currentGeneration.current===generation)onSuccess(result,generation);
    return result;
  },[action,generation,onSuccess]);
  const [state,formAction,pending]=useActionState(run,INITIAL_STATE);
  const {onReset: resetOnReset} = useActionFormReset(state);
  const [submittedGeneration,setSubmittedGeneration]=useState<string|null>(null);
  const onSubmit=(event:FormEvent<HTMLFormElement>)=>{
    if(!enabled||pending){event.preventDefault();return;}
    setSubmittedGeneration(generation);
  };
  return {formAction,pending,onSubmit,onReset:resetOnReset,state:submittedGeneration===generation?state:INITIAL_STATE};
}

export function BetaAccountManagement({read}:{read:AccountManagementRead}) {
  const search=useSearchParams(),router=useRouter();
  const query=search.toString();
  const context=useMemo(()=>domainQueryContext(query),[query]);
  const freshness=useBetaReadFreshness(),available=useBetaExistingCrudAvailable();
  const [pending,startTransition]=useTransition();
  const observed=freshness?.observed,epoch=freshness?.epoch,store=freshness?.store;
  useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
  const blocked=pending||managementKey(context)!==read.queryKey||!!store?.blocked(read.readReceipt,read.readEpoch);
  const state=blocked?'loading':read.state;
  const ready=!blocked&&(read.state==='ready'||read.state==='empty');
  const enabled=available&&ready;
  const generation=managementKey(context)+'|'+(store?.pendingEpoch()??read.readEpoch??'initial');
  const currentGeneration=useRef(generation);
  useLayoutEffect(()=>{currentGeneration.current=generation},[generation]);
  const active=read.managementRows.filter(account=>account.isActive);
  const archived=read.managementRows.filter(account=>!account.isActive);
  const [completion,setCompletion]=useState<{generation:string;message:string|null}|null>(null);
  const reread=useCallback((result?:AccountManagementActionState)=>{
    const nextEpoch=crypto.randomUUID();
    store?.begin(nextEpoch);
    if(result?.status==='success')setCompletion({generation:managementKey(context)+'|'+nextEpoch,message:result.message});
    startTransition(()=>router.replace(carryRecoveryFragment(managementHref(context,nextEpoch),location.hash),{scroll:false}));
  },[context,router,store]);
  const complete=useCallback((result:AccountManagementActionState,submitted:string)=>{if(submitted===currentGeneration.current)reread(result)},[reread]);
  const navigate=(next:typeof context)=>startTransition(()=>router.push(carryRecoveryFragment(managementHref(next,store?.pendingEpoch()),location.hash),{scroll:false}));
  const message=blocked?'사용자·조회 범위를 다시 확인하는 중':read.message;
  const shell=blankDomainView(state==='loading'?'loading':state==='unauthorized'?'unauthorized':'ready',message);
  shell.domain!.scopes=blocked?[]:read.scopes;
  return <BetaShell context={context} setContext={navigate} readView={shell} workspace="accounts" originalPath="/portfolio/accounts">
    <section className={styles.workspace} id="account-management" data-account-management-state={state} aria-busy={blocked}>
      <DetailHeader title="계좌 관리" actions={<Link className={styles.textLink} prefetch={false} href={accountsHref(context,store?.pendingEpoch())}>계좌 현황 ↗</Link>} />
      {(blocked||read.state!=='ready')&&<CairnStatus as="p" className={styles.readStatus} role="status">{blocked?'계좌를 확인하고 있어요':read.message}</CairnStatus>}
      {!available&&<p className={styles.notice}>이 실행 환경에서는 계좌 저장 기능이 연결되지 않았습니다. 현재 화면에서 변경을 보낼 수 없습니다.</p>}
      {completion?.generation===generation&&completion.message&&<CairnStatus as="p" tone="success" className={styles.success} role="status">{completion.message}</CairnStatus>}
      {!blocked&&read.state==='unavailable'&&<CairnButton variant="secondary" className={styles.secondary} type="button" onClick={()=>reread()}>계좌 관리 다시 조회</CairnButton>}
      {!blocked&&read.state==='unauthorized'&&<Link className={styles.textLink} prefetch={false} href={managementHref({...context,scope:'all'},store?.pendingEpoch())}>전체 계좌 목록에서 접근 다시 확인 ↗</Link>}
      {/* Keep form DOM and drafts mounted during the accepted read refresh. */}
      <div className={styles.forms} data-read-blocked={!ready} aria-hidden={!ready} inert={!ready}>
        <ManagementWorkbench label="계좌" create={<CreateAccount generation={generation} enabled={enabled} onSuccess={complete}/>} items={[
          ...active.map(account=>({id:account.id,name:account.name,meta:account.currency+' · 보유 기록 '+account.activeHoldingCount,group:'활성 계좌',content:<ActiveAccount account={account} generation={generation} enabled={enabled} onSuccess={complete}/>})),
          ...archived.map(account=>({id:account.id,name:account.name,meta:account.currency+' · 보관',group:'보관 계좌',content:<ArchivedAccount account={account} generation={generation} enabled={enabled} onSuccess={complete}/>})),
        ]}/>
      </div>
      {ready&&<ActionGroup label="계좌와 연결된 자산" className={styles.related}><Link prefetch={false} href={ownedManagementHref('holdings',context,store?.pendingEpoch())}><ActionContent icon={<Wallet size={22}/>} title="보유 종목 관리" description="수량과 매입가 확인" /></Link></ActionGroup>}
      <details className={styles.evidence}>
        <summary>계좌 상태와 저장 근거</summary>
        <p>상단 범위는 현재 접근과 이동 문맥입니다. 관리 목록은 로그인한 소유자의 전체 계좌를 포함하며 표시 통화 선택으로 계좌의 저장 통화를 바꾸지 않습니다.</p>
        <p>새 계좌는 기존 규칙에 따라 투자 계좌·KRW 기준으로 생성됩니다. 보유 종목의 시장·원통화는 별도이며 USD 종목을 보유할 수 있습니다.</p>
        <p>보관은 기록 삭제가 아닙니다. 미보관 보유 기록 또는 미종료 분석 범위 연결이 있으면 보관할 수 없습니다. 수량 0인 미보관 보유 기록도 원본 검사에 포함됩니다.</p>
        <p>이름 수정·보관·복원은 읽은 갱신 시각으로 동시 변경을 확인합니다. 충돌 시 최신 계좌를 다시 읽은 뒤 내용을 확인해 주세요. 거래·보유·목표·분석 범위 편집은 이 화면에 연결하지 않았습니다.</p>
        <p className={styles.muted}>범위 연결 판정일 {ready?(read.serviceDate??'확인 전'):'확인 중'} · 읽은 시각 {ready?(read.readAt??'확인 전'):'확인 중'}</p>
      </details>
    </section>
  </BetaShell>;
}

type FormProps={generation:string;enabled:boolean;onSuccess:ActionCompletion};
function CreateAccount({generation,enabled,onSuccess}:FormProps) {
  const [name,setName]=useState('');
  const formRef=useRef<HTMLFormElement>(null);
  const complete=useCallback((state:AccountManagementActionState,submitted:string)=>{
    setName('');
    formRef.current?.reset();
    onSuccess(state,submitted);
  },[onSuccess]);
  const action=useManagementAction(createBetaAccount,generation,enabled,complete);
  return <section className={styles.createSection} aria-labelledby="create-account-title">
    <CairnSectionTitle level="h3" id="create-account-title">새 계좌</CairnSectionTitle>
    <CairnForm ref={formRef} action={action.formAction} onSubmit={action.onSubmit} onReset={action.onReset} aria-busy={action.pending}>
      <CairnFieldset className={styles.fields} disabled={!enabled||action.pending}>
        <div className={styles.nameField}><CairnField htmlFor="new-account-name">계좌 이름</CairnField><CairnInput id="new-account-name" name="name" type="text" autoComplete="off" maxLength={100} required value={name} onChange={event=>setName(event.target.value)}/></div>
        <CairnButton variant="primary" className={styles.primary} type="submit">{action.pending?'생성 중…':'계좌 생성'}</CairnButton>
      </CairnFieldset>
      <p className={styles.muted}>KRW 기준 · 미국 주식도 등록할 수 있어요.</p>
      <ActionMessage state={action.state} pending={action.pending}/>
    </CairnForm>
  </section>;
}

function ActiveAccount({account,generation,enabled,onSuccess}:FormProps&{account:ManagedAccount}) {
  const [draft,setDraft]=useState({version:account.updatedAt,value:account.name});
  const [confirmation,setConfirmation]=useState({version:account.updatedAt,value:false});
  const update=useManagementAction(updateBetaAccount,generation,enabled,onSuccess);
  const archive=useManagementAction(archiveBetaAccount,generation,enabled,onSuccess);
  const busy=update.pending||archive.pending;
  const archiveBlocked=account.activeHoldingCount>0||account.openGroupReferenceCount>0;
  const name=draft.version===account.updatedAt?draft.value:account.name;
  const confirmed=confirmation.version===account.updatedAt&&confirmation.value;
  return <article className={styles.accountRow} aria-busy={busy}>
    <div className={styles.accountHeading}><h4>{account.name}</h4><span className={styles.muted}>{account.accountType} · {account.currency}</span></div>
    <dl className={styles.references}><div><dt>보유 기록</dt><dd>{account.activeHoldingCount}</dd></div><div><dt>연결된 분석 범위</dt><dd>{account.openGroupReferenceCount}</dd></div></dl>
    <CairnForm action={update.formAction} onSubmit={update.onSubmit} onReset={update.onReset} aria-label={account.name+' 이름 수정'}>
      <CairnFieldset className={styles.fields} disabled={!enabled||busy}>
        <IdentityFields account={account}/>
        <div className={styles.nameField}><CairnField htmlFor={'account-name-'+account.id}>계좌 이름</CairnField><CairnInput id={'account-name-'+account.id} name="name" type="text" maxLength={100} required value={name} onChange={event=>setDraft({version:account.updatedAt,value:event.target.value})}/></div>
        <CairnButton variant="primary" className={styles.secondary} type="submit">{update.pending?'저장 중…':'이름 저장'}</CairnButton>
      </CairnFieldset>
      <ActionMessage state={update.state} pending={update.pending}/>
    </CairnForm>
    <details className={styles.archiveDisclosure}><summary>계좌 보관</summary>
    <CairnForm className={styles.archiveForm} action={archive.formAction} onSubmit={archive.onSubmit} onReset={archive.onReset} aria-label={account.name+' 보관'}>
      <CairnFieldset className={styles.archiveFields} disabled={!enabled||busy||archiveBlocked}>
        <IdentityFields account={account}/>
        <CairnField className={styles.confirm}><CairnCheckbox name="archiveConfirmed" value="yes" required checked={confirmed} onChange={event=>setConfirmation({version:account.updatedAt,value:event.target.checked})}/><span>기록을 유지한 채 계좌를 보관합니다.</span></CairnField>
        <CairnButton variant="danger" type="submit">{archive.pending?'보관 중…':'계좌 보관'}</CairnButton>
      </CairnFieldset>
      {archiveBlocked&&<p className={styles.notice}>보관 불가: {account.activeHoldingCount>0?'미보관 보유 기록 '+account.activeHoldingCount+'개':''}{account.activeHoldingCount>0&&account.openGroupReferenceCount>0?' · ':''}{account.openGroupReferenceCount>0?'미종료 범위 연결 '+account.openGroupReferenceCount+'개':''}가 있습니다.</p>}
      <ActionMessage state={archive.state} pending={archive.pending}/>
    </CairnForm>
    </details>
    <AccountEvidence account={account}/>
  </article>;
}

function ArchivedAccount({account,generation,enabled,onSuccess}:FormProps&{account:ManagedAccount}) {
  const restore=useManagementAction(restoreBetaAccount,generation,enabled,onSuccess);
  return <article className={styles.accountRow} aria-busy={restore.pending}>
    <div className={styles.accountHeading}><h4>{account.name}</h4><span className={styles.muted}>{account.accountType} · {account.currency} · 보관</span></div>
    <CairnForm action={restore.formAction} onSubmit={restore.onSubmit} onReset={restore.onReset} aria-label={account.name+' 복원'}>
      <CairnFieldset className={styles.restoreFields} disabled={!enabled||restore.pending}>
        <IdentityFields account={account}/>
        <p className={styles.muted}>저장된 기록을 유지하며 활성 계좌로 복원합니다.</p>
        <CairnButton variant="primary" className={styles.secondary} type="submit">{restore.pending?'복원 중…':'계좌 복원'}</CairnButton>
      </CairnFieldset>
      <ActionMessage state={restore.state} pending={restore.pending}/>
    </CairnForm>
    <AccountEvidence account={account}/>
  </article>;
}

function IdentityFields({account}:{account:ManagedAccount}) {
  return <><input name="accountId" type="hidden" value={account.id}/><input name="expectedUpdatedAt" type="hidden" value={account.updatedAt}/></>;
}
function ActionMessage({state,pending}:{state:AccountManagementActionState;pending:boolean}) {
  return <CairnStatus as="p" className={styles.actionMessage} data-action-state={pending?'pending':state.status} role="status" aria-live="polite">{pending?'저장 중…':state.message}</CairnStatus>;
}
function AccountEvidence({account}:{account:ManagedAccount}) {
  return <details className={styles.rowEvidence}><summary>계좌 기록 근거</summary><dl>
    <dt>기록 갱신 시각 (UTC)</dt><dd>{account.updatedAt}</dd>
    <dt>미보관 보유 기록</dt><dd>{account.activeHoldingCount}개 · 수량 0을 포함한 미보관 저장 행 수이며 현재 평가액이 아닙니다.</dd>
    <dt>미종료 범위 연결</dt><dd>{account.openGroupReferenceCount}개 · 기존 판정에 따라 미래 시작 연결이나 보관된 분석 범위 참조도 포함할 수 있습니다.</dd>
  </dl></details>;
}
