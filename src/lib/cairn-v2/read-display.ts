import { historyObservationPoints, historyObservationDate } from "./history-observations.ts";
import type { BetaView } from "./read-contract";
import { buildPortfolioHistoryTrajectory } from "../history-trajectory";
import { readStateText } from "./read-presentation";

// Presentation only: retain original evidence; observed view selects original rows, never repairs missing data.
export function historySourceView(base: BetaView, requested?: string, preferredDate?: string | null) {
  const domain = base.domain;
  const fallback = { view: base, options: [] as { value: string; label: string }[], selected: "", label: "" };
  if (!domain || domain.historyDisplayCurrency !== "KRW" || !["ready", "partial"].includes(domain.historyReadStatus ?? "") || ["loading", "unauthorized"].includes(domain.state)) return fallback;
  const sources = [...new Set(domain.historyRecords.map(row => row.source))];
  const observedPolicy = domain.historyObservationPolicy === "production_observed_v1";
  if (sources.length < 2 && !observedPolicy) return fallback;
  const groups = sources.map(source => {
    const rows = domain.historyRecords.filter(row => row.source === source);
    const dates = rows.map(row => observedPolicy ? historyObservationDate(row) ?? "" : row.snapshotDate).filter(Boolean).sort();
    return { source, rows, latest: dates.at(-1) ?? "", earliest: dates[0] ?? "" };
  }).sort((a,b) => b.latest.localeCompare(a.latest) || a.source.localeCompare(b.source));
  const names = (source: string, i: number) => source === "varda_manual_daily_snapshot" ? "저장 평가" : source === "base44_import" ? "이관 기록" : source.startsWith("broker_reconstructed_close_v1:") ? "재구성 기록 " + (i + 1) : "저장 출처 " + (i + 1);
  const options = groups.map((group,i) => ({value:group.source,label:names(group.source,i)+" · "+group.earliest.slice(5)+"–"+group.latest.slice(5)}));
  if (observedPolicy) {
    options.unshift({value:"observed",label:"관측 이력 · 날짜별 확인된 기록"});
    const choice = requested ?? domain.historyViewSource ?? "observed";
    const group = groups.find(g=>g.source===choice);
    const projected = historyObservationPoints(group?.rows ?? domain.historyRecords, !group);
    const partial = domain.historyReadStatus === "partial" || projected.rows.some(r=>r.rowKind === "partial");
    const state = !projected.rows.length ? domain.historyRecords.length ? "unavailable" : "empty" : partial ? "partial" : "ready";
    const selected = group?.source ?? "observed";
    const view: BetaView = {...base,history:projected.rows,domain:{...domain,historyViewSource:selected,historyObservedExcludedCount:projected.excludedCount,historyState:state}};
    return {view,options,selected,label:options.find(o=>o.value===selected)!.label};
  }
  // Legacy source-only evidence presentation stays available for older read ports.
  const selected = groups.find(group => group.source === requested) ?? groups.find(group => group.rows.some(row => row.snapshotDate === preferredDate)) ?? groups[0];
  const trajectory = buildPortfolioHistoryTrajectory({rows:selected.rows,account:selected.rows[0]?.account ?? "all"});
  const rows = selected.rows.map(row => {
    const segment = trajectory.segments.find(s => s.source === row.source && s.rowKind === row.rowKind && s.points.some(p => p.date === row.snapshotDate));
    const point = segment?.points.find(p => p.date === row.snapshotDate);
    return {date:row.snapshotDate,source:row.source,rowKind:row.rowKind,account:row.account,includedAccounts:[...row.derivedFromAccounts],segment:segment?.key ?? row.snapshotDate,valueKrw:point?.valueKrw ?? null,exampleReturnPct:point && row.rowKind !== "partial" ? row.totalReturnPct : null};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const partial = domain.historyReadStatus === "partial" || trajectory.excludedPointCount > 0 || selected.rows.some(row=>row.rowKind === "partial");
  const view: BetaView = {...base,history:rows,domain:{...domain,historyRecords:selected.rows,historySourceCount:1,historyState:trajectory.status === "ready" ? partial ? "partial" : "ready" : "unavailable"}};
  return {view,options,selected:selected.source,label:options.find(o=>o.value===selected.source)!.label};
}

const reasons: Record<string,string> = {
  missing_fresh_live_prices:"비교 시점의 시세가 부족합니다",
  missing_baseline_snapshot:"비교 기준 기록이 부족합니다",
  missing_previous_close_fallback:"비교할 이전 종가가 없습니다",
  coverage_below_threshold:"비교 가능한 자산 범위가 기준에 못 미칩니다",
  manual_valuation_not_updated_in_cycle:"수동 평가 자산의 갱신이 필요합니다",
  unsupported_currency:"지원되지 않는 통화가 포함되어 있습니다",
  missing_current_fx:"현재 환율 근거가 없습니다",
  missing_baseline_fx:"비교 기준 환율이 없습니다",
};
export function movementDisplay(view: BetaView) {
  const d=view.domain, read=d?.movementRead;
  const guarded=!!d && (["loading","unauthorized"].includes(d.state) || ["loading","unauthorized","empty"].includes(d.movementState));
  const fxBlocked=!!d && d.historyDisplayCurrency === "USD" && !(d.moneyBasis.dashboard.usdKrwRate! > 0);
  const partial=!!read?.ready && read.excludedCount > 0;
  const confirmed=!guarded && !fxBlocked && partial && read?.changeKrw !== null && Number.isFinite(read?.changeKrw) ? read!.changeKrw : null;
  const value=guarded || fxBlocked ? null : view.todayMoveKrw ?? confirmed;
  const stateText=guarded ? readStateText(["loading","unauthorized"].includes(d!.state) ? d!.state : d!.movementState,"비교할 기록 없음") : value !== null ? null : fxBlocked ? "USD 표시를 위한 환율 근거 없음" : d?.movementReason ? reasons[d.movementReason] ?? "비교 근거 확인 전" : read?.reasons.length ? reasons[read.reasons[0]] ?? "일부 종목의 비교 근거 부족" : readStateText(d?.movementState,"비교할 기록 없음");
  return {value,partial:value !== null && partial,message:stateText,includedCount:read?.includedCount ?? 0,excludedCount:read?.excludedCount ?? d?.movementExcludedCount ?? 0,returnPct:guarded || partial ? null : d?.movementReturnPct ?? null};
}
export function retryReadNeeded(view?: BetaView) {
  const d=view?.domain;if(!d)return false;
  return d.valueState === "unavailable" || d.historyReadStatus === "unavailable" || (d.historyReadStatus === undefined && d.historyState === "unavailable") || (!d.movementRead && d.movementState === "unavailable");
}
export function homeReadMessage(view: BetaView) {
  const selected=historySourceView(view);
  if (!selected.options.length || selected.view.domain?.historyState === "unavailable") return view.domain?.message;
  const sources = view.domain?.historyObservationPolicy ? "확인된 관측일 기준 · 저장 원본과 출처는 확대 화면에서 확인" : "저장 이력은 출처별로 표시 · 확대 화면에서 출처 선택";
  return view.domain?.valueState !== "ready" ? view.domain?.message + " · " + sources : sources;
}
