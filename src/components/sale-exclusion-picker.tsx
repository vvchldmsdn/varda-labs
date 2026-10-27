"use client";
import { SALE_EXCLUSION_LIMIT } from '@/lib/additional-contribution-sale-exclusions';
import styles from './sale-exclusion-picker.module.css';
export type SaleExclusionOption = { key: string; label: string; detail?: string };
export function SaleExclusionPicker({options,value,onChange,disabled=false,english=false}:{options:readonly SaleExclusionOption[];value:readonly string[];onChange:(keys:string[])=>void;disabled?:boolean;english?:boolean}) {
  return <details className={styles.picker}><summary>{english?'Exclude from sales':'매도 제외 종목'} · {value.length}</summary><p>{english?'Only excludes hypothetical sales in this calculation. Holdings, targets and trades stay unchanged.':'이번 계산의 매도 대상에서만 제외합니다. 보유·목표·거래는 바뀌지 않습니다.'}</p>
    <div className={styles.list}>{options.map(option=><label className={styles.option} key={option.key}><input type="checkbox" name="excludeSell" value={option.key} checked={value.includes(option.key)} disabled={disabled||(!value.includes(option.key)&&value.length>=SALE_EXCLUSION_LIMIT)} onChange={event=>onChange((event.currentTarget.checked?[...value,option.key]:value.filter(key=>key!==option.key)).sort())}/><span>{option.label}{option.detail&&<small>{option.detail}</small>}</span></label>)}</div>
    {!options.length&&<p>{english?'No eligible holdings are available for selection.':'선택 가능한 보유 종목을 확인하지 못했습니다.'}</p>}
    {value.length>=SALE_EXCLUSION_LIMIT&&<p>{english?'Selection limit':'최대 선택'} {SALE_EXCLUSION_LIMIT}</p>}
    {value.length>0&&<button type="button" disabled={disabled} onClick={()=>onChange([])}>{english?'Clear exclusions':'매도 제외 모두 해제'}</button>}
  </details>;
}
