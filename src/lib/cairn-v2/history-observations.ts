import type { PortfolioHistoryDisplayRow } from "../history-balance";
import { historyObservationDate } from "./history-date.ts";
export { historyObservationDate } from "./history-date.ts";
export type HistoryReadRow = PortfolioHistoryDisplayRow & { valuationDate?: string | null; storageSnapshotDate?: string; cycleEndAt?: string | Date | null };
// Limited reuse of production history-overview canonical selection. No new
// dates, balances, return calculations, carry-forward or interpolation.
const precedence = (row: HistoryReadRow) => (row.rowKind === "stored" ? 0 : row.rowKind === "derived" ? 10 : 20) +
  (row.source === "varda_manual_daily_snapshot" ? 0 : row.source === "varda_daily_snapshot_v1" ? 1 : row.source === "base44_import" ? 2 : 3);
const signature = (row: HistoryReadRow) => JSON.stringify([row.totalMarketValue,row.totalPnl,row.totalReturnPct,row.cashValue]);
export function selectHistoryObservations(input: readonly HistoryReadRow[]) {
  const byDate = new Map<string, HistoryReadRow[]>(); let excludedCount = 0;
  for (const row of input) {
    const date = historyObservationDate(row);
    if (!date || row.totalMarketValue === null || !Number.isFinite(row.totalMarketValue)) { excludedCount++; continue; }
    byDate.set(date, [...(byDate.get(date) ?? []), {...row,valuationDate:date,storageSnapshotDate:row.storageSnapshotDate ?? row.snapshotDate}]);
  }
  const rows: HistoryReadRow[] = [];
  for (const [, candidates] of [...byDate].sort(([a],[b])=>a.localeCompare(b))) {
    const ranked = candidates.toSorted((a,b)=>precedence(a)-precedence(b) || a.source.localeCompare(b.source) || a.snapshotDate.localeCompare(b.snapshotDate));
    const first=ranked[0]; const peers=ranked.filter(r=>precedence(r)===precedence(first) && r.source===first.source);
    if (new Set(peers.map(signature)).size > 1) { excludedCount+=candidates.length; continue; }
    rows.push(first); excludedCount += candidates.length - 1;
  }
  return { rows, excludedCount };
}
const coverage = (r: HistoryReadRow) => JSON.stringify([r.account,[...r.derivedFromAccounts].sort()]);
export function historyObservationPoints(input: readonly HistoryReadRow[], canonical: boolean) {
  const selection = canonical ? selectHistoryObservations(input) : {rows:[...input],excludedCount:0};
  const dated = selection.rows.map(row=>({row,date:historyObservationDate(row)})).filter((r):r is {row:HistoryReadRow;date:string}=>!!r.date).toSorted((a,b)=>a.date.localeCompare(b.date));
  let segment=0, valueSegment=0;
  const rows=dated.map(({row,date},i)=>{
    const prior=dated[i-1];
    if (prior && (prior.row.source!==row.source || prior.row.rowKind!==row.rowKind || coverage(prior.row)!==coverage(row) || Date.parse(date)-Date.parse(prior.date)!==86400000)) segment++;
    if (prior && (prior.row.rowKind==='partial' || row.rowKind==='partial')) valueSegment++;
    return { date,storageSnapshotDate:row.storageSnapshotDate ?? row.snapshotDate,source:row.source,rowKind:row.rowKind,account:row.account,includedAccounts:[...row.derivedFromAccounts],
      segment:'evidence:'+segment, valueSegment:canonical?'observations:'+valueSegment:'evidence:'+segment,
      valueKrw:row.totalMarketValue,exampleReturnPct:row.rowKind==='partial'?null:row.totalReturnPct };
  });
  return {rows,excludedCount:selection.excludedCount + selection.rows.length-dated.length};
}
