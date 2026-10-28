'use client';
import {useActionFormReset} from '@/components/cairn-ui/client';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Select as CairnSelect, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";

import {useActionState,useState} from 'react';
import type {PortfolioTargetPolicyActionState} from '@/lib/shared-backend/target-policy';
import type {TargetEditorRow} from '@/lib/cairn-v2/target-editor-contract';
import type {OnboardingInstrument} from '../../../lib/onboarding-instrument-search';
import {parseDisplayedTargetPercent,targetInputPercent} from './target-policy-editor-values';
import {OnboardingInstrumentSearch} from './onboarding-instrument-search';
import styles from './target-policy-editor.module.css';
type Candidate=OnboardingInstrument&{accountId:string;accountName:string;weight:string};
type Save=(previous:PortfolioTargetPolicyActionState,data:FormData)=>Promise<PortfolioTargetPolicyActionState>;
// Limited candidate 736f display-core port: original weights/candidates/removed/revision
// contract; current scoped presentation, no candidate locale/root/fixture/storage.
export function TargetPolicyEditor({rows,accounts,scopeKey,universeHash,approvalRevision,action:save}:{rows:readonly TargetEditorRow[];accounts:readonly {id:string;name:string;code:string}[];scopeKey:string;universeHash:string;approvalRevision:number;action:Save}){
 const [state,action,pending]=useActionState(async(previous:PortfolioTargetPolicyActionState,data:FormData)=>{const result=await save(previous,data);return {...result,approvalRevision:result.approvalRevision??previous.approvalRevision};},{status:'idle',message:null,approvalRevision} as PortfolioTargetPolicyActionState);
 const {formRef: actionResetRef, onReset: actionResetOnReset} = useActionFormReset(state);
 const initial=rows.map(r=>r.buyability==='buyable'?targetInputPercent(r.editorTargetWeightBps):'0');
 const [weights,setWeights]=useState(initial),[candidates,setCandidates]=useState<Candidate[]>([]),[removed,setRemoved]=useState<string[]>([]),[accountId,setAccountId]=useState(accounts[0]?.id??''),[editedSinceSubmit,setEditedSinceSubmit]=useState(false),[selectionNotice,setSelectionNotice]=useState('');
 const added=candidates.map((r,i)=>({...r,assetId:'draft:'+i,heldAssetId:null,assetName:r.name,buyability:'buyable',currentValueKrw:0}));
 const all=[...rows,...added],values=[...weights,...candidates.map(r=>r.weight)],parsed=values.map((v,i)=>i<rows.length&&removed.includes(rows[i].assetId)?0:parseDisplayedTargetPercent(v));
 const total=parsed.some(v=>v===null)?null:parsed.reduce<number>((sum,v)=>sum+v!,0),valid=total===10000;
 const dirty=weights.some((v,i)=>v!==initial[i])||candidates.length>0||removed.length>0;
 const invalidCount=parsed.filter(value=>value===null).length,firstInvalid=parsed.findIndex(value=>value===null);
 const feedback=editedSinceSubmit?(dirty?'편집 중 · 아직 승인하지 않은 입력입니다.':'편집 시작값으로 되돌렸습니다.'):state.message??(dirty?'편집 중 · 아직 승인하지 않은 입력입니다.':'현재 승인본 또는 편집 시작값입니다.');
 const edited=()=>{setEditedSinceSubmit(true);setSelectionNotice('')};
 const select=(instrument:OnboardingInstrument)=>{
  const account=accounts.find(a=>a.id===accountId);if(!account)return;
  const same=(r:{accountId:string;market:string;currency:string;ticker:string|null})=>r.accountId===account.id&&r.market===instrument.market&&r.currency===instrument.currency&&r.ticker===instrument.ticker;
  const restore=rows.find(r=>same(r)&&r.heldAssetId===null&&removed.includes(r.assetId));
  if(restore){setRemoved(old=>old.filter(id=>id!==restore.assetId));edited();return;}
  if(all.some(r=>same(r)&&!removed.includes(r.assetId))){setSelectionNotice('같은 계좌의 종목이 이미 목표에 있습니다.');return;}
  setCandidates(old=>[...old,{...instrument,accountId:account.id,accountName:account.name,weight:''}]);edited();
 };
 return <CairnForm ref={actionResetRef} onReset={actionResetOnReset} action={action} className={styles.form} data-target-dirty={dirty} onSubmit={()=>setEditedSinceSubmit(false)}>
  <input type="hidden" name="scope" value={scopeKey}/><input type="hidden" name="universeHash" value={universeHash}/><input type="hidden" name="approvalRevision" value={state.approvalRevision??approvalRevision}/><input type="hidden" name="rowCount" value={all.length}/><input type="hidden" name="candidates" value={JSON.stringify(candidates.map(r=>({accountId:r.accountId,instrumentId:r.id})))}/><input type="hidden" name="removed" value={JSON.stringify(removed)}/>
  <section className={styles.total} aria-label="목표 합계와 승인 상태" data-target-summary>
   <div className={styles.totalValue}><span>목표 합계</span><strong data-valid={valid}>{total===null?'입력 확인':targetInputPercent(total)+'%'}</strong></div>
   <div className={styles.totalStatus}>
    <p className={styles.rule}>{valid?'합계 조건 충족 · 100%':'합계는 정확히 100%여야 합니다'}</p>
    {invalidCount>0&&<CairnButton variant="secondary" className={styles.errorLink} type="button" disabled={pending} aria-label={'입력 오류 '+invalidCount+'개 · '+all[firstInvalid].assetName+' 입력으로 이동'} onClick={event=>{const input=event.currentTarget.form?.elements.namedItem('targetWeight:'+firstInvalid) as HTMLInputElement|null;input?.focus();}}>입력 확인 {invalidCount}종목 ↗</CairnButton>}
    <CairnStatus as="p" className={styles.feedback} role="status" aria-live="polite" data-target-action-state={pending?'pending':editedSinceSubmit?(dirty?'dirty':'reset'):state.status!=='idle'?state.status:dirty?'dirty':'idle'}>{pending?'목표비중 승인 중…':feedback}</CairnStatus>
   </div>
   <CairnButton variant="primary" className={styles.save} type="submit" disabled={pending||!valid||all.length===removed.length}>{pending?'승인 중':'목표비중 승인 저장'}</CairnButton>
   <p className={styles.summaryNote}>저장해도 주문은 실행되지 않습니다.</p>
  </section>
  <div className={styles.editor}>
   <div className={styles.editorHeading}><CairnSectionTitle level="h3">종목별 목표</CairnSectionTitle><CairnButton variant="secondary" type="button" disabled={pending||!dirty} onClick={()=>{setWeights(initial);setCandidates([]);setRemoved([]);edited();}}>입력 되돌리기</CairnButton></div>
   <div className={styles.columns} aria-hidden="true"><span>종목 · 계좌</span><span>목표 비중</span></div>
   <ol className={styles.rows}>{all.map((r,i)=>{
    const hidden=i<rows.length&&removed.includes(r.assetId),buyable=r.buyability==='buyable',invalid=parsed[i]===null,id='target-weight-'+i;
    if(hidden)return <li key={r.assetId} hidden><input type="hidden" name={'targetWeight:'+i} value="0"/></li>;
    return <li className={styles.row} key={r.assetId}>
     <div className={styles.identity}><CairnField htmlFor={id}>{r.assetName}</CairnField><p>{r.accountName} · {r.ticker??'심볼 없음'} · {r.market} · {r.currency}</p><small>{r.heldAssetId===null?'미보유 계획 종목':'보유 종목'}</small></div>
     <CairnField className={styles.weight} htmlFor={id}><span className={styles.visuallyHidden}>목표 비중</span><div><CairnInput id={id} name={'targetWeight:'+i} type="text" inputMode="decimal" autoComplete="off" value={buyable?values[i]:'0'} disabled={pending||!buyable} aria-invalid={invalid||undefined} aria-describedby={invalid?id+'-error':undefined} onChange={e=>{const value=e.target.value;if(i<rows.length)setWeights(old=>old.map((v,at)=>at===i?value:v));else setCandidates(old=>old.map((v,at)=>at===i-rows.length?{...v,weight:value}:v));edited();}}/><b>%</b></div>{!buyable&&<input type="hidden" name={'targetWeight:'+i} value="0"/>}</CairnField>
     {invalid&&<p className={styles.warning} id={id+'-error'}>0~100 사이, 소수점 둘째 자리까지 입력하세요.</p>}
     {!buyable&&<p className={styles.warning}>이 종목은 목표 0%만 설정할 수 있습니다.</p>}
     <div className={styles.rowDetails}>
      <details className={styles.evidence}><summary>평가액·종목 근거</summary><p>현재 확인 평가액 (KRW): {r.currentValueKrw===null?'—':String(r.currentValueKrw)} · {r.heldAssetId===null?'현재 보유가 없는 목표입니다. 자산이나 거래를 생성하지 않습니다.':'소유 계좌의 보유 자료'}</p></details>
      {r.heldAssetId===null&&<CairnButton variant="ghost" className={styles.remove} type="button" disabled={pending} onClick={()=>{if(i<rows.length)setRemoved(old=>[...old,r.assetId]);else setCandidates(old=>old.filter((_,at)=>at!==i-rows.length));edited();}}>목표에서 제외</CairnButton>}
     </div>
    </li>;
   })}</ol>
   {accounts.length>0&&<details className={styles.add}><summary>목표 종목 추가</summary><CairnField>계좌<CairnSelect value={accountId} disabled={pending} onChange={e=>setAccountId(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</CairnSelect></CairnField><OnboardingInstrumentSearch privateQuery manualEntryAvailable={false} onSelect={select} disabled={pending||all.length>=64}/><CairnStatus as="p" role="status">{selectionNotice}</CairnStatus></details>}
  </div>
 </CairnForm>;
}
