'use client';
import type {EventRow} from '@/lib/cairn-v2/event-contract';
import {eventNumber,eventRecordedTime} from '@/lib/cairn-v2/event-display';
import {recordDisplayLabel} from '@/lib/record-display-labels';
import {useI18n} from '@/components/i18n/locale-provider';
import styles from './events.module.css';

const kinds = {buy:['매수','Buy'],sell:['매도','Sell'],asset_added:['자산 추가','Holding added'],asset_removed:['자산 제외','Holding removed'],unsupported:['지원 외 유형','Unsupported type']} as const;
const columns = [['날짜 / 기록 시각','Date / recorded time'],['이벤트','Event'],['종목','Holding'],['계좌','Account'],['저장 금액 (KRW)','Stored amount (KRW)'],['수량 변화','Quantity change'],['근거 상태','Evidence']] as const;

export function EventTable({rows}:{rows:readonly EventRow[]}){
 const {t,locale}=useI18n();
 return <div className={styles.tableScroll} role="region" aria-label={t('날짜별 이벤트 기록 · 좌우 스크롤','Dated events · scroll horizontally')} tabIndex={0}><table>
  <caption>{t('소유 계좌의 기록 · 저장 금액 KRW','Your account records · stored amounts in KRW')}</caption>
  <thead><tr>{columns.map(([ko,en],i)=><th key={ko} scope="col" className={i===4||i===5?styles.number:undefined}>{t(ko,en)}</th>)}</tr></thead>
  <tbody>{rows.map((row,index)=><tr key={index}>
   <td>{row.eventDate}<small>{t('기록','Recorded')} {eventRecordedTime(row.recordedAt)}</small></td><td>{t(kinds[row.eventType][0],kinds[row.eventType][1])}</td>
   <th scope="row">{row.assetName}<small>{row.ticker??t('티커 미제공','Ticker unavailable')}</small></th><td>{row.accountName}</td>
   <td className={styles.number}>{eventNumber(row.amountKrw)}</td><td className={styles.number}>{eventNumber(row.quantityDelta)}</td>
   <td>{row.evidenceStatus==='complete'?t('저장 근거 확인','Stored evidence checked'):t('부분 근거','Partial evidence')}
    {row.correctionStatus!=='none'&&<small>{t('정정 대상 미검증 · 상계하지 않음','Correction target unverified · not offset')}</small>}
    {row.missingFields.length>0&&<small>{row.missingFields.map(field=>recordDisplayLabel(field,locale)).join(', ')}</small>}
   </td>
  </tr>)}</tbody></table></div>;
}

/** Technical evidence is available only inside the parent's collapsed disclosure. */
export function EventEvidence({rows}:{rows:readonly EventRow[]}){
 const {t}=useI18n();
 return <><p>{t('동일 티커도 별도 기록입니다. 순번은 이번 조회의 행 순서입니다.','Matching tickers remain separate records. Numbers identify rows in this query only.')}</p><ol className={styles.rowEvidence}>{rows.map((row,index)=><li key={index}><strong>{row.assetName} · {row.accountName}</strong><dl>
  <dt>{t('계좌 코드','Account code')}</dt><dd>{row.accountCode}</dd><dt>{t('기록 시각 ISO (UTC)','Recorded ISO time (UTC)')}</dt><dd>{row.recordedAt??'—'}</dd>
  <dt>{t('원본 금액 / 수량','Source amount / quantity')}</dt><dd>{row.amountKrw===null?'—':String(row.amountKrw)} KRW / {row.quantityDelta===null?'—':String(row.quantityDelta)}</dd>
  <dt>{t('자산 참조','Holding reference')}</dt><dd>{row.assetReferenceStatus}</dd><dt>{t('정정 / 누락 근거','Correction / missing evidence')}</dt><dd>{row.correctionStatus} / {row.missingFields.join(', ')||'—'}</dd>
 </dl></li>)}</ol></>;
}
