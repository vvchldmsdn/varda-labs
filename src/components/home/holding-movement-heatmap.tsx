"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import Link from "next/link";
import { X } from "lucide-react";
import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

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
import { HoldingDatePicker } from "./holding-date-picker";
import { MobileHoldingConnections } from "./mobile-holding-connections";
import styles from "@/components/home/portfolio-overview.module.css";

type HeatmapMode = "movement" | "allocation" | "connections";

export function HoldingMovementHeatmap({
  history,
  structureHref,
  stage = false,
}: {
  history: PortfolioDashboardHoldingHistory;
  riskHref: string;
  structureHref: string;
  etfHref?: string | null;
  stage?: boolean;
}) {
  const { t } = useI18n();
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
    <section aria-labelledby="holding-heatmap-title" className={stage ? styles.stageHeatmap : "relative min-w-0"}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="holding-heatmap-title" className={styles.panelTitle}><T ko="종목 흐름" en="Holding history"/></h2>
          <p className="mt-1.5 text-[11px] text-[var(--muted)]"><T ko="오늘은 종목 가격 등락, 과거는 저장된 일별 변동입니다." en="Today shows holding price changes; past dates show recorded daily changes."/></p>
        </div>
        <div className={styles.chartRanges} aria-label={t("종목 흐름 보기 방식", "Holding history view")}>
          <ModeButton active={mode === "movement"} onClick={() => setMode("movement")}><T ko="일별 변동" en="Daily changes"/></ModeButton>
          <ModeButton active={mode === "allocation"} onClick={() => setMode("allocation")}><T ko="구성" en="Allocation"/></ModeButton>
          <ModeButton active={mode === "connections"} onClick={() => setMode("connections")}><T ko="동반 움직임" en="Co-movement"/></ModeButton>
        </div>
      </div>

      <div className={stage ? styles.stageHeatmapViewport : undefined}>
      {mode === "movement" ? (
        <MovementMatrix
          history={history}
          stage={stage}
          onSelect={(rowIndex, cellIndex) =>
            setSelection((current) =>
              current?.rowIndex === rowIndex && current.cellIndex === cellIndex
                ? null
                : { rowIndex, cellIndex },
            )
          }
          selection={selection}
        />
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
          <Link className="inline-flex border-b border-[var(--faint)] pb-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]" href={structureHref}><T ko="전체 자산 구성 보기 →" en="View full allocation →"/></Link>
        </div>
      ) : null}

      {mode === "connections" ? (
        <ConnectionMap history={history} structureHref={structureHref} />
      ) : null}
      </div>

      {mode === "movement" && selectedRow && selectedCell ? (
        <div className="varda-heatmap-popover" id="holding-heatmap-selection" aria-live="polite">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--ink)]">{selectedRow.name}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {<T ko={formatDate(selectedCell.date)} en={translateHomeHistory(formatDate(selectedCell.date))}/>}
              {selectedRow.ticker ? ` · ${selectedRow.ticker}` : ""}
              {<T ko={selectedCell.basis === "market_value" ? " · 평가액 변동 근거" : ""} en={translateHomeHistory(selectedCell.basis === "market_value" ? " · 평가액 변동 근거" : "")}/>}
              {<T ko={selectedCell.basis === "live_movement" ? " · 실시간 변동 근거" : ""} en={translateHomeHistory(selectedCell.basis === "live_movement" ? " · 실시간 변동 근거" : "")}/>}
              {selectedCell.basis === "live_price" ? <T ko=" · 거래통화 기준 가격 등락" en=" · Price change in the trading currency"/> : null}
            </p>
            </div>
            <button
              aria-label={t("선택한 종목 정보 닫기", "Close selected holding details")}
              className="varda-icon-button -mr-2 -mt-2"
              onClick={() => setSelection(null)}
              title={t("닫기", "Close")}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-[var(--wash)] pt-4 text-xs sm:grid-cols-5">
            <HeatmapDetail
              label={selectedCell.priceReturnEvidence ? t("가격 등락", "Price change") : t("등락", "Change")}
              value={t(selectedCell.changePct === null ? "미수집" : formatPercent(selectedCell.changePct, true), translateHomeHistory(selectedCell.changePct === null ? "미수집" : formatPercent(selectedCell.changePct, true)))}
              tone={selectedCell.changePct}
            />
            <HeatmapDetail label={t("평가액", "Value")} value={t(formatKrw(selectedCell.marketValueKrw), translateHomeHistory(formatKrw(selectedCell.marketValueKrw)))} tone={null} />
            <HeatmapDetail label={t("평가액 변동", "Value change")} value={t(formatKrw(selectedCell.changeKrw), translateHomeHistory(formatKrw(selectedCell.changeKrw)))} tone={selectedCell.changeKrw} />
            <HeatmapDetail label={t("가격 영향", "Price impact")} value={t(formatKrw(selectedCell.priceChangeKrw), translateHomeHistory(formatKrw(selectedCell.priceChangeKrw)))} tone={selectedCell.priceChangeKrw} />
            <HeatmapDetail label={t("환율 영향", "FX impact")} value={t(formatKrw(selectedCell.fxChangeKrw), translateHomeHistory(formatKrw(selectedCell.fxChangeKrw)))} tone={selectedCell.fxChangeKrw} />
          </dl>
          {selectedCell.priceReturnEvidence ? <div className="mt-3 border-t border-[var(--wash)] pt-3 text-[11px] leading-5 text-[var(--muted)]" data-heatmap-price-evidence>
            {selectedCell.priceReturnEvidence.reason === null ? <>
              <p>{selectedCell.priceReturnEvidence.previousCloseDate} <T ko="종가" en="close"/> {selectedCell.priceReturnEvidence.previousClose?.toLocaleString()} → {selectedCell.priceReturnEvidence.currentPrice?.toLocaleString()} {selectedCell.priceReturnEvidence.currency}</p>
              <p><T ko="가격 등락률은 (현재 단위 가격 ÷ 기준 종가 − 1) × 100%입니다. 보유 수량·매매·환율은 반영하지 않습니다. 원화 평가액 변동은 위 항목에서 별도로 확인하세요." en="Price change is (current unit price ÷ reference close − 1) × 100%. It excludes quantity, trades and FX. KRW valuation changes are shown separately above."/></p>
            </> : <p><T ko={priceReturnReason(selectedCell.priceReturnEvidence.reason, "ko")} en={priceReturnReason(selectedCell.priceReturnEvidence.reason, "en")}/></p>}
          </div> : null}
        </div>
      ) : null}
    </section>
  );
}

function ConnectionMap({ history, structureHref }: { history: PortfolioDashboardHoldingHistory; structureHref: string }) {
  const graph = useMemo(() => buildHoldingConnectionGraph(history), [history]);
  const reason = graph.emptyReason ?? "insufficient_personal_history";
  return <div className="border-y border-[var(--wash)] py-4">
    {graph.edges.length ? <MobileHoldingConnections graph={graph} /> : <div className="py-12 text-sm text-[var(--muted)]" data-connection-empty={reason}>
      {reason === "insufficient_personal_history" ? <T ko="같은 날짜의 종목별 등락 기록이 6개 이상 필요해요." en="At least 6 matching daily records are needed." /> : reason === "insufficient_variation" ? <T ko="등락의 변화가 없어 상관관계를 계산할 수 없어요." en="Correlation is unavailable when daily changes do not vary." /> : <T ko="이 기간에는 표시 기준에 맞는 관계가 없어요." en="No relationships meet the display threshold in this period." />}
    </div>}
    <Link href={structureHref} className="mt-4 inline-block text-xs underline underline-offset-4"><T ko="포트 구조 살펴보기" en="Explore portfolio structure"/></Link>
  </div>;
}

function MovementMatrix({
  history,
  onSelect,
  selection,
  stage = false,
}: {
  history: PortfolioDashboardHoldingHistory;
  onSelect: (rowIndex: number, cellIndex: number) => void;
  selection: { rowIndex: number; cellIndex: number } | null;
  stage?: boolean;
}) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mobileDate, setMobileDate] = useState<string | null>(null);
  const selectedMobileDate = mobileDate && history.dates.includes(mobileDate)
    ? mobileDate
    : history.dates.at(-1);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (stage && viewport) viewport.scrollLeft = viewport.scrollWidth;
  }, [stage, history.dates]);

  if (history.rows.length === 0 || history.dates.length === 0) {
    return (
      <div className="grid min-h-[310px] place-items-center border-y border-[var(--wash)] px-6 text-center">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]"><T ko="종목별 일별 변화가 아직 없습니다." en="No daily holding changes are available yet."/></p>
          <p className="mt-2 text-xs text-[var(--muted)]"><T ko="현재 평가액과 다른 분석은 그대로 이용할 수 있습니다." en="Current values and other analyses remain available."/></p>
        </div>
      </div>
    );
  }

  const cellWidth = history.dates.length <= 20 ? 34 : 27;
  const gridTemplateColumns = stage
    ? `minmax(118px, .26fr) repeat(${history.dates.length}, minmax(16px, 1fr))`
    : `minmax(174px, 214px) repeat(${history.dates.length}, ${cellWidth}px)`;

  return (
    <div className={stage ? styles.stageMatrix : "overflow-x-auto pb-1"} data-heatmap-grid data-single-date={stage && history.dates.length === 1 ? true : undefined}>
      {stage ? (
        <div className={styles.mobileMovements}>
          <div className={styles.mobileMovementDate}>
            <span><T ko="일별 변동" en="Daily changes"/></span>
            <HoldingDatePicker dates={history.dates} value={selectedMobileDate} onChange={setMobileDate} />
          </div>
          <div className={styles.mobileMovementRows}>
            {history.rows.map((row, rowIndex) => {
              const cellIndex = row.cells.findIndex((cell) => cell.date === selectedMobileDate);
              const cell = row.cells[cellIndex];
              const selected = selection?.rowIndex === rowIndex && selection.cellIndex === cellIndex;
              return (
                <button key={row.holdingId} type="button" className={styles.mobileMovementRow}
                  aria-pressed={selected} aria-controls={selected ? "holding-heatmap-selection" : undefined}
                  disabled={!cell} onClick={() => onSelect(rowIndex, cellIndex)}>
                  <i aria-hidden="true" style={cell ? heatmapStyle(cell) : missingCellStyle} />
                  <span><strong>{row.name}</strong><small>{row.ticker || formatPercent(row.currentWeight)}</small></span>
                  <span><strong className={toneClass(cell?.changePct ?? null)}>{<T ko={cell?.changePct == null ? "미수집" : formatPercent(cell.changePct, true)} en={translateHomeHistory(cell?.changePct == null ? "미수집" : formatPercent(cell.changePct, true))}/>}</strong>
                    <small>{<T ko={formatKrw(cell?.changeKrw ?? null)} en={translateHomeHistory(formatKrw(cell?.changeKrw ?? null))}/>}</small></span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={stage ? styles.stageGridViewport : undefined} ref={viewportRef}>
      <div
        className={stage ? styles.stageMatrixGrid : "min-w-max"}
        style={{
          columnGap: "1px",
          display: "grid",
          gridTemplateColumns,
          gridTemplateRows: stage ? `20px repeat(${history.rows.length}, minmax(32px, 1fr))` : undefined,
          rowGap: "2px",
        }}
      >
        <div />
        {history.dates.map((date, index) => (
          <div
            key={date}
            className="h-4 text-center text-[10px] tabular-nums text-[var(--faint)]"
            title={t(formatDate(date), translateHomeHistory(formatDate(date)))}
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
            rowCount={history.rows.length}
            cellCount={history.dates.length}
            onSelect={onSelect}
            selection={selection}
          />
        ))}
      </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-[var(--faint)]">
        <span><T ko="하락" en="Down"/></span>
        <div className="flex flex-1 items-center gap-px" aria-hidden="true">
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--negative) 78%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--negative) 30%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px] bg-[var(--wash)]" />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 30%, transparent)" }} />
          <span className="h-1.5 flex-1 rounded-[3px]" style={{ backgroundColor: "color-mix(in srgb, var(--brand) 78%, transparent)" }} />
        </div>
        <span><T ko="상승" en="Up"/></span>
        <span className="ml-2 inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-[4px]" style={missingCellStyle} /><T ko="미수집" en="Unavailable"/></span>
      </div>
    </div>
  );
}

function HeatmapRow({
  onSelect,
  row,
  rowIndex,
  rowCount,
  cellCount,
  selection,
}: {
  onSelect: (rowIndex: number, cellIndex: number) => void;
  row: PortfolioDashboardHoldingHistory["rows"][number];
  rowIndex: number;
  rowCount: number;
  cellCount: number;
  selection: { rowIndex: number; cellIndex: number } | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className={styles.heatmapRowLabel} data-selected={selection?.rowIndex === rowIndex} title={row.name}>
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
            aria-label={`${row.name} ${formatDate(cell.date)} ${cell.priceReturnEvidence ? t("가격 등락", "Price change") : ""} ${t(evidenceLabel, translateHomeHistory(evidenceLabel))}`}
            aria-pressed={selected}
            className={styles.heatmapCell}
            data-cell-index={cellIndex}
            data-heatmap-cell
            data-change-basis={cell.basis}
            data-row-index={rowIndex}
            onKeyDown={(event) =>
              moveHeatmapFocus({
                cellCount,
                cellIndex,
                event,
                onSelect,
                rowCount,
                rowIndex,
              })
            }
            onClick={() => onSelect(rowIndex, cellIndex)}
            style={{ ...heatmapStyle(cell), "--cell-delay": `${Math.min((rowIndex + cellIndex) * 10, 320)}ms` } as CSSProperties}
            tabIndex={selected || (!selection && rowIndex === 0 && cellIndex === 0) ? 0 : -1}
            title={`${row.name}\n${formatDate(cell.date)}\n${t(evidenceLabel, translateHomeHistory(evidenceLabel))}`}
          >
            {cell.changePct === null ? "·" : null}
          </button>
        );
      })}
    </>
  );
}

function priceReturnReason(reason: "missing_current_quote" | "missing_previous_close" | "conflicting_previous_close", locale: "ko" | "en") {
  if (reason === "missing_current_quote") return locale === "ko" ? "현재 시세 근거가 없어 가격 등락률을 표시하지 않습니다." : "Price change is unavailable because current quote evidence is missing.";
  if (reason === "conflicting_previous_close") return locale === "ko" ? "같은 기준일의 종가가 서로 달라 가격 등락률을 표시하지 않습니다." : "Price change is unavailable because reference closes conflict on the same date.";
  return locale === "ko" ? "비교할 이전 종가가 없어 가격 등락률을 표시하지 않습니다." : "Price change is unavailable because the previous close is missing.";
}

function moveHeatmapFocus({
  cellCount,
  cellIndex,
  event,
  onSelect,
  rowCount,
  rowIndex,
}: {
  cellCount: number;
  cellIndex: number;
  event: KeyboardEvent<HTMLButtonElement>;
  onSelect: (rowIndex: number, cellIndex: number) => void;
  rowCount: number;
  rowIndex: number;
}) {
  const movement = {
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
  }[event.key];
  if (!movement) return;
  event.preventDefault();
  const nextRow = Math.min(Math.max(rowIndex + movement[0], 0), rowCount - 1);
  const nextCell = Math.min(
    Math.max(cellIndex + movement[1], 0),
    cellCount - 1,
  );
  onSelect(nextRow, nextCell);
  event.currentTarget
    .closest<HTMLElement>("[data-heatmap-grid]")
    ?.querySelector<HTMLElement>(
      `[data-heatmap-cell][data-row-index="${nextRow}"][data-cell-index="${nextCell}"]`,
    )
    ?.focus();
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
      className={styles.rangeButton}
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
      <dt className="text-[var(--faint)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className={`mt-1 whitespace-nowrap font-medium ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function heatmapColor(cell: PortfolioDashboardHeatmapCell) {
  if (cell.changePct === null) return "var(--wash)";
  const alpha = Math.min(0.82, 0.22 + (Math.abs(cell.changePct) / 4) * 0.6);
  if (cell.changePct > 0) return `color-mix(in srgb, var(--accent) ${(alpha * 100).toFixed(1)}%, transparent)`;
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
