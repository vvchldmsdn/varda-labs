"use client";

import { instrumentLabel } from "@/lib/instrument-display";
import {useState,type CSSProperties,type KeyboardEvent} from 'react';
import type {BetaView} from '@/lib/cairn-v2/read-contract';
import type {PortfolioDashboardHeatmapCell} from '@/lib/cairn-v2/heatmap-model';
import {eventNumber} from '@/lib/cairn-v2/event-display';
import {Button, ChoiceGroup} from '@/components/cairn-ui';
import styles from './holding-heatmap.module.css';
const signed=(value:number|null)=>value===null?'—':(value>0?'+':'')+eventNumber(value);
const basisLabel=(cell:PortfolioDashboardHeatmapCell)=>cell.basis==='live_price'?'가격 등락률':cell.basis==='unit_value'?'단위 평가 변동률':cell.basis==='market_value'?'평가액 변동률':cell.basis==='live_movement'?'현재 평가액 변동률':'변동률 비교 불가';
// Selection/arrow-key behavior and color scale are a limited port of the original
// components/home/holding-movement-heatmap.tsx; no data fetching or graph engines.
export function HoldingHeatmap({view,compact=false}:{view:BetaView;compact?:boolean}){
 const read=view.domain?.heatmap;
 const [draft,setDraft]=useState<{key:string;row:number;cell:number}|null>(null);
 const [days,setDays]=useState(31);
 if(!read?.history)return <p role="status" className={styles.message}>{read?.message??(view.domain?.state==='loading'?'종목 흐름 확인 중':view.domain?.state==='unauthorized'?'로그인과 조회 범위를 확인해 주세요':'종목 흐름의 저장 이력을 확인하지 못했습니다.')}</p>;
 const start=compact?0:Math.max(0,read.history.dates.length-days);
 const history={...read.history,dates:read.history.dates.slice(start),rows:read.history.rows.map(row=>({...row,cells:row.cells.slice(start)}))};
 const repeatedNames=new Set(history.rows.filter((row,index,rows)=>rows.findIndex(other=>instrumentLabel(other)===instrumentLabel(row))!==index).map(row=>instrumentLabel(row)));
 if(!history.rows.length)return <p role="status" className={styles.message}>{read.message}</p>;
 const readKey=JSON.stringify([read.scopeKey,view.domain?.refreshedAt,history.rows.map(r=>r.holdingId),history.dates]);
 const selection=draft?.key===readKey?draft:null;
 const selectedRow=selection?history.rows[selection.row]:null;
 const selectedCell=selectedRow&&selection?selectedRow.cells[selection.cell]:null;
 function choose(row:number,cell:number){setDraft({key:readKey,row,cell});}
 function move(event:KeyboardEvent<HTMLButtonElement>,row:number,cell:number){
  const movement:Record<string,number[]>={ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],ArrowUp:[-1,0]};const delta=movement[event.key];if(!delta)return;
  event.preventDefault();const nextRow=Math.min(Math.max(row+delta[0],0),history.rows.length-1),nextCell=Math.min(Math.max(cell+delta[1],0),history.dates.length-1);choose(nextRow,nextCell);
  const target=event.currentTarget.closest<HTMLElement>('[data-heatmap-grid]')?.querySelector<HTMLElement>(`[data-row-index="${nextRow}"][data-cell-index="${nextCell}"]`);
  target?.focus({preventScroll:true});
  // Native nearest scrolling honors the sticky label/date margins below.
  target?.scrollIntoView({block:"nearest",inline:"nearest"});
 }
 return <div className={styles.surface} data-compact={compact} data-heatmap-state={read.state}>
  {!compact&&<div className={styles.toolbar}><p className={styles.caption}>종목별 평가 변동 · KRW</p><ChoiceGroup label="종목 흐름 기간" appearance="segmented">{[7,14,31].map(value=><Button key={value} variant="selection" type="button" aria-pressed={days===value} onClick={()=>{setDays(value);setDraft(null);}}>{value===31?'전체':`${value}일`}</Button>)}</ChoiceGroup></div>}
  <div className={styles.viewport} role="region" aria-label="종목 흐름 · 가로 탐색">
   <div className={styles.matrix} data-heatmap-grid style={{gridTemplateColumns:`var(--heatmap-label-width,132px) repeat(${history.dates.length},minmax(var(--heatmap-cell-width,28px),1fr))`} as CSSProperties}>
    <span className={styles.corner}>{compact?<span className={styles.visuallyHidden}>종목 / 날짜</span>:'종목 / 날짜'}</span>{history.dates.map((date,index)=><span key={date} title={(read.currentDate===date?'현재 · ':'')+date} className={styles.date}>{compact?(index===0||history.dates[index-1].slice(0,7)!==date.slice(0,7)?date.slice(5).replace('-','.'):date.slice(8)):<>{read.currentDate===date?'현재 ':''}{date.slice(5).replace('-','.')}</>}</span>)}
    {history.rows.map((row,rowIndex)=><div className={styles.row} key={row.holdingId}>
     <span className={styles.label} title={instrumentLabel(row)+' · '+row.account}><span className={styles.name}>{instrumentLabel(row)}</span><small className={compact&&!repeatedNames.has(instrumentLabel(row))?styles.visuallyHidden:undefined}>{row.account}</small></span>
     {row.cells.map((cell,cellIndex)=>{const selected=selection?.row===rowIndex&&selection.cell===cellIndex;return <button key={row.holdingId+':'+cell.date} type="button" className={styles.cell} data-heatmap-cell data-row-index={rowIndex} data-cell-index={cellIndex} data-change-basis={cell.basis} aria-label={instrumentLabel(row)+' · '+row.account+' · '+cell.date+' · '+basisLabel(cell)+' '+signed(cell.changePct)+(cell.changePct===null?'':'%')} aria-pressed={selected} tabIndex={selected||(!selection&&rowIndex===0&&cellIndex===0)?0:-1} onClick={()=>choose(rowIndex,cellIndex)} onKeyDown={event=>move(event,rowIndex,cellIndex)} style={heatmapStyle(cell)}>{cell.changePct===null?'—':cell.changePct===0?'0':''}</button>;})}
    </div>)}
   </div>
  </div>
  {!compact&&<div className={styles.legend}><span>하락 <i className={styles.down}/></span><span>0 <i/></span><span>상승 <i className={styles.up}/></span><span>비교 불가 <i className={styles.missing}/></span></div>}
  <div className={styles.readout} data-empty={compact&&!selectedCell} aria-live="polite">{selectedRow&&selectedCell?<><p><strong>{instrumentLabel(selectedRow)}</strong> · {selectedRow.account} · {selectedCell.date===read.currentDate?'현재 ':''}{selectedCell.date}<button type="button" onClick={()=>setDraft(null)} aria-label="히트맵 선택 해제">×</button></p><p>{basisLabel(selectedCell)} <strong>{signed(selectedCell.changePct)}{selectedCell.changePct===null?'':'%'}</strong>{selectedCell.changePct===null?' · 비교 자료 없음':''}</p>{!compact&&<dl className={styles.facts}>{[['평가액',selectedCell.marketValueKrw],['평가액 변화',selectedCell.changeKrw],['가격 영향',selectedCell.priceChangeKrw],['환율 영향',selectedCell.fxChangeKrw]].map(([name,value])=><div key={String(name)}><dt>{name}</dt><dd>{eventNumber(value as number|null)} KRW</dd></div>)}</dl>}</>:compact?null:<p>종목·날짜를 선택해 자세히 볼 수 있어요.</p>}</div>
  {(compact||read.state==='partial')&&<p className={styles.caption} role="status">{compact?'KRW 기준':''}{read.state==='partial'?(compact?' · 일부 비교 자료 없음':'일부 날짜의 비교 자료가 없습니다.'):''}</p>}
  {!compact&&<details className={styles.evidence}><summary>날짜·수치의 근거</summary><p>{read.message} · 저장 KRW와 현재 평가를 구분하며 표시 통화로 재환산하지 않습니다. 평가액 변화는 투자 수익률과 다릅니다.</p><p>최근 최대 31개 달력 날짜 · 기존 서비스의 07:00 저장 경계·기록 우선순위 적용. 기록이 없는 날짜는 채우지 않습니다.</p>{selectedCell&&<p>원본 비율 {selectedCell.changePct===null?'—':String(selectedCell.changePct)}% · {basisLabel(selectedCell)} · {selectedCell.date===read.currentDate?'현재 평가':'저장 기록'}</p>}</details>}
 </div>;
}
function heatmapStyle(cell:PortfolioDashboardHeatmapCell):CSSProperties{
 if(cell.changePct===null)return{backgroundColor:'var(--wash,#e5e7e1)',backgroundImage:'repeating-linear-gradient(135deg, transparent 0 4px, rgba(112,121,113,.12) 4px 5px)'};
 const alpha=Math.min(.82,.22+(Math.abs(cell.changePct)/4)*.6);
 return{backgroundColor:cell.changePct>0?`color-mix(in srgb,var(--accent,#ef5a32) ${(alpha*100).toFixed(1)}%,transparent)`:cell.changePct<0?`color-mix(in srgb,var(--negative,#4772a9) ${(alpha*100).toFixed(1)}%,transparent)`:'var(--wash,#e5e7e1)'};
}
