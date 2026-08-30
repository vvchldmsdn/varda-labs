"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ChartPie, LayoutGrid } from "lucide-react";
import { PortfolioAllocationRing } from "./portfolio-allocation-ring";

import type {
  PortfolioStructureGroupRow,
  PortfolioStructureHoldingRow,
} from "@/lib/portfolio-structure";
import { layoutPortfolioTreemap } from "@/lib/portfolio-structure-treemap";

export function PortfolioAllocationExplorer({
  groupRows,
  holdingRows,
}: {
  groupRows: readonly PortfolioStructureGroupRow[];
  holdingRows: readonly PortfolioStructureHoldingRow[];
}) {
  const keyedRows = useMemo(
    () =>
      holdingRows.map((row, index) => ({
        key: holdingKey(row, index),
        row,
      })),
    [holdingRows],
  );
  const layout = useMemo(
    () =>
      layoutPortfolioTreemap(
        keyedRows.map(({ key, row }) => ({ key, value: row.currentValueKrw })),
      ),
    [keyedRows],
  );
  const [selectedKey, setSelectedKey] = useState(keyedRows[0]?.key ?? "");
  const [view, setView] = useState<"ring" | "map">("ring");
  const selected =
    keyedRows.find(({ key }) => key === selectedKey) ?? keyedRows[0] ?? null;
  const rowsByKey = useMemo(
    () => new Map(keyedRows.map(({ key, row }) => [key, row])),
    [keyedRows],
  );

  return (
    <section
      aria-labelledby="allocation-explorer-title"
      className="border-y border-[var(--line)] py-7 lg:py-8"
      data-section="allocation-explorer"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            ALLOCATION FIELD
          </p>
          <h2
            className="mt-1 text-xl font-medium text-[var(--ink)] sm:text-2xl"
            id="allocation-explorer-title"
          >
            포트폴리오의 무게중심
          </h2>
        </div>
        <div className="varda-segmented" role="group" aria-label="비중 시각화">
          <button type="button" aria-pressed={view === "ring"} onClick={() => setView("ring")}><ChartPie size={14} aria-hidden="true" />원형</button>
          <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}><LayoutGrid size={14} aria-hidden="true" />비중 지도</button>
        </div>
      </div>

      {selected ? (
        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.65fr)] lg:gap-10">
          <div className="min-w-0">
            {view === "ring" ? (
              <PortfolioAllocationRing entries={keyedRows.map(({key,row}) => ({key,name:row.name,weightPct:row.currentWeightPct}))} selectedKey={selected.key} onSelect={setSelectedKey} />
            ) : (
            <div className="relative min-h-[390px] overflow-hidden bg-[var(--paper)] sm:aspect-[16/8] sm:min-h-0">
              {layout.map((rect) => {
                const row = rowsByKey.get(rect.key);
                if (!row) return null;
                const active = rect.key === selected.key;
                const showName = rect.width >= 11 && rect.height >= 10;
                const showTicker = rect.width >= 15 && rect.height >= 15;
                return (
                  <button
                    aria-label={`${row.name}, 현재 비중 ${formatPercent(row.currentWeightPct)}`}
                    aria-pressed={active}
                    className={`absolute overflow-hidden rounded-md border p-2 text-left transition-[filter,box-shadow] duration-150 focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] ${
                      active
                        ? "z-10 border-[var(--ink)] shadow-[0_0_0_1px_var(--ink)]"
                        : "border-[var(--paper)] hover:brightness-[0.97]"
                    }`}
                    key={rect.key}
                    onClick={() => setSelectedKey(rect.key)}
                    style={tileStyle(rect, row.driftPct)}
                    type="button"
                  >
                    {showName ? (
                      <span className="block truncate text-[11px] font-semibold leading-4 text-[var(--ink)] sm:text-xs">
                        {row.name}
                      </span>
                    ) : null}
                    {showTicker ? (
                      <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                        {accountLabel(row.account)} · {row.ticker ?? "종목 코드 없음"}
                      </span>
                    ) : null}
                    {rect.width >= 9 && rect.height >= 8 ? (
                      <span className="absolute bottom-2 left-2 text-[10px] font-medium tabular-nums text-[var(--ink)] sm:text-xs">
                        {formatPercent(row.currentWeightPct)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            )}
            {view === "map" ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--muted)]">
              <LegendSwatch color="var(--brand)" label="목표보다 낮음" />
              <LegendSwatch color="var(--line)" label="목표 근접" />
              <LegendSwatch color="var(--negative-mid)" label="목표보다 높음" />
              <LegendSwatch color="var(--wash)" label="목표 없음" />
            </div>
            ) : null}
          </div>

          <div className="min-w-0 border-t border-[var(--line)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <label className="sr-only" htmlFor="allocation-selected-holding">비중 종목 선택</label>
            <select id="allocation-selected-holding" className="mb-7 min-h-10 w-full border-b border-[var(--line)] bg-transparent text-sm" value={selected.key} onChange={event => setSelectedKey(event.target.value)}>
              {keyedRows.map(({key,row}) => <option key={key} value={key}>{row.name} · {formatPercent(row.currentWeightPct)}</option>)}
            </select>
            <p className="text-[11px] font-medium text-[var(--muted)]">
              SELECTED HOLDING
            </p>
            <h3 className="mt-2 text-2xl font-medium leading-tight text-[var(--ink)]">
              {selected.row.name}
            </h3>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {accountLabel(selected.row.account)} · {selected.row.ticker ?? "종목 코드 없음"} · {selected.row.currency}
            </p>

            <dl className="mt-8 divide-y divide-[var(--wash)] border-y border-[var(--wash)]">
              <DetailRow
                label="평가액"
                value={formatKrw(selected.row.currentValueKrw)}
              />
              <DetailRow
                label="현재 비중"
                value={formatPercent(selected.row.currentWeightPct)}
              />
              <DetailRow
                label="목표 비중"
                value={formatPercent(selected.row.effectiveTargetPct)}
              />
              <DetailRow
                label="편차"
                tone={selected.row.driftPct}
                value={formatSignedPercent(selected.row.driftPct)}
              />
            </dl>

            <div className="mt-7">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--muted)]">현재 / 목표</span>
                <span className="font-medium tabular-nums text-[var(--ink)]">
                  {formatPercent(selected.row.currentWeightPct)} / {formatPercent(selected.row.effectiveTargetPct)}
                </span>
              </div>
              <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-[var(--wash)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--brand)]"
                  style={{ width: `${Math.min(100, selected.row.currentWeightPct)}%` }}
                />
                {selected.row.effectiveTargetPct !== null ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 h-4 w-px bg-[var(--ink)]"
                    style={{ left: `${Math.min(100, selected.row.effectiveTargetPct)}%` }}
                  />
                ) : null}
              </div>
            </div>

            <p className="mt-7 text-xs leading-5 text-[var(--muted)]">
              {selected.row.targetPolicyStatus === "approved_policy"
                ? "승인된 목표비중과 현재 평가액을 비교한 읽기 전용 근거입니다."
                : "현재 범위에 적용된 승인 목표가 없어 보유 근거만 표시합니다."}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-7 border-y border-[var(--wash)] py-8 text-sm text-[var(--muted)]">
          현재 표시할 수 있는 보유 종목이 없습니다.
        </p>
      )}

      {groupRows.length > 0 ? (
        <div className="mt-10 border-t border-[var(--line)] pt-7">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium text-[var(--ink)]">그룹 비중</h3>
            <span className="text-[11px] text-[var(--muted)]">현재값 / 승인 목표</span>
          </div>
          <div className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-2">
            {groupRows.map((row) => (
              <GroupAllocationRow key={row.name} row={row} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GroupAllocationRow({ row }: { row: PortfolioStructureGroupRow }) {
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--ink)]">{displayGroupName(row.name)}</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{row.holdingCount}개 종목</p>
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
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className={`font-medium tabular-nums ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
      {label}
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

function accountLabel(account: string) {
  if (account === "brokerage") return "증권";
  if (account === "isa") return "ISA";
  if (account === "irp") return "IRP";
  return account;
}

function displayGroupName(name: string) {
  return name === "Ungrouped" ? "미분류" : name;
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
