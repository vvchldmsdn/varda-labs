"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "@/components/first-visit/money-input";
import { resolveNativeTrade } from "@/lib/native-portfolio-ledger";
import { formatMoney, type Currency } from "@/lib/money";
import styles from "./native-ledger-view.module.css";

export function NativeTradeFields({ kind, fields, unit, quantity, edit }: {
  kind: "buy" | "sell"; fields: Record<string, string>; unit: Currency; quantity: string; edit: (key: string, value: string) => void;
}) {
  const { t, locale } = useI18n();
  const totalMode = fields.inputMode === "total";
  const settlementCurrency = totalMode && fields.settlementCurrency ? fields.settlementCurrency as Currency : unit;
  let summary: string | null = null;
  try {
    const resolved = resolveNativeTrade({ type: kind, assetId: "preview", quantity: fields.quantity, currency: unit,
      ...(totalMode ? { settlement: { amount: fields.total, currency: settlementCurrency } } : { price: fields.price }) });
    summary = formatMoney(Number(resolved.settlement.amount), resolved.settlement.currency, locale === "en" ? "en-US" : "ko-KR");
  } catch { /* Incomplete input is shown by the form, never a fabricated settlement. */ }
  return <>
    <div className={styles.holdingQuantity}><span>{t("현재 보유", "Currently held")} · {quantity}</span>{kind === "sell" ? <button type="button" className={styles.secondary} disabled={Number(quantity) <= 0} onClick={() => edit("quantity", quantity)}>{t("전량", "All")}</button> : null}</div>
    <label>{t("수량", "Quantity")}<input inputMode="decimal" name="quantity" value={fields.quantity ?? ""} onChange={event => edit("quantity", event.target.value)} placeholder="0" required /></label>
    <div className={styles.tradeKinds} role="group" aria-label={t("입력 방식", "Price input")}>
      <button type="button" aria-pressed={totalMode} onClick={() => edit("inputMode", "total")}>{t("체결 총액", "Executed total")}</button>
      <button type="button" aria-pressed={!totalMode} onClick={() => edit("inputMode", "unit")}>{t("1주당 체결가", "Execution per share")}</button>
    </div>
    {totalMode ? <div className={styles.row}><label>{t("체결 총액", "Executed total")}<MoneyInput value={fields.total ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit("total", value)} required /></label><label>{t("결제 통화", "Settlement currency")}<select value={settlementCurrency} onChange={event => edit("settlementCurrency", event.target.value)}><option>KRW</option><option>USD</option></select></label></div>
      : <label>{t("실제 평균 체결가", "Actual average execution price")} · {unit}<input inputMode="decimal" value={fields.price ?? ""} onChange={event => edit("price", event.target.value)} required /></label>}
    {summary ? <p className={styles.settlement} aria-live="polite">{t("체결금액", "Execution amount")} <strong>{summary}</strong></p> : null}
    <details><summary>{t("주문가·수수료·세금 (선택)", "Order price, fees & tax (optional)")}</summary>
      <label>{t("주문 참고 단가", "Order reference price")} · {unit}<input inputMode="decimal" value={fields.orderPrice ?? ""} onChange={event => edit("orderPrice", event.target.value)} /></label>
      <div className={styles.grid}>{(["fee", "tax"] as const).map(key => <label key={key}>{key === "fee" ? t("수수료", "Fee") : t("세금", "Tax")} · {settlementCurrency}<MoneyInput value={fields[key] ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit(key, value)} placeholder={t("미제공", "Unknown")} /></label>)}</div>
      <p className={styles.note}>{t("수수료·세금은 체결금액과 별도로 차감해요. 모르면 비워두세요.", "Fees and tax are debited separately from the execution amount. Leave blank if unknown.")}</p>
    </details>
  </>;
}
