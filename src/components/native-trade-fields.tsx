"use client";

import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "@/components/first-visit/money-input";
import { formatMoney, type Currency } from "@/lib/money";
import { tradeCashAmount, tradeInputFromFields, tradeConsideration, exactTradeAmount } from "./native-trade-input";
import styles from "./native-ledger-view.module.css";
import { Button as CairnButton, Field as CairnField, Input as CairnInput, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


export function NativeTradeFields({ kind, fields, unit, quantity, edit }: {
  kind: "buy" | "sell"; fields: Record<string, string>; unit: Currency; quantity: string; edit: (key: string, value: string) => void;
}) {
  const { t, locale } = useI18n();
  const netMode = fields.inputMode === "net";
  const cashMode = netMode || fields.inputMode === "total";
  const legacyUnit = fields.inputMode === "unit" || fields.inputMode === "price";
  const settlementCurrency = cashMode && fields.settlementCurrency ? fields.settlementCurrency as Currency : unit;
  let preview: ReturnType<typeof tradeCashAmount> = null;
  let consideration: ReturnType<typeof tradeConsideration> | null = null;
  let problem = "";
  try { const input = tradeInputFromFields(kind, fields, unit, "preview"); preview = tradeCashAmount(input); consideration = tradeConsideration(input); }
  catch (cause) { problem = cause instanceof Error ? cause.message : "invalid_input"; }
  const fmt = (value: string) => formatMoney(Number(value), settlementCurrency, locale === "en" ? "en-US" : "ko-KR");
  return <>
    <div className={styles.holdingQuantity}><span>{t("현재 보유", "Currently held")} · {quantity}</span>{kind === "sell" ? <CairnButton variant="secondary" type="button" className={styles.secondary} disabled={Number(quantity) <= 0} onClick={() => edit("quantity", quantity)}>{t("전량", "All")}</CairnButton> : null}</div>
    <CairnField>{t("체결 수량", "Executed quantity")}<CairnInput inputMode="decimal" name="quantity" value={fields.quantity ?? ""} onChange={event => edit("quantity", event.target.value)} placeholder="0" required /></CairnField>
    <CairnField>{t("체결 단가", "Execution price")} · {unit}{cashMode ? t(" · 선택", " · optional") : ""}<CairnInput inputMode="decimal" name="price" value={fields.price ?? ""} onChange={event => edit("price", event.target.value)} placeholder="0" required={!cashMode} /></CairnField>
    {!cashMode && !legacyUnit ? <p className={styles.note}>{t("증권사에 나온 수량·단가 그대로 입력하세요. 현금 출금액 없이 저장할 수 있어요.", "Enter your broker’s quantity and price. No cash debit is required.")}</p> : null}
    {!cashMode && consideration ? <p className={styles.settlement} aria-live="polite"><span>{t("총 체결금액 · 수량 × 단가", "Total consideration · quantity × price")}</span><strong style={{overflowWrap:"anywhere"}}>{exactTradeAmount(consideration.amount)} {consideration.currency}</strong></p> : null}
    <details open={cashMode || legacyUnit ? true : undefined}>
      <summary>{t("수수료·정산 정보 (선택)", "Fees & settlement (optional)")}</summary>
      {!cashMode && !legacyUnit ? <p className={styles.note}>{t("투자자산 원가·수익률은 체결금액 기준으로 확인합니다. 현금 정산은 별도이며 필수가 아닙니다.", "Investment cost and returns use execution consideration. Cash settlement is separate and optional.")}</p> : null}
      {legacyUnit ? <p className={styles.note}>{t("이전 기록은 수량 × 단가로 현금을 정산한 거래입니다. 정정 시 기존 정산 방식을 유지합니다.", "This older record settled cash from quantity × price. Corrections preserve that original method.")}</p> : null}
      <div className={`${styles.tradeKinds} ${styles.tradeModeOptions}`} role="group" aria-label={t("정산 입력 방식", "Settlement input")}>
        <CairnButton variant="selection" type="button" aria-pressed={netMode} onClick={() => edit("inputMode", "net")}><span>{t("정산 금액", "Net settlement")}</span><small>{kind === "buy" ? t("실제 출금액 · 비용 포함", "Actual debit · includes costs") : t("실제 입금액 · 비용 차감 후", "Actual credit · after costs")}</small></CairnButton>
        <CairnButton variant="selection" type="button" aria-pressed={cashMode && !netMode} onClick={() => edit("inputMode", "total")}><span>{t("체결 총액", "Gross total")}</span><small>{t("수수료·세금 제외", "Before fees and tax")}</small></CairnButton>
      </div>
      {cashMode ? <>
        <p className={styles.note}>{netMode
          ? kind === "buy" ? t("수수료·세금을 포함한 최종 출금액입니다. 주문금액과 구분해 주세요.", "Final debit including fees and tax, not the order budget.") : t("수수료·세금을 뺀 최종 입금액입니다.", "Final credit after fees and tax.")
          : t("수수료·세금 제외 금액입니다. 실제 결제 통화를 선택하세요.", "Gross total before fees and tax. Select the actual settlement currency.")}</p>
        <div className={styles.row}><CairnField>{netMode ? kind === "buy" ? t("실제 출금액", "Actual debit") : t("실제 입금액", "Actual credit") : t("체결 총액", "Gross total")}<MoneyInput value={(netMode ? fields.netTotal : fields.total) ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit(netMode ? "netTotal" : "total", value)} required /></CairnField><CairnField>{t("결제 통화", "Settlement currency")}<CairnSelect className="cairn-form-select" value={settlementCurrency} onChange={event => edit("settlementCurrency", event.target.value)}><option>KRW</option><option>USD</option></CairnSelect></CairnField></div>
      </> : null}
      <div className={styles.grid}>{(["fee", "tax"] as const).map(key => <CairnField key={key}>{key === "fee" ? t("수수료", "Fee") : t("세금", "Tax")} · {settlementCurrency}<MoneyInput value={fields[key] ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit(key, value)} required={netMode} placeholder={netMode ? t("없으면 0", "0 if none") : t("모르면 비워두세요", "Leave blank if unknown")} /></CairnField>)}</div>
      <p className={styles.note}>{netMode ? t("정산액에 포함된 비용입니다. 없는 항목은 0, 모르는 항목은 확인 후 입력하세요. 이중 차감하지 않습니다.", "Costs included in net settlement. Enter 0 only if none; verify unknown costs. They are not deducted twice.") : !cashMode && !legacyUnit ? t("정산액을 모르면 비용도 참고 정보로만 기록하며 현금을 차감하지 않습니다.", "Until settlement is known, costs are recorded as evidence without debiting cash.") : t("비용은 체결 총액과 별도로 반영합니다. 모르면 비워두세요.", "Costs are applied separately from gross. Leave blank if unknown.")}</p>
      {(cashMode || legacyUnit) ? <CairnButton variant="secondary" type="button" className={styles.secondary} onClick={() => edit("inputMode", "execution")}>{t("정산액 없이 체결만 기록", "Record execution without settlement")}</CairnButton> : null}
      <CairnField>{t("주문 참고 단가 · 선택", "Order reference price · optional")} · {unit}<CairnInput inputMode="decimal" value={fields.orderPrice ?? ""} onChange={event => edit("orderPrice", event.target.value)} /></CairnField>
    </details>
    {problem === "invalid_minor_unit" ? <CairnStatus as="p" tone="neutral" className={styles.error} role="status">{t("정산액은 USD 소수 둘째 자리, KRW 정수 원 단위입니다. 정산액을 모르면 ‘정산액 없이 체결만 기록’을 선택하세요. 체결 단가는 줄이지 않아도 됩니다.", "Settlement uses USD cents or whole KRW. If unknown, record execution without settlement; do not shorten the unit price.")}</CairnStatus> : null}
    {problem === "invalid_net_settlement" ? <CairnStatus as="p" tone="neutral" className={styles.error} role="status">{t("매수 출금액은 포함된 수수료·세금보다 커야 합니다.", "The buy debit must exceed its included fees and tax.")}</CairnStatus> : null}
    {preview ? <div className={styles.note} aria-live="polite">
      <p className={styles.settlement}><span>{t("체결 총액 · 비용 제외", "Gross total · before costs")}</span><strong>{fmt(preview.gross.amount)}</strong></p>
      <p className={styles.settlement}><span>{kind === "buy" ? t("출금 합계", "Total debit") : t("입금 합계", "Total credit")}{preview.costsKnown ? "" : t(" · 입력된 비용 기준", " · entered costs only")}</span><strong>{fmt(preview.cash.amount)}</strong></p>
    </div> : null}
  </>;
}
