"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatShortDate,
  toneClass,
} from "@/components/home/portfolio-format";
import type {
  PortfolioDashboardHeatmapCell,
  PortfolioDashboardHoldingHistory,
} from "@/lib/portfolio-dashboard-history";

type HeatmapMode = "movement" | "allocation" | "connections";

export function HoldingMovementHeatmap({
  history,
  riskHref,
  structureHref,
}: {
  history: PortfolioDashboardHoldingHistory;
  riskHref: string;
  structureHref: string;
}) {
  const [mode, setMode] = useState<HeatmapMode>("movement");
  const [selection, setSelection] = useState<{ rowIndex: number; cellIndex: number } | null>(null);
  const selectedRow = selection ? history.rows[selection.rowIndex] ?? null : null;
  const selectedCell = selection && selectedRow
    ? selectedRow.cells[selection.cellIndex] ?? null
    : null;
  const maxWeight = useMemo(
    () => Math.max(...history.rows.map((row) => row.currentWeight), 1),
    [history.rows],
  );

  return (
    <section aria-labelledby="holding-heatmap-title" className="min-w-0">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">HOLDING PULSE</p>
          <h2 id="holding-heatmap-title" className="mt-1 text-base font-semibold">
            종목 흐름
          </h2>
        </div>
        <div className="flex gap-5 text-xs" aria-label="종목 흐름 보기 방식">
          <ModeButton active={mode === "movement"} onClick={() => setMode("movement")}>
            일별 변동
          </ModeButton>
          <ModeButton active={mode === "allocation"} onClick={() => setMode("allocation")}>
            구성
          </ModeButton>
          <ModeButton active={mode === "connections"} onClick={() => setMode("connections")}>
            연결
          </ModeButton>
        </div>
      </div>

      {mode === "movement" ? (
        <MovementMatrix history={history} onSelect={(rowIndex, cellIndex) => setSelection({ rowIndex, cellIndex })} selection={selection} />
      ) : null}

      {mode === "allocation" ? (
        <div className="min-h-[310px] space-y-5 py-3">
          {history.rows.map((row) => (
            <div key={row.holdingId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
              <p className="truncate text-sm font-medium text-[#252824]">{row.name}</p>
              <p className="text-sm font-medium tabular-nums text-[#252824]">
                {formatPercent(row.currentWeight)}
              </p>
              <div className="col-span-2 h-1 bg-[#e4e7e2]">
                <div
                  className="h-1 bg-[#6f9e88]"
                  style={{ width: `${Math.max(2, (row.currentWeight / maxWeight) * 100)}%` }}
                />
              </div>
            </div>
          ))}
          <Link className="inline-flex border-b border-[#9da39b] pb-1 text-xs font-medium text-[#4d534c] hover:text-[#20231f]" href={structureHref}>
            전체 자산 구성 보기 →
          </Link>
        </div>
      ) : null}

      {mode === "connections" ? (
        <div className="grid min-h-[310px] place-items-center border-y border-[#e2e5df] px-6 text-center">
          <div className="max-w-sm">
            <p className="text-sm font-semibold text-[#2d312c]">연결 분석은 근거별로 나누어 제공합니다.</p>
            <p className="mt-2 text-xs leading-5 text-[#747a72]">
              가격 상관관계와 ETF 구성 겹침을 하나의 점수로 섞지 않고 각각 확인할 수 있습니다.
            </p>
            <div className="mt-5 flex justify-center gap-5 text-xs font-medium">
              <Link className="border-b border-[#9da39b] pb-1 hover:text-[#347e62]" href={riskHref}>
                상관·위험 보기
              </Link>
              <Link className="border-b border-[#9da39b] pb-1 hover:text-[#347e62]" href="/etfs">
                ETF 겹침 보기
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {mode === "movement" && selectedRow && selectedCell ? (
        <div className="mt-4 grid gap-3 border-t border-[#e0e3de] pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-sm font-semibold text-[#252824]">{selectedRow.name}</p>
            <p className="mt-1 text-xs text-[#767c74]">
              {formatDate(selectedCell.date)}
              {selectedRow.ticker ? ` · ${selectedRow.ticker}` : ""}
              {selectedCell.basis === "market_value" ? " · 평가액 변동 근거" : ""}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 text-xs sm:grid-cols-4">
            <HeatmapDetail label="등락" value={formatPercent(selectedCell.changePct, true)} tone={selectedCell.changePct} />
            <HeatmapDetail label="평가액" value={formatKrw(selectedCell.changeKrw)} tone={selectedCell.changeKrw} />
            <HeatmapDetail label="가격" value={formatKrw(selectedCell.priceChangeKrw)} tone={selectedCell.priceChangeKrw} />
            <HeatmapDetail label="환율" value={formatKrw(selectedCell.fxChangeKrw)} tone={selectedCell.fxChangeKrw} />
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function MovementMatrix({
  history,
  onSelect,
  selection,
}: {
  history: PortfolioDashboardHoldingHistory;
  onSelect: (rowIndex: number, cellIndex: number) => void;
  selection: { rowIndex: number; cellIndex: number } | null;
}) {
  if (history.rows.length === 0 || history.dates.length === 0) {
    return (
      <div className="grid min-h-[310px] place-items-center border-y border-[#e2e5df] px-6 text-center">
        <div>
          <p className="text-sm font-medium text-[#343833]">종목별 일별 변화가 아직 없습니다.</p>
          <p className="mt-2 text-xs text-[#7b8079]">현재 평가액과 다른 분석은 그대로 이용할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const cellWidth = history.dates.length <= 20 ? 38 : 30;
  const gridTemplateColumns = `minmax(156px, 200px) repeat(${history.dates.length}, ${cellWidth}px)`;

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="min-w-max"
        style={{
          columnGap: "2px",
          display: "grid",
          gridTemplateColumns,
          rowGap: "3px",
        }}
      >
        <div />
        {history.dates.map((date, index) => (
          <div
            key={date}
            className="h-4 text-center text-[8px] tabular-nums text-[#858a83]"
            title={formatDate(date)}
          >
            {index === 0 || index === history.dates.length - 1 || index % 5 === 0
              ? formatShortDate(date)
              : ""}
          </div>
        ))}

        {history.rows.map((row, rowIndex) => (
          <HeatmapRow
            key={row.holdingId}
            row={row}
            rowIndex={rowIndex}
            onSelect={onSelect}
            selection={selection}
          />
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-[9px] text-[#858a83]">
        <span>하락</span>
        <div className="mx-2.5 flex flex-1 items-center gap-0.5" aria-hidden="true">
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "rgba(217, 101, 93, 0.46)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "rgba(217, 101, 93, 0.18)" }} />
          <span className="h-1.5 flex-1 rounded-[3px] bg-[#eceeeb]" />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "rgba(76, 155, 118, 0.18)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "rgba(76, 155, 118, 0.46)" }} />
        </div>
        <span>상승</span>
      </div>
    </div>
  );
}

function HeatmapRow({
  onSelect,
  row,
  rowIndex,
  selection,
}: {
  onSelect: (rowIndex: number, cellIndex: number) => void;
  row: PortfolioDashboardHoldingHistory["rows"][number];
  rowIndex: number;
  selection: { rowIndex: number; cellIndex: number } | null;
}) {
  return (
    <>
      <div className="flex min-w-0 items-center pr-2 text-[11px] font-medium text-[#2e322d]" title={row.name}>
        <span className="truncate">{row.name}</span>
      </div>
      {row.cells.map((cell, cellIndex) => {
        const selected = selection?.rowIndex === rowIndex && selection.cellIndex === cellIndex;
        return (
          <button
            key={`${row.holdingId}:${cell.date}`}
            type="button"
            aria-label={`${row.name} ${formatDate(cell.date)} ${formatPercent(cell.changePct, true)}`}
            aria-pressed={selected}
            className={`h-[18px] min-w-[22px] w-full rounded-[5px] border border-white/25 transition-[transform,box-shadow] hover:relative hover:z-10 hover:scale-[1.08] hover:shadow-[0_3px_8px_rgba(28,35,30,0.14)] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#20231f] ${
              selected ? "ring-1 ring-[#2b3731] ring-offset-1 ring-offset-[#f7f8f5]" : ""
            }`}
            onClick={() => onSelect(rowIndex, cellIndex)}
            style={{ backgroundColor: heatmapColor(cell) }}
            title={`${row.name}\n${formatDate(cell.date)}\n${formatPercent(cell.changePct, true)}`}
          />
        );
      })}
    </>
  );
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`border-b py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62] ${
        active
          ? "border-[#20231f] text-[#20231f]"
          : "border-transparent text-[#777c74] hover:text-[#20231f]"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function HeatmapDetail({
  label,
  tone,
  value,
}: {
  label: string;
  tone: number | null;
  value: string;
}) {
  return (
    <div>
      <dt className="text-[#858a83]">{label}</dt>
      <dd className={`mt-1 whitespace-nowrap font-medium ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function heatmapColor(cell: PortfolioDashboardHeatmapCell) {
  if (cell.changePct === null) return "#eceeeb";
  const alpha = Math.min(0.62, 0.13 + (Math.abs(cell.changePct) / 4) * 0.49);
  if (cell.changePct > 0) return `rgba(76, 155, 118, ${alpha.toFixed(3)})`;
  if (cell.changePct < 0) return `rgba(217, 101, 93, ${alpha.toFixed(3)})`;
  return "#e7e9e6";
}
