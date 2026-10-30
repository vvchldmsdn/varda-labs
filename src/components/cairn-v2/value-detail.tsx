"use client";
import { InfoDisclosure } from "@/components/cairn-ui";
import { useId, useState } from "react";
import Link from "next/link";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { readStateText } from "@/lib/cairn-v2/read-presentation";
import { snapshotDecimal } from "@/lib/cairn-v2/snapshot-contract";
import { betaHref, betaReadHref, type BetaContext } from "@/lib/cairn-v2/navigation";
import { useBetaReadFreshness } from "./beta-provider";
import styles from "./value-detail.module.css";
import { Metric, SectionHeading } from "./ui/molecules";
import { StatusPill } from "./ui/atoms";
import { formatNumber, formatPercent } from "./ui/format";

// Limited presentation reuse: portfolio overview's value hierarchy and the
// original structure HoldingEvidenceTable/selected holding roles. All figures,
// composition weights, colors and exclusions come from the existing BetaView.
export function ValueDetail({ view, context }: { view: BetaView; context: BetaContext }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const id = useId();
  const freshness = useBetaReadFreshness();
  const domain = view.domain;
  const stateText = readStateText(domain?.valueState, "보유 자산 없음");
  if (!domain || stateText) return <p className={styles.empty} role="status">{stateText ?? "평가 근거 확인 전"}</p>;
  const partial = domain.valueState === "partial" || domain.excluded.length > 0;
  const active = view.rows.find(row => row.key === selectedKey) ?? view.rows[0];
  const money = (value: number | null) => displayReadMoney(view, value, context.currency, false, "structure");
  const unit = context.currency === "KRW" ? "원" : "USD";
  const amount = partial ? domain.knownSubtotalKrw : view.totalKrw;
  const investment = domain.investmentReturn;
  const costCoverage = investment?.coverage;
  const partialCost = !!costCoverage && costCoverage.confirmed < costCoverage.total;
  const costReason = (reason: string | null) => reason === "missing_cost_evidence" ? "매입원가 미등록" : reason === "fx_missing" || reason === "fx_stale" ? "매입일 환율 확인 필요" : reason === "quantity_basis_changed" ? "보유 수량 대조 필요" : "원가 근거 확인 필요";
  const reasonLabel = (reason: string) => reason === "missing_price" ? "가격 없음" : reason === "missing_fx" ? "환율 없음" : reason === "unsupported_currency" ? "미지원 통화" : reason;
  return <div className={styles.detail} data-value-detail>
    <div className={styles.hero}>
      <div className={styles.balance}>
        <p className={styles.eyebrow}>{partial ? "확인 가능한 투자자산 소계" : "전체 투자자산 평가액"}</p>
        <p className={styles.amount} data-value-hero><span>{money(amount)}</span><small>{unit}</small></p>
        <p className={styles.basis}>{partial ? "전체 합계 확인 전 · 평가 제외 자산 별도" : "현재 가격·환율 기준"}</p>
      </div>
      <dl className={styles.metrics}>
        <div><dt>평가에 포함</dt><dd>{view.rows.length}<small>종목</small></dd></div>
        <div><dt>평가 제외</dt><dd>{domain.excluded.length}<small>종목</small></dd></div>
      </dl>
    </div>

    <InfoDisclosure summary="평가 기준" className={styles.visibleBasis}>
      {context.currency === "USD" && <p>현재 KRW 평가의 환산 표시 · 과거 USD 성과 아님</p>}
      <p>USD/KRW {snapshotDecimal(domain.moneyBasis.structure.usdKrwRate)} · 환율 관측일 {domain.moneyBasis.structure.rateDate ?? "미제공"}</p>
      {domain.nonInvestmentCount > 0 && <p>비투자자산 {domain.nonInvestmentCount}개 · {displayReadMoney(view, domain.nonInvestmentValueKrw, context.currency, false, "dashboard")} {unit} 별도 · 아래 투자자산 비중에 미포함</p>}
    </InfoDisclosure>

    {investment && <section className={styles.costSection} aria-label="투자자산 보유 수익률">
      <SectionHeading title="보유 원가와 손익" actions={costCoverage && <StatusPill tone={partialCost ? "muted" : "positive"}>원가 확인 {costCoverage.confirmed}/{costCoverage.total}종목</StatusPill>} />
      {partialCost && <p className={styles.costNotice} role="status">{costCoverage!.total - costCoverage!.confirmed}종목의 매입원가 근거가 없어 전체 보유 수익률을 계산할 수 없습니다. {costCoverage!.confirmed > 0 ? "아래는 원가가 확인된 종목만의 소계입니다." : "종목별 매입원가를 확인하면 계산할 수 있습니다."}</p>}
      <dl className={styles.investmentMetrics}>
        <Metric label={partialCost ? "확인된 매입원가 소계" : "남은 매입원가"} value={formatNumber(partialCost ? costCoverage!.confirmed ? costCoverage!.knownCostKrw : null : investment.costKrw,{maximumFractionDigits:0})} unit="원" note="KRW · 수수료·세금 제외" />
        <Metric label={partialCost ? "확인 종목 평가손익" : "보유 평가손익"} value={formatNumber(partial ? null : partialCost ? costCoverage!.confirmed ? costCoverage!.knownPnlKrw : null : investment.pnlKrw, {signDisplay:"exceptZero",maximumFractionDigits:0})} unit="원" note={partialCost ? "전체 계좌 손익이 아닙니다" : "현금 제외 · 남은 보유 기준"} />
        <Metric label={partialCost ? "확인 종목 보유 수익률" : "보유 수익률"} value={formatPercent(partial ? null : partialCost ? costCoverage!.knownReturnPct : investment.returnPct, 2, true)} note={partialCost ? "원가 확인 종목만 비교" : "매입원가 대비 평가손익"} />
      </dl>
      {!costCoverage && investment.reason && <p className={styles.costNotice} role="status">{investment.reason === "valuation_basis_changed" ? "조회 중 평가 근거가 바뀌었습니다. 다시 조회하면 원가와 평가액을 같은 기준으로 비교합니다." : "매입원가 근거를 불러오지 못했습니다. 다시 조회해 주세요."}</p>}
      {!!investment.rows?.length && <details className={styles.costEvidence}><summary>종목별 원가 확인 상태</summary><ul>{investment.rows.map(row => <li key={row.key}><span><strong>{row.name}</strong><small>{row.account}</small></span><span>{row.costKrw === null ? costReason(row.reason) : formatNumber(row.costKrw) + "원"}</span></li>)}</ul></details>}
    </section>}

    <section className={styles.composition} aria-label="투자자산 구성">
      <SectionHeading title="투자자산 구성"  />
      <div className={styles.ribbon} role="img" aria-label="확인 소계 내 종목별 비중 · 아래 목록에서 종목 선택" data-value-ribbon>
        {view.rows.map(row => <span key={row.key} style={{ flexBasis: `${row.weightPct}%`, background: row.color }} title={`${row.name} · ${snapshotDecimal(row.weightPct)}%`} data-weight={row.weightPct} />)}
      </div>
      <div className={styles.explorer}>
        <div className={styles.tableScroll} role="region" aria-label="투자자산 구성 표 · 가로 세로 스크롤" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">종목 / 계좌</th><th scope="col" className={styles.number}>평가액 ({unit})</th><th scope="col" className={styles.number}>비중</th></tr></thead>
            <tbody>{view.rows.map(row => <tr key={row.key} data-selected={row.key === active?.key}>
              <th scope="row"><button type="button" className={styles.holdingButton} aria-pressed={row.key === active?.key} aria-controls={`${id}-holding`} onClick={() => setSelectedKey(row.key)}>
                <span className={styles.dot} style={{ background: row.color }} aria-hidden="true" />
                <span><strong>{row.name}</strong><small>{row.account}{row.ticker ? " · " + row.ticker : ""}</small></span>
              </button></th>
              <td className={styles.number}>{money(row.valueKrw)}</td>
              <td className={styles.number} title={String(row.weightPct) + "%"}>{row.weightPct.toFixed(2)}<small>%</small></td>
            </tr>)}</tbody>
          </table>
        </div>
        {active && <section className={styles.selection} id={`${id}-holding`} aria-label="선택 종목 평가 근거" aria-live="polite">
          <p className={styles.eyebrow}>선택한 종목</p>
          <h3>{active.name}</h3>
          <p className={styles.identity}>{active.account} · {active.ticker ?? "티커 미제공"}</p>
          <p className={styles.selectedValue}>{money(active.valueKrw)}<small>{unit}</small></p>
          <dl className={styles.facts}>
            <div><dt>수량</dt><dd>{snapshotDecimal(active.quantity)}<small>개</small></dd></div>
            <div><dt>원본 가격</dt><dd>{snapshotDecimal(active.currentPrice)}<small>{active.currency ?? "통화 미제공"}</small></dd></div>
            <div><dt>소계 내 비중</dt><dd title={String(active.weightPct) + "%"}>{active.weightPct.toFixed(2)}<small>%</small></dd></div>
            <div className={styles.timestamp}><dt>가격 관측</dt><dd>{active.priceAsOf ? <time dateTime={active.priceAsOf}>{active.priceAsOf}</time> : "미제공"}</dd></div>
          </dl>
        </section>}
      </div>
    </section>

    {domain.excluded.length > 0 && <section className={styles.excluded} aria-label="평가 제외 근거">
      <header className={styles.sectionHeader}><h3>평가 제외 {domain.excluded.length}종목</h3><span>전체 합계에 포함하지 않음</span></header>
      <ul>{domain.excluded.map((row, index) => <li key={`${row.account}:${row.ticker ?? row.name}:${index}`}><strong>{row.name}</strong><span>{row.account} · {row.currency}</span><span>{reasonLabel(row.reason)}</span></li>)}</ul>
    </section>}

    <details className={styles.evidence}><summary>평가 기준·원본 수치</summary>
      <dl className={styles.evidenceFacts}>
        <div><dt>평가 기준</dt><dd>{domain.valuationBasis}</dd></div>
        <div><dt>전체 투자자산 합계 (KRW)</dt><dd>{snapshotDecimal(view.totalKrw)}</dd></div>
        <div><dt>확인 가능한 소계 (KRW)</dt><dd>{snapshotDecimal(domain.knownSubtotalKrw)}</dd></div>
        <div><dt>화면 갱신</dt><dd>{domain.refreshedAt ?? "확인 전"}</dd></div>
        <div><dt>화면 기준시각</dt><dd>{view.asOf}</dd></div>
        <div><dt>비투자자산 (KRW)</dt><dd>{snapshotDecimal(domain.nonInvestmentValueKrw)} · 투자자산과 별도</dd></div>
        {active && <><div><dt>선택 종목 평가액 원본 (KRW)</dt><dd>{snapshotDecimal(active.valueKrw)}</dd></div><div><dt>원본 비중</dt><dd>{String(active.weightPct)}%</dd></div></>}
      </dl>
    </details>
    <Link prefetch={false} className={styles.link} href={betaReadHref(betaHref("/beta/portfolio/structure", context), freshness?.store.pendingEpoch())}>보유 평가·비중 보기 ↗</Link>
  </div>;
}
