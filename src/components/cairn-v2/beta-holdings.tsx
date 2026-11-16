'use client';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {blankHoldings,holdingsKey,holdingsHref,type HoldingsRead} from '@/lib/cairn-v2/holding-contract';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {betaHref,betaReadHref} from '@/lib/cairn-v2/navigation';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness} from './beta-provider';
import {CairnSelect} from './reused/cairn-select';
import {HoldingsTable} from './holdings-table';
import styles from './holdings.module.css';

export function BetaHoldings({read}:{read:HoldingsRead}) {
  const search=useSearchParams(),router=useRouter(),context=domainQueryContext(search.toString()),freshness=useBetaReadFreshness();
  const [pending,startTransition]=useTransition(),observed=freshness?.observed,epoch=freshness?.epoch;
  useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
  const visible=pending||holdingsKey(context)!==read.queryKey||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankHoldings(context,'loading','사용자·범위·통화를 다시 확인하는 중'):read;
  const [filter,setFilter]=useState('active');
  const active=visible.rows.filter(row=>row.archivedAt===null),archived=visible.rows.filter(row=>row.archivedAt!==null);
  const rows=filter==='active'?active:filter==='archived'?archived:visible.rows;
  const navigate=(next:typeof context)=>startTransition(()=>router.push(holdingsHref(next,freshness?.store.pendingEpoch()),{scroll:false}));
  const shell=blankDomainView(visible.state==='loading'?'loading':visible.state==='unauthorized'?'unauthorized':'ready',visible.message);shell.domain!.scopes=visible.scopes;
  const readable=visible.state==='ready'||visible.state==='partial';
  return <BetaShell context={context} setContext={navigate} readView={shell} workspace="holdings" originalPath="/portfolio/holdings">
    <section className={styles.workspace} id="stored-holdings" data-holdings-state={visible.state}>
      <DetailHeader title="보유종목" description={<>저장된 수량·가격 기준{context.currency==='USD'?' · USD로 재환산하지 않습니다.':''}</>} />
      {visible.state!=="ready"&&<CairnStatus as="p" role="status">{visible.message}</CairnStatus>}
      {readable&&<>
        <div className={styles.filter}><CairnSelect label="보유 기록 보기" value={filter} options={[{value:'active',label:'보유 중'},{value:'archived',label:'보관 기록'},{value:'all',label:'확인 기록 전체'}]} onValueChange={next=>{if(['active','archived','all'].includes(next))setFilter(next)}}/>
          <p className={styles.muted}>보유 중 {active.length}건 · 보관 {archived.length}건{visible.excludedHoldingCount>0 && ` · 확인할 수 없는 기록 ${visible.excludedHoldingCount}건`}</p>
        </div>
        {rows.length?<HoldingsTable rows={rows}/>:<p>{visible.state==='partial'?'선택한 표시 조건의 확인 가능한 행 없음 · 제외된 근거가 있어 전체 보유 없음으로 확정하지 않습니다.':'선택한 표시 조건의 보유 기록이 없습니다.'}</p>}
      </>}
      {visible.state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={()=>startTransition(()=>router.refresh())}>보유 근거 다시 조회</CairnButton>}
      <Link prefetch={false} className={styles.continueLink} href={betaReadHref(betaHref('/beta/portfolio/structure',context),freshness?.store.pendingEpoch())}>현재 보유 평가·비중 보기 ↗</Link>
      <details className={styles.evidence}><summary>포함 범위와 읽기 기준</summary>
        <p>활성 계좌에 연결된 보유 기록을 보여줘요. 같은 종목도 계좌나 보유 기록이 다르면 각각 표시해요. 보관은 기록의 표시 상태예요.</p>
        <p>저장 가격은 등록된 통화 기준이에요. 종목의 ‘기록 근거’를 열면 원본 수량과 가격, 가격 기준 시각과 마지막 변경 시각을 확인할 수 있어요.</p>
        <p>범위 판정 기준일 {visible.serviceDate??'확인 전'} · 가격 기준일은 종목별 근거에서 확인 · 읽은 시각 {visible.readAt??'확인 전'}</p>
      </details>
    </section>
  </BetaShell>;
}
