'use client';
import { Button as CairnButton, Field as CairnField, Select as CairnSelect, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";

import {useId,useState,type ReactNode} from 'react';
import styles from './management-workbench.module.css';
type Item={id:string;name:string;meta:string;group:string;content:ReactNode};
/** Display selection only. Hidden panels stay mounted so changing items never discards a form. */
export function ManagementWorkbench({label,items,create}:{label:string;items:readonly Item[];create?:ReactNode}){
 const id=useId(),[selected,setSelected]=useState(items[0]?.id??'create');
 const current=items.some(item=>item.id===selected)?selected:selected==='create'&&create?'create':items[0]?.id??'create';
 const groups=[...new Set(items.map(item=>item.group))];
 return <div className={styles.layout}>
  <aside className={styles.list} aria-label={label+' 목록'}>
   <CairnField className={styles.mobileSelect}>{label} 선택<CairnSelect value={current} onChange={e=>setSelected(e.target.value)}>{create&&<option value="create">새로 만들기</option>}{groups.map(group=><optgroup key={group} label={group}>{items.filter(item=>item.group===group).map(item=><option key={item.id} value={item.id}>{item.name} · {item.meta}</option>)}</optgroup>)}</CairnSelect></CairnField>
   <nav className={styles.desktopList} aria-label={label+' 선택'}>{create&&<CairnButton variant="bare" className={styles.create} type="button" aria-current={current==='create'?'true':undefined} aria-controls={id+'-create'} onClick={()=>setSelected('create')}>+ 새 {label} 만들기</CairnButton>}{groups.map(group=><section key={group}><CairnSectionTitle level="h3">{group} <span>{items.filter(item=>item.group===group).length}</span></CairnSectionTitle>{items.filter(item=>item.group===group).map(item=><CairnButton variant="bare" key={item.id} type="button" aria-current={current===item.id?'true':undefined} aria-controls={id+'-'+item.id} onClick={()=>setSelected(item.id)}><strong>{item.name}</strong><small>{item.meta}</small></CairnButton>)}</section>)}</nav>
   <p className={styles.note}>변경 후 저장해 주세요.</p>
  </aside>
  <div className={styles.detail}>{create&&<section id={id+'-create'} hidden={current!=='create'} aria-label={'새 '+label}>{create}</section>}{items.map(item=><section id={id+'-'+item.id} key={item.id} hidden={current!==item.id} aria-label={item.name+' 편집'}>{item.content}</section>)}{!items.length&&!create&&<p>표시할 {label}이 없습니다.</p>}</div>
 </div>
}
