"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

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
import { buildHoldingConnectionGraph } from "@/lib/holding-connection-graph";

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
          <p className="text-[11px] font-medium text-[var(--muted)]">HOLDING PULSE</p>
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
              <p className="truncate text-sm font-medium text-[var(--ink)]">{row.name}</p>
              <p className="text-sm font-medium tabular-nums text-[var(--ink)]">
                {formatPercent(row.currentWeight)}
              </p>
              <div className="col-span-2 h-1 bg-[var(--wash)]">
                <div
                  className="h-1 bg-[var(--brand-mid)]"
                  style={{ width: `${Math.max(2, (row.currentWeight / maxWeight) * 100)}%` }}
                />
              </div>
            </div>
          ))}
          <Link className="inline-flex border-b border-[var(--faint)] pb-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]" href={structureHref}>
            전체 자산 구성 보기 →
          </Link>
        </div>
      ) : null}

      {mode === "connections" ? (
        <ConnectionMap history={history} riskHref={riskHref} />
      ) : null}

      {mode === "movement" && selectedRow && selectedCell ? (
        <div className="mt-4 grid gap-3 border-t border-[var(--wash)] pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">{selectedRow.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {formatDate(selectedCell.date)}
              {selectedRow.ticker ? ` · ${selectedRow.ticker}` : ""}
              {selectedCell.basis === "market_value" ? " · 평가액 변동 근거" : ""}
              {selectedCell.basis === "live_movement" ? " · 실시간 변동 근거" : ""}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-5">
            <HeatmapDetail
              label="등락"
              value={selectedCell.changePct === null ? "미수집" : formatPercent(selectedCell.changePct, true)}
              tone={selectedCell.changePct}
            />
            <HeatmapDetail label="평가액" value={formatKrw(selectedCell.marketValueKrw)} tone={null} />
            <HeatmapDetail label="평가액 변동" value={formatKrw(selectedCell.changeKrw)} tone={selectedCell.changeKrw} />
            <HeatmapDetail label="가격 영향" value={formatKrw(selectedCell.priceChangeKrw)} tone={selectedCell.priceChangeKrw} />
            <HeatmapDetail label="환율 영향" value={formatKrw(selectedCell.fxChangeKrw)} tone={selectedCell.fxChangeKrw} />
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function ConnectionMap({
  history,
  riskHref,
}: {
  history: PortfolioDashboardHoldingHistory;
  riskHref: string;
}) {
  const graph = useMemo(() => buildHoldingConnectionGraph(history), [history]);

  if (graph.nodes.length < 2 || graph.edges.length === 0) {
    return (
      <div className="grid min-h-[310px] place-items-center border-y border-[var(--wash)] px-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm font-semibold text-[var(--ink)]">연결을 계산할 공통 이력이 아직 부족합니다.</p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            가격 상관관계와 ETF 구성 겹침은 서로 다른 근거이므로 상세 화면에서 나누어 확인합니다.
          </p>
          <ConnectionLinks riskHref={riskHref} />
        </div>
      </div>
    );
  }

  return (
    <div className="border-y border-[var(--wash)] py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[10px] text-[var(--muted)]">
        <p>최근 저장 일별 등락 · 상위 {graph.nodes.length}종목</p>
        <div className="flex items-center gap-4" aria-label="연결선 범례">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-5 bg-[var(--brand-mid)]" /> 함께 움직임
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-5 bg-[var(--warning)]" /> 반대 움직임
          </span>
        </div>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg
          aria-label="종목별 최근 등락 상관 연결도"
          className="h-[300px] min-w-[720px] w-full"
          role="img"
          viewBox="0 0 900 300"
        >
          <ellipse
            cx="450"
            cy="145"
            fill="none"
            rx="332"
            ry="104"
            stroke="var(--wash)"
            strokeDasharray="2 7"
          />
          {graph.edges.map((edge) => {
            const left = graph.nodes[edge.leftIndex];
            const right = graph.nodes[edge.rightIndex];
            if (!left || !right) return null;
            const strength = Math.abs(edge.correlation);
            return (
              <line
                key={edge.key}
                x1={left.x}
                x2={right.x}
                y1={left.y}
                y2={right.y}
                stroke={edge.correlation >= 0 ? "var(--brand-mid)" : "var(--warning)"}
                strokeDasharray={edge.correlation < 0 ? "4 4" : undefined}
                strokeLinecap="round"
                strokeOpacity={0.24 + strength * 0.42}
                strokeWidth={0.8 + strength * 3.2}
              >
                <title>
                  {left.name} · {right.name}: 상관 {edge.correlation.toFixed(2)} ({edge.observations}일)
                </title>
              </line>
            );
          })}
          {graph.nodes.map((node) => (
            <g key={node.holdingId}>
              <circle
                cx={node.x}
                cy={node.y}
                fill="var(--paper)"
                r={node.radius + 4}
                stroke="var(--wash)"
              />
              <circle
                cx={node.x}
                cy={node.y}
                fill="var(--brand)"
                fillOpacity="0.88"
                r={node.radius}
              >
                <title>{node.name} · 현재 비중 {formatPercent(node.currentWeight)}</title>
              </circle>
              <text
                x={node.x}
                y={node.y + node.radius + 18}
                fill="var(--ink)"
                fontSize="11"
                fontWeight="600"
                textAnchor="middle"
              >
                {compactName(node.name)}
              </text>
              <text
                x={node.x}
                y={node.y + node.radius + 32}
                fill="var(--faint)"
                fontSize="9"
                textAnchor="middle"
              >
                {formatPercent(node.currentWeight)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-1 pt-1">
        <p className="max-w-xl text-[10px] leading-4 text-[var(--faint)]">
          선은 같은 날짜에 관측된 일별 등락의 방향만 요약합니다. ETF 내부 종목 겹침이나 투자 권고를 뜻하지 않습니다.
        </p>
        <ConnectionLinks riskHref={riskHref} />
      </div>
    </div>
  );
}

function ConnectionLinks({ riskHref }: { riskHref: string }) {
  return (
    <div className="mt-5 flex justify-center gap-5 text-xs font-medium">
      <Link className="border-b border-[var(--faint)] pb-1 hover:text-[var(--brand)]" href={riskHref}>
        상관·위험 상세
      </Link>
      <Link className="border-b border-[var(--faint)] pb-1 hover:text-[var(--brand)]" href="/etfs">
        ETF 겹침 상세
      </Link>
    </div>
  );
}

function compactName(value: string) {
  return value.length > 18 ? `${value.slice(0, 16)}…` : value;
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
      <div className="grid min-h-[310px] place-items-center border-y border-[var(--wash)] px-6 text-center">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">종목별 일별 변화가 아직 없습니다.</p>
          <p className="mt-2 text-xs text-[var(--muted)]">현재 평가액과 다른 분석은 그대로 이용할 수 있습니다.</p>
        </div>
      </div>
    );
  }

  const cellWidth = history.dates.length <= 20 ? 34 : 27;
  const gridTemplateColumns = `minmax(174px, 214px) repeat(${history.dates.length}, ${cellWidth}px)`;

  return (
    <div className="overflow-x-auto pb-1">
      <div
        className="min-w-max"
        style={{
          columnGap: "1px",
          display: "grid",
          gridTemplateColumns,
          rowGap: "2px",
        }}
      >
        <div />
        {history.dates.map((date, index) => (
          <div
            key={date}
            className="h-4 text-center text-[8px] tabular-nums text-[var(--faint)]"
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
      <div className="mt-3 flex items-center gap-3 text-[9px] text-[var(--faint)]">
        <span>하락</span>
        <div className="flex flex-1 items-center gap-px" aria-hidden="true">
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--negative) 78%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--negative) 30%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px] bg-[var(--wash)]" />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 78%, transparent)" }} />
        </div>
        <span>상승</span>
        <span className="ml-2 inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[4px]" style={missingCellStyle} /> 미수집
        </span>
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
      <div className="flex min-w-0 items-center pr-2 text-[11px] font-medium text-[var(--ink)]" title={row.name}>
        <span className="truncate">{row.name}</span>
      </div>
      {row.cells.map((cell, cellIndex) => {
        const selected = selection?.rowIndex === rowIndex && selection.cellIndex === cellIndex;
        const evidenceLabel = cell.changePct === null
          ? "미수집"
          : formatPercent(cell.changePct, true);
        return (
          <button
            key={`${row.holdingId}:${cell.date}`}
            type="button"
            aria-label={`${row.name} ${formatDate(cell.date)} ${evidenceLabel}`}
            aria-pressed={selected}
            className={`flex h-[18px] min-w-[22px] w-full items-center justify-center rounded-[6px] border border-white/30 text-[8px] font-semibold tabular-nums text-[var(--muted)] transition-[transform,box-shadow] hover:relative hover:z-10 hover:scale-[1.08] hover:shadow-[0_3px_8px_rgba(28,35,30,0.14)] focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand)] ${
              selected ? "ring-1 ring-[var(--brand)] ring-offset-1 ring-offset-[var(--paper)]" : ""
            }`}
            onClick={() => onSelect(rowIndex, cellIndex)}
            style={heatmapStyle(cell)}
            title={`${row.name}\n${formatDate(cell.date)}\n${evidenceLabel}`}
          >
            {cell.changePct === null ? "·" : null}
          </button>
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
      className={`border-b py-1 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] ${
        active
          ? "border-[var(--ink)] text-[var(--ink)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
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
      <dt className="text-[var(--faint)]">{label}</dt>
      <dd className={`mt-1 whitespace-nowrap font-medium ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function heatmapColor(cell: PortfolioDashboardHeatmapCell) {
  if (cell.changePct === null) return "var(--wash)";
  const alpha = Math.min(0.82, 0.22 + (Math.abs(cell.changePct) / 4) * 0.6);
  if (cell.changePct > 0) return `color-mix(in srgb, var(--brand) ${(alpha * 100).toFixed(1)}%, transparent)`;
  if (cell.changePct < 0) return `color-mix(in srgb, var(--negative) ${(alpha * 100).toFixed(1)}%, transparent)`;
  return "var(--wash)";
}

const missingCellStyle: CSSProperties = {
  backgroundColor: "var(--wash)",
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, rgba(112, 121, 113, 0.12) 4px 5px)",
};

function heatmapStyle(cell: PortfolioDashboardHeatmapCell): CSSProperties {
  if (cell.changePct === null) return missingCellStyle;
  return { backgroundColor: heatmapColor(cell) };
}
