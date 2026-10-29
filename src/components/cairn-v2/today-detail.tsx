"use client";
import { useId, useState } from "react";
import Link from "next/link";
import type { BetaView, BetaMovementRow } from "@/lib/cairn-v2/read-contract";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import { movementDisplay } from "@/lib/cairn-v2/read-display";
import { betaHref, betaReadHref, type BetaContext } from "@/lib/cairn-v2/navigation";
import { useBetaReadFreshness } from "./beta-provider";
import styles from "./today-detail.module.css";
import { Metric, SectionHeading } from "./ui/molecules";
import { StatusPill } from "./ui/atoms";
import { formatNumber, formatPercent } from "./ui/format";

// Limited presentation port of original today-contribution-explorer.tsx:
// signed dot bars, holding/account identity and selected evidence. The page,
// auth wrapper, detail drawer, queries and attribution calculation stay outside.
const exact = (n: number | null, signed = false) => n === null || !Number.isFinite(n) ? "—" : (signed && n > 0 ? "+" : "") + eventNumber(n);
const tone = (n: number | null) => n === null || !Number.isFinite(n) || n === 0 ? "neutral" : n > 0 ? "positive" : "negative";
const sourceLabel = (source: string | null) => source === "daily_position_snapshot" ? "저장 포지션 비교" : source === "asset_price_snapshot" ? "저장 이전 종가 비교" : source ? "비교 출처 확인 필요" : "비교 근거 없음";
const reasonLabel = (reason: string) => ({ missing_fresh_live_prices:"비교 시점 시세 부족", missing_baseline_snapshot:"기준 기록 없음", missing_previous_close_fallback:"이전 종가 없음", coverage_below_threshold:"비교 범위 부족", manual_valuation_not_updated_in_cycle:"수동 평가 갱신 필요", unsupported_currency:"지원 통화 밖", missing_current_fx:"현재 환율 없음", missing_baseline_fx:"기준 환율 없음" } as Record<string,string>)[reason] ?? "근거 확인 필요";

export function TodayDetail({view,context}:{view:BetaView;context:BetaContext}) {
 const d=view.domain, movement=movementDisplay(view), freshness=useBetaReadFreshness();
 const readoutId=useId();
 const [selection,setSelection]=useState<{read:string;key:string}|null>(null);
 // Selection belongs to the analysis scope, not to a quote observation time.
 // Resolve the key against current rows below so refreshed evidence is never cached.
 const readKey=JSON.stringify([context.mode,context.scope,context.currency]);
 if(!d || ["loading","unauthorized"].includes(d.state)) return <p role="status" className={styles.status}>{movement.message ?? "조회 근거 확인 중"}</p>;
 const market=d.currentHoldingMovement;
 const rows=[...(market?.rows ?? [])].sort((a,b)=>Math.abs(b.changeKrw)-Math.abs(a.changeKrw));
 const active=rows.find(row=>selection?.read===readKey&&row.key===selection.key) ?? rows[0] ?? null;
 const maximum=Math.max(1,...rows.map(row=>Number.isFinite(row.changeKrw)?Math.abs(row.changeKrw):0));
 const excluded=market?.exclusions?.filter(row=>row.subject!=="aggregate") ?? [];
 const money=(n:number|null,signed=false)=>displayReadMoney(view,n,context.currency,signed,"dashboard");
 const select=(row:BetaMovementRow)=>setSelection({read:readKey,key:row.key});
 return <section className={styles.detail} aria-label="오늘 변동 상세">
  <header className={styles.heading}>
   <dl className={styles.primaryMetrics}>
    <Metric label="가격·환율 수익률" value={formatPercent(market?.returnPct ?? null,2,true)} size="hero" tone={tone(market?.returnPct ?? null)} note="현재 보유 수량을 같은 수량으로 비교" />
    <Metric label="가격·환율 변동액" value={money(market?.changeKrw ?? null,true)} unit={context.currency} tone={tone(market?.changeKrw ?? null)} note={market?.partial ? "비교 가능한 종목의 소계" : "수량 증가·감소 효과 제외"} />
   </dl>
   <div className={styles.basis}><span>비교 기준</span><strong>{d.comparisonDate ?? "기준일 미제공"}</strong><p>{sourceLabel(d.movementSource)}</p></div>
  </header>
  <div className={styles.coverage}><StatusPill tone={market?.partial ? "muted" : "positive"}>비교 {market?.includedCount ?? 0}종목 · 제외 {market?.excludedCount ?? 0}종목</StatusPill><span>KRW 기준 · 매매 수량 변화가 수익률에 포함되지 않습니다</span></div>
  {market?.valuationChangeKrw !== null && market?.valuationChangeKrw !== undefined && <div className={styles.movementBridge}>
    <dl><Metric label="저장 평가액 대비 변화" value={money(market.valuationChangeKrw,true)} unit={context.currency}/><Metric label="수량 변화 효과" value={money(market.quantityChangeKrw,true)} unit={context.currency} note="기준 가격으로 환산한 보유량 변화"/></dl>
    <p>평가액 변화에는 매수·매도에 따른 보유량 변화가 포함됩니다. 위 수익률은 현재 보유 종목의 가격·환율 비교이며, 실제 계좌의 기간 수익률과는 다릅니다.</p>
  </div>}
  {!rows.length&&movement.message&&<p className={styles.notice} role="status">{movement.message}</p>}
  {context.currency==="USD"&&<p className={styles.notice}>금액은 현재 환율로 환산한 표시입니다. 수익률은 KRW 기준입니다.</p>}
  {excluded.length>0&&<p className={styles.exclusions}>비교 제외 · {excluded.map(row=>(row.assetName??row.ticker??"종목 확인 전")+" ("+reasonLabel(row.reason)+")").join(" · ")}</p>}
  {rows.length>0?<>
   <div className={styles.explorer}>
    <div className={styles.chart}>
     <SectionHeading title="종목별 가격·환율 변동" description={"변동액 크기순 · " + context.currency} />
     <div className={styles.axis} aria-hidden="true"><span>감소</span><span>증가</span></div>
     <div className={styles.rows} aria-label="종목별 변동 기여 목록">
      {rows.map(row=><button key={row.key} type="button" className={styles.row} onClick={()=>select(row)} onFocus={()=>select(row)} aria-pressed={active?.key===row.key} aria-controls={readoutId} aria-label={(row.name??"이름 확인 전")+" · "+(row.accountLabel??"계좌 확인 전")+" · 변동 "+money(row.changeKrw,true)+" "+context.currency+" · 가격·환율 수익률 "+formatPercent(row.returnPct,2,true)}>
       <span className={styles.identity}><strong title={row.name??undefined}>{row.name??"이름 확인 전"}</strong><small>{row.accountLabel??"계좌 확인 전"}{row.ticker?" · "+row.ticker:""}</small></span>
       <DotBar value={row.changeKrw} maximum={maximum} active={active?.key===row.key}/>
       <span className={styles.rowValue} data-tone={tone(row.changeKrw)}>{money(row.changeKrw,true)}<small>{row.returnPct===null?"변동률 —":formatPercent(row.returnPct,2,true)}</small></span>
      </button>)}
     </div>
    </div>
    {active&&<aside className={styles.selected} id={readoutId} aria-live="polite">
     <p className={styles.eyebrow}>선택한 종목</p><h3>{active.name??"이름 확인 전"}</h3><p>{active.accountLabel??"계좌 확인 전"} · {active.market??"시장 미제공"}</p>
     <strong className={styles.selectedAmount} data-tone={tone(active.changeKrw)}>{money(active.changeKrw,true)} <small>{context.currency}</small></strong>
     <dl><Metric label="가격·환율 수익률" value={formatPercent(active.returnPct,2,true)} /><Metric label="같은 수량의 기준 평가" value={formatNumber(active.previousValueKrw,{maximumFractionDigits:0})} unit="원" /></dl>
     <p className={styles.selectedNote}>현재 보유 수량에 기준 가격·환율과 현재 가격·환율을 각각 적용합니다. 추가 매수 금액은 수익에 포함하지 않습니다.</p>
     {active.identityStatus==="unmatched"&&<p className={styles.notice}>변동 근거는 있으나 현재 종목 이름을 연결하지 못했습니다.</p>}
    </aside>}
   </div>
  </>:<p className={styles.empty}>표시할 종목별 변동 근거가 없습니다. 확인되지 않은 값을 채우지 않습니다.</p>}
  <details className={styles.evidence}><summary>숫자·시세·비교 근거</summary>
   {rows.length>0&&<>
   <div className={styles.tableScroll} tabIndex={0} aria-label="종목별 변동 원본 숫자 표">
    <table><caption>종목별 변동 근거 · KRW 원본</caption><thead><tr><th>종목 · 계좌</th><th>가격·환율 변동액</th><th>수익률</th><th>같은 수량의 기준 평가</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th>{row.name??"이름 확인 전"}<small>{row.accountLabel??"계좌 확인 전"}{row.ticker?" · "+row.ticker:""}</small></th><td data-tone={tone(row.changeKrw)}>{exact(row.changeKrw,true)}</td><td>{row.returnPct===null?"—":exact(row.returnPct,true)+"%"}</td><td>{exact(row.previousValueKrw)}</td></tr>)}</tbody></table>
   </div>

   </>}
   <p>화면 갱신 {d.refreshedAt??"미제공"} · 비교 기준일 {d.comparisonDate??"미제공"} · {sourceLabel(d.movementSource)}</p>
   <p>변동 모델 환율 {exact(d.moneyBasis.dashboard.usdKrwRate)} · 환율 기준일 {d.moneyBasis.dashboard.rateDate??"미제공"}. 수익률은 현재 보유 수량을 고정한 KRW 가격·환율 비교입니다.</p>
   <p>종목별 값은 동일 수량의 기준 평가와 현재 평가 차이입니다. 미확인 가격·환율은 제외하며, 전체 수익률로 확대 해석하지 않습니다.</p>
   <p>원본 상태: {d.movementSource??"none"}{d.movementReason?" · "+d.movementReason:""}{d.movementRead?.reasons.length?" · "+d.movementRead.reasons.join(", "):""}</p>
  </details>
  <Link className={styles.link} prefetch={false} href={betaReadHref(betaHref("/beta/history",context),freshness?.store.pendingEpoch())}>저장 평가 이력 보기 ↗</Link>
 </section>;
}

function DotBar({value,maximum,active}:{value:number;maximum:number;active:boolean}) {
 const id=useId(), length=Number.isFinite(value)?Math.abs(value)/maximum*238:0, positive=value>=0;
 return <span className={styles.bar} aria-hidden="true"><svg viewBox="0 0 500 32" preserveAspectRatio="xMidYMid meet"><defs><pattern id={id+"-track"} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.7" fill="var(--cairn-v2-line)"/></pattern><pattern id={id+"-value"} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r={active?2.55:2.05} fill={positive?"var(--today-positive)":"var(--today-negative)"}/></pattern></defs><rect x="10" width="480" height="32" fill={"url(#"+id+"-track)"} opacity=".55"/><rect x={positive?250:250-length} width={length} height="32" fill={"url(#"+id+"-value)"}/><line x1="250" x2="250" y1="0" y2="32" stroke="var(--cairn-v2-muted)" strokeWidth=".6"/></svg></span>;
}
