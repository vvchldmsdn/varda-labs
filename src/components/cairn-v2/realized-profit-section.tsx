"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { Button } from "@/components/cairn-ui";
import { startBoundedRead } from "@/lib/cairn-v2/bounded-read";
import { HISTORY_BINDING_HEADER } from "@/lib/cairn-v2/home-history-read";
import type { BetaCurrency } from "@/lib/cairn-v2/navigation";
import type { BetaRealizedProfit } from "@/lib/cairn-v2/realized-profit";
import { formatNumber } from "./ui/format";
import { SectionHeading } from "./ui/molecules";
import styles from "./realized-profit-section.module.css";

type BrokerStatement = NonNullable<BetaRealizedProfit["broker"]>[number];
type LoadResult = { data: BetaRealizedProfit } | { error: "session" | "read" };

function SignedMoney({ amount, currency }: { amount: string | null; currency: BetaCurrency }) {
  const { t } = useI18n();
  if (amount === null) return <>—</>;
  const number = Number(amount);
  const digits = currency === "KRW" ? 0 : 2;
  return <span data-tone={number > 0 ? "positive" : number < 0 ? "negative" : "neutral"}>
    {formatNumber(number, { signDisplay: "exceptZero", minimumFractionDigits: digits, maximumFractionDigits: digits })}
    {currency === "KRW" ? t("원", " KRW") : " USD"}
  </span>;
}

function Statement({ row, showAccount }: { row: BrokerStatement; showAccount: boolean }) {
  const { t } = useI18n();
  return <div className={styles.statement}>
    <div className={styles.line}>
      <div><h4>{t("증권사 확인분 소계", "Broker-confirmed subtotal")}{showAccount && " · " + row.accountLabel}</h4>
        <p>{row.startDate} – {row.endDate} · {t("복구 자료 기준", "Recovered statements")}</p></div>
      <strong><SignedMoney amount={row.subtotalKrw} currency="KRW"/></strong>
    </div>
    <dl className={styles.breakdown}>
      <div><dt>{t("국내주식", "Korean stocks")}</dt><dd><SignedMoney amount={row.domesticKrw} currency="KRW"/></dd></div>
      <div><dt>{t("미국주식", "US stocks")}</dt><dd><SignedMoney amount={row.overseasUsd} currency="USD"/>
        {row.overseasBrokerKrw !== null && <small>{t("증권사 환산", "Broker equivalent")} <SignedMoney amount={row.overseasBrokerKrw} currency="KRW"/></small>}</dd></div>
    </dl>
    <details className={styles.months}><summary>{t("월별 확인 내역", "Monthly evidence")}</summary>
      <table><caption>{t("자료가 없는 달은 —로 표시합니다.", "A dash indicates missing evidence.")}</caption>
        <thead><tr><th scope="col">{t("월", "Month")}</th><th scope="col">{t("국내 · 원", "Korea · KRW")}</th><th scope="col">{t("미국 · 달러", "US · USD")}</th></tr></thead>
        <tbody>{row.months.map(month => <tr key={month.month}><th scope="row">{month.month}</th>
          <td><SignedMoney amount={month.domesticKrw} currency="KRW"/></td><td><SignedMoney amount={month.overseasUsd} currency="USD"/></td></tr>)}</tbody>
      </table>
    </details>
  </div>;
}

export function RealizedProfitResult({ data, currency }: { data: BetaRealizedProfit; currency: BetaCurrency }) {
  const { t } = useI18n();
  const ledger = data.ledger?.[currency];
  const ledgerValue = ledger?.total ?? (ledger && ledger.valued > 0 ? ledger.verifiedSubtotal : null);
  return <>
    {data.broker?.length ? data.broker.map((row, index) => <Statement key={row.accountLabel + index} row={row} showAccount={data.scope === "all" || data.broker!.length > 1}/>) :
      <div className={styles.line}><h4>{t("증권사 확인분", "Broker-confirmed subtotal")}</h4>
        <p>{data.broker === null ? t("조회할 수 없습니다.", "Could not load statements.") : t("이 범위에 등록된 확인 내역이 없습니다.", "No statement is available for this scope.")}</p></div>}
    <div className={styles.ledger}>
      <div className={styles.line}><h4>{t("거래 원장 계산분", "Recorded sales")}</h4>
        <strong>{ledgerValue == null ? "—" : <SignedMoney amount={ledgerValue} currency={currency}/>}</strong></div>
      {ledger ? <p>{ledger.sales > 0
          ? t(`등록 매도 ${ledger.sales}건 중 ${ledger.valued}건 계산`, `${ledger.valued} of ${ledger.sales} recorded sales valued`)
          : t("등록된 매도 0건", "No recorded sales")}
        {ledger.missingCostSales > 0 && " · " + t(`취득원가 미확인 ${ledger.missingCostSales}건`, `Acquisition cost missing for ${ledger.missingCostSales}`)}
        {ledger.valued > 0 && ledger.total === null && " · " + t("확인분 소계", "Verified subtotal")}
        {ledger.sales > 0 && !ledger.missingCostSales && ledger.valued < ledger.sales && " · " + t("체결·원가·환율 근거 확인 필요", "Trade, cost or FX evidence needed")}
        {ledger.valued > 0 && " · " + t("수수료 별도", "Before fees")}
      </p> : <p>{t("원장을 조회할 수 없습니다.", "Could not load the ledger.")}</p>}
    </div>
    {!!data.broker?.length && <p className={styles.note}>{t("같은 매도가 두 출처에 포함될 수 있어 각각 표시합니다.", "A sale can appear in both sources. Figures are shown separately.")}</p>}
  </>;
}

export function RealizedProfitSection({ scope, binding, currency }: { scope: string; binding: string; currency: BetaCurrency }) {
  const { t } = useI18n();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const request = startBoundedRead<LoadResult>(async signal => {
      const response = await fetch("/beta/api/realized-profit?" + new URLSearchParams({ scope }), {
        credentials: "same-origin", cache: "no-store", signal, headers: { [HISTORY_BINDING_HEADER]: binding },
      });
      if ([401, 403, 409].includes(response.status) || response.ok && response.headers.get(HISTORY_BINDING_HEADER) !== binding) return { error: "session" };
      if (!response.ok) throw new Error("realized_profit_unavailable");
      const data: BetaRealizedProfit = await response.json();
      if (data.scope !== scope) throw new Error("realized_profit_scope_mismatch");
      return { data };
    });
    void request.promise.then(next => { if (active) setResult(next); }, () => { if (active) setResult({ error: "read" }); });
    return () => { active = false; request.cancel(); };
  }, [scope, binding, attempt]);
  return <section className={styles.section} aria-label={t("누적 실현손익", "Cumulative realized P&L")}>
    <SectionHeading title={t("누적 실현손익", "Cumulative realized P&L")} />
    {result && "data" in result ? <RealizedProfitResult data={result.data} currency={currency}/> :
      <p role="status">{!result ? t("매도 손익을 조회하고 있습니다.", "Loading realized P&L.") :
        result.error === "session" ? t("계좌 연결을 다시 확인해 주세요.", "Refresh to check the account connection.") : t("매도 손익을 불러오지 못했습니다.", "Could not load realized P&L.")}</p>}
    {result && ("error" in result || result.data.ledger === null || result.data.broker === null) && <Button type="button" variant="secondary" onClick={() => {
      if ("error" in result && result.error === "session") { window.location.reload(); return; }
      setResult(null); setAttempt(n => n + 1);
    }}>{t("다시 조회", "Retry")}</Button>}
  </section>;
}
