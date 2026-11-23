"use client";

import { useState } from "react";
import { Button } from "@/components/cairn-ui";
import { HOME_ALLOCATION_COLORS } from "@/components/portfolio/allocation-colors";
import { CompositionBar } from "@/components/portfolio/composition-bar";
import styles from './planned-trades.module.css';

type TradeRow = {
  key: string;
  name: string;
  account?: string;
  buy: number;
  sell: number;
};

type Props = {
  rows: readonly TradeRow[];
  totalSell: number;
  totalBuy: number;
  available: number;
  remainingCash: number;
  formatAmount: (value: number) => string;
  english?: boolean;
};

export function PlannedTrades({ rows, totalSell, totalBuy, available, remainingCash, formatAmount, english = false }: Props) {
  const buys = rows.filter(row => row.buy > 0).sort((a, b) => b.buy - a.buy);
  const sales = rows.filter(row => row.sell > 0).sort((a, b) => b.sell - a.sell);
  const cashLabel = english ? "Remaining cash" : "남는 현금";
  const [pinned, setPinned] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const slices = buys.map((row, index) => ({
    key: "buy:" + row.key, name: row.name, label: [row.name, row.account].filter(Boolean).join(" · "),
    amount: row.buy, color: HOME_ALLOCATION_COLORS[index % HOME_ALLOCATION_COLORS.length],
  }));
  if (remainingCash > 0) slices.push({
    key: "cash", name: cashLabel, label: cashLabel, amount: remainingCash,
    color: "repeating-linear-gradient(130deg, #dedcd4 0 4px, #c8c7bf 4px 5px)",
  });
  const segments = available > 0 ? slices.map(slice => {
    const share = 100 * slice.amount / available;
    return { ...slice, share, description: `${slice.label}, ${formatAmount(slice.amount)}, ${share.toFixed(1)}%` };
  }) : [];
  const active = segments.find(segment => segment.key === (hovered ?? pinned));
  const byKey = new Map(segments.map(segment => [segment.key, segment]));
  function select(key: string) {
    setPinned(pinned === key ? null : key);
    setHovered(null);
  }
  const groups = [
    { side: 'sell', trades: sales, title: english ? 'Planned sales' : '예상 매도', total: totalSell,
      empty: english ? 'No planned sales' : '매도할 종목이 없어요' },
    { side: 'buy', trades: buys, title: english ? 'Planned buys' : '예상 매수', total: totalBuy,
      empty: english ? 'No planned buys' : '매수할 종목이 없어요' },
  ] as const;

  return <div className={styles.root} onKeyDown={event => {
    if (event.key === "Escape" && (pinned || hovered)) {
      event.stopPropagation();
      event.preventDefault();
      setPinned(null);
      setHovered(null);
    }
  }}>
    <figure className={styles.figure} data-planned-allocation aria-label={english ? "Projected allocation breakdown" : "예상 자금 배분"}>
      <figcaption className={styles.figureTotal}>
        <span>{english ? "Available to allocate" : "배분할 금액"}</span>
        <strong>{formatAmount(available)}</strong>
      </figcaption>
      <div className={styles.visual}>
        {segments.length > 0 && <div className={styles.ribbon}>
          <CompositionBar className={styles.composition} entries={segments} label={english ? "Planned buys and remaining cash" : "매수 종목과 남는 현금"}
            selectedKey={pinned} hoveredKey={hovered} onHover={setHovered} onSelect={select} />
          <div aria-hidden="true" className={styles.barLabels}>
            {segments.map(segment => <div className={styles.labelCell} key={segment.key} data-active={segment.key === active?.key} style={{ width: `${segment.share}%` }}>
              <span>{segment.name}</span><small>{segment.share.toFixed(1)}%</small>
            </div>)}
          </div>
        </div>}
        <div className={styles.figureFoot}>
          <span className={styles.readout} data-allocation-readout title={active?.description}>
            {active ? <><i style={{ background: active.color }} />{active.label} · {formatAmount(active.amount)}</>
              : english ? `${buys.length} planned buys` : `예상 매수 ${buys.length}건`}
          </span>
          <span className={styles.cash}>{cashLabel} <b>{formatAmount(remainingCash)}</b></span>
        </div>
      </div>
    </figure>
    <div className={styles.groups}>
      {groups.map(({ side, title, total, empty, trades }) => {
        function rowItem(row: TradeRow) {
          const segment = side === "buy" ? byKey.get("buy:" + row.key) : undefined;
          const content = <><span>{row.name}{row.account && <small>{row.account}</small>}</span>
            <strong>{formatAmount(row[side])}</strong></>;
          return <li key={row.key}>{segment ? <Button variant="bare" type="button" className={styles.legendRow}
            aria-label={segment.description} aria-pressed={pinned === segment.key} data-active={active?.key === segment.key}
            onPointerEnter={event => { if (event.pointerType !== "touch") setHovered(segment.key); }}
            onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(segment.key)} onBlur={() => setHovered(null)}
            onClick={() => select(segment.key)}>
            <i aria-hidden="true" style={{ background: segment.color }} />{content}
          </Button> : content}</li>;
        }
        return <section className={styles.group} aria-label={title} data-side={side} key={side}>
          <header><h4>{title}</h4>{trades.length > 1 && <span>{formatAmount(total)}</span>}</header>
          {trades.length ? <ul>{trades.slice(0, 2).map(rowItem)}</ul> : <p>{empty}</p>}
          {trades.length > 2 && <details>
            <summary>{english ? `${trades.length - 2} more` : `${trades.length - 2}건 더 보기`}</summary>
            <ul>{trades.slice(2).map(rowItem)}</ul>
          </details>}
        </section>;
      })}
    </div>
  </div>;
}
