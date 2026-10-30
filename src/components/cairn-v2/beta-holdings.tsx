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
          <p className={styles.muted}>확인한 행 {visible.rows.length}개 · 보유 중 {active.length} · 보관 {archived.length} · 제외 {visible.excludedHoldingCount}개</p>
        </div>
        {rows.length?<HoldingsTable rows={rows}/>:<p>{visible.state==='partial'?'선택한 표시 조건의 확인 가능한 행 없음 · 제외된 근거가 있어 전체 보유 없음으로 확정하지 않습니다.':'선택한 표시 조건의 보유 기록이 없습니다.'}</p>}
      </>}
      {visible.state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={()=>startTransition(()=>router.refresh())}>보유 근거 다시 조회</CairnButton>}
      <Link prefetch={false} className={styles.continueLink} href={betaReadHref(betaHref('/beta/portfolio/structure',context),freshness?.store.pendingEpoch())}>현재 보유 평가·비중 보기 ↗</Link>
      <details className={styles.evidence}><summary>포함 범위와 읽기 기준</summary>
        <p>기존 보유 읽기 모델의 개별 기록입니다. 보유 관계·scope를 확인한 뒤 읽으며 같은 티커의 다른 계좌/자산을 합치지 않습니다. 표시 행의 순서 키는 이번 읽기 안의 구분이며 영속 자산 식별자가 아닙니다.</p>
        <p>비활성 계좌와 연결이 끊어진 기록은 이 모델에서 지원하지 않습니다. 보관 기록은 활성 계좌와의 관계가 남아 있는 경우만 포함되며 매도 체결 내역을 의미하지 않습니다.</p>
        <p>수량·평균원가·저장 가격은 원본 문자열 정밀도 그대로입니다. 저장 가격은 현재 실시간 시세나 체결가가 아니며, 평가액·손익·환율 환산을 새로 계산하지 않습니다. 가격 관측 시각과 기록 갱신 시각도 서로 다릅니다.</p>
        <p>범위 판정 기준일 {visible.serviceDate??'확인 전'} · 가격 기준일은 종목별 근거에서 확인 · 읽은 시각 {visible.readAt??'확인 전'}</p>
        <p>이 표는 저장 근거를 읽습니다. 관리 메뉴의 변경 요청과 별개이며, 기록 보기 변경과 근거 펼침은 새 조회를 실행하지 않습니다.</p>
      </details>
    </section>
  </BetaShell>;
}
