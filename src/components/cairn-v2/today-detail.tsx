"use client";
import { instrumentLabel } from "@/lib/instrument-display";
import { useId, useState } from "react";
import Link from "next/link";
import { ActionGroup, ActionContent } from "@/components/cairn-ui";
import { History } from "lucide-react";
import type { BetaView, BetaMovementRow } from "@/lib/cairn-v2/read-contract";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import { todayChangeForHistory } from "@/lib/cairn-v2/history-current";
import { reviewedMovementForView } from "@/lib/cairn-v2/reviewed-current-movement";
import { betaHref, betaReadHref, type BetaContext } from "@/lib/cairn-v2/navigation";
import { useBetaReadFreshness } from "./beta-provider";
import styles from "./today-detail.module.css";
import { Metric, SectionHeading } from "./ui/molecules";
import { StatusPill } from "./ui/atoms";
import { movementExclusionLabel } from "./movement-exclusion-label";
import { MovementBreakdown } from "./movement-breakdown";
import { TodayPurchaseBreakdown } from "./today-purchase-breakdown";
import { formatNumber, formatPercent } from "./ui/format";

// Limited presentation port of original today-contribution-explorer.tsx:
// signed dot bars, holding/account identity and selected evidence. The page,
// auth wrapper, detail drawer, queries and attribution calculation stay outside.
const exact = (n: number | null, signed = false) => n === null || !Number.isFinite(n) ? "—" : (signed && n > 0 ? "+" : "") + eventNumber(n);
const tone = (n: number | null) => n === null || !Number.isFinite(n) || n === 0 ? "neutral" : n > 0 ? "positive" : "negative";
const sourceLabel = (source: string | null) => source === "reviewed_close" ? "복구 마감 평가" : source === "daily_position_snapshot" ? "저장된 보유 기록" : source === "asset_price_snapshot" ? "이전 종가" : source === "trade_execution" ? "당일 체결 기록" : source ? "비교 출처 확인 필요" : "비교 근거 없음";


export function TodayDetail({view,context}:{view:BetaView;context:BetaContext}) {
 const d=view.domain, movement=movementDisplay(view), freshness=useBetaReadFreshness();
 const readoutId=useId();
 const [selection,setSelection]=useState<{read:string;key:string}|null>(null);
 // Selection belongs to the analysis scope, not to a quote observation time.
 // Resolve the key against current rows below so refreshed evidence is never cached.
 const readKey=JSON.stringify([context.mode,context.scope,context.currency]);
 if(!d || ["loading","unauthorized"].includes(d.state)) return <p role="status" className={styles.status}>{movement.message ?? "조회 근거 확인 중"}</p>;
 const reviewChange=todayChangeForHistory(view);
 const reviewMovement=reviewedMovementForView(view,reviewChange);
 const market=reviewChange ? undefined : d.currentHoldingMovement;
 const changeKrw=reviewChange ? reviewChange.changeKrw ?? null : market?.changeKrw ?? null;
 const returnPct=reviewChange ? reviewChange.returnPct ?? null : market?.returnPct ?? null;
 const reviewedRows=reviewMovement?.rows.map(row=>({
   ...row, accountLabel:row.account, source:"reviewed_close", identityStatus:"matched",
   execution:undefined, currentPrice:undefined,
 }));
 const rows=[...(reviewedRows ?? market?.rows ?? [])].sort((a,b)=>Math.abs(b.changeKrw)-Math.abs(a.changeKrw));
 const sources=[...new Set(rows.map(row=>sourceLabel(row.source)))].join(" · ");
 const comparisonDate=reviewChange?.baselineDate ?? d.comparisonDate;
 const factors=reviewMovement ?? market;
 const active=rows.find(row=>selection?.read===readKey&&row.key===selection.key) ?? rows[0] ?? null;
 const maximum=Math.max(1,...rows.map(row=>Number.isFinite(row.changeKrw)?Math.abs(row.changeKrw):0));
 const excluded=market?.exclusions?.filter(row=>row.subject!=="aggregate") ?? [];
 const localOnly=excluded.flatMap(row=>row.localPurchases ? [{row,purchase:row.localPurchases}] : []);
 const adjusted=market?.basis==="execution_adjusted_price_fx";
 const execution=active?.execution;
 const money=(n:number|null,signed=false)=>displayReadMoney(view,n,context.currency,signed,"dashboard");
 const select=(row:Pick<BetaMovementRow,"key">)=>setSelection({read:readKey,key:row.key});
 const historyHref=betaReadHref(betaHref("/beta/history",context),freshness?.store.pendingEpoch());
 return <section className={styles.detail} aria-label="오늘 변동 상세">
  <header className={styles.heading}>
   <dl className={styles.primaryMetrics}>
    <Metric label={reviewChange ? "평가액 변동률" : "총변동률"} value={formatPercent(returnPct,2,true)} size="hero" tone={tone(returnPct)} note={reviewChange ? "오전 7시 마감 평가액 대비" : adjusted ? "시작 평가액 대비 · KRW" : "KRW 기준"} />
    <Metric label={reviewChange ? "평가액 변동" : "총변동액"} value={money(changeKrw,true)} unit={context.currency} tone={tone(changeKrw)} note={market?.partial ? "비교 가능한 종목의 소계" : undefined} />
   </dl>
   <div className={styles.basis}>
    <span>비교 기준</span>
    <strong>{reviewChange ? reviewChange.baselineDate + " 평가액" : comparisonDate ?? "기준일 미제공"}</strong>
    <p>{reviewChange ? reviewChange.cutoffDate + " 오전 7시 저장" : sources || sourceLabel(d.movementSource)}</p>
   </div>
  </header>
  {reviewChange && <dl className={styles.primaryMetrics}>
    <Metric label="마감 평가액" value={money(reviewChange.previousValueKrw)} unit={context.currency} />
    <Metric label="현재 평가액" value={money(reviewChange.valueKrw)} unit={context.currency} />
  </dl>}
  {factors && rows.length > 0 && <div className={styles.breakdown}>
    <MovementBreakdown view={view} currency={context.currency} priceChangeKrw={factors.priceChangeKrw} fxChangeKrw={factors.fxChangeKrw}
      previousValueKrw={factors.previousValueKrw} quantityChangeKrw={reviewMovement?.quantityChangeKrw}/>
  </div>}
  {reviewMovement && <p className={styles.notice}>가격과 환율의 영향은 마감과 현재에 공통으로 보유한 수량을 기준으로 계산합니다.</p>}
  {!reviewChange && <div className={styles.coverage}><StatusPill tone={market?.partial ? "muted" : "positive"}>비교 {market?.includedCount ?? 0}종목 · 제외 {market?.excludedCount ?? 0}종목</StatusPill></div>}
  {!reviewChange&&!rows.length&&!localOnly.length&&movement.message&&<p className={styles.notice} role="status">{movement.message}</p>}
  {context.currency==="USD"&&<p className={styles.notice}>총변동액은 현재 환율로 환산하고, 총변동률은 원화로 계산합니다.</p>}
  {excluded.length>0&&<p className={styles.exclusions}>비교 제외 · {excluded.map(row=>(row.assetName??row.ticker??"종목 확인 전")+" ("+movementExclusionLabel(row.reason)+")").join(" · ")}</p>}
  {localOnly.length>0&&<section className={styles.localOnly} aria-label="원화 합산 제외 종목의 가격손익">
    <SectionHeading title="원화 합산 제외 · 종목별 가격손익"/>
    {localOnly.map(({row,purchase})=><div key={row.holdingId}><strong>{row.ticker || row.assetName || "종목 확인 전"}</strong>
      <TodayPurchaseBreakdown purchase={purchase}/></div>)}
  </section>}
  {rows.length>0?<>
   <div className={styles.explorer}>
    <div className={styles.chart}>
     <SectionHeading title="종목별 변동" />
     <div className={styles.rows} aria-label="종목별 변동 기여 목록">
      {rows.map(row=><button key={row.key} type="button" className={styles.row} onClick={()=>select(row)} onFocus={()=>select(row)} aria-pressed={active?.key===row.key} aria-controls={readoutId} aria-label={(instrumentLabel(row))+" · "+(row.accountLabel??"계좌 확인 전")+" · 변동 "+money(row.changeKrw,true)+" "+context.currency+" · 변동률 "+formatPercent(row.returnPct,2,true)+" · 가격 변동 "+money(row.priceChangeKrw,true)+" "+context.currency+" · 환율 변동 "+money(row.fxChangeKrw,true)+" "+context.currency}>
       <span className={styles.identity}><strong title={instrumentLabel(row)}>{instrumentLabel(row)}</strong><small>{row.accountLabel??"계좌 확인 전"}{row.ticker?" · "+row.ticker:""}</small></span>
       <DotBar value={row.changeKrw} maximum={maximum} active={active?.key===row.key}/>
       <span className={styles.rowBreakdown}><MovementBreakdown view={view} currency={context.currency} priceChangeKrw={row.priceChangeKrw} fxChangeKrw={row.fxChangeKrw}
        quantityChangeKrw={"quantityChangeKrw" in row ? row.quantityChangeKrw : undefined}/></span>
       <span className={styles.rowValue} data-tone={tone(row.changeKrw)}>{money(row.changeKrw,true)}<small>{row.returnPct===null?"변동률 —":formatPercent(row.returnPct,2,true)}</small></span>
      </button>)}
     </div>
    </div>
    {active&&<aside className={styles.selected} id={readoutId} aria-live="polite">
     <p className={styles.eyebrow}>선택한 종목</p><h3>{instrumentLabel(active)}</h3><p>{active.accountLabel??"계좌 확인 전"} · {active.market??"시장 미제공"}</p>
     <strong className={styles.selectedAmount} data-tone={tone(active.changeKrw)}>{money(active.changeKrw,true)} <small>{context.currency}</small></strong>
     <dl><Metric label="변동률" value={formatPercent(active.returnPct,2,true)} /><Metric label="시작 평가액" value={formatNumber(active.previousValueKrw,{maximumFractionDigits:0})} unit="원" />
      {"currentValueKrw" in active && <Metric label="현재 평가액" value={formatNumber(active.currentValueKrw,{maximumFractionDigits:0})} unit="원" />}</dl>
     {execution && execution.boughtQuantity>0 && execution.soldQuantity===0 && execution.averageBuyPrice!==null && active.currentPrice!=null && active.currency &&
      <TodayPurchaseBreakdown purchase={{...execution,averageBuyPrice:execution.averageBuyPrice,currentPrice:active.currentPrice,currency:active.currency}}/>}
     {execution && execution.soldQuantity>0 && <p className={styles.selectedNote}>매도 {formatNumber(execution.soldQuantity,{maximumFractionDigits:8})}주는 체결가까지 반영했습니다.</p>}
     {active.identityStatus==="unmatched"&&<p className={styles.notice}>변동 근거는 있으나 현재 종목 이름을 연결하지 못했습니다.</p>}
    </aside>}
   </div>
  </>:!localOnly.length&&<p className={styles.empty}>{reviewChange ? "복구 마감 평가액과 현재 평가액을 비교할 종목별 근거가 아직 없어요." : "비교할 종목별 기록이 아직 없어요."}</p>}
  {market?.valuationChangeKrw !== null && market?.valuationChangeKrw !== undefined && <details className={styles.movementBridge}><summary>평가액 변화와 왜 다른가요?</summary>
    <dl><Metric label="저장 평가액 대비 변화" value={money(market.valuationChangeKrw,true)} unit={context.currency}/><Metric label={adjusted?"순매수 금액":"수량 변화 효과"} value={money(market.quantityChangeKrw,true)} unit={context.currency}/></dl>
    <p>{adjusted?"오늘의 변동은 비교한 종목의 평가액 변화에서 매수 원금을 빼고 매도 대금을 더한 값입니다. 수수료와 세금은 별도입니다.":"보유 수량이 바뀌면 평가액도 달라집니다."}</p>
  </details>}
  <details className={styles.evidence}><summary>숫자·시세·비교 근거</summary>
   {rows.length>0&&<>
   <div className={styles.tableScroll} tabIndex={0} aria-label="종목별 변동 원본 숫자 표">
    <table><caption>종목별 변동 근거 · KRW 원본</caption>
     <thead><tr><th>종목 · 계좌</th><th>총변동액</th><th>가격 변동</th><th>환율 변동</th>{reviewMovement && <th>수량·기타</th>}<th>변동률</th><th>시작 평가액</th>{reviewMovement && <th>현재 평가액</th>}</tr></thead>
     <tbody>{rows.map(row=><tr key={row.key}>
      <th>{instrumentLabel(row)}<small>{row.accountLabel??"계좌 확인 전"}{row.ticker?" · "+row.ticker:""}</small></th>
      <td data-tone={tone(row.changeKrw)}>{exact(row.changeKrw,true)}</td>
      <td data-tone={tone(row.priceChangeKrw)}>{exact(row.priceChangeKrw,true)}</td>
      <td data-tone={tone(row.fxChangeKrw)}>{exact(row.fxChangeKrw,true)}</td>
      {"quantityChangeKrw" in row && <td data-tone={tone(row.quantityChangeKrw)}>{exact(row.quantityChangeKrw,true)}</td>}
      <td>{row.returnPct===null?"—":exact(row.returnPct,true)+"%"}</td><td>{exact(row.previousValueKrw)}</td>
      {"currentValueKrw" in row && <td>{exact(row.currentValueKrw)}</td>}
     </tr>)}</tbody></table>
   </div>

   </>}
   <p>화면 갱신 {reviewMovement?.asOf??d.refreshedAt??"미제공"} · 비교 기준일 {comparisonDate??"미제공"} · {reviewChange ? sourceLabel("reviewed_close") : sources || sourceLabel(d.movementSource)}</p>
   {!reviewChange && <p>평가 환율 {exact(d.moneyBasis.dashboard.usdKrwRate)} · 환율 기준일 {d.moneyBasis.dashboard.rateDate??"미제공"}</p>}
   {adjusted&&<p>현재 보유 종목을 비교합니다. 기존 보유분은 시작 가격부터, 오늘 산 수량은 체결가부터 계산합니다. 일부 매도한 수량은 매도 체결가까지 반영합니다.</p>}
   {!reviewChange && <p>원본 상태: {d.movementSource??"none"}{d.movementReason?" · "+d.movementReason:""}{d.movementRead?.reasons.length?" · "+d.movementRead.reasons.join(", "):""}</p>}
  </details>
  <ActionGroup label="오늘 변동 더 살펴보기"><Link prefetch={false} href={historyHref}><ActionContent icon={<History size={22}/>} title="지난 변동과 이어서 보기" description="날짜별 평가액과 수익률"/></Link></ActionGroup>
 </section>;
}

function DotBar({value,maximum,active}:{value:number;maximum:number;active:boolean}) {
 const id=useId(), length=Number.isFinite(value)?Math.abs(value)/maximum*238:0, positive=value>=0;
 return <span className={styles.bar} aria-hidden="true"><svg viewBox="0 0 500 32" preserveAspectRatio="xMidYMid meet"><defs><pattern id={id+"-track"} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.7" fill="var(--cairn-v2-line)"/></pattern><pattern id={id+"-value"} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r={active?2.55:2.05} fill={positive?"var(--today-positive)":"var(--today-negative)"}/></pattern></defs><rect x="10" width="480" height="32" fill={"url(#"+id+"-track)"} opacity=".55"/><rect x={positive?250:250-length} width={length} height="32" fill={"url(#"+id+"-value)"}/><line x1="250" x2="250" y1="0" y2="32" stroke="var(--cairn-v2-muted)" strokeWidth=".6"/></svg></span>;
}
