'use client';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankEvents,eventKey,type EventRead} from '@/lib/cairn-v2/event-contract';
import {type BetaContext} from '@/lib/cairn-v2/navigation';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness} from './beta-provider';
import {EventTable,EventEvidence} from './event-table';
import {continueEventHref,historyReturnHref} from '@/lib/cairn-v2/history-return';
import styles from './events.module.css';
export function BetaEvents({read}:{read:EventRead}){
 const search=useSearchParams(),router=useRouter(),freshness=useBetaReadFreshness();const context=domainQueryContext(search.toString()),dates=search.getAll('date'),date=dates.length===1?dates[0]:dates.length?dates:undefined;
 const [pending,startTransition]=useTransition();const observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
 const visible=pending||eventKey(context,date??null)!==read.queryKey||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankEvents(context,typeof date==='string'?date:null,'loading','날짜·사용자·조회 범위를 다시 확인하는 중'):read;
 const [draft,setDraft]=useState<{query:string,value:string}|null>(null);const query=search.toString(),input=draft?.query===query?draft.value:typeof date==='string'?date:'';
 const navigate=(next:BetaContext,nextDate:string|string[]|undefined)=>startTransition(()=>router.push(continueEventHref(next,nextDate,freshness?.store.pendingEpoch(),new URLSearchParams(search.toString())),{scroll:false}));
 const shell=blankDomainView(visible.state==='loading'?'loading':visible.state==='unauthorized'?'unauthorized':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 return <BetaShell context={context} setContext={next=>navigate(next,date)} readView={shell} workspace="history" originalPath="/history"><section className={styles.workspace} id="date-events" data-events-state={visible.state}>
 <DetailHeader title="날짜별 거래·이벤트 근거" actions={<Link prefetch={false} href={historyReturnHref(context,date,freshness?.store.pendingEpoch(),new URLSearchParams(search.toString()))}>히스토리로 돌아가기 ↗</Link>} />
 <CairnForm className={styles.filter} onSubmit={e=>{e.preventDefault();navigate(context,input)}}><CairnField>기록 날짜 <CairnInput aria-label="이벤트 날짜" type="date" value={input} onChange={e=>setDraft({query,value:e.target.value})}/></CairnField><CairnButton variant="primary" type="submit">날짜 조회</CairnButton></CairnForm>
 {visible.state!=='ready'&&<CairnStatus as="p" role="status">{visible.message}</CairnStatus>}<p className={styles.muted}>저장 KRW · 소유 계좌의 최신 최대 100개 · 전체 거래 이력 아님{context.currency==='USD'?' · USD로 환산하지 않음':''}</p>
 {visible.rows.length>0&&<><p className={styles.summary}>선택 날짜 확인 기록 {visible.rows.length}건 · 매수/매도 {visible.rows.filter(r=>r.eventKind==='trade').length} · 자산 상태 {visible.rows.filter(r=>r.eventKind==='lifecycle').length}</p><EventTable rows={visible.rows}/></>}
 {visible.state==='partial'&&visible.rows.length===0&&<p>이 날짜의 기록 유무를 확정할 수 없습니다. 표시 한도 또는 불완전 근거를 확인하세요.</p>}
 {visible.state==='unavailable'&&<CairnButton variant="secondary" type="button" onClick={()=>startTransition(()=>router.refresh())}>이벤트 다시 조회</CairnButton>}
 <details className={styles.evidence}><summary>지원 범위와 원본 근거</summary><p>이벤트의 저장 날짜 기준 · 기록 시각은 체결 시각이 아닙니다. 전체 ISO 밀리초와 모델 원본 숫자를 아래에 보존합니다.</p><p>대상 계좌 {visible.includedAccounts.join(", ")||"확인 전"} · 히스토리 부분 평가와 같은 포함 계좌라고 추정하지 않습니다.</p><EventEvidence rows={visible.rows}/><p>기존 모델: 매수·매도·자산 추가·제외. 입출금·배당·수수료의 완전한 원장은 미연결입니다. 손익·거래 합계·평가액 변화의 원인을 계산하지 않습니다.</p><p>원본 통화·체결 시각·공개 이벤트/자산 ID·시장 식별은 제공되지 않습니다. 같은 티커의 행을 병합하거나 자산으로 연결하지 않습니다. 표의 행 순서는 이번 읽기 결과의 순서이며 영속 자산 식별자가 아닙니다.</p><p>금액/수량은 기존 모델의 number, 기록 시각은 기존 ISO 밀리초 정밀도입니다. DB 원문 소수/밀리초 이하 정밀도를 복원하지 않습니다. broker source·rule·raw row는 전달하지 않습니다.</p><p>정정 상계·스냅샷 비교·거래 저장 미연결 · 읽은 시각 {visible.readAt??'확인 전'}</p></details>
 </section></BetaShell>;
}
