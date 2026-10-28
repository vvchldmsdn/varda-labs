'use client';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";

import { DetailHeader } from './ui/molecules';
import Link from 'next/link';
import {useLayoutEffect,useState,useTransition} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {BetaShell} from './beta-shell';
import {useBetaReadFreshness} from './beta-provider';
import {blankDomainView} from '@/lib/cairn-v2/read-contract';
import {domainContext} from '@/lib/cairn-v2/read-service';
import {blankEtf,etfHref,etfKey,etfParams,type EtfRead,type EtfParams} from '@/lib/cairn-v2/etf-contract';
import styles from './etfs.module.css';
import {EtfHoldingsTable} from './etf-holdings-table';
export function BetaEtfs({read}:{read:EtfRead}){
 const search=useSearchParams(),router=useRouter(),freshness=useBetaReadFreshness(),p=etfParams(new URLSearchParams(search.toString())),context=domainContext(p);
 const [pending,start]=useTransition(),[draft,setDraft]=useState<{key:string;q:string;date:string}|null>(null);
 const key=etfKey(p),observed=freshness?.observed,epoch=freshness?.epoch;
 useLayoutEffect(()=>{observed?.(read.readReceipt,read.readEpoch)},[observed,epoch,read.readReceipt,read.readEpoch]);
 const visible=pending||read.queryKey!==key||freshness?.store.blocked(read.readReceipt,read.readEpoch)?blankEtf(p,'loading','사용자·ETF·기준일을 다시 확인하는 중'):read;
 const values=draft?.key===key?draft:{key,q:typeof p.q==='string'?p.q:'',date:typeof p.asOfDate==='string'?p.asOfDate:''};
 const nav=(next:EtfParams)=>start(()=>router.push(etfHref(context,next,freshness?.store.pendingEpoch()),{scroll:false}));
 const shell=blankDomainView(visible.state==='unauthorized'?'unauthorized':visible.state==='loading'?'loading':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 return <BetaShell context={context} setContext={next=>start(()=>router.push(etfHref(next,p,freshness?.store.pendingEpoch()),{scroll:false}))} readView={shell} workspace="etfs" originalPath="/etfs">
 <section className={styles.workspace} id="etf-reference" data-etf-state={visible.state}>
 <DetailHeader title="ETF의 저장 구성" description="공용 ETF 참고 자료 · 현재 조회 범위의 개인 보유 분석이 아닙니다." />
 <CairnForm className={styles.search} onSubmit={e=>{e.preventDefault();nav({...p,q:values.q||undefined,etfMasterId:undefined,ticker:undefined})}}>
 <CairnField>ETF 검색<CairnInput aria-label="ETF 검색어" value={values.q} onChange={e=>setDraft({...values,q:e.target.value})} placeholder="이름 또는 티커" maxLength={120}/></CairnField><CairnButton variant="primary" disabled={pending} type="submit">검색</CairnButton></CairnForm>
 <CairnStatus as="p" role="status">{visible.message}</CairnStatus>
 <div className={styles.layout}>
 <aside aria-label="ETF 검색 결과"><p className={styles.muted}>검색 결과 최대 24건 · 전체 목록 아님</p><ul className={styles.list}>{visible.masters.map(m=><li key={m.id}><Link prefetch={false} aria-current={visible.selected?.id===m.id?'true':undefined} href={etfHref(context,{...p,etfMasterId:m.id,ticker:undefined},freshness?.store.pendingEpoch())}>{m.name}<small>{m.ticker} · {m.market} · {m.currency}</small></Link></li>)}</ul></aside>
 <div className={styles.content}>{visible.state==='unselected'&&<p className={styles.emptySelection}>검색 결과에서 ETF를 선택해 저장 구성과 기준일을 확인하세요.</p>}{visible.selected&&<><CairnSectionTitle level="h3">{visible.selected.name}</CairnSectionTitle><p>{visible.selected.ticker} · {visible.selected.market} · 마스터 통화 {visible.selected.currency}</p></>}
 <CairnForm className={styles.filter} onSubmit={e=>{e.preventDefault();nav({...p,asOfDate:values.date})}}><CairnField>저장 기준일<CairnInput type="date" aria-label="ETF 저장 기준일" value={values.date} required onChange={e=>setDraft({...values,date:e.target.value})}/></CairnField><CairnButton variant="primary" type="submit" disabled={!p.etfMasterId||pending}>날짜 조회</CairnButton>{p.etfMasterId&&<Link prefetch={false} href={etfHref(context,{...p,asOfDate:undefined},freshness?.store.pendingEpoch())}>최신 저장일 조회</Link>}</CairnForm>
 <p className={styles.muted}>ETF 변경 시 지정일 유지 · 최신 조회는 ETF별 저장일을 선택합니다.</p>
 {visible.selected&&<p>저장 기준일 <strong>{visible.date??'기록 없음'}</strong> · {visible.latest?'최신 저장일 조회':'명시한 날짜 그대로'} · 조회 통화 {context.currency}와 별개로 저장 통화 유지</p>}
 {visible.groups.length>0&&<EtfHoldingsTable key={JSON.stringify([key,visible.readReceipt,visible.date])} read={visible}/>}
 {visible.state==='unavailable'&&<CairnButton variant="secondary" type="button" onClick={()=>start(()=>router.refresh())}>ETF 다시 조회</CairnButton>}
 </div></div></section></BetaShell>;
}
