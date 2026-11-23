"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { InfoDisclosure } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { formatLiveValuationTime } from "@/lib/cairn-v2/history-date";
import { historyEventHref, validateHistoryReturn } from "@/lib/cairn-v2/history-return";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import type { PerformanceGapReason } from "@/lib/cairn-v2/period-performance";
import type { BetaView } from "@/lib/cairn-v2/read-contract";
import { nativeLedgerRecordsHref } from "@/lib/native-ledger-records";
import { HistoryChart } from "./beta-charts";
import { useBetaPreferences, useBetaReadFreshness } from "./beta-provider";
import { PerformanceStatus, type usePeriodPerformance } from "./home-performance";
import styles from "./history-detail.module.css";

const gapReasons: Record<PerformanceGapReason, [string, string]> = {
  valuation: ["두 날짜의 보유 평가액을 확인할 수 없어요.", "Complete holding valuations are unavailable for the two dates."],
  trade: ["보유 수량 변화와 매매 기록을 맞출 수 없어요.", "The trade records do not reconcile with the holding changes."],
  cash_flow: ["입출금 기록의 금액을 확인할 수 없어요.", "The amount of a cash flow is unconfirmed."],
  capital: ["수익률의 기준이 되는 투자 원금을 확인할 수 없어요.", "There is no reliable capital base for the return."],
  scope: ["포함한 자산이나 평가 기준 시점을 맞출 수 없어요.", "The asset coverage or valuation times do not match."],
};

function percent(value: number | null | undefined, locale: string) {
  return value == null ? "—" : value.toLocaleString(locale, {
    minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "exceptZero",
  }) + "%";
}

export function PerformanceDetail({ performance, view, context, metricControls, periodControls, children }: {
  performance: NonNullable<ReturnType<typeof usePeriodPerformance>>;
  view: BetaView; context: BetaContext; metricControls: ReactNode; periodControls: ReactNode; children: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { period, historyDate } = useBetaPreferences();
  const freshness = useBetaReadFreshness();
  const [showSaved, setShowSaved] = useState(false);
  const data = performance.status === "ready" ? performance.data : null;
  const points = data?.points ?? [];
  const selected = points.find(point => point.date === historyDate) ??
    points.findLast(point => point.returnPct !== null && point.date !== point.segment) ?? points.at(-1);
  const selectedGap = selected && data?.gaps.find(gap => gap.start <= selected.date && selected.date <= gap.end);
  const account = context.scope.startsWith("account:") ? context.scope.slice(8) : undefined;
  const selection = selected && { date: selected.date, metric: "return" as const, period };
  const canReturnToDate = selection && validateHistoryReturn({
    ...selection, scope: context.scope, currency: context.currency, kind: "origin",
  }, view) === "valid";
  const recordsHref = selection && canReturnToDate
    ? historyEventHref(context, selection.date, freshness?.store.pendingEpoch(), selection)
    : nativeLedgerRecordsHref(account, context.currency, true);

  return <div className={styles.surface} data-performance-detail>
    <div className={styles.toolbar}>
      <span className={styles.sourceLabel}>{t("누적 수익률 · 원화 기준", "Cumulative return · KRW basis")}</span>
      {metricControls}
    </div>
    {data ? <>
      <div className={styles.stage}>
        <aside className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{t("선택한 날짜", "Selected date")}</p>
            <p className={styles.date}>{selected?.date.replaceAll("-", ".") ?? "—"}</p>
            <p className={styles.value} data-history-selected-value>{percent(selected?.returnPct, locale)}</p>
            {selected?.liveAsOf && <p className={styles.note}>
              {t("잠정 수익률 · 평가 시각", "Provisional return · valued at")} <time dateTime={selected.liveAsOf}>{formatLiveValuationTime(selected.liveAsOf)}</time>
            </p>}
            {(selected?.recovered || selected?.accountReview) && <p className={styles.note}>{t("복구한 거래·평가 기록 기준", "From reconstructed trade and valuation records")}</p>}
            {selected?.reviewEstimated && <p className={styles.note}>{t("거래·평가 자료에 추정치 포함", "Includes estimates from trade or valuation evidence")}</p>}
            {selected?.estimatedFx && <p className={styles.note}>{t("평가 환율을 적용한 추정치", "Estimated using a valuation exchange rate")}</p>}
            {selected?.segment && <p className={styles.caption}>{t(
              selected.segment + " 기준 누적 수익률", "Cumulative return since " + selected.segment,
            )}</p>}
            <p className={styles.note}>{t("일간 수익률", "Daily return")} {percent(selected?.dailyReturnPct, locale)}</p>
            {selected && selected.dailyReturnPct === null && selected.returnPct !== null && selected.segment !== selected.date &&
              <p className={styles.note}>{t("직전 평가와 며칠 간격이 있어 누적 변화만 확인했어요.", "There are several days between valuations, so only the cumulative change is known.")}</p>}
            {selected?.dailyReturnPct == null && selectedGap && <p className={styles.note}>{t(...gapReasons[selectedGap.reason])}</p>}
          </div>
        </aside>
        <div className={styles.plot}>
          <HistoryChart view={view} currency={context.currency} />
          {periodControls}
        </div>
      </div>
      <div className={styles.performanceEvidence}>
        {performance.limitedHistory && <p>{t("최근 10년 안에서 확인한 기록을 기준으로 계산했어요.", "This return uses verified records from the last 10 years.")}</p>}
        <p>{data.basis === "invested_assets_excluding_cash"
          ? t("보유 자산 기준 · 현금 제외 · 매수·매도 금액 반영", "Invested assets · cash excluded · adjusted for buys and sells")
          : data.basis === "portfolio_including_cash"
            ? t("현금 포함 계좌 기준 · 입출금 반영", "Portfolio including cash · adjusted for cash flows")
            : t("서로 다른 평가 기준이 포함돼 있어요.", "This selection contains incompatible valuation bases.")}</p>
        {data.basis === "invested_assets_excluding_cash" && <p>{t(
          "매매로 늘고 줄어든 원금을 조정해요. 별도 현금 잔액, 현금 배당과 별도 수수료는 계산에서 제외해요.",
          "Buys and sells adjust invested capital. Separate cash balances, cash dividends and separately recorded fees are excluded.",
        )}</p>}
        {data.includesCarriedMarks && <p>{t("일부 종목은 이전에 확인한 평가액을 사용했어요.", "Some holdings use a previously recorded valuation.")}</p>}
        {data.includesClosingFx && <p>{t("체결 환율이 없는 외화 거래에는 해당 날짜의 평가 환율을 적용했어요.", "Trades without an execution exchange rate use the valuation rate recorded for that date.")}</p>}
      </div>
      {data.gaps.length > 0 && <InfoDisclosure summary={t("일간 수익률을 계산할 수 없는 구간", "Periods with an unavailable daily return")}>
        <p>{t("평가 자료가 없는 날은 비워 두고, 원금 흐름을 확인한 구간만 계산해요.", "Days without valuations stay empty. A period return requires confirmed capital flows.")}</p>
        <dl className={styles.gapList}>{data.gaps.map(gap => <div key={gap.start}>
          <dt>{gap.start}{gap.start !== gap.end && " – " + gap.end}</dt>
          <dd>{t(...gapReasons[gap.reason])}</dd>
        </div>)}</dl>
      </InfoDisclosure>}
      {selected && (account || context.scope === "all") && <Link id="history-evidence" prefetch={false} className={styles.recordsLink} href={recordsHref}>
        {canReturnToDate ? t("이날 거래 기록 보기", "View records for this date") : t("거래 기록 보기", "View transaction records")} <span aria-hidden="true">↗</span>
      </Link>}
    </> : <><PerformanceStatus />{periodControls}</>}
    <InfoDisclosure className={styles.savedDisclosure} summary={t("기존 저장·복구 수익률 보기", "View previously saved and reconstructed returns")}
      onToggle={event => setShowSaved(event.currentTarget.open)}>
      {showSaved && children}
    </InfoDisclosure>
  </div>;
}
