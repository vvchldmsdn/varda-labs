"use client";
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { ContributionNextSteps } from '@/components/additional-contribution/contribution-journey';
import { betaHref } from '@/lib/cairn-v2/navigation';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, FormActions as CairnFormActions, Status as CairnStatus, InfoDisclosure } from "@/components/cairn-ui";

import {SaleExclusionPicker} from "../sale-exclusion-picker";
import {parseSaleExclusionKeys} from "@/lib/additional-contribution-sale-exclusions";
import { useId, useState } from "react";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { requestKey, type BetaView } from "@/lib/cairn-v2/read-contract";
import { useBetaContext } from "./use-beta-context";
import { useBetaExistingCrudAvailable } from './beta-provider';
import styles from "./beta.module.css";

import {AdditionalContributionAllocationTable} from "./reused/allocation-list";
import {MoneyInput} from "./reused/money-input";
import {ContributionFundingVisual} from "./reused/contribution-funding";
import presentation from "./reused/contribution.module.css";

const krw = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
export { driftNumber, targetMessage } from "@/lib/cairn-v2/target-presentation";
import { driftNumber, targetMessage } from "@/lib/cairn-v2/target-presentation";
export { ContributionHome } from "./home-contribution";

export function TargetDetail({view}: {view: BetaView}) {
  const target = view.domain?.planning?.targets;
  const available = useBetaExistingCrudAvailable();
  return <div className={styles.planningDetail} data-target-state={target?.state ?? view.domain?.state}>
    {target?.state !== "ready" && <CairnStatus as="p" role="status" className={styles.muted}>{targetMessage(view)}</CairnStatus>}
    {target && target.state !== 'ready' && <RecoveryNotice beta allowResolve={available && Boolean(view.domain)} scope={target.provenance?.scopeKey} kind={target.state === 'missing' ? 'targets' : target.state === 'partial' ? 'market' : 'retry'} />}
    {target?.provenance && <InfoDisclosure summary="목표 기준"><p className={styles.muted}>{target.state === "ready" ? "승인 목표" : "목표 정책 조회 근거"} · revision {target.provenance.approvalRevision ?? "없음"} · 적용일 {target.provenance.effectiveServiceDate ?? "없음"} · 평가 기준일 {target.provenance.serviceDate}</p></InfoDisclosure>}
    {target?.maxDrift && <p className={styles.detailNumber}>{driftNumber(target.maxDrift.driftPct)}<small>%p</small></p>}
    <p className={styles.muted}>현재 비중과 목표의 차이 · %p</p>
    {target?.state === "ready" && target.rows.length > 0 && <div className={styles.planningTableViewport}><table className={styles.planningTable}><caption>승인 목표와 비교 가능한 현재 비중</caption><thead><tr><th>종목 · 계좌</th><th>현재</th><th>승인 목표</th><th>편차</th></tr></thead><tbody>{target.rows.map(row => <tr key={row.key}><th>{row.ticker ?? row.name}<small>{row.name} · {row.account} · {row.currency}{row.plannedOnly ? " · 미보유 계획" : ""}</small></th><td>{row.currentWeightPct.toFixed(2)}%</td><td>{row.effectiveTargetPct?.toFixed(2) ?? "—"}%</td><td>{driftNumber(row.driftPct, 2)}%p</td></tr>)}</tbody></table></div>}
  </div>;
}
export function ContributionDetail({view, context, onEdit, onCalculate}: {view: BetaView; context: BetaContext; onEdit?: (dirty: boolean) => void; onCalculate?: (amount: string,keys?:string[]) => void}) {
  const inputId=useId();
  const available = useBetaExistingCrudAvailable();
  const [evidenceOpen,setEvidenceOpen] = useState(false);
  const [,setContext] = useBetaContext(context);
  const queryKey = requestKey(context);
  const submitted = typeof context.cashAmountKrw === "string" ? context.cashAmountKrw : "";
  const [draft,setDraft] = useState({key:queryKey,value:submitted});
  const amount = draft.key === queryKey ? draft.value : submitted;
  const committedSale=parseSaleExclusionKeys(context.excludeSell);
  const committedKeys=committedSale.ok?committedSale.keys:[];
  const [saleDraft,setSaleDraft]=useState<{key:string;keys:string[]}>({key:queryKey,keys:committedKeys});
  const excludedSales=saleDraft.key===queryKey?saleDraft.keys:committedKeys;
  const saleDirty=JSON.stringify(excludedSales)!==JSON.stringify(committedKeys);
  const dirty = amount !== submitted||saleDirty;
  const read = view.domain?.planning?.contribution;
  const result = !dirty && read?.state === "ready" ? read.result : null;
  return <div className={`${styles.planningDetail} ${presentation.surface}`} data-contribution-state={dirty ? "edited" : read?.state ?? view.domain?.state}>
    <div className={presentation.layout}><CairnForm className={presentation.form} onSubmit={event => {event.preventDefault();onEdit?.(false);if (onCalculate) onCalculate(amount,excludedSales); else setContext({...context,cashAmountKrw:amount,excludeSell:excludedSales.length?excludedSales:undefined});}}>
      <CairnField htmlFor={inputId}>얼마를 더 투자할까요?</CairnField><div className={presentation.amountInput}><MoneyInput presentation="amount" data-long={amount.length>9} id={inputId} name="cashAmountKrw" aria-label="신규 투자금" autoComplete="off" value={amount} placeholder="금액 입력" onValueChange={value=>{setDraft({key:queryKey,value});onEdit?.(value!==submitted||saleDirty);}} /><span>원</span></div>
      <div className={presentation.presets} aria-label="투입 금액 빠른 선택">{[1000000,3000000,5000000,10000000].map(value=><CairnButton variant="secondary" type="button" key={value} onClick={()=>{setDraft({key:queryKey,value:String(value)});onEdit?.(String(value)!==submitted||saleDirty);document.getElementById(inputId)?.focus();}}>{value/10000}만</CairnButton>)}</div>
      <SaleExclusionPicker options={read?.selectionRows??[]} value={excludedSales} onChange={keys=>{setSaleDraft({key:queryKey,keys});onEdit?.(amount!==submitted||JSON.stringify(keys)!==JSON.stringify(committedKeys));}}/>
      <CairnFormActions className={presentation.submitRow}><CairnButton variant="primary" className={presentation.calculate} type="submit" disabled={context.currency!=="KRW"}>계산 <span aria-hidden="true">↗</span></CairnButton></CairnFormActions>
    </CairnForm><div className={presentation.fundingPanel}>{result&&<ContributionFundingVisual cash={result.cashAmountKrw} trims={result.totalTrimProceedsKrw} total={result.totalAvailableFundsKrw} residual={result.residualCashKrw} rows={result.rows.map((row,i)=>({key:row.accountCode+":"+row.ticker+":"+i,name:row.name,amount:row.allocationKrw}))}/>}</div></div>

    {(read?.state === 'blocked' || read?.state === 'unavailable') ? <RecoveryNotice beta allowResolve={available && context.mode === 'domain'} scope={context.scope} reasons={read.blockers} kind={read.state === 'unavailable' ? 'retry' : undefined} returnHref={betaHref('/beta', {...context,cashAmountKrw:amount,excludeSell:excludedSales})+'#beta-contribution'} /> : (dirty || !result) && <CairnStatus as="p" role="status" className={styles.muted}>{dirty ? "변경한 금액으로 다시 계산해 주세요." : read?.message ?? "금액을 입력해 주세요."}</CairnStatus>}
    {result && <>

      <dl className={presentation.footerNumbers}>
        {[["신규 투자금",result.cashAmountKrw],["총 매수 배분",result.totalAllocatedKrw],["남는 현금",result.residualCashKrw],...(result.totalTrimProceedsKrw > 0 ? [["계산상 매도대금",result.totalTrimProceedsKrw],["총 배분 재원",result.totalAvailableFundsKrw]] : [])].map(([label,value]) => <div key={String(label)}><dt>{label}</dt><dd>{krw(Number(value))}원</dd></div>)}
      </dl>
      <InfoDisclosure summary="계산 기준"><p>수수료·세금·체결 단위는 포함하지 않습니다. 금액은 1원부터 1,000억 원까지 입력할 수 있습니다.</p><p>배분안 계산 후 별도로 계획을 저장하거나 실제 거래를 기록할 수 있습니다.</p></InfoDisclosure>

      {view.domain?.planning?.targets.rows.some(row=>row.plannedOnly) && <p className={styles.muted}>미보유 계획 종목은 현재 보유액 0으로 계산합니다. 가격·MA 근거가 없는 경우 기존 엔진의 보류·조정 규칙을 따릅니다.</p>}
      {available && <ContributionNextSteps journey={{scope:context.scope,amount,currency:'KRW',beta:true,excludeSell:excludedSales}} />}
      <AdditionalContributionAllocationTable preview={result}/>

      <details className={styles.planningEvidence} onToggle={event => { if (event.target === event.currentTarget) setEvidenceOpen(event.currentTarget.open); }}><summary tabIndex={0}>상세 계산 보기</summary>      <div className={styles.planningTableViewport}><table className={styles.planningTable}><caption>종목별 계산 · KRW</caption><thead><tr><th>종목</th><th>계산 구분</th><th>매수 배분</th><th>계산상 매도</th><th>투입 후 비중</th></tr></thead><tbody>{result.rows.map((row,i) => <tr key={row.accountCode+":"+row.ticker+":"+i}><th>{row.ticker ?? row.name}<small>{row.name} · {row.accountName}</small></th><td>{row.action === "buy" ? "매수 계산" : row.action === "trim" ? "축소 계산" : "유지"}<small>{row.trimReason==="user_sale_excluded"?"매도 제외 · 이번 계산":row.action}</small></td><td>{krw(row.allocationKrw)}</td><td>{krw(row.trimAmountKrw)}</td><td>{row.postTopupWeightPct.toFixed(2)}%</td></tr>)}</tbody></table></div>      <p className={styles.muted}>{result.policyLabel} · {result.source === "legacy_account_policy" ? "구형 계좌 정책" : "현재 승인 정책"} · {result.policyVersion} · revision {read?.approvalRevision ?? "구형 정책 계약에 없음"}<br />적용일 {result.effectiveServiceDate} · 평가 기준일 {result.serviceDate}</p><p className={styles.muted}>총 배분 재원 {krw(result.totalAvailableFundsKrw)}원 · 계산상 매도대금 {krw(result.totalTrimProceedsKrw)}원 · 투입 후 총액 · 현금 포함 {krw(result.postTopupTotalKrw)}원</p>      <p className={styles.muted}>투입 후 비중의 분모는 {krw(result.postTopupTotalKrw)}원이며 남는 현금도 포함합니다.</p><div>{result.rows.map((row,i) => <details key={row.accountCode+":"+i}><summary tabIndex={evidenceOpen ? 0 : -1}>{row.ticker ?? row.name} · 원가/MA/보류 근거</summary><dl className={styles.holdingNumbers}>
        <div><dt>현재 평가액</dt><dd>{krw(row.currentValueKrw)}원</dd></div><div><dt>원가</dt><dd>{krw(row.costBasisKrw)}원</dd></div><div><dt>미실현 수익률</dt><dd>{row.unrealizedReturnPct?.toFixed(2) ?? "—"}%</dd></div><div><dt>승인 목표 / 계산 유효 목표</dt><dd>{row.targetWeightPct.toFixed(2)}% / {row.effectiveTargetWeightPct.toFixed(2)}%</dd></div>
      </dl><p>축소 근거 {row.trimReason} · MA 조정 {row.maAdjustmentReason}</p><p>MA120 {row.ma120Evidence.status} · 관측 {row.ma120Evidence.availableObservationCount}개 · 가격 기준 {row.ma120Evidence.priceBasis ?? "미제공"} · 최근 관측일 {row.ma120Evidence.latestWindowPriceDate ?? "미제공"}</p><p>MA120 {row.ma120Evidence.ma120 ?? "—"} · 이격 {row.ma120Evidence.distanceFromMaPct ?? "—"}% · 배수 {row.maEffectiveMultiplier}</p></details>)}</div></details>
    </>}
  </div>;
}
