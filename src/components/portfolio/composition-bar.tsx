"use client";

import { useId } from "react";
import styles from "./composition-bar.module.css";

type Segment = { key: string; label: string; share: number; color: string; description?: string };

/** Shared geometry and interaction for holdings and proposed funding. Shares are supplied by the caller. */
export function CompositionBar({ entries, selectedKey, hoveredKey, onHover, onSelect, label, className = "" }: {
  entries: readonly Segment[]; selectedKey?: string | null; hoveredKey?: string | null;
  onHover: (key: string | null) => void; onSelect: (key: string) => void;
  label: string; className?: string;
}) {
  const id = useId();
  const activeKey = hoveredKey ?? selectedKey;
  const hovered = entries.find(row => row.key === hoveredKey);
  return <div className={`${styles.chart} ${className}`} data-composition-bar>
    <div className={styles.bar} role="group" aria-label={label} onPointerLeave={() => onHover(null)}>
      {entries.map(row => <button key={row.key} type="button" className={styles.segment}
        style={{ width: `${row.share}%`, background: row.color }}
        data-segment-key={row.key} data-active={row.key === activeKey}
        aria-label={row.description ?? `${row.label} ${row.share.toFixed(2)}%`}
        aria-pressed={row.key === selectedKey} aria-describedby={row.key === hoveredKey ? id : undefined}
        onPointerEnter={event => { if (event.pointerType !== "touch") onHover(row.key); }}
        onFocus={() => onHover(row.key)} onBlur={() => onHover(null)} onClick={() => onSelect(row.key)} />)}
    </div>
    {hovered && <span id={id} role="tooltip" className={styles.tooltip}>{hovered.label}<small>{hovered.share.toFixed(2)}%</small></span>}
  </div>;
}
