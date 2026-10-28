'use client';
import { Button as CairnButton } from "@/components/cairn-ui";

import {useId,useLayoutEffect,useRef,useState} from 'react';
import {etfNumber,etfStatusLabels,type EtfRead} from '@/lib/cairn-v2/etf-contract';
import styles from './etfs.module.css';
export function EtfHoldingsTable({read}:{read:EtfRead}){
 const [selected,setSelected]=useState<string|null>(null),id=useId(),panel=useRef<HTMLElement|null>(null),triggers=useRef<Record<string,HTMLButtonElement|null>>({});
 const group=read.groups.find(g=>g.identityKey===selected);
 useLayoutEffect(()=>{if(group){panel.current?.focus({preventScroll:true});panel.current?.scrollIntoView({block:'nearest',behavior:'auto'})}},[group]);
 const close=()=>{setSelected(null);if(selected)triggers.current[selected]?.focus({preventScroll:true})};
 return <>
  <p className={styles.counts}>원시 {read.rawRowCount}행 · 묶음 {read.groupedRowCount}행 · 중복 {read.duplicateGroupCount}그룹</p>
  <p className={styles.muted}>제공된 구성 범위 · 비중을 100%로 재정규화하지 않습니다. 확인값 합산은 누락 없는 총합을 뜻하지 않습니다.</p>
  <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="ETF 저장 구성 표 가로 탐색"><table><caption>기준일 {read.date}의 저장 구성 · 종목을 선택하면 받은 근거를 확인합니다</caption><thead><tr><th className={styles.number}>순위</th><th>종목 · 심볼</th><th className={styles.number}>비중 %</th><th>근거 상태</th></tr></thead><tbody>{read.groups.map(g=><tr key={g.identityKey} data-selected={g.identityKey===selected||undefined}>
   <td className={styles.number}>{etfNumber(g.rank.value)}{g.rank.disagrees?' · 불일치':''}</td>
   <th scope="row"><CairnButton variant="ghost" type="button" className={styles.rowSelect} ref={el=>{triggers.current[g.identityKey]=el}} aria-expanded={g.identityKey===selected} aria-controls={id} aria-label={g.holdingName+' 저장 근거'} onClick={()=>setSelected(g.identityKey===selected?null:g.identityKey)}>{g.holdingName}</CairnButton><small>{g.holdingSymbol??'심볼 없음'} · {g.holdingMarket.value??etfStatusLabels[g.holdingMarket.status]}</small></th>
   <td className={styles.number}>{etfNumber(g.weightPct.value)}</td><td>{etfStatusLabels[g.weightPct.status]}{g.source.status==='mixed'?' · 출처 혼합':''}{g.currency.status==='mixed'?' · 통화 혼합':''}{g.incompleteNumbers?' · 일부 숫자 근거 없음':''}{g.hasDuplicates?' · 중복 '+g.rawRowCount+'행':''}</td>
  </tr>)}</tbody></table></div>
  <section id={id} ref={panel} hidden={!group} tabIndex={-1} aria-label="선택 종목 저장 근거" className={styles.selectedEvidence} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close()}}}>
   {group&&<><header><div><p className={styles.muted}>선택 행 · {read.date} 저장</p><h4>{group.holdingName}</h4><p>{group.holdingSymbol??'심볼 없음'} · {group.holdingMarket.value??etfStatusLabels[group.holdingMarket.status]}</p></div><CairnButton variant="secondary" type="button" onClick={close}>근거 닫기</CairnButton></header>
   <dl className={styles.evidenceValues}><div><dt>비중 %</dt><dd>{etfNumber(group.weightPct.value)}</dd><small>{etfStatusLabels[group.weightPct.status]}</small></div><div><dt>수량</dt><dd>{etfNumber(group.shares.value)}</dd><small>{etfStatusLabels[group.shares.status]}</small></div><div><dt>저장 평가금액 · {group.currency.value??etfStatusLabels[group.currency.status]}</dt><dd>{etfNumber(group.marketValue.value)}</dd><small>{etfStatusLabels[group.marketValue.status]}</small></div></dl>
   <p>출처 {group.source.value??etfStatusLabels[group.source.status]} · 원시 {group.rawRowCount}행{group.hasDuplicates?' · 중복 그룹':''}{group.incompleteNumbers?' · 일부 숫자 근거 없음':''}</p>
   <details className={styles.evidence}><summary>이 행의 원본 필드·묶음 근거</summary><pre>{JSON.stringify({identity:group.identityKey,rank:group.rank,market:group.holdingMarket,country:group.holdingCountry,sector:group.sector,industry:group.industry,securityType:group.securityType,evidence:group.evidence},null,2)}</pre></details></>}
  </section>
  <details className={styles.evidence}><summary>저장 구성의 포함·집계 기준</summary>
   <p>행 식별은 이번 결과의 묶음 기준입니다. 원본은 ETF 티커·날짜·종목 심볼·이름으로 묶으며 세계 공통 자산 ID나 개인 보유 연결 키가 아닙니다. 같은 종목의 시장 차이는 원본 mixed 상태로 남을 수 있습니다.</p>
   <p>동일 출처 중복은 기존 모델이 합산합니다. 원문 소수와 모델 공개 number는 다를 수 있으며 더 높은 정밀도를 복원하지 않습니다. 통화 환산·누락 구성 추정·look-through·겹침 계산 없음.</p>
  </details>
 </>;
}
