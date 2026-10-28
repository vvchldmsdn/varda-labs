import type {HoldingsRead} from '@/lib/cairn-v2/holding-contract';
import {snapshotDecimal} from '@/lib/cairn-v2/snapshot-contract';
import styles from './holdings.module.css';

// Limited display port of the inline /portfolio/holdings table. The original
// query/projector supplies all facts; correction/archive/price actions are absent.
export function HoldingsTable({rows}:{rows:HoldingsRead['rows']}) {
  return <div className={styles.tableScroll} role="region" aria-label="보유 근거 표 가로 탐색" tabIndex={0}>
    <table aria-label="저장 보유 근거 표"><caption>원본 통화·저장 수량/가격 · 같은 티커도 개별 보유 기록으로 표시</caption>
      <thead><tr><th scope="col">종목</th><th scope="col">계좌</th><th scope="col" className={styles.number}>수량</th><th scope="col" className={styles.number}>평균원가</th><th scope="col" className={styles.number}>저장 가격</th><th scope="col">가격·기록 근거</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.key}>
        <td><span className={styles.name} title={row.name} tabIndex={0}>{row.name}</span><small>{row.ticker??'티커 미제공'}{row.assetType?' · '+row.assetType:''}</small><small>{row.archivedAt?'보관 기록':'보유 중'}</small></td>
        <td>{row.accountName}</td>
        <td className={styles.number}>{snapshotDecimal(row.quantity)}</td>
        <td className={styles.number}>{row.averageCost===null?'미기록':snapshotDecimal(row.averageCost)+' '+row.currency}</td>
        <td className={styles.number}>{snapshotDecimal(row.currentPrice)} {row.currency}</td>
        <td>{row.priceAsOf?<time dateTime={row.priceAsOf}>{row.priceAsOf.slice(0,10)} UTC</time>:'가격 관측일 미제공'}
          {(!row.priceSource||!row.priceStatus)&&<small>가격 출처/상태 일부 미제공</small>}
          <details className={styles.rowEvidence}><summary>기록 근거</summary><dl>
            <dt>시장·원통화</dt><dd>{row.market} · {row.currency}</dd><dt>계좌 코드</dt><dd>{row.accountCode}</dd><dt>가격 출처</dt><dd>{row.priceSource??'미제공'}</dd><dt>가격 상태</dt><dd>{row.priceStatus??'미제공'}</dd>
            <dt>가격 관측 시각</dt><dd>{row.priceAsOf??'미제공'}</dd><dt>기록 갱신 시각</dt><dd>{row.updatedAt}</dd><dt>보관 시각</dt><dd>{row.archivedAt??'보관되지 않음'}</dd>
            <dt>원본 수량</dt><dd>{row.quantity}</dd><dt>원본 평균원가</dt><dd>{row.averageCost??'미기록'}</dd><dt>원본 저장 가격</dt><dd>{row.currentPrice}</dd>
          </dl></details>
        </td>
      </tr>)}</tbody>
    </table>
  </div>;
}
