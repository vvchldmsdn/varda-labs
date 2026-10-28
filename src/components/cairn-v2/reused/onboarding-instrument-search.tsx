'use client';
import { Button as CairnButton, Field as CairnField, Input as CairnInput, Status as CairnStatus } from "@/components/cairn-ui";


import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import type {OnboardingInstrument,OnboardingInstrumentSearchResult} from '../../../lib/onboarding-instrument-search';
import styles from './onboarding-search.module.css';

// Limited display-core port: candidate 736f417 components/onboarding/instrument-search.tsx.
// Keeps 300ms debounce, request cancellation and explicit selection. The absent
// candidate locale/icon roots and its preview fixture branch are not mounted.
export function OnboardingInstrumentSearch({onSelect,disabled=false,privateQuery=false,manualEntryAvailable=true}:{onSelect:(instrument:OnboardingInstrument)=>void;disabled?:boolean;privateQuery?:boolean;manualEntryAvailable?:boolean}){
 const id=useId(),input=useRef<HTMLInputElement>(null),list=useRef<HTMLUListElement>(null);
 const [query,setQuery]=useState(''),[results,setResults]=useState<readonly OnboardingInstrument[]>([]),[status,setStatus]=useState<'idle'|'loading'|OnboardingInstrumentSearchResult['status']>('idle');
 useEffect(()=>{
  if(!query.trim())return;
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   setStatus('loading');
   try{
    const response=await fetch(privateQuery?'/api/instruments/search':`/api/instruments/search?q=${encodeURIComponent(query.trim())}`,{signal:controller.signal,cache:'no-store',credentials:'same-origin',...(privateQuery?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:query.trim()})}:{})});
    const data:OnboardingInstrumentSearchResult=await response.json();
    if(controller.signal.aborted)return;
    if(response.ok&&data.status==='ready'&&Array.isArray(data.instruments)){setResults(data.instruments);setStatus('ready');}
    else{setResults([]);setStatus(data.status==='unauthorized'?'unauthorized':data.status==='invalid'?'invalid':'unavailable');}
   }catch{if(!controller.signal.aborted){setResults([]);setStatus('unavailable');}}
  },300);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,privateQuery]);
 const close=()=>{setQuery('');setResults([]);setStatus('idle');input.current?.focus();};
 const keyDown=(event:KeyboardEvent)=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
  if(event.target===input.current&&event.key==='Enter')event.preventDefault();
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   const buttons=Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button')??[]);if(!buttons.length)return;
   event.preventDefault();const at=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='ArrowDown'?Math.min(at+1,buttons.length-1):Math.max(at-1,0);buttons[next]?.focus();
  }
 };
 return <div className={styles.root} data-instrument-search-state={status} onKeyDown={keyDown}>
  <CairnField htmlFor={id}>종목 이름 또는 티커 검색</CairnField>
  <CairnInput ref={input} id={id} value={query} maxLength={80} disabled={disabled} autoComplete="off" placeholder="종목 이름 또는 티커 검색"
   onChange={event=>{setQuery(event.target.value);setResults([]);setStatus(event.target.value.trim()?'loading':'idle');}} aria-describedby={`${id}-status`} aria-controls={results.length?`${id}-results`:undefined}/>
  <CairnStatus as="p" id={`${id}-status`} role="status" className={styles.hint}>
   {status==='loading'?'검색 중':status==='unauthorized'?'로그인과 접근 권한을 다시 확인해 주세요.':status==='invalid'?'검색어를 확인해 주세요.':status==='unavailable'?(manualEntryAvailable?'검색을 불러오지 못했습니다. 다시 입력하거나 티커로 직접 등록해 주세요.':'검색을 불러오지 못했습니다. 다시 입력해 주세요.'):status==='ready'&&!results.length?(manualEntryAvailable?'확인된 종목 목록에 없습니다. 아래에서 티커로 직접 등록할 수 있습니다.':'확인된 종목 목록에 없습니다. 다른 검색어를 입력해 주세요.'):'저장된 한국·미국 ETF와 ETF 구성 주식을 검색합니다. 전체 상장 종목 목록은 아닙니다. 결과는 최대 12개입니다.'}
  </CairnStatus>
  {results.length>0&&<ul ref={list} id={`${id}-results`} className={styles.results} aria-label="종목 검색 결과">
   {results.map(row=><li key={row.id}><CairnButton variant="ghost" className={styles.result} type="button" disabled={disabled} onClick={()=>{onSelect(row);close();}}>
    <span><strong>{row.name}</strong><small>{row.ticker} · {row.market==='korea'?'한국':'미국'} · {row.currency}</small></span><span>{row.assetType==='stock'?'주식':'ETF'}</span>
   </CairnButton></li>)}
  </ul>}
 </div>;
}
