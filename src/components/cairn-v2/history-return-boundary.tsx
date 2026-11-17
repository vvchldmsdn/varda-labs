'use client';
import { Button as CairnButton, Status as CairnStatus } from "@/components/cairn-ui";

import {useLayoutEffect,useState,type ReactNode} from 'react';
import {useSearchParams} from 'next/navigation';
import type {BetaContext} from '@/lib/cairn-v2/navigation';
import type {BetaView} from '@/lib/cairn-v2/read-contract';
import {parseHistoryDisplayReturn,validateHistoryDisplayReturn,parseHistoryReturn,resolveHistoryReturn,validateHistoryReturn} from '@/lib/cairn-v2/history-return';
import {restoreHistoryStudioSelection} from '@/lib/cairn-v2/history-studio-selection';
import {useBetaPreferences} from './beta-provider';
import styles from './events.module.css';
export function HistoryReturnBoundary({context,view,children,displayBinding}:{context:BetaContext;view:BetaView;children:ReactNode;displayBinding?:string}){
 const search=useSearchParams(),params=new URLSearchParams(search.toString()),displayHint=parseHistoryDisplayReturn(params,context),storedHint=resolveHistoryReturn(parseHistoryReturn(params,context),view);
 const displayOnly=displayHint!==null,hint=displayOnly?displayHint:storedHint,status=displayOnly?validateHistoryDisplayReturn(displayHint,view):validateHistoryReturn(storedHint,view);
 const date=!displayOnly&&storedHint&&storedHint!=='invalid'?storedHint.date:null;
 const key=JSON.stringify([displayOnly,hint,displayBinding]),[applied,setApplied]=useState<string|null>(null),[dismissed,setDismissed]=useState<string|null>(null);
 const {historyDate,period,metric,setHistoryDate,setPeriod,setMetric,historyStudio,setHistoryStudio}=useBetaPreferences();
 const restoredStudio=status==='valid'&&hint&&hint!=='invalid'?restoreHistoryStudioSelection({current:historyStudio,context,displayBinding,date,metric:hint.metric}):null;
 const studioReady=!restoredStudio||JSON.stringify(restoredStudio)===JSON.stringify(historyStudio);
 // Acknowledge only after the existing preference setters have taken effect.
 // This conditional render adjustment avoids a second local state update in the effect.
 if(status==='valid'&&hint&&hint!=='invalid'&&applied!==key&&historyDate===date&&period===hint.period&&metric===hint.metric&&studioReady)setApplied(key);
 useLayoutEffect(()=>{if(status==='valid'&&hint&&hint!=='invalid'&&applied!==key){
  setHistoryDate(date);setPeriod(hint.period);setMetric(hint.metric);
  if(restoredStudio&&!studioReady)setHistoryStudio(restoredStudio);
 }},[status,hint,date,key,applied,setHistoryDate,setPeriod,setMetric,restoredStudio,studioReady,setHistoryStudio]);
 useLayoutEffect(()=>{
  if(status==='loading'||(status==='valid'&&applied!==key)||location.hash!=='#history-evidence')return;
  let target=document.getElementById('history-evidence');
  if(!target){
   const panel=document.querySelector<HTMLDetailsElement>('[data-history-evidence-panel]');
   if(panel){panel.open=true;target=panel.querySelector('summary');}
  }
  // The return target may live inside secondary record details. Reveal it before
  // focusing; this runs only after the existing scope/date return checks above.
  for(let parent=target?.parentElement;parent;parent=parent.parentElement){
   if(parent.tagName==='DETAILS')(parent as HTMLDetailsElement).open=true;
  }
  target?.focus({preventScroll:true});
 },[status,applied,key]);
 if(status==='none')return children;
 if(status==='valid'&&applied===key)return children;
 if(status==='loading'||status==='valid')return <CairnStatus as="p" role="status">{displayOnly?'복귀 보기와 현재 조회 범위를 확인하는 중':'복귀 날짜와 현재 조회 범위를 확인하는 중'}</CairnStatus>;
 const message=status==='missing'?date+'의 히스토리 관측이 없습니다. 이벤트 기록으로 그래프 점을 만들거나 다른 날짜를 대신 선택하지 않았습니다.':status==='outside-period'?date+'의 관측이 복귀 기간 밖에 있습니다. 기간과 날짜를 자동 변경하지 않았습니다.':status==='unavailable'?displayOnly?'현재 권한·통화·조회 상태에서 이전 기간과 지표를 적용할 수 없습니다.':'현재 권한·통화·조회 상태에서 복귀 날짜의 히스토리를 확인할 수 없습니다.':'복귀 문맥이 올바르지 않거나 조회 범위·통화가 달라졌습니다. 이전 날짜·보기를 적용하지 않았습니다.';
 return <><CairnStatus as="div" className={styles.returnNotice} role="status" data-history-return={status}><p>{message}</p>{dismissed!==key&&<CairnButton variant="secondary" id="history-evidence" type="button" onClick={()=>{setHistoryDate(null);setDismissed(key);}}>현재 범위 히스토리 보기</CairnButton>}</CairnStatus>{dismissed===key&&children}</>;
}
