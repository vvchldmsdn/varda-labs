"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";
import { portfolioEnglish } from "@/components/portfolio/portfolio-copy";


import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ChartPie, LayoutGrid } from "lucide-react";
import { PortfolioAllocationRing } from "./portfolio-allocation-ring";
import styles from "../portfolio-structure/structure-stage.module.css";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import type { PortfolioStructureGroupRow, PortfolioStructureHoldingRow } from "@/lib/portfolio-structure";
import { layoutPortfolioTreemap } from "@/lib/portfolio-structure-treemap";

export function PortfolioAllocationExplorer({ compact=false, groupRows, holdingRows, accountLabels, summary, footer, serviceDate }: {
  compact?: boolean;
  groupRows: readonly PortfolioStructureGroupRow[];
  holdingRows: readonly PortfolioStructureHoldingRow[];
  accountLabels: Readonly<Record<string, string>>;
  summary?: ReactNode;
  footer?: ReactNode;
  serviceDate?: string | null;
}) {
  const pt = usePortfolioText();
  const keyedRows=useMemo(()=>holdingRows.map((row,index)=>({key:holdingKey(row,index),row})),[holdingRows]);
  const layout=useMemo(()=>layoutPortfolioTreemap(keyedRows.map(({key,row})=>({key,value:row.currentValueKrw}))),[keyedRows]);
  const [selectedKey,setSelectedKey]=useState(keyedRows[0]?.key??"");
  const [view,setView]=useState<"ring"|"map">("ring");
  const selected=keyedRows.find(({key})=>key===selectedKey)??keyedRows[0]??null;
  const rowsByKey=useMemo(()=>new Map(keyedRows.map(({key,row})=>[key,row])),[keyedRows]);
  return <section className={styles.explorer} aria-labelledby="allocation-explorer-title" data-compact={compact?"true":"false"} data-section="allocation-explorer">
    <div className={styles.explorerHeading}><h2 id="allocation-explorer-title"><PortfolioText ko={"자산 배분"} /></h2><div className="varda-segmented" role="group" aria-label={pt("비중 시각화")}><button type="button" aria-pressed={view==="ring"} onClick={()=>setView("ring")}><ChartPie size={14} aria-hidden="true" /><PortfolioText ko={"원형"} /></button><button type="button" aria-pressed={view==="map"} onClick={()=>setView("map")}><LayoutGrid size={14} aria-hidden="true" /><PortfolioText ko={"비중 지도"} /></button></div></div>
    {selected ? <div className={styles.explorerBody}>
      <aside className={styles.summaryCell} aria-label={pt("포트폴리오 핵심 수치")}>{summary}</aside>
      <div className={styles.visualCell}>
        {view==="ring" ? <PortfolioAllocationRing entries={keyedRows.map(({key,row})=>({key,name:row.name,weightPct:row.currentWeightPct}))} selectedKey={selected.key} onSelect={setSelectedKey} /> : <div className={styles.mapFrame}><div className={styles.map}>{layout.map(rect=>{
          const row=rowsByKey.get(rect.key);if(!row)return null;
          const active=rect.key===selected.key;
          return <button key={rect.key} type="button" aria-label={pt(`${row.name}, 현재 비중 ${formatPercent(row.currentWeightPct)}`)} aria-pressed={active} onClick={()=>setSelectedKey(rect.key)} className={`absolute overflow-hidden rounded-md border p-2 text-left transition-[filter,box-shadow] duration-150 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] ${active?"z-10 border-[var(--ink)] shadow-[0_0_0_1px_var(--ink)]":"border-[var(--paper)] hover:brightness-[0.97]"}`} style={tileStyle(rect,row.driftPct)}>
            {rect.width>=11&&rect.height>=10?<span className="block truncate text-[10px] font-semibold leading-4 text-[var(--ink)]">{row.name}</span>:null}
            {rect.width>=15&&rect.height>=15?<span className="mt-1 block truncate text-[9px] text-[var(--muted)]"><PortfolioText ko={accountLabel(row.account, accountLabels)} /> · {row.ticker ?? <PortfolioText ko="종목 코드 없음" />}</span>:null}
            {rect.width>=9&&rect.height>=8?<span className="absolute bottom-2 left-2 text-[9px] tabular-nums">{formatPercent(row.currentWeightPct)}</span>:null}
          </button>;
        })}</div><div className={styles.mapLegend}><LegendSwatch color="var(--brand)" label="목표보다 낮음" /><LegendSwatch color="var(--line)" label="목표 근접" /><LegendSwatch color="var(--negative-mid)" label="목표보다 높음" /><LegendSwatch color="var(--wash)" label="목표 없음" /></div></div>}
      </div>
      <aside className={styles.selectedDetail} aria-label={pt("선택 종목 근거")}>
        <label className="sr-only" htmlFor="allocation-selected-holding"><PortfolioText ko={"비중 종목 선택"} /></label><select id="allocation-selected-holding" className={styles.holdingSelect} value={selected.key} onChange={event=>setSelectedKey(event.target.value)}>{keyedRows.map(({key,row})=><option key={key} value={key}>{row.name} · {formatPercent(row.currentWeightPct)}</option>)}</select>
        <div className={styles.selectedDesktop}><SelectedHoldingEvidence row={selected.row} accountLabels={accountLabels} /></div>
        <div className={styles.selectedMobile}><span><PortfolioText ko={"현재"} /><strong>{formatPercent(selected.row.currentWeightPct)}</strong></span><span><PortfolioText ko={"목표"} /><strong><PortfolioText ko={formatPercent(selected.row.effectiveTargetPct)} /></strong></span><span><PortfolioText ko={"편차"} /><strong>{formatSignedPercent(selected.row.driftPct)}</strong></span></div>
      </aside>
    </div> : <p className="py-12 text-sm text-[var(--muted)]"><PortfolioText ko={"현재 표시할 수 있는 보유 종목이 없습니다."} /></p>}
    <footer className={styles.explorerFooter}><span><PortfolioText ko={"기준일"} />{" "}<PortfolioText ko={serviceDate??"근거 없음"} /> {" "}<PortfolioText ko={"· 읽기 전용 분석"} /></span><div className={styles.launchers}>
      <PresentationDialog label="종목·그룹 비중" labelEn={portfolioEnglish("종목·그룹 비중")} title="선택 종목과 그룹별 비중" titleEn={portfolioEnglish("선택 종목과 그룹별 비중")} wide>{selected?<SelectedHoldingEvidence row={selected.row} accountLabels={accountLabels}/>:null}{groupRows.length?<section className={styles.modalSection}><h3><PortfolioText ko={"그룹 비중 · 현재 / 승인 목표"} /></h3><div className={styles.groupRows}>{groupRows.map(row=><GroupAllocationRow key={row.name} row={row}/>)}</div></section>:null}</PresentationDialog>
      {footer}
    </div></footer>
  </section>;
}

function SelectedHoldingEvidence({row, accountLabels}:{row:PortfolioStructureHoldingRow; accountLabels: Readonly<Record<string, string>>}) {
  const pt = usePortfolioText();
  return <section className={styles.holdingEvidence}><h3>{row.name}</h3><p className={styles.holdingIdentity}><PortfolioText ko={accountLabel(row.account, accountLabels)} /> · {row.ticker ?? <PortfolioText ko="종목 코드 없음" />} · {row.currency}</p><dl className={styles.holdingFacts}><DetailRow label="평가액" value={formatKrw(row.currentValueKrw)}/><DetailRow label="현재 비중" value={formatPercent(row.currentWeightPct)}/><DetailRow label="목표 비중" value={pt(formatPercent(row.effectiveTargetPct))}/><DetailRow label="편차" tone={row.driftPct} value={formatSignedPercent(row.driftPct)}/></dl><div className={styles.targetComparison}><div><span><PortfolioText ko={"현재 / 목표"} /></span><strong>{formatPercent(row.currentWeightPct)} / <PortfolioText ko={formatPercent(row.effectiveTargetPct)} /></strong></div><div className={styles.targetTrack}><div style={{width:`${Math.min(100,row.currentWeightPct)}%`}}/>{row.effectiveTargetPct!==null?<span aria-hidden="true" style={{left:`${Math.min(100,row.effectiveTargetPct)}%`}}/>:null}</div></div><p className={styles.holdingNote}><PortfolioText ko={row.targetPolicyStatus==="approved_policy"?"승인된 목표비중과 현재 평가액을 비교한 읽기 전용 근거입니다.":"현재 범위에 적용된 승인 목표가 없어 보유 근거만 표시합니다."} /></p></section>;
}
function GroupAllocationRow({ row }: { row: PortfolioStructureGroupRow }) {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{row.name === "Ungrouped" ? <PortfolioText ko="미분류" /> : row.name}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{row.holdingCount}<PortfolioText ko={"개 종목"} /></p>
        </div>
        <div className="shrink-0 text-right text-xs tabular-nums">
          <span className="font-medium text-[var(--ink)]">{formatPercent(row.currentWeightPct)}</span>
          <span className="mx-2 text-[var(--faint)]">/</span>
          <span className="text-[var(--muted)]">{formatPercent(row.effectiveTargetPct)}</span>
        </div>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-[var(--wash)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand-mid)]"
          style={{ width: `${Math.min(100, row.currentWeightPct)}%` }}
        />
        {row.effectiveTargetPct !== null ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 h-3.5 w-px bg-[var(--ink)]"
            style={{ left: `${Math.min(100, row.effectiveTargetPct)}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  tone = null,
  value,
}: {
  label: string;
  tone?: number | null;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <dt className="text-[var(--muted)]"><PortfolioText ko={label} /></dt>
      <dd className={`font-medium tabular-nums ${toneClass(tone)}`}><PortfolioText ko={value} /></dd>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
      <PortfolioText ko={label} />
    </span>
  );
}

function tileStyle(
  rect: { x: number; y: number; width: number; height: number },
  driftPct: number | null,
): CSSProperties {
  const inset = 0.24;
  return {
    left: `${rect.x + inset}%`,
    top: `${(rect.y / 56) * 100 + inset}%`,
    width: `${Math.max(0.5, rect.width - inset * 2)}%`,
    height: `${Math.max(0.8, (rect.height / 56) * 100 - inset * 2)}%`,
    backgroundColor: driftColor(driftPct),
  };
}

function holdingKey(row: PortfolioStructureHoldingRow, index: number) {
  return [row.account, row.market, row.currency, row.ticker ?? row.name, index]
    .map((part) => encodeURIComponent(String(part)))
    .join("|");
}

function driftColor(value: number | null) {
  if (value === null) return "var(--wash)";
  if (value >= 4) return "var(--negative-mid)";
  if (value >= 1) return "var(--warning-soft)";
  if (value <= -4) return "var(--brand-mid)";
  if (value <= -1) return "var(--brand-soft)";
  return "var(--line)";
}

function toneClass(value: number | null) {
  if (value === null || value === 0) return "text-[var(--ink)]";
  return value > 0 ? "text-[var(--negative)]" : "text-[var(--brand)]";
}

function accountLabel(account: string, labels: Readonly<Record<string, string>>) {
  if (Object.hasOwn(labels, account)) return labels[account];
  if (account === "brokerage") return "증권";
  if (account === "isa") return "ISA";
  if (account === "irp") return "IRP";
  return account;
}


function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "목표 없음";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%p`;
}
