'use client';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankSnapshots,snapshotKey,continueSnapshotHref,type SnapshotRead,type SnapshotKind} from '@/lib/cairn-v2/snapshot-contract';
import {type BetaContext} from '@/lib/cairn-v2/navigation';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {historyReturnHref} from '@/lib/cairn-v2/history-return';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness} from './beta-provider';
import {SnapshotSummary,SnapshotWarnings,AccountSnapshotTable,PositionSnapshotTable,SnapshotEvidence} from './snapshot-table';
import styles from './snapshots.module.css';
export function BetaSnapshots({read}:{read:SnapshotRead}){
 const search=useSearchParams(),router=useRouter(),freshness=useBetaReadFreshness(),query=search.toString(),context=domainQueryContext(query);
 const dates=search.getAll('date'),date=dates.length===1?dates[0]:dates.length?dates:undefined;
 const [pending,startTransition]=useTransition(),observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
 const visible=pending||snapshotKey(context,date??null,read.kind)!==read.queryKey||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankSnapshots(context,read.kind,typeof date==='string'?date:null,'loading','사용자·범위·저장 날짜를 다시 확인하는 중'):read;
 const [draft,setDraft]=useState<{query:string;value:string}|null>(null);
 const input=draft?.query===query?draft.value:typeof date==='string'?date:visible.date??'';
 const href=(next:BetaContext,nextDate:string|string[]|undefined,kind:SnapshotKind=read.kind)=>continueSnapshotHref(next,nextDate,freshness?.store.pendingEpoch(),new URLSearchParams(query),kind);
 const navigate=(next:BetaContext,nextDate:string|string[]|undefined)=>startTransition(()=>router.push(href(next,nextDate),{scroll:false}));
 const shell=blankDomainView(visible.state==='loading'?'loading':visible.state==='unauthorized'?'unauthorized':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 const model=visible.accounts??visible.positions;
 return <BetaShell context={context} setContext={next=>navigate(next,date)} readView={shell} workspace="history" originalPath={read.kind==='accounts'?'/portfolio/portfolio-snapshots':'/portfolio/position-snapshots'}>
 <section className={styles.workspace} id="stored-valuations" data-snapshots-state={visible.state}>
 <DetailHeader title={read.kind==='accounts'?'저장된 평가':'저장된 종목 평가'} actions={<Link prefetch={false} href={historyReturnHref(context,typeof date==='string'?date:visible.date,freshness?.store.pendingEpoch(),new URLSearchParams(query),'storage')}>히스토리로 돌아가기 ↗</Link>} />
 <CairnForm className={styles.filter} onSubmit={e=>{e.preventDefault();navigate(context,input)}}><CairnField>저장 날짜 <CairnInput aria-label="저장 날짜" type="date" required value={input} onChange={e=>setDraft({query,value:e.target.value})}/></CairnField><CairnButton variant="primary" type="submit">날짜 조회</CairnButton>{read.kind==='accounts'&&<Link prefetch={false} href={href(context,undefined)}>최신 저장일 조회</Link>}</CairnForm>
 <p className={styles.muted}>저장 KRW · 현재 시세 평가가 아님{context.currency==='USD'?' · 조회 통화 USD와 별개이며 현재 환율로 환산하지 않음':''} · {date===undefined?'허용 범위의 공통 최신 날짜 하나':'명시한 날짜 그대로 조회'}</p>
 <p className={styles.muted}>기존 모델이 지원하는 활성 투자 계좌 기준 · 전체 금융자산 평가가 아닙니다.</p>
 <CairnStatus as="p" role="status">{visible.message}</CairnStatus>
 {visible.accounts&&<SnapshotSummary model={visible.accounts}/>}
 {visible.positions&&<p>저장 기준일 <strong>{visible.positions.snapshotDate}</strong> · 확인 계좌 {visible.positions.coveredAccounts.length} / 예상 {visible.positions.expectedAccounts.length} · 종목 기록 {visible.positions.positions.length}개</p>}
 {model&&<SnapshotWarnings model={model}/>}
 {visible.accounts&&<AccountSnapshotTable model={visible.accounts}/>}
 {visible.positions&&<PositionSnapshotTable model={visible.positions}/>}
 {model&&visible.date&&<Link prefetch={false} href={href(context,visible.date,read.kind==='accounts'?'positions':'accounts')}>{read.kind==='accounts'?'같은 저장일의 종목 기록 읽기 ↗':'같은 저장일의 계좌 평가 읽기 ↗'}</Link>}
 {visible.state==='unavailable'&&<CairnButton variant="secondary" type="button" onClick={()=>startTransition(()=>router.refresh())}>저장 평가 다시 조회</CairnButton>}
 <details className={styles.evidence}><summary>포함 범위와 저장 근거</summary><p>현재 소유 관계를 확인한 활성 비현금 계좌 중 기존 모델이 지원하는 투자자산 보유 계좌만 조회합니다. 전량 매도한 계좌의 전체 과거 기록, 모든 저장 날짜 목록과 페이지 나누기는 미연결입니다.</p><p>저장 account=all 행은 소유 계좌나 전체 합계의 근거로 사용하지 않습니다. 다른 날짜의 계좌 값을 합치거나 누락 금액을 0으로 채우지 않습니다.</p>{model?<SnapshotEvidence model={model}/>:<p>예상 계좌 {visible.expectedAccounts.join(', ')||'확인 전 또는 없음'}{visible.reason?' · 모델 상태 '+visible.reason:''}</p>}<p>당시 목표는 현재 승인 목표가 아닙니다. 체결가·당시 원가를 역산하지 않습니다. 저장·수정·삭제 미연결 · 읽은 시각 {visible.readAt??'확인 전'}</p></details>
 </section></BetaShell>;
}
