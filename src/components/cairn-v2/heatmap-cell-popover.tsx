"use client";

import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/cairn-ui";
import type { PortfolioDashboardHeatmapCell } from "@/lib/cairn-v2/heatmap-model";
import { eventNumber } from "@/lib/cairn-v2/event-display";
import styles from "./holding-heatmap.module.css";

export function HeatmapCellPopover({ anchor, name, account, cell, basis }: {
  anchor: HTMLButtonElement; name: string; account: string; cell: PortfolioDashboardHeatmapCell; basis: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const popover = ref.current!;
    if (!anchor.isConnected || typeof popover.showPopover !== "function") return;
    popover.showPopover();
    const target = anchor.getBoundingClientRect();
    const box = { width: popover.offsetWidth, height: popover.offsetHeight };
    const right = target.right + box.width + 10 <= window.innerWidth - 12;
    const left = right ? target.right + 10 : Math.max(12, target.left - box.width - 10);
    popover.dataset.side = right ? "right" : "left";
    popover.style.left = Math.min(left, window.innerWidth - box.width - 12) + "px";
    popover.style.top = Math.max(12, Math.min(target.top + (target.height - box.height) / 2, window.innerHeight - box.height - 12)) + "px";
    const close = () => popover.hidePopover();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popover.contains(event.target)) return;
      const current = anchor.getBoundingClientRect();
      if (Math.abs(current.top - target.top) > 1 || Math.abs(current.left - target.left) > 1) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
      if (popover.matches(":popover-open")) close();
    };
  }, [anchor]);
  return <div ref={ref} popover="auto" role="region" aria-label="선택한 종목의 날짜별 변동" className={styles.popover}>
    <header><div><small>{account} · {cell.date}</small><h3>{name}</h3></div>
      <Button variant="bare" type="button" aria-label="날짜별 변동 닫기" onClick={event => {
        event.stopPropagation(); ref.current?.hidePopover(); anchor.focus({ preventScroll: true });
      }}>×</Button></header>
    <dl>{[["평가액 변화",cell.changeKrw],["가격 영향",cell.priceChangeKrw],["환율 영향",cell.fxChangeKrw]].map(([label,value]) => <div key={label}>
      <dt>{label}</dt><dd>{typeof value === "number" ? eventNumber(value) + "원" : "—"}</dd>
    </div>)}<div><dt>{basis}</dt><dd>{cell.changePct === null ? "비교 자료 없음" : eventNumber(cell.changePct) + "%"}</dd></div></dl>
  </div>;
}
