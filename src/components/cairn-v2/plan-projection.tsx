'use client';

import { Button, Field, Input, Select } from '@/components/cairn-ui';
import { useState } from 'react';
import { compareUserAllocation, type UserAllocationBasis } from '@/lib/user-allocation-comparison';
import { allocateTargetRatio } from '@/lib/contribution-comparison';
import { parseMoneyInput } from '@/lib/money';
import { instrumentLabel } from '@/lib/instrument-display';
import { dataIssueLabel } from '@/lib/data-issue-presentation';
import type { BetaContext } from '@/lib/cairn-v2/navigation';
import styles from './plan-projection.module.css';

const colors = ['#d48670','#80988d','#c6a478','#889eaf','#a998aa'];
const pct = (value: number | null) => value === null ? '—' : value.toLocaleString('ko-KR',{maximumFractionDigits:2})+'%';

export function PlanProjection({basis, reason, unavailableHoldings, context, amount, onAmountChange}: {amount:string;onAmountChange:(value:string)=>void;basis?:UserAllocationBasis; reason?:string; unavailableHoldings?:string[]; context:BetaContext}) {
  const [allocation,setAllocation] = useState('ratio');
  const units = parseMoneyInput(amount,'KRW');
  const validBudget = units !== null && Number.isSafeInteger(units) && units > 0 && units <= 100_000_000_000;
  const validWeights = basis?.rows.every(row=>Number.isInteger(row.targetWeightBps) && row.targetWeightBps>=0) && basis.rows.reduce((sum,row)=>sum+row.targetWeightBps,0)===10000;
  const amounts = basis && validBudget && validWeights ? allocation === 'ratio'
    ? Object.fromEntries(Object.entries(allocateTargetRatio(units,basis.rows)).map(([key,value])=>[key,String(value)]))
    : { [allocation]: amount } : {};
  const projection = basis && validBudget && validWeights ? compareUserAllocation(basis,amount,'KRW',amounts) : null;
  const rows = projection?.status==='ready' ? projection.rows : [];
  return <section className={styles.spread} aria-label="추가 투자 미리보기">
    <div className={styles.budget}>
      <Field htmlFor="plan-budget">추가 투자금</Field>
      <div><Input presentation="amount" id="plan-budget" inputMode="numeric" value={amount} onBlur={()=>{if(validBudget) onAmountChange(units.toLocaleString('ko-KR'))}} onChange={event=>onAmountChange(event.target.value)} aria-invalid={!validBudget}/><span>원</span></div>
      {!validBudget && <p role="alert">1원부터 1,000억 원까지 정수로 입력해 주세요.</p>}
      <nav aria-label="투자금 빠른 입력" className={styles.presets}>{[50,100,200].map(value=><Button variant="bare" type="button" key={value} onClick={()=>onAmountChange((value*10000).toLocaleString('ko-KR'))}>{value}만 원</Button>)}</nav>
      <small>가상 배분 · 원화 기준</small>
    </div>
    <div className={styles.allocation}>
      <header><h2>투자 후 비중</h2>{basis && <Field>배분 방식<Select value={allocation} onChange={event=>setAllocation(event.target.value)}>
        <option value="ratio">목표 비율대로</option>{basis.rows.filter(row=>row.buyable).map(row=><option key={row.allocationKey} value={row.allocationKey}>{instrumentLabel(row.metadata)}에 전액</option>)}
      </Select></Field>}</header>
      {rows.length>0 && basis ? <>
        <div className={styles.ribbon} aria-hidden>{rows.map((row,index)=><span key={row.key} style={{width:(row.afterPct??0)+'%',background:colors[index%colors.length]}}/>)}</div>
        <table><thead><tr><th>종목</th><th>현재</th><th>투자 후</th><th>목표 차이</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}>
          <th scope="row"><i style={{background:colors[index%colors.length]}}/>{instrumentLabel(basis.rows[index].metadata)}{basis.rows[index].metadata.manualValuation && <small> · 수동 평가</small>}</th>
          <td>{pct(row.currentPct)}</td><td>{pct(row.afterPct)}</td><td>{row.gapPp===null?'—':(row.gapPp>0?'+':'')+row.gapPp.toFixed(2)+'%p'}</td>
        </tr>)}</tbody></table>
      </>:<p role="status">{!context.scope.startsWith('account:')?'상단에서 투자할 계좌를 선택해 주세요.':!validBudget?'투자금을 확인해 주세요.':dataIssueLabel(reason ?? (projection?.status==='blocked'?projection.reason:'valuation_incomplete'))}{validBudget && unavailableHoldings?.length ? ' '+unavailableHoldings.join(' ') : ''}</p>}
    </div>
  </section>;
}
