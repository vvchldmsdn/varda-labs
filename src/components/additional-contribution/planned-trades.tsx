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
  formatAmount: (value: number) => string;
  english?: boolean;
};

export function PlannedTrades({ rows, totalSell, totalBuy, formatAmount, english = false }: Props) {
  const groups = [
    { side: 'sell', title: english ? 'Planned sales' : '예상 매도', total: totalSell,
      empty: english ? 'No planned sales' : '매도할 종목이 없어요' },
    { side: 'buy', title: english ? 'Planned buys' : '예상 매수', total: totalBuy,
      empty: english ? 'No planned buys' : '매수할 종목이 없어요' },
  ] as const;

  return <div className={styles.root}>
    <div className={styles.groups}>
      {groups.map(({ side, title, total, empty }) => {
        const trades = rows.filter(row => row[side] > 0).sort((a, b) => b[side] - a[side]);
        const rowItem = (row: TradeRow) => <li key={row.key}>
          <span>{row.name}{row.account && <small>{row.account}</small>}</span>
          <strong>{formatAmount(row[side])}</strong>
        </li>;
        return <section className={styles.group} aria-label={title} data-side={side} key={side}>
          <header><h4>{title}</h4><span>{formatAmount(total)}</span></header>
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
