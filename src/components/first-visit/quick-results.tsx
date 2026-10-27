"use client";

import { useState, type ReactNode } from "react";
import { PortfolioAllocationRing } from "@/components/portfolio/portfolio-allocation-ring";
import { analyzeQuickPortfolio, type QuickInput } from "@/lib/quick-portfolio";
import { formatMoney } from "@/lib/money";
import { useI18n } from "@/components/i18n/locale-provider";
import { intlLocale } from "@/lib/i18n/locale";
import styles from "./quick-portfolio.module.css";

export function formatQuickTimestamp(at: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function QuickResults({ input, action, compact = false }: { input: QuickInput; action?: ReactNode; compact?: boolean }) {
  const { locale, t } = useI18n();
  const result = analyzeQuickPortfolio(input);
  const [selected, setSelected] = useState("0");
  const row = result.rows.find(item => item.key === selected) ?? result.rows[0];
  const money = (value: number, currency = input.currency) => formatMoney(value, currency, intlLocale(locale));
  const classification = (name: string) => t(name, ({ "미확인": "Unidentified", "주식 ETF": "Equity ETFs", "개별 주식": "Stocks", "채권 ETF": "Bond ETFs", "금 ETF": "Gold ETFs" } as Record<string, string>)[name] ?? name);
  const breakdown = <div className={styles.breakdowns}><section><h3>{t("자산 종류", "Asset classes")}</h3>{result.assetClasses.map(item => <p key={item.name}><span>{classification(item.name)}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section><section><h3>{t("거래통화 기준", "Trading currencies")}</h3>{result.currencies.map(item => <p key={item.name}><span>{classification(item.name)}</span><strong>{item.weightPct.toFixed(1)}%</strong></p>)}</section></div>;
  return <section className={`${styles.results} ${compact ? styles.compactResult : ""}`} aria-label={t("내 입력 자산 분석", "Analysis of my inputs")}>
    <p className={styles.eyebrow}>{t("입력 기준", "ENTERED VALUES")} · {input.currency}</p>
    <h2>{result.total !== null ? t(`${money(result.total)}, 이렇게 나뉘어 있어요.`, `${money(result.total)}, at a glance.`) : t("입력한 자산을 통화별로 확인하세요.", "Your assets, by currency.")}</h2>
    {result.largest ? <p>{t("가장 큰 자산", "Largest holding")} <strong>{result.largest.name} · {result.largest.weightPct?.toFixed(1)}%</strong></p> : <p className={styles.partialNote} role="status">{t("같은 시점의 환율이 없어 총액과 전체 비중은 아직 계산할 수 없어요.", "A matching exchange rate is missing, so the combined total and weights are unavailable.")}</p>}
    {result.complete && result.rows.some(item => item.inputCurrency !== input.currency) && input.fx?.[0]?.kind === "user_input" ? <p className={styles.note}>{t("직접 입력한 가정 환율", "Your exchange-rate assumption")} · 1 USD = {Number(input.fx[0].rate).toLocaleString(intlLocale(locale), { maximumFractionDigits: 8 })} KRW</p> : null}
    {action ? <div className={styles.actions}>{action}</div> : null}
    {result.complete ? <div className={styles.chart}>
      <PortfolioAllocationRing entries={result.rows.filter((item): item is typeof item & { weightPct: number } => item.weightPct !== null)} selectedKey={row.key} onSelect={setSelected} compositionOnly />
      <div className={styles.assetList}>{result.rows.map(item => <button type="button" aria-pressed={row.key === item.key} key={item.key} onClick={() => setSelected(item.key)}><span>{item.name}</span><strong>{item.weightPct?.toFixed(1)}%</strong></button>)}
        <p>{row.name} · {row.reportingValue !== null ? money(row.reportingValue) : "—"}</p>
        {row.inputCurrency !== input.currency ? <p>{t("원본 입력", "Original amount")} · {money(row.value, row.inputCurrency)}</p> : null}
      </div>
    </div> : <div className={styles.partialValues}>
      <div className={styles.currencyTotals}>{result.currencyTotals.map(item => <p key={item.currency}><span>{item.currency}</span><strong>{money(item.value, item.currency)}</strong></p>)}</div>
      {result.rows.map(item => <article key={item.key}><span>{item.name}</span><div><strong>{money(item.value, item.inputCurrency)}</strong>{item.reportingValue === null ? <small>{t("환율 확인 필요", "Exchange rate needed")}</small> : item.inputCurrency !== input.currency ? <small>{money(item.reportingValue)}</small> : null}</div></article>)}
      <p className={styles.note}>{t(`전체 ${result.rows.length}개 중 ${result.excluded.length}개 자산의 환산 근거가 부족해요. 입력은 모두 보관됩니다.`, `${result.excluded.length} of ${result.rows.length} assets need exchange-rate evidence. All original inputs are kept.`)}</p>
    </div>}
    {result.complete ? compact ? <details className={styles.method}><summary>{t("자산 종류 · 거래통화", "Asset classes and trading currencies")}</summary>{breakdown}</details> : breakdown : null}
    <details className={styles.method}><summary>{t("어디까지 알 수 있나요?", "What these numbers mean")}</summary>
      <p>{t("비중은 같은 기준 통화의 자산 금액 ÷ 입력 범위의 총액입니다. 선택한 종목만 분류하며, 직접 쓴 이름은 미확인으로 남깁니다.", "Weights divide each asset’s value by the total in one analysis currency. Only selected instruments are classified; unverified names stay unidentified.")}</p>
      <p>{t("거래통화는 실제 환율 노출과 다릅니다. 금액만으로 실제 손익이나 과거 성과를 계산하지 않습니다.", "Trading currency is not the same as currency exposure. Amounts alone do not establish actual gains or past investment performance.")}</p>
      {input.asOf ? <p>{t("입력 기준 시각", "Inputs as of")} · {formatQuickTimestamp(input.asOf, input.timeZone ?? "Asia/Seoul")} · {input.timeZone ?? "Asia/Seoul"}</p> : null}
    </details>
  </section>;
}
