'use client';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {domainQueryContext} from '@/lib/cairn-v2/read-service';
import {accountsKey,accountsHref,blankAccounts,type AccountsRead} from '@/lib/cairn-v2/account-contract';
import {holdingsHref} from '@/lib/cairn-v2/holding-contract';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness,useBetaExistingCrudAvailable} from './beta-provider';
import {CairnSelect} from './reused/cairn-select';
import styles from './accounts.module.css';
import tableStyles from './record-table.module.css';

export function BetaAccounts({read}:{read:AccountsRead}) {
  const search=useSearchParams(),router=useRouter(),context=domainQueryContext(search.toString()),freshness=useBetaReadFreshness();
  const [pending,startTransition]=useTransition(),observed=freshness?.observed,epoch=freshness?.epoch;
  useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[read.readReceipt,read.readEpoch,observed,epoch]);
  const visible=pending||accountsKey(context)!==read.queryKey||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankAccounts(context,'loading','사용자·조회 범위를 다시 확인하는 중'):read;
  const managementAvailable=useBetaExistingCrudAvailable();
  const [filter,setFilter]=useState('active');
  const active=visible.rows.filter(row=>row.isActive),archived=visible.rows.filter(row=>!row.isActive);
  const rows=filter==='active'?active:filter==='archived'?archived:visible.rows;
  const navigate=(next:typeof context)=>startTransition(()=>router.push(accountsHref(next,freshness?.store.pendingEpoch()),{scroll:false}));
  const shell=blankDomainView(visible.state==='loading'?'loading':visible.state==='unauthorized'?'unauthorized':'ready',visible.message);shell.domain!.scopes=visible.scopes;
  return <BetaShell context={context} setContext={navigate} readView={shell} workspace="accounts" originalPath="/portfolio/accounts">
    <section className={styles.workspace} id="account-summary" data-accounts-state={visible.state}>
      <DetailHeader title="계좌 현황" description="상단에서 선택한 범위와 관계없이 내 계좌를 모두 보여줘요." />
      {visible.state!=='ready'&&<CairnStatus as="p" role="status">{visible.message}</CairnStatus>}
      {visible.state==='ready'&&<>
        <div className={styles.filter}><CairnSelect label="계좌 보기" value={filter} options={[{value:'active',label:'활성 계좌'},{value:'archived',label:'보관 계좌'},{value:'all',label:'전체 계좌'}]} onValueChange={next=>{if(['active','archived','all'].includes(next))setFilter(next)}}/>
          <p className={styles.muted}>전체 {visible.rows.length}개 · 활성 {active.length} · 보관 {archived.length}</p>
        </div>
        {rows.length?<div className={`${styles.tableScroll} ${tableStyles.viewport}`}><table role="table" aria-label="계좌 현황">
          <thead><tr><th scope="col">계좌</th><th scope="col">계좌 통화</th><th scope="col">상태</th><th scope="col" className={styles.number}>미보관 보유 기록</th><th scope="col">조회·근거</th></tr></thead>
          <tbody>{rows.map(row=><tr key={row.key}>
            <th scope="row"><span className={styles.name}>{row.name}</span><small>{row.accountType}</small></th>
            <td><span className={tableStyles.fieldLabel} aria-hidden>계좌 통화</span>{row.currency}</td>
            <td><span className={tableStyles.fieldLabel} aria-hidden>상태</span>{row.isActive?'활성':'보관'}</td>
            <td className={styles.number}><span className={tableStyles.fieldLabel} aria-hidden>미보관 보유 기록</span>{row.activeHoldingCount}</td>
            <td>{row.holdingsScopeKey?<Link prefetch={false} className={styles.continueLink} href={holdingsHref({...context,scope:row.holdingsScopeKey},freshness?.store.pendingEpoch())}>이 계좌의 보유 근거 ↗</Link>:<span className={styles.muted}>{row.isActive?'현재 조회 범위에서 연결 불가':'보관 계좌의 보유 조회 미지원'}</span>}
              <details className={styles.rowEvidence}><summary>계좌 기록 근거</summary><dl><dt>기록 갱신 시각 (UTC)</dt><dd>{row.updatedAt}</dd><dt>미보관 보유 기록</dt><dd>보관 처리되지 않은 저장 행 수입니다. 수량 0도 포함하며 현재 평가나 체결 수가 아닙니다.</dd><dt>미종료 범위 연결 · {row.openGroupReferenceCount}개</dt><dd>종료일이 지나지 않은 계좌·자산 연결의 고유 분석 범위 수입니다. 미래 시작 연결이나 보관된 분석 범위 참조도 포함할 수 있어 현재 적용 범위 수와 다릅니다.</dd></dl></details>
            </td>
          </tr>)}</tbody></table></div>:<p>선택한 표시 조건의 계좌가 없습니다.</p>}
      </>}
      {visible.state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={()=>startTransition(()=>router.refresh())}>계좌 현황 다시 조회</CairnButton>}
      <details className={styles.evidence}><summary>조회 범위와 계좌 상태의 의미</summary>
        <p>통화는 각 계좌에 등록된 값이에요. 보관한 계좌도 목록에 남고, 보유 내역은 활성 계좌에서 열 수 있어요.</p>
        <p>범위 기준일 {visible.serviceDate??'확인 전'} · 조회 시각 {visible.readAt??'확인 전'}</p>
        {managementAvailable && <p>계좌 관리에서 이름을 바꾸거나 보관한 계좌를 복원할 수 있어요.</p>}
      </details>
    </section>
  </BetaShell>;
}
