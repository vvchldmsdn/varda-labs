'use client';
import {SectionTitle as CairnSectionTitle} from '@/components/cairn-ui';
import {useI18n} from '@/components/i18n/locale-provider';
import {recordDisplayLabel} from '@/lib/record-display-labels';
import type {AccountSnapshotModel,PositionSnapshotModel} from '@/lib/cairn-v2/snapshot-contract';
import {snapshotDecimal as number} from '@/lib/cairn-v2/snapshot-contract';
import styles from './snapshots.module.css';

export function SnapshotSummary({model}:{model:AccountSnapshotModel}){
 const {t}=useI18n(),aggregate=model.aggregate;
 const metrics=[['저장 평가액','Stored valuation',aggregate?.totalMarketValue],['저장 투자금','Stored investment',aggregate?.investedAmount],['저장 손익','Stored profit / loss',aggregate?.totalPnl],['저장 수익률','Stored return',aggregate?.totalReturnPct]] as const;
 return <><p>{t('저장 기준일','Snapshot date')} <strong>{model.snapshotDate}</strong> · {t('확인 계좌','Accounts covered')} {model.coveredAccounts.length} / {model.expectedAccounts.length}</p>
 <dl className={styles.totals}>{metrics.map(([ko,en,value],i)=><div key={ko}><dt>{t(ko,en)} · {aggregate?.evidenceKind==='complete_total'?t('전체 합계','Complete total'):aggregate?t('확인 소계','Confirmed subtotal'):t('합계 확인 전','Total unconfirmed')}</dt><dd>{number(value)} <small>{i===3?'%':'KRW'}</small></dd></div>)}</dl></>;
}
export function SnapshotWarnings({model}:{model:AccountSnapshotModel|PositionSnapshotModel}){
 const {t}=useI18n();
 return <>{model.missingAccounts.length>0&&<p role="status">{t('누락 계좌','Missing accounts')}: {model.missingAccounts.join(', ')} · {t('다른 날짜의 값을 합치지 않습니다.','Values from other dates are not combined.')}</p>}
 {'snapshots' in model?<>
 {model.excludedSnapshotCount>0&&<p role="status">{t(`근거를 확인하지 못한 계좌 기록 ${model.excludedSnapshotCount}개 제외`,`Excluded ${model.excludedSnapshotCount} account records with unverified evidence`)}</p>}
 {model.incompleteCoreSnapshotCount>0&&<p role="status">{t(`불완전한 계좌 기록 ${model.incompleteCoreSnapshotCount}개 · —는 0이 아닙니다.`,`${model.incompleteCoreSnapshotCount} incomplete account records · — does not mean zero.`)}</p>}
 {model.hasMixedRuleVersions&&<p role="status">{t('계산 기준이 다른 기록이 포함돼 있습니다.','Records use different calculation rules.')}</p>}</>:<>
 {model.excludedPositionCount>0&&<p role="status">{t(`근거를 확인하지 못한 종목 기록 ${model.excludedPositionCount}개 제외`,`Excluded ${model.excludedPositionCount} holding records with unverified evidence`)}</p>}
 <p>{t(`연결 종목 ${model.linkedPositionCount}개 · 과거 연결만 남은 기록 ${model.historicalOnlyPositionCount}개 · 현재 보유 여부와는 다릅니다.`,`${model.linkedPositionCount} linked holdings · ${model.historicalOnlyPositionCount} historical-only records · These do not indicate current ownership.`)}</p></>}</>;
}
export function AccountSnapshotTable({model}:{model:AccountSnapshotModel}){
 const {t}=useI18n();
 const columns=[['계좌','Account'],['평가액','Valuation'],['투자금','Investment'],['원가','Cost'],['손익','Profit / loss'],['수익률 (%)','Return (%)'],['현금','Cash'],['종목 수','Holdings'],['최대 보유 종목','Largest holding'],['기록 시각 (UTC)','Recorded time (UTC)']] as const;
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t('계좌별 저장 평가 표 · 가로 스크롤','Account snapshots · scroll horizontally')}><table><caption>{model.snapshotDate} · {t('계좌별 저장 평가 · KRW','Stored account valuations · KRW')}</caption><thead><tr>{columns.map(([ko,en],i)=><th key={ko} scope="col" className={i>0&&i<8?styles.number:undefined}>{t(ko,en)}</th>)}</tr></thead><tbody>{model.snapshots.map(row=><tr key={row.accountCode}><th scope="row">{row.accountName}</th>{[row.totalMarketValue,row.investedAmount,row.totalCost,row.totalPnl,row.totalReturnPct,row.cashValue,row.numAssets].map((n,i)=><td key={i} className={styles.number}>{number(n)}</td>)}<td>{row.topHoldingName??'—'}<small>{number(row.topHoldingWeight)}%</small></td><td className={styles.timestamp}>{row.capturedAt??'—'}</td></tr>)}</tbody></table></div>;
}
export function PositionSnapshotTable({model}:{model:PositionSnapshotModel}){
 const {t,locale}=useI18n();
 const columns=[['계좌 / 종목','Account / holding'],['시장 / 저장 통화','Market / stored currency'],['저장 수량','Stored quantity'],['저장 가격','Stored price'],['저장 평가액 (KRW)','Stored valuation (KRW)'],['당시 비중 (%)','Weight then (%)'],['당시 목표 (%)','Target then (%)'],['연결 근거','Evidence']] as const;
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t('종목별 저장 평가 표 · 가로 스크롤','Holding snapshots · scroll horizontally')}><table><caption>{model.snapshotDate} · {t('당시 목표는 현재 승인 목표와 다릅니다.','Historical targets differ from current approved targets.')}</caption><thead><tr>{columns.map(([ko,en],i)=><th key={ko} scope="col" className={i>=2&&i<=6?styles.number:undefined}>{t(ko,en)}</th>)}</tr></thead><tbody>{model.positions.map((row,index)=><tr key={index}><th scope="row">{row.assetName}<small>{row.accountName} · {row.ticker??t('티커 미제공','Ticker unavailable')}</small></th><td>{row.market?recordDisplayLabel(row.market,locale):'—'} / {row.currency??'—'}</td><td className={styles.number}>{number(row.quantity)}</td><td className={styles.number}>{number(row.storedPrice)}<small>{row.storedPriceKind==='current_price'?t('당시 저장 현재가','Quote saved then'):row.storedPriceKind==='close_price'?t('저장 종가','Stored close'):t('가격 근거 없음','Price evidence unavailable')} · {row.currency??t('통화 미제공','Currency unavailable')}</small></td><td className={styles.number}>{number(row.marketValueKrw)}</td><td className={styles.number}>{number(row.currentWeight)}</td><td className={styles.number}>{number(row.targetWeight)}</td><td>{row.assetLinkStatus==='historical_only'?t('과거 연결만 남음','Historical link only'):t('자산 연결 있음','Holding linked')}<small>{row.priceBasis?recordDisplayLabel(row.priceBasis,locale):t('가격 기준 미제공','Price basis unavailable')}</small></td></tr>)}</tbody></table></div>;
}
export function SnapshotEvidence({model}:{model:AccountSnapshotModel|PositionSnapshotModel}){
 const {t}=useI18n();
 return <><p>{t('출처','Source')} {model.source} · {t('포함','Included')} {model.coveredAccounts.join(', ')||'—'} · {t('예상','Expected')} {model.expectedAccounts.join(', ')||'—'}</p>
 {'snapshots' in model?<><p>{t('계산 규칙','Calculation rule')} {model.ruleVersions.map(v=>v??'—').join(', ')} · {t('합계 구분','Total evidence')} {model.aggregate?.evidenceKind??'—'}</p>{model.aggregate&&<dl className={styles.facts}>{Object.entries(model.aggregate).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl>}{model.snapshots.map(row=><section key={row.accountCode}><CairnSectionTitle level="h3">{row.accountName} · {row.accountCode}</CairnSectionTitle><dl className={styles.facts}>{Object.entries(row).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl></section>)}</>:model.positions.map((row,i)=><section key={i}><CairnSectionTitle level="h3">{row.accountName} · {row.assetName} · {i+1}</CairnSectionTitle><dl className={styles.facts}>{Object.entries(row).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl></section>)}
 <p>{t('저장된 숫자와 시각 그대로입니다. 같은 티커의 행도 합치지 않습니다.','Numbers and timestamps are preserved as stored. Rows with matching tickers remain separate.')}</p></>;
}
