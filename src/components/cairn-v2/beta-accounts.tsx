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
      <DetailHeader title="계좌 현황" description="본인 소유의 전체 계좌 · 상단 조회 범위와 별개인 목록입니다." />
      <CairnStatus as="p" role="status">{visible.message}</CairnStatus>
      {visible.state==='ready'&&<>
        <div className={styles.filter}><CairnSelect label="계좌 보기" value={filter} options={[{value:'active',label:'활성 계좌'},{value:'archived',label:'보관 계좌'},{value:'all',label:'전체 계좌'}]} onValueChange={next=>{if(['active','archived','all'].includes(next))setFilter(next)}}/>
          <p className={styles.muted}>전체 {visible.rows.length}개 · 활성 {active.length} · 보관 {archived.length}</p>
        </div>
        {rows.length?<div className={styles.tableScroll} role="region" aria-label="계좌 현황 표 가로 탐색" tabIndex={0}><table>
          <caption>계좌·통화와 저장 기록의 연결 근거 · 잔액이나 현재 평가액이 아닙니다</caption>
          <thead><tr><th scope="col">계좌</th><th scope="col">계좌 통화</th><th scope="col">상태</th><th scope="col" className={styles.number}>미보관 보유 기록</th><th scope="col">조회·근거</th></tr></thead>
          <tbody>{rows.map(row=><tr key={row.key}>
            <th scope="row"><span className={styles.name} title={row.name} tabIndex={0}>{row.name}</span><small>{row.accountType}</small></th><td>{row.currency}</td><td>{row.isActive?'활성':'보관'}</td>
            <td className={styles.number}>{row.activeHoldingCount}</td>
            <td>{row.holdingsScopeKey?<Link prefetch={false} className={styles.continueLink} href={holdingsHref({...context,scope:row.holdingsScopeKey},freshness?.store.pendingEpoch())}>이 계좌의 보유 근거 ↗</Link>:<span className={styles.muted}>{row.isActive?'현재 조회 범위에서 연결 불가':'보관 계좌의 보유 조회 미지원'}</span>}
              <details className={styles.rowEvidence}><summary>계좌 기록 근거</summary><dl><dt>기록 갱신 시각 (UTC)</dt><dd>{row.updatedAt}</dd><dt>미보관 보유 기록</dt><dd>보관 처리되지 않은 저장 행 수입니다. 수량 0도 포함하며 현재 평가나 체결 수가 아닙니다.</dd><dt>미종료 범위 연결 · {row.openGroupReferenceCount}개</dt><dd>종료일이 지나지 않은 계좌·자산 연결의 고유 분석 범위 수입니다. 미래 시작 연결이나 보관된 분석 범위 참조도 포함할 수 있어 현재 적용 범위 수와 다릅니다.</dd></dl></details>
            </td>
          </tr>)}</tbody></table></div>:<p>선택한 표시 조건의 계좌가 없습니다.</p>}
      </>}
      {visible.state==='unavailable'&&<CairnButton variant="secondary" className={styles.retry} type="button" onClick={()=>startTransition(()=>router.refresh())}>계좌 현황 다시 조회</CairnButton>}
      <details className={styles.evidence}><summary>조회 범위와 계좌 상태의 의미</summary>
        <p>기존 계좌 모델의 소유 계좌 전체를 읽습니다. 상단 범위는 접근 확인과 다른 읽기 화면의 문맥이며 이 목록의 포함 계좌를 바꾸지 않습니다. 표시 통화 {context.currency} 선택으로 원본 계좌 통화를 환산하거나 바꾸지 않습니다.</p>
        <p>범위 연결 판정일 {visible.serviceDate??'확인 전'} · 기록 갱신 시각은 계좌 변경 시각이며 잔액·가격 기준일이 아닙니다. 읽은 시각 {visible.readAt??'확인 전'}.</p>
        <p>보관 계좌도 원본 모델이 반환한 기록 수를 유지합니다. 보관이 전량 매도나 계좌 해지를 증명하지 않으며, 현재 보유 읽기 모델은 활성 계좌만 지원합니다.</p>
        <p>{managementAvailable ? "계좌 관리 메뉴에서 기존 생성·이름 수정·보관·복원 동작을 사용할 수 있습니다." : "이 실행 환경에서는 관리 요청을 보낼 수 없습니다."} 보기 선택과 근거 펼침은 새 금융 조회를 실행하지 않습니다.</p>
      </details>
    </section>
  </BetaShell>;
}
