"use client";

import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ExternalLink } from "lucide-react";
import { useI18n } from "@/components/i18n/locale-provider";
import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import { compareContributionFxAssumption, type ContributionMarketContext } from "@/lib/contribution-market-context";
import { compareAdditionalContributionCashReserve } from "@/lib/additional-contribution-cash-reserve";
import styles from "./contribution-adjustment.module.css";

export function ContributionAdjustmentPanel({ preview, context }: {
  preview: AdditionalContributionResultPreview;
  context?: ContributionMarketContext;
}) {
  const { locale, t } = useI18n();
  const reserveId = useId();
  const fxId = useId();
  const [enabled, setEnabled] = useState(false);
  const [reserveRatioPct, setReserveRatioPct] = useState(25);
  const [fxChangeBps, setFxChangeBps] = useState(0);
  const baseline = useMemo(() => ({
    cashAmountKrw: preview.cashAmountKrw,
    totalTrimProceedsKrw: preview.totalTrimProceedsKrw,
    totalAllocatedKrw: preview.totalAllocatedKrw,
    residualCashKrw: preview.residualCashKrw,
    rows: preview.rows.map((row, index) => ({
      allocationKey: row.allocationKey ?? `${row.accountCode}:${row.market}:${row.currency}:${row.ticker ?? row.name}:${index}`,
      allocationKrw: row.allocationKrw,
      trimAmountKrw: row.trimAmountKrw,
    })),
  }), [preview]);
  const holdingsByKey = useMemo(() => new Map(baseline.rows.map((row, index) => [row.allocationKey, preview.rows[index]])), [baseline, preview.rows]);
  const reserve = useMemo(() => compareAdditionalContributionCashReserve({ baseline, mode: enabled ? "enabled" : "off", reserveRatioPct }), [baseline, enabled, reserveRatioPct]);
  const fxScenario = useMemo(() => compareContributionFxAssumption(preview.rows, fxChangeBps), [preview.rows, fxChangeBps]);
  const money = (value: number) => new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
  const fx = context?.fx;
  const hasFx = fx?.rate !== null && fx?.rate !== undefined;

  return <div className={styles.panel}>
    <section className={styles.reserve} aria-labelledby={reserveId}>
      <div className={styles.sectionHeading}>
        <div><span className={styles.eyebrow}>YOUR CHOICE</span><h3 id={reserveId}>{t("이번 투입, 얼마나 남겨둘까요?", "How much will you keep in cash?")}</h3></div>
        <button type="button" role="switch" aria-checked={enabled} aria-label={t("신규 투입금 보류 비교", "Compare cash reserve")} className={styles.switch} onClick={() => setEnabled(!enabled)}><span />{t(enabled ? "비교 켜짐" : "비교 꺼짐", enabled ? "On" : "Off")}</button>
      </div>
      <p className={styles.note}>{t("신규 투입금 중 선택한 비율 이상을 현금으로 남기는 가정입니다. 계산된 매도대금의 매수 배분은 유지합니다.", "Compare keeping at least your chosen share of new money in cash. Purchases funded by calculated sales are preserved.")}</p>
      <label className={styles.sliderLabel} htmlFor={`${reserveId}-ratio`}><span>{t("신규 투입금의 최소 보류 비율", "Minimum share of new money to retain")}</span><strong>{enabled ? reserveRatioPct : 0}%</strong></label>
      <input id={`${reserveId}-ratio`} className={styles.slider} type="range" min="0" max="100" step="5" value={reserveRatioPct} disabled={!enabled} onChange={(event) => setReserveRatioPct(Number(event.target.value))} />
      <div className={styles.endpoints}><span>{t("전액 계산", "Full base calculation")}</span><span>{t("신규금 전액 보류", "Keep all new money")}</span></div>
      {reserve.status === "ready" ? <>
        <div className={styles.comparison} aria-live="polite" aria-atomic="true">
          <div><span>{t("기본 매수안", "Base purchases")}</span><strong>{money(preview.totalAllocatedKrw)}</strong><small>{t("현금", "Cash")} {money(preview.residualCashKrw)}</small></div>
          <ArrowRight aria-hidden="true" className={styles.comparisonArrow} size={20} />
          <div data-active={enabled}><span>{t("보류 가정의 매수안", "Purchases with reserve")}</span><strong>{money(reserve.scenarioAllocatedKrw)}</strong><small>{t("현금", "Cash")} {money(reserve.scenarioResidualCashKrw)}</small></div>
        </div>
        <div className={styles.balance}>
          <span style={{flex: reserve.scenarioAllocatedKrw || 0.0001}} title={t("매수", "Purchases")} />
          <span style={{flex: reserve.scenarioResidualCashKrw || 0.0001}} title={t("현금", "Cash")} />
        </div>
        <p className={styles.resultNote}>{t("추가로 남기는 현금", "Additional cash retained")} <strong>{money(reserve.totalAdditionalReserveKrw)}</strong></p>
        <details className={styles.details}>
          <summary>{t("종목별 변화와 계산 근거", "Holding changes and calculation")}<ArrowDown aria-hidden="true" size={15} /></summary>
          <p className={styles.note}>{t("기본 매수금과 남은 현금을 신규금·매도금 비율로 나눠 자금 출처를 계산합니다. 실제 자금 이동을 추적한 값은 아닙니다. 보류 목표액은 1원 미만을 버리고, 이미 남는 신규 현금부터 인정합니다. 부족한 보류액만 신규금으로 살 부분에서 원 단위로 줄이며 다른 종목으로 옮기지 않습니다.", "Funding is attributed proportionately to new money and calculated sale proceeds; this does not trace actual cash transfers. The reserve target is rounded down to whole won. Existing unspent new money counts first; only the remaining reserve reduces new-money-funded purchases. Reductions are not reassigned to other holdings.")}</p>
          <ul className={styles.holdings}>{reserve.rows.map((row) => <li key={row.allocationKey}><div><strong>{holdingsByKey.get(row.allocationKey)?.name}</strong><small>{holdingsByKey.get(row.allocationKey)?.accountName}</small></div><div><span>{money(row.baselineAllocationKrw)} → {money(row.scenarioAllocationKrw)}</span><small>{t("보류", "Retained")} {money(row.reserveKrw)}</small></div></li>)}</ul>
        </details>
      </> : <p role="status" className={styles.note}>{t("자금 합계를 검증하지 못해 비교를 표시하지 않습니다. 기본 배분안은 유지됩니다.", "The funding totals could not be verified. The base allocation remains available.")}</p>}
    </section>

    <section className={styles.market} aria-labelledby={fxId}>
      <span className={styles.eyebrow}>OBSERVED, NOT PREDICTED</span><h3 id={fxId}>{t("지금 확인할 수 있는 근거", "Evidence available now")}</h3>
      <div className={styles.fxHeadline}><span>USD / KRW</span><strong>{hasFx ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(fx!.rate!) : "—"}</strong><small>{t(!hasFx ? "사용 가능한 관측 없음" : fx?.status === "stale" ? "지난 관측 · 최신성 부족" : "저장된 관측값", !hasFx ? "No usable observation" : fx?.status === "stale" ? "Earlier observation · stale" : "Stored observation")}</small></div>
      {hasFx ? <p className={styles.source}>{fx!.date} · {fx!.source}<br />{t("수집 시각", "Retrieved")} {fx!.fetchedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(fx!.fetchedAt)) : "—"} KST</p> : null}
      {fx?.rangePositionPct !== null && fx?.rangePositionPct !== undefined ? <div className={styles.range}>
        <p>{t("최근 90일 같은 출처의 관측 범위", "Same-source observations over the last 90 days")} · {fx.observationCount}{t("개", " observations")}</p>
        <div><i style={{ left: `${fx.rangePositionPct}%` }} /></div>
        <span>{fx.rangeLow?.toLocaleString(locale)} — {fx.rangeHigh?.toLocaleString(locale)}</span>
      </div> : <p className={styles.note}>{t("같은 출처의 날짜별 관측 20개 이상이 있을 때 과거 범위를 표시합니다.", "A historical range requires at least 20 distinct dates from the same source.")}</p>}
      <dl className={styles.evidenceList}><div><dt>{t("가격 추세", "Price trend")}</dt><dd>MA120 {preview.ma120Evidence.usableCount}/{preview.rows.length} · {t(preview.ma120Evidence.mode === "off" ? "조정 꺼짐" : "근거 검증 후 적용", preview.ma120Evidence.mode === "off" ? "Adjustment off" : "Applied after evidence checks")}</dd></div><div><dt>{t("금리·뉴스·산업", "Rates, news & industry")}</dt><dd>{t("연결된 검증 자료 없음 · 금액 조정 없음", "No connected validated evidence · no amount adjustment")}</dd></div></dl>
      <details className={styles.details}>
        <summary>{t("환율이 변한다면?", "What if FX changes?")}<ArrowDown aria-hidden="true" size={15} /></summary>
        <p className={styles.note}>{t("현재 보유한 USD 표시자산의 달러 가격만 고정하고 원화 환산액을 비교합니다. 원화 상장 해외 ETF, 헤지·파생상품·매수 후 변화는 포함하지 않으므로 전체 환위험을 뜻하지 않습니다.", "Hold USD asset prices fixed and compare their KRW translation. KRW-listed global ETFs, hedges, derivatives and post-purchase changes are excluded, so this is not total currency exposure.")}</p>
        <label className={styles.sliderLabel} htmlFor={`${fxId}-change`}><span>{t("USD/KRW 변화 가정", "Assumed USD/KRW change")}</span><strong>{fxChangeBps > 0 ? "+" : ""}{fxChangeBps / 100}%</strong></label>
        <input id={`${fxId}-change`} className={styles.slider} type="range" min="-2000" max="2000" step="100" value={fxChangeBps} onChange={(event) => setFxChangeBps(Number(event.target.value))} />
        {fxScenario ? <dl className={styles.evidenceList}><div><dt>{t("USD 표시자산", "USD-priced holdings")}</dt><dd>{money(fxScenario.usdListedValueKrw)}</dd></div><div><dt>{t("원화 환산 차이", "KRW translation difference")}</dt><dd>{fxScenario.differenceKrw > 0 ? "+" : ""}{money(fxScenario.differenceKrw)}</dd></div></dl> : null}
        <p className={styles.note}>{t("앞으로의 환율 전망이 아니며 매수·매도 계산에 적용하지 않습니다.", "This is not an FX forecast and does not change buy or sell calculations.")}</p>
      </details>
      <details className={styles.details}>
        <summary>{t("공식 발표 직접 확인", "Read official releases")}<ArrowDown aria-hidden="true" size={15} /></summary>
        <p className={styles.note}>{t("아래 링크는 원문 확인용입니다. 서비스가 발표 내용을 수집하거나 점수화했다는 뜻은 아닙니다.", "These links open original sources. Their contents have not been collected or scored by this service.")}</p>
        <div className={styles.sourceLinks}>{[
          ["한국은행 기준금리", "Bank of Korea rates", "https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643"],
          ["미 연준 통화정책", "Federal Reserve policy", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"],
          ["DART 공시", "DART filings", "https://dart.fss.or.kr/"],
          ["SEC 공시", "SEC filings", "https://www.sec.gov/search-filings"],
        ].map(([ko,en,url]) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{t(ko,en)}<ExternalLink size={12} aria-hidden="true" /></a>)}</div>
      </details>
    </section>
    <p className={styles.footnote}>{t("보류 비율과 환율 가정은 이 비교에서만 사용합니다. 저장된 목표비중과 기본 배분안은 바뀌지 않으며 실제 주문을 실행하지 않습니다.", "Reserve and FX assumptions apply only to this comparison. Saved targets and the base allocation stay unchanged; no orders are placed.")}</p>
  </div>;
}
