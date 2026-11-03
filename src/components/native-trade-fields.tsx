"use client";

import { useId } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { MoneyInput } from "@/components/first-visit/money-input";
import { Decimal, formatMoney, type Currency } from "@/lib/money";
import { tradeCashAmount, tradeInputFromFields, tradeConsideration, exactTradeAmount } from "./native-trade-input";
import defaultStyles from "./native-ledger-view.module.css";
import { Button as CairnButton, Field as CairnField, Input as CairnInput, Select as CairnSelect, Status as CairnStatus } from "@/components/cairn-ui";


type TradeFieldsProps = { kind: "buy" | "sell"; fields: Record<string,string>; unit: Currency; quantity: string; edit: (key:string,value:string)=>void; requiredErrors?: readonly string[] };
export function NativeTradeFields(props: TradeFieldsProps) {
  const i18n = useI18n();
  return <TradeExecutionFields {...props} {...i18n} />;
}
/** Shared controls; the two shells supply their locale and existing layout tokens. */
export function TradeExecutionFields({ kind, fields, unit, quantity, edit, t, locale, styles = defaultStyles, requiredErrors = [] }: TradeFieldsProps & {
  t: (ko: string, en?: string) => string; locale: string; styles?: Record<string,string>;
}) {
  const quantityHint = useId();
  const errorId = useId();
  const missing = (name: string) => requiredErrors.includes(name) && !fields[name]?.trim();
  const requiredMessage = (name: string, ko: string, en: string) => missing(name) ? <span id={`${errorId}-${name}`} role="alert">{t(ko, en)}</span> : undefined;
  const executionTotalMode = fields.inputMode === "execution_total";
  let oversold = false;
  try { oversold = kind === "sell" && !fields.historyMode && Decimal.from(fields.quantity || "0").compare(quantity) > 0; } catch { /* Validation also runs at save. */ }
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
    <div className={styles.holdingQuantity}><span>{t("현재 보유", "Currently held")} <strong>{quantity}</strong></span>{kind === "sell" ? <CairnButton variant="secondary" type="button" className={styles.secondary} disabled={Number(quantity) <= 0} onClick={() => edit("quantity", quantity)}>{t("전량", "All")}</CairnButton> : null}</div>
    {!cashMode && !legacyUnit && <div className={styles.tradeKinds} role="group" aria-label={t("체결금액 입력 방식", "Execution amount input")}><CairnButton variant="selection" type="button" aria-pressed={!executionTotalMode} onClick={() => edit("inputMode", "execution")}>{t("1주 가격", "Price per share")}</CairnButton><CairnButton variant="selection" type="button" aria-pressed={executionTotalMode} onClick={() => edit("inputMode", "execution_total")}>{t("총 체결금액", "Total consideration")}</CairnButton></div>}
    <div className={styles.executionFields}>
      <CairnField error={requiredMessage("quantity", "체결 수량을 입력해 주세요.", "Enter the executed quantity.")}>{t("체결 수량", "Executed quantity")}<CairnInput inputMode="decimal" name="quantity" aria-label={t("체결 수량", "Executed quantity")} aria-invalid={oversold || missing("quantity") || undefined} aria-describedby={missing("quantity") ? `${errorId}-quantity` : oversold ? quantityHint : undefined} value={fields.quantity ?? ""} onChange={event => edit("quantity", event.target.value)} placeholder="0" required /></CairnField>
      {executionTotalMode ? <CairnField error={requiredMessage("executionTotal", "총 체결금액을 입력해 주세요.", "Enter the total consideration.")}>{t("총 체결금액", "Total consideration")} · {unit}<CairnInput inputMode="decimal" name="executionTotal" aria-label={`${t("총 체결금액", "Total consideration")} · ${unit}`} aria-invalid={missing("executionTotal") || undefined} aria-describedby={missing("executionTotal") ? `${errorId}-executionTotal` : undefined} value={fields.executionTotal ?? ""} onChange={event => edit("executionTotal", event.target.value)} placeholder="0" required /></CairnField> : <CairnField error={requiredMessage("price", "체결 단가를 입력해 주세요.", "Enter the execution price.")}>{t("체결 단가", "Execution price")} · {unit}{cashMode ? t(" · 선택", " · optional") : ""}<CairnInput inputMode="decimal" name="price" aria-label={`${t("체결 단가", "Execution price")} · ${unit}${cashMode ? t(" · 선택", " · optional") : ""}`} aria-invalid={missing("price") || undefined} aria-describedby={missing("price") ? `${errorId}-price` : undefined} value={fields.price ?? ""} onChange={event => edit("price", event.target.value)} placeholder="0" required={!cashMode} /></CairnField>}
    </div>
    {oversold && <CairnStatus as="p" id={quantityHint} tone="danger" role="alert">{t(`최대 ${quantity}주까지 매도할 수 있어요.`, `You can sell up to ${quantity} shares.`)}</CairnStatus>}
    {!cashMode && !legacyUnit ? <p className={styles.note}>{t("정산액을 비우면 KRW·USD 현금은 미확인으로 남아요. 주식·ETF 평가액은 계속 볼 수 있어요.", "Without settlement, both KRW and USD cash remain unconfirmed. Stock and ETF values remain available.")}</p> : null}
    {!cashMode && consideration ? <div className={styles.executionTotal} aria-live="polite"><span>{t("총 체결금액", "Total consideration")}</span><strong>{exactTradeAmount(consideration.amount)} <small>{consideration.currency}</small></strong><span>{executionTotalMode ? t("입력한 체결금액 · 수수료·세금 제외", "Entered consideration · before fees and tax") : t("수량 × 단가 · 수수료·세금 제외", "Quantity × price · before fees and tax")}</span></div> : null}
    <details className={styles.options} open={cashMode || legacyUnit ? true : undefined}>
      <summary>{t("수수료·메모·정산", "Fees, memo & settlement")}<span>{t("선택", "Optional")}</span></summary>
      {!cashMode && !legacyUnit ? <p className={styles.note}>{t("원가·수익률은 체결금액 기준이에요.", "Cost and returns use execution consideration.")}</p> : null}
      {legacyUnit ? <p className={styles.note}>{t("이전 기록은 수량 × 단가로 현금을 정산한 거래입니다. 정정 시 기존 정산 방식을 유지합니다.", "This older record settled cash from quantity × price. Corrections preserve that original method.")}</p> : null}
      <div className={`${styles.tradeKinds} ${styles.tradeModeOptions}`} role="group" aria-label={t("정산 입력 방식", "Settlement input")}>
        <CairnButton variant="selection" type="button" aria-pressed={netMode} onClick={() => edit("inputMode", "net")}><span>{t("정산 금액", "Net settlement")}</span><small>{kind === "buy" ? t("실제 출금액 · 비용 포함", "Actual debit · includes costs") : t("실제 입금액 · 비용 차감 후", "Actual credit · after costs")}</small></CairnButton>
        <CairnButton variant="selection" type="button" aria-pressed={cashMode && !netMode} onClick={() => edit("inputMode", "total")}><span>{t("체결 총액", "Gross total")}</span><small>{t("수수료·세금 제외", "Before fees and tax")}</small></CairnButton>
      </div>
      {cashMode ? <>
        <p className={styles.note}>{netMode
          ? kind === "buy" ? t("수수료·세금 포함 출금액이에요. 주문금액과 달라요.", "Actual debit including fees and tax, not the order budget.") : t("수수료·세금을 뺀 입금액이에요.", "Actual credit after fees and tax.")
          : t("수수료·세금 제외 금액과 결제 통화를 입력하세요.", "Enter the total before costs and its settlement currency.")}</p>
        <div className={styles.row}><CairnField error={requiredMessage(netMode ? "netTotal" : "total", "정산 금액을 입력해 주세요.", "Enter the settlement amount.")}>{netMode ? kind === "buy" ? t("실제 출금액", "Actual debit") : t("실제 입금액", "Actual credit") : t("체결 총액", "Gross total")}<MoneyInput name={netMode ? "netTotal" : "total"} aria-invalid={missing(netMode ? "netTotal" : "total") || undefined} aria-describedby={missing(netMode ? "netTotal" : "total") ? `${errorId}-${netMode ? "netTotal" : "total"}` : undefined} value={(netMode ? fields.netTotal : fields.total) ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit(netMode ? "netTotal" : "total", value)} required /></CairnField><CairnField>{t("결제 통화", "Settlement currency")}<CairnSelect className="cairn-form-select" value={settlementCurrency} onChange={event => edit("settlementCurrency", event.target.value)}><option>KRW</option><option>USD</option></CairnSelect></CairnField></div>
      </> : null}
      <div className={styles.grid}>{(["fee", "tax"] as const).map(key => <CairnField key={key} error={requiredMessage(key, "확인한 금액을 입력해 주세요. 없으면 0을 입력하세요.", "Enter the confirmed amount, or 0 if none.")}>{key === "fee" ? t("수수료", "Fee") : t("세금", "Tax")} · {settlementCurrency}<MoneyInput name={key} aria-invalid={missing(key) || undefined} aria-describedby={missing(key) ? `${errorId}-${key}` : undefined} value={fields[key] ?? ""} allowDecimals={settlementCurrency === "USD"} onValueChange={value => edit(key, value)} required={netMode} placeholder={netMode ? t("없으면 0", "0 if none") : t("모르면 비워두세요", "Leave blank if unknown")} /></CairnField>)}</div>
      <p className={styles.note}>{netMode ? t("정산액에 포함된 비용이에요. 없으면 0, 모르면 확인 후 입력해 주세요. 중복 차감하지 않아요.", "Costs already included in settlement. Enter 0 only if none; verify unknown costs. No double deduction.") : !cashMode && !legacyUnit ? t("정산액 없이 입력한 비용은 참고용이에요. 현금은 차감하지 않아요.", "Without settlement, costs are reference-only. Cash is unchanged.") : t("비용은 체결 총액에 별도로 반영해요. 모르면 비워 두세요.", "Costs apply separately from gross. Leave blank if unknown.")}</p>
      {fields.costsReset && <p className={styles.note} role="status">{t("통화가 바뀌었어요. 수수료·세금을 다시 확인해 주세요.", "Currency changed. Recheck fees and tax.")}</p>}
      {(cashMode || legacyUnit) ? <CairnButton variant="secondary" type="button" className={styles.secondary} onClick={() => edit("settlementMode", "none")}>{t("정산액 없이 체결만 기록", "Record execution without settlement")}</CairnButton> : null}
      <CairnField>{t("메모 · 선택", "Memo · optional")}<CairnInput maxLength={300} value={fields.memo ?? ""} onChange={event => edit("memo", event.target.value)} /></CairnField>
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
