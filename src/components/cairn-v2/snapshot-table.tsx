
import { SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";
// Limited presentation port: portfolio-snapshot-summary/table and the inline
// position-snapshots page at the preserved baseline. Exact decimal strings replace
// the original rounded formatters; server pages/actions/styles are not imported.
import type {AccountSnapshotModel,PositionSnapshotModel} from '@/lib/cairn-v2/snapshot-contract';
import {snapshotDecimal as number} from '@/lib/cairn-v2/snapshot-contract';
import styles from './snapshots.module.css';
export function SnapshotSummary({model}:{model:AccountSnapshotModel}){
 const aggregate=model.aggregate;
 return <><p>저장 기준일 <strong>{model.snapshotDate}</strong> · 확인 계좌 {model.coveredAccounts.length} / 예상 {model.expectedAccounts.length}</p>
 <dl className={styles.totals}>{([['저장 평가액',aggregate?.totalMarketValue],['저장 투자금',aggregate?.investedAmount],['저장 손익',aggregate?.totalPnl],['저장 수익률',aggregate?.totalReturnPct]] as const).map(([label,value],i)=><div key={label}><dt>{label} · {aggregate?.evidenceKind==='complete_total'?'전체 합계':aggregate?'확인 소계':'합계 확인 전'}</dt><dd>{number(value)} <small>{i===3?'%':'KRW'}</small></dd></div>)}</dl></>;
}
export function SnapshotWarnings({model}:{model:AccountSnapshotModel|PositionSnapshotModel}){
 return <>{model.missingAccounts.length>0&&<p role="status">누락 계좌: {model.missingAccounts.join(', ')} · 다른 날짜의 값을 합치지 않습니다.</p>}
 {'snapshots' in model?<>{model.excludedSnapshotCount>0&&<p role="status">표시 근거가 유효하지 않아 제외한 계좌 기록 {model.excludedSnapshotCount}개</p>}{model.incompleteCoreSnapshotCount>0&&<p role="status">핵심 값이 불완전한 계좌 기록 {model.incompleteCoreSnapshotCount}개 · —는 0이 아닙니다.</p>}{model.hasMixedRuleVersions&&<p role="status">계산 규칙 버전이 다른 부분 기록 · 같은 계산 근거로 간주하지 않습니다.</p>}</>:<>{model.excludedPositionCount>0&&<p role="status">유효한 식별·표시 근거가 없어 제외된 종목 기록 {model.excludedPositionCount}개</p>}<p>연결 종목 {model.linkedPositionCount}개 · 과거 연결만 남은 기록 {model.historicalOnlyPositionCount}개 · 현재 보유 여부를 뜻하지 않습니다.</p></>}</>;
}
export function AccountSnapshotTable({model}:{model:AccountSnapshotModel}){
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="계좌별 저장 평가 표 · 가로 스크롤"><table><caption>{model.snapshotDate} 계좌별 저장 평가 · 금액 KRW</caption><thead><tr>{['계좌','평가액','투자금','원가','손익','수익률 (%)','현금','종목 수','최대 보유 종목','기록 시각 (UTC)'].map((h,i)=><th key={h} scope="col" className={i>0&&i<8?styles.number:undefined}>{h}</th>)}</tr></thead><tbody>{model.snapshots.map(row=><tr key={row.accountCode}><th scope="row">{row.accountName}</th>{[row.totalMarketValue,row.investedAmount,row.totalCost,row.totalPnl,row.totalReturnPct,row.cashValue,row.numAssets].map((n,i)=><td key={i} className={styles.number}>{number(n)}</td>)}<td>{row.topHoldingName??'—'}<small>{number(row.topHoldingWeight)}%</small></td><td className={styles.timestamp}>{row.capturedAt??'—'}</td></tr>)}</tbody></table></div>;
}
export function PositionSnapshotTable({model}:{model:PositionSnapshotModel}){
 return <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="종목별 저장 평가 표 · 가로 스크롤"><table><caption>{model.snapshotDate} 종목별 저장 기록 · 평가액 KRW · 당시 목표는 현재 승인 목표와 다름</caption><thead><tr>{['계좌 / 종목','시장 / 저장 통화','저장 수량','저장 가격','저장 평가액 (KRW)','당시 비중 (%)','당시 목표 (%)','연결 근거'].map((h,i)=><th key={h} scope="col" className={i>=2&&i<=6?styles.number:undefined}>{h}</th>)}</tr></thead><tbody>{model.positions.map((row,index)=><tr key={index}><th scope="row">{row.assetName}<small>{row.accountName} · {row.ticker??'티커 미제공'}</small></th><td>{row.market??'—'} / {row.currency??'—'}</td><td className={styles.number}>{number(row.quantity)}</td><td className={styles.number}>{number(row.storedPrice)}<small>{row.storedPriceKind==='current_price'?'당시 저장 현재가':row.storedPriceKind==='close_price'?'저장 종가':'가격 근거 없음'} · {row.currency??'통화 미제공'}</small></td><td className={styles.number}>{number(row.marketValueKrw)}</td><td className={styles.number}>{number(row.currentWeight)}</td><td className={styles.number}>{number(row.targetWeight)}</td><td>{row.assetLinkStatus==='historical_only'?'과거 연결만 남음':'자산 연결 있음'}<small>{row.priceBasis??'가격 기준 미제공'}</small></td></tr>)}</tbody></table></div>;
}
export function SnapshotEvidence({model}:{model:AccountSnapshotModel|PositionSnapshotModel}){
 return <><p>출처 {model.source} · 포함 {model.coveredAccounts.join(', ')||'없음'} · 예상 {model.expectedAccounts.join(', ')||'없음'}</p>
 {'snapshots' in model?<><p>계산 규칙 {model.ruleVersions.map(v=>v??'미제공').join(', ')} · 합계 구분 {model.aggregate?.evidenceKind??'미제공'}</p>{model.aggregate&&<dl className={styles.facts}>{Object.entries(model.aggregate).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl>}{model.snapshots.map(row=><section key={row.accountCode}><CairnSectionTitle level="h3">{row.accountName} · {row.accountCode}</CairnSectionTitle><dl className={styles.facts}>{Object.entries(row).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl></section>)}</>:model.positions.map((row,i)=><section key={i}><CairnSectionTitle level="h3">{row.accountName} · {row.assetName} · 기록 {i+1}</CairnSectionTitle><dl className={styles.facts}>{Object.entries(row).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value===null?'—':String(value)}</dd></div>)}</dl></section>)}
 <p>원본 공개 DTO의 소수 문자열과 기록 시각을 그대로 보존합니다. 같은 티커 행은 합치지 않습니다. 행 순서는 현재 조회 안의 표시 순서이며 공개 영속 자산 ID가 아닙니다.</p></>;
}
