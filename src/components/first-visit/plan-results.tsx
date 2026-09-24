"use client";
import { calculatePlan, type PlanInput } from "@/lib/investment-plan";
import { formatMoney, type Currency } from "@/lib/money";
import { useI18n } from "@/components/i18n/locale-provider";
import { intlLocale, type Locale } from "@/lib/i18n/locale";
import styles from "./first-visit.module.css";

export function planErrorCopy(error: string, currency: Currency, locale: Locale) {
  if (/추가 투자금/.test(error)) return locale === "en"
    ? `Enter a positive amount in ${currency}${currency === "USD" ? ", with no more than two decimals" : ", in whole won"}.`
    : currency === "USD" ? "추가 투자금은 0달러보다 크게, 소수 둘째 자리까지 입력해 주세요." : error;
  if (/현재 평가금액/.test(error)) return locale === "en"
    ? `Check each asset value in ${currency}${currency === "USD" ? " (up to two decimals)" : " (whole won)"}.`
    : currency === "USD" ? "현재 평가금액은 0달러 이상, 소수 둘째 자리까지 입력해 주세요." : error;
  if (locale === "ko") return error;
  if (/합계.*100%/.test(error)) return "Target weights must add up to 100%.";
  if (/목표 비중/.test(error)) return "Use target weights from 0 to 100%, with up to two decimals.";
  if (/같은 이름/.test(error)) return "Combine assets with the same name or give them distinct names.";
  if (/이름/.test(error)) return "Give every asset a name of 1–60 characters.";
  if (/1~12/.test(error)) return "Add between 1 and 12 assets.";
  if (/통화|기준 시각/.test(error)) return "Check the calculation currency and input date.";
  return "Check your inputs and calculate again.";
}

export function PlanResults({ input, sample = false }: { input: PlanInput; sample?: boolean }) {
  const { locale, t } = useI18n();
  const calculation = calculatePlan(input);
  if (!calculation.ok) return <p role="alert">{planErrorCopy(calculation.error, input.currency, locale)}</p>;
  const { rows, totalAllocated, residualCash } = calculation;
  const money = (value: number) => formatMoney(value, input.currency, intlLocale(locale));
  const reached = rows.every(row => Math.abs(row.afterPct - row.targetPct) < 0.01);
  return <section className={styles.results} aria-label={sample ? t("샘플 계산 결과", "Sample allocation") : t("내 계산 결과", "My allocation")}>
    <p className={styles.eyebrow}>{sample ? t("예시 배분 결과", "SAMPLE ALLOCATION") : t("내가 입력한 자산의 배분", "YOUR ALLOCATION")} · {input.currency}</p>
    <h2>{t("이번 투자금", "Allocate")} <strong>{money(input.amount)}</strong>{t("의 배분", "")}</h2>
    <p>{reached ? t("목표 비중에 가까워졌어요. 반올림 차이는 남을 수 있습니다.", "Close to your targets. Small rounding differences may remain.") : t("목표보다 부족한 자산에 배분합니다. 목표 비중과 차이는 남을 수 있어요.", "New money goes to underweight assets. Some gaps may remain.")}</p>
    <div className={styles.resultRows}>{rows.map((row, i) => <article key={i}>
      <div className={styles.rowTitle}><h3>{row.name}</h3><strong>+{money(row.allocation)}</strong></div>
      <div className={styles.bar} aria-hidden="true"><span style={{ width: `${row.afterPct}%` }} /><i style={{ left: `${row.targetPct}%` }} /></div>
      <div className={styles.stats}><span>{t("현재", "Now")} {row.beforePct === null ? "—" : `${row.beforePct.toFixed(2)}%`} → {t("배분 후", "After")} {row.afterPct.toFixed(2)}%</span><span>{t("목표", "Target")} {row.targetPct.toFixed(2)}% · {t("차이", "Gap")} {(row.afterPct - row.targetPct).toFixed(2)}{t("%p", " pp")}</span></div>
    </article>)}</div>
    <p>{t("배분 합계", "Allocated")} {money(totalAllocated)} · {t("남는 현금", "Cash left")} {money(residualCash)}</p>
    <details><summary>{t("계산 방법과 한계", "How this works")}</summary><p>{t("목표까지 부족한 금액이 큰 자산에 더 많이 배분합니다. 이미 비중이 높은 자산은 팔지 않으므로, 새 투자금만으로 목표에 도달하지 못할 수 있어요.", "New money is split in proportion to each asset’s shortfall. Nothing is sold, so new money alone may not reach every target.")}</p><p>{t(`입력한 ${input.currency} 금액으로 계산한 계획입니다. 실제 매수 수량·환전·세금·수수료는 반영하지 않습니다. ${input.currency === "USD" ? "센트" : "원"} 단위로 배분한 뒤 남은 금액은 현금으로 표시합니다.`, `This plan uses the entered ${input.currency} values. Trade quantities, currency exchange, taxes and fees are not included. Allocations use ${input.currency === "USD" ? "cents" : "whole won"}; any remainder stays in cash.`)}</p></details>
  </section>;
}
