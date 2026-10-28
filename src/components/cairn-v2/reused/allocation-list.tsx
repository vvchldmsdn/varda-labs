import type { ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import styles from "./allocation-list.module.css";
export function AdditionalContributionAllocationTable({ preview }: {
    preview: ReadyContribution;
}) {
    const orderedRows = preview.rows.toSorted((left, right) => {
        const rank = { buy: 0, trim: 1, hold: 2 };
        return rank[left.action] - rank[right.action] ||
            Math.max(right.allocationKrw, right.trimAmountKrw) - Math.max(left.allocationKrw, left.trimAmountKrw);
    });
    const maxAmount = Math.max(1, ...orderedRows.map((row) => Math.max(row.allocationKrw, row.trimAmountKrw)));
    return (<div className={`${styles.surface} ${styles.allocationList}`}>
      <div className={styles.listHeading} aria-hidden="true"><span><>{"종목 / 계좌"}</></span><span><>{"현재 → 투입 후"}</></span><span><>{"계산 금액"}</></span></div>
      <ul aria-label="종목별 배분 결과">
        {orderedRows.map((row) => <li key={rowKey(row)} className={styles.allocationRow}>
          <div className={styles.holdingName}><strong>{row.name}</strong><span>{row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}</span></div>
          <div className={styles.weightChange}><span>{formatPercent(row.currentWeightPct)} <span aria-hidden="true">→</span> <strong>{formatPercent(row.postTopupWeightPct)}</strong></span><span><>{"목표"}</>{" "}{formatPercent(row.targetWeightPct)}</span></div>
          <div className={styles.tradeAmount} data-action={row.action}>
            <span><small><>{row.action === "buy" ? "매수 계산" : row.action === "trim" ? "축소 계산" : "유지"}</></small><strong>{row.action === "hold" ? formatKrw(row.allocationKrw) : formatKrw(row.action === "buy" ? row.allocationKrw : row.trimAmountKrw)}</strong></span>
            <div className={styles.amountTrack} aria-hidden="true"><span style={{ width: `${Math.max(row.allocationKrw, row.trimAmountKrw) / maxAmount * 100}%` }}/></div>
          </div>
        </li>)}
      </ul>
    </div>);
}
function rowKey(row: ReadyContribution["rows"][number]) {
    return `${row.accountCode}:${row.market ?? "unknown"}:${row.currency ?? "unknown"}:${row.ticker ?? row.name}`;
}
function formatKrw(value: number) {
    return new Intl.NumberFormat("ko-KR", {
        style: "currency",
        currency: "KRW",
        maximumFractionDigits: 0,
    }).format(value);
}
function formatPercent(value: number) {
    return `${value.toFixed(2)}%`;
}
