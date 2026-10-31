"use client";

import { Button as CairnButton } from "@/components/cairn-ui";

import { useState, type CSSProperties } from "react";
import styles from "./risk-matrix.module.css";
import { preciseNumber } from "./display-format";
type Instrument = Readonly<{
    instrumentKey: string;
    ticker: string;
    names: readonly string[];
}>;
export function RiskCorrelationMatrix({ instruments, matrix, compact = false }: {
    instruments: readonly Instrument[];
    matrix: readonly (readonly (number | null)[])[];
    compact?: boolean;
}) {
    const [selected, setSelected] = useState<[
        number,
        number
    ]>([0, instruments.length > 1 ? 1 : 0]);
    const [rowIndex, columnIndex] = selected;
    const selectedValue = matrix[rowIndex]?.[columnIndex] ?? null;
    const finiteSelected = selectedValue !== null && Number.isFinite(selectedValue);
    const minWidth = compact ? Math.max(480, 112 + instruments.length * 66) : Math.max(540, 132 + instruments.length * 74);
    return (<div className={`${styles.surface} ${styles.interactiveMatrix}`}>
      <div className={styles.matrixReadout} data-matrix-readout aria-live="polite">
        <div><span><>{"선택한 종목 쌍"}</></span><p>{instruments[rowIndex]?.ticker ?? "—"}<i>×</i>{instruments[columnIndex]?.ticker ?? "—"}</p></div>
        <strong title={finiteSelected ? `원본 정밀도 ${selectedValue}` : "계산 근거 없음"} data-negative={finiteSelected && selectedValue < 0}>{finiteSelected ? preciseNumber(selectedValue) : "—"}</strong>
        <span className={styles.readoutHint}><>{finiteSelected ? rowIndex === columnIndex ? "같은 종목" : selectedValue > 0 ? "같은 방향의 움직임" : selectedValue < 0 ? "반대 방향의 움직임" : "선형 상관 없음" : "계산 근거 없음"}</></span>
      </div>
      <p className={styles.matrixPairNames} data-matrix-pair>{instruments[rowIndex]?.names.join(", ") ?? <>{"종목 근거 없음"}</>}<span>×</span>{instruments[columnIndex]?.names.join(", ") ?? <>{"종목 근거 없음"}</>}</p>
      <div className={styles.matrixScroll} data-matrix-scroll tabIndex={0} role="region" aria-label={"좌우로 스크롤할 수 있는 상관관계 행렬"}>
        <table className={styles.heatmapTable} style={{ minWidth }}>
          <thead><tr><th scope="col"><span className="sr-only"><>{"종목"}</></span></th>{instruments.map((instrument, index) => <th key={instrument.instrumentKey} scope="col" data-highlight={columnIndex === index} title={instrumentName(instrument)}><span className={styles.instrumentName}>{instrumentName(instrument)}</span></th>)}</tr></thead>
          <tbody>{instruments.map((instrument, row) => <tr key={instrument.instrumentKey}>
            <th scope="row" data-highlight={rowIndex === row} title={instrumentName(instrument)}><span className={styles.instrumentName}>{instrumentName(instrument)}</span></th>
            {instruments.map((column, col) => {
                const raw = matrix[row]?.[col] ?? null;
                const value = raw !== null && Number.isFinite(raw) ? raw : null;
                const isSelected = row === rowIndex && col === columnIndex;
                return <td key={column.instrumentKey} className={styles.correlationCell}>
                <CairnButton variant="bare" type="button" title={value === null ? "계산 근거 없음" : `원본 정밀도 ${value}`} tabIndex={isSelected ? 0 : -1} data-matrix-cell aria-label={`${instrumentName(instrument)} / ${instrumentName(column)}: ${preciseNumber(value)} · ${value === null ? "계산 근거 없음" : `원본 정밀도 ${value}`}`} aria-pressed={isSelected} data-crosshair={row === rowIndex || col === columnIndex} data-diagonal={row === col} onPointerEnter={(event) => { if (event.pointerType !== "touch")
                    setSelected([row, col]); }} onFocus={() => setSelected([row, col])} onClick={() => setSelected([row, col])} onKeyDown={(event) => {
                        const steps: Record<string, [
                            number,
                            number
                        ]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
                        const step = steps[event.key];
                        if (!step)
                            return;
                        event.preventDefault();
                        const nextRow = Math.max(0, Math.min(instruments.length - 1, row + step[0]));
                        const nextCol = Math.max(0, Math.min(instruments.length - 1, col + step[1]));
                        event.currentTarget.closest("table")?.querySelectorAll<HTMLButtonElement>("[data-matrix-cell]")[nextRow * instruments.length + nextCol]?.focus();
                    }} style={{ background: correlationFill(value, row === col), "--cell-delay": `${Math.min(row + col, 12) * 18}ms` } as CSSProperties}>
                  {value === null ? "—" : preciseNumber(value)}
                </CairnButton>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className={styles.matrixLegend} data-matrix-legend><span><>{"반대 방향"}</>{" "}<b>−1</b></span><i /><span><b>+1</b> {" "}<>{"같은 방향"}</></span><small><>{"셀을 선택해 종목 쌍을 확인하세요"}</></small></div>
    </div>);
}
function instrumentName(instrument: Instrument) {
    return instrument.names.filter(name => name.trim()).join(", ") || instrument.ticker;
}
function correlationFill(value: number | null, diagonal: boolean) {
    if (value === null)
        return "var(--paper)";
    if (diagonal)
        return "var(--wash)";
    return `color-mix(in srgb, ${value >= 0 ? "var(--accent)" : "var(--negative)"} ${Math.min(Math.abs(value), 1) * 76 + 3}%, var(--surface))`;
}
