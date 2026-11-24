"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Field, Form, Input, Status } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { instrumentLabel } from "@/lib/instrument-display";
import {
  displayOrderNativeAmount, type ContributionOrderBasis,
} from "@/lib/cairn-v2/contribution-order-plan";
import { parseContributionInput, type ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import { useContributionOrderPlan } from "./contribution-order-context";
import { formatBuyQuantity, formatOrderUnitPrice } from "./contribution-order-display";
import styles from "./contribution-order-preview.module.css";

export function ContributionOrderPreview({basis, preview, formatWon, onIncludeCash}: {
  basis: ContributionOrderBasis;
  preview: ReadyContribution;
  formatWon: (value: number) => string;
  onIncludeCash: (updatedTotal: string) => void;
}) {
  const {t} = useI18n();
  const {projection, settings} = useContributionOrderPlan(basis);
  const [message, setMessage] = useState("");
  const [additionalCash, setAdditionalCash] = useState("");
  const id = useId();
  const result = projection?.result;
  const orders = result && result.status !== "unavailable" ? result.orders.filter(row => row.principalMinor > 0) : [];
  const cappedOrders = result && result.status !== "unavailable" ? result.orders.filter(row => row.nextWholeOverCap) : [];
  const saleRows = projection?.sales ?? [];
  const rowsByKey = new Map(basis.rows.map(row => [row.key, row]));

  function quantityText(quantity: string | number, unit: "share" | "gram") {
    if (unit === "gram") return `${quantity}g`;
    return t(`${quantity}주`, `${quantity} shares`);
  }
  function includeCash(event: FormEvent) {
    event.preventDefault();
    const parsed = parseContributionInput(additionalCash.trim());
    const total = parsed.amount === null ? null : String(parsed.amount + preview.cashAmountKrw);
    if (total === null || parseContributionInput(total).state !== "ready") {
      setMessage(t("예비비를 뺀 금액을 원 단위로 입력해 주세요.", "Enter available cash after reserves in whole won."));
      return;
    }
    setAdditionalCash("");
    setMessage("");
    onIncludeCash(total);
  }

  return <section className={styles.orderPanel} aria-labelledby={id}>
    <div className={styles.head}>
      <h3 id={id}>{t("수량으로 환산한 주문", "Orders at executable sizes")}</h3>
      <span>{settings.useCashLimits ? t("입력한 통화별 잔액", "Entered cash by currency") : t("입력한 투자금 기준", "Based on entered funding")}</span>
    </div>
    {result && result.status !== "unavailable" ? <>
      <dl className={styles.totals}>
        <div><dt>{t("규칙 적용 후 주문 예산", "Order budget after rules")}</dt><dd>{formatWon(basis.budgetKrw)}</dd></div>
        <div><dt>{t("예상 매수 원금", "Estimated buy principal")}</dt><dd>{formatWon(result.principalKrw)}</dd></div>
        <div><dt>{t("예상 비용", "Estimated fees")}</dt><dd>{formatWon(result.feesKrw)}</dd></div>
        <div><dt>{t("주문 후 잔액", "Unspent order budget")}</dt><dd>{formatWon(result.remainingKrw)}</dd></div>
      </dl>
      {preview.totalTrimProceedsKrw > 0 && <p>{t(
        `전략 배분은 예상 매도대금 ${formatWon(preview.totalTrimProceedsKrw)}을 포함해요. 주문 예산은 새 투자금 한도에서 계산해요.`,
        `The allocation includes ${formatWon(preview.totalTrimProceedsKrw)} in projected sales. The order budget is capped at the entered funding.`
      )}</p>}
      {orders.length ? <ul className={styles.orderList}>{orders.map(order => {
        const row = rowsByKey.get(order.key)!;
        return <li key={row.key}><span>{instrumentLabel(row)}<small>{row.accountName}</small></span>
          <span>{formatBuyQuantity(order, row, t)}<small>{formatOrderUnitPrice(row, t)}</small>
            <small>{order.currency === "KRW" ? formatWon(order.principalKrw) : `USD ${displayOrderNativeAmount(order.principalMinor, "USD")} · ${formatWon(order.principalKrw)}`}</small></span></li>;
      })}</ul> : <p>{t("예산과 주문 조건에 맞는 매수 수량이 없어요.", "No buy size meets the budget and order terms.")}</p>}
      {result.remainingKrw > 0 && <p>{t(
        `주문 단위와 종목별 매수 상한, 수수료${settings.useCashLimits ? "·통화별 잔액" : ""}을 적용한 뒤 주문 예산에서 ${formatWon(result.remainingKrw)}이 남아요.`,
        `${formatWon(result.remainingKrw)} remains within the order budget after order increments, per-holding caps, fees${settings.useCashLimits ? " and currency balances" : ""}.`
      )}</p>}
      {result.remainingKrw > 0 && cappedOrders.length > 0 && <details className={styles.sales}>
        <summary>{t("한 단위 더 사면 상한을 넘는 종목", "Holdings where the next unit exceeds the cap")}</summary>
        <ul className={styles.orderList}>{cappedOrders.map(order => {
          const row = rowsByKey.get(order.key)!;
          const next = order.nextWholeOverCap!;
          return <li key={row.key}><span>{instrumentLabel(row)}<small>{row.accountName}</small></span>
            <span>{quantityText(next.quantity, row.unit)} · {formatWon(next.principalKrw)}
              <small>{t("매수 상한", "Buy cap")} {formatWon(next.maxPrincipalKrw)}</small></span></li>;
        })}</ul>
      </details>}
      {result.status === "approximate" && <Status as="p" role="status">{t("탐색 한도 안에서 찾은 주문 조합이에요.", "Best order combination found within the search limit.")}</Status>}
      {projection?.relaxed && <p>{t("예산과 잔액에 맞는 더 적은 정수 수량도 비교했어요.", "Smaller whole-unit orders were also considered to meet the cash limits.")}</p>}
    </> : <Status as="p" role="status">{t("계좌 잔액과 주문 단위를 확인해 주세요.", "Check the cash available and order increments.")}</Status>}
    {saleRows.length > 0 && <details className={styles.sales}><summary>{t("예상 매도 수량", "Estimated sale quantities")}</summary>
      <ul className={styles.orderList}>{saleRows.map(sale => {
        const row = rowsByKey.get(sale.key)!;
        return <li key={sale.key}><span>{instrumentLabel(row)}<small>{row.accountName}</small></span>
          <span>{quantityText(sale.quantity,row.unit)}<small>{formatWon(sale.principalKrw)}</small></span></li>;
      })}</ul><p>{t("설정한 매도 단위와 보유 수량을 적용했어요. 결제된 매도대금은 기존 현금에 더할 수 있어요.", "Estimated sales follow your sell increments and available holdings. You can add settled sale proceeds as available cash.")}</p>
    </details>}
    {basis.unavailable.length > 0 && <p>{t("주문 단가·단위 확인 필요", "Order prices or increments needed")} · {basis.unavailable.join(", ")}</p>}
    <p className={styles.basis}>{t("평가 단가와 환율 기준 · 기본 정수 주문 · 미입력 수수료 0 가정", "Uses valuation prices and FX · whole units by default · blank fees assumed zero")}</p>
    <details className={styles.settings}>
      <summary>{t("기존 현금 더하기", "Add available cash")}</summary>
      <Form className={styles.addCash} onSubmit={includeCash}>
        <NumericField label={t("예산에 더 쓸 기존 현금 (원)", "Existing cash to add (KRW)")} value={additionalCash} onChange={setAdditionalCash} />
        <Button type="submit" variant="secondary">{t("합산 후 다시 배분", "Add and reallocate")}</Button>
      </Form>
      {message && <Status as="p" role="status">{message}</Status>}
    </details>
  </section>;
}

function NumericField({label,value,onChange}: {label:string;value:string;onChange:(value:string)=>void}) {
  const id = useId();
  return <div className={styles.field}><Field htmlFor={id}>{label}</Field>
    <Input id={id} inputMode="decimal" autoComplete="off" value={value} maxLength={18} onChange={event => onChange(event.target.value)} />
  </div>;
}
