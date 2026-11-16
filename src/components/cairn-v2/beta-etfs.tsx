'use client';
import { instrumentLabel } from "@/lib/instrument-display";
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
 const epochForForm=freshness?.store.pendingEpoch();
 const formContext=<><input type="hidden" name="mode" value="domain"/><input type="hidden" name="scope" value={context.scope}/><input type="hidden" name="currency" value={context.currency}/>{epochForForm&&<input type="hidden" name="_betaRead" value={epochForForm}/>}</>;
 const nav=(next:EtfParams)=>start(()=>router.push(etfHref(context,next,freshness?.store.pendingEpoch()),{scroll:false}));
 const shell=blankDomainView(visible.state==='unauthorized'?'unauthorized':visible.state==='loading'?'loading':'ready',visible.message);shell.domain!.scopes=visible.scopes;
 return <BetaShell context={context} setContext={next=>start(()=>router.push(etfHref(next,p,freshness?.store.pendingEpoch()),{scroll:false}))} readView={shell} workspace="etfs" originalPath="/etfs">
 <section className={styles.workspace} id="etf-reference" data-etf-state={visible.state}>
 <DetailHeader title="ETF 구성 종목" description="ETF를 고르면 기준일에 담긴 종목과 비중을 볼 수 있어요." />
 <CairnForm method="get" action="/beta/etfs#etf-reference" className={styles.search} onSubmit={e=>{e.preventDefault();nav({...p,q:values.q.trim()||undefined,etfMasterId:undefined,ticker:undefined})}}>
 {formContext}{typeof p.asOfDate==='string'&&<input type="hidden" name="asOfDate" value={p.asOfDate}/>}
 <CairnField>ETF 검색<CairnInput name="q" required={!p.q || !!values.q} aria-label="ETF 검색어" value={values.q} onChange={e=>setDraft({...values,q:e.target.value})} placeholder="이름 또는 티커" maxLength={120}/></CairnField><CairnButton variant="primary" disabled={pending} type="submit">검색</CairnButton>{p.q && <Link prefetch={false} href={etfHref(context,{...p,q:undefined,etfMasterId:undefined,ticker:undefined},epochForForm)}>검색 해제</Link>}</CairnForm>
 {visible.state!=='ready'&&visible.state!=='unselected'&&<CairnStatus as="p" role="status">{visible.message}</CairnStatus>}
 <div className={styles.layout}>
 {visible.masters.length>0 && <aside aria-label="ETF 검색 결과"><p className={styles.muted}>검색 결과 {visible.masters.length}개{visible.masters.length===24 && ' · 최대 24개 표시'}</p><ul className={styles.list}>{visible.masters.map(m=><li key={m.id}><Link prefetch={false} aria-current={visible.selected?.id===m.id?'true':undefined} href={etfHref(context,{...p,etfMasterId:m.id,ticker:undefined},freshness?.store.pendingEpoch())}>{instrumentLabel(m)}<small>{m.ticker} · {m.market} · {m.currency}</small></Link></li>)}</ul></aside>}
 <div className={styles.content}>{visible.state==='unselected'&&<p className={styles.emptySelection}>구성을 확인할 ETF를 선택하세요.</p>}{visible.selected&&<><CairnSectionTitle level="h3">{instrumentLabel(visible.selected)}</CairnSectionTitle><p>{visible.selected.ticker} · {visible.selected.market} · {visible.selected.currency}</p></>}
 {p.etfMasterId&&<CairnForm method="get" action="/beta/etfs#etf-reference" className={styles.filter} onSubmit={e=>{e.preventDefault();nav({...p,asOfDate:values.date})}}>{formContext}
 {['etfMasterId','ticker','q'].map(name=>typeof p[name]==='string' && <input type="hidden" key={name} name={name} value={p[name]}/>)}
 <CairnField>저장 기준일<CairnInput name="asOfDate" type="date" aria-label="ETF 저장 기준일" value={values.date} required onChange={e=>setDraft({...values,date:e.target.value})}/></CairnField><CairnButton variant="primary" type="submit" disabled={pending}>날짜 조회</CairnButton><Link prefetch={false} href={etfHref(context,{...p,asOfDate:undefined},freshness?.store.pendingEpoch())}>최신 저장일 조회</Link></CairnForm>}

 {visible.selected&&<p>저장 기준일 <strong>{visible.date??'기록 없음'}</strong> · {visible.latest?'최근 자료':'선택한 날짜'} · 금액은 저장 통화 기준</p>}
 {visible.groups.length>0&&<EtfHoldingsTable key={JSON.stringify([key,visible.readReceipt,visible.date])} read={visible}/>}
 {visible.state==='unavailable'&&<CairnButton variant="secondary" type="button" onClick={()=>start(()=>router.refresh())}>ETF 다시 조회</CairnButton>}
 </div></div></section></BetaShell>;
}
