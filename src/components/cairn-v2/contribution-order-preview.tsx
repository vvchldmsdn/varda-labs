"use client";

import { useId, useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Form, Input, Select, Status } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { instrumentLabel } from "@/lib/instrument-display";
import {
  defaultContributionOrderRule, displayOrderNativeAmount, getContributionWallets, projectContributionOrderPlan,
  type ContributionOrderBasis, type ContributionOrderKind, type ContributionOrderRule,
} from "@/lib/cairn-v2/contribution-order-plan";
import { parseContributionInput } from "@/lib/cairn-v2/planning-contract";
import { useContributionOrderPlan } from "./contribution-order-context";
import styles from "./contribution-order-preview.module.css";

export function ContributionOrderPreview({basis, totalBudgetKrw, formatWon, onIncludeCash}: {
  basis: ContributionOrderBasis;
  totalBudgetKrw: number;
  formatWon: (value: number) => string;
  onIncludeCash: (updatedTotal: string) => void;
}) {
  const {t} = useI18n();
  const {projection, settings, setSettings} = useContributionOrderPlan(basis);
  const [draft, setDraft] = useState(settings);
  const [message, setMessage] = useState("");
  const [additionalCash, setAdditionalCash] = useState("");
  const id = useId();
  const result = projection?.result;
  const orders = result && result.status !== "unavailable" ? result.orders.filter(row => row.principalMinor > 0) : [];
  const buyRows = basis.rows.filter(row => row.targetKrw > 0);
  const saleRows = projection?.sales ?? [];
  const rowsByKey = new Map(basis.rows.map(row => [row.key, row]));

  function updateRule(key: string, values: Partial<ContributionOrderRule>) {
    setDraft(prev => ({...prev, rules: {...prev.rules, [key]: {...(prev.rules[key] ?? defaultContributionOrderRule), ...values}}}));
    setMessage("");
  }
  function updateSettings(event: FormEvent) {
    event.preventDefault();
    if (projectContributionOrderPlan(basis, draft).status === "invalid") {
      setMessage(t("소수점 주문 단위·최소 금액과 수수료 입력을 확인해 주세요.", "Check the fractional increment, minimum order and fee inputs."));
      return;
    }
    setSettings(draft);
    setMessage(t("주문 조건을 적용했어요.", "Order terms updated."));
  }

  function quantityText(quantity: string | number, unit: "share" | "gram") {
    if (unit === "gram") return `${quantity}g`;
    return t(`${quantity}주`, `${quantity} shares`);
  }
  function includeCash(event: FormEvent) {
    event.preventDefault();
    const parsed = parseContributionInput(additionalCash.trim());
    const total = parsed.amount === null ? null : String(parsed.amount + totalBudgetKrw);
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
      <h3 id={id}>{t("예상 주문", "Estimated orders")}</h3>
      <span>{settings.useCashLimits ? t("입력한 통화별 잔액", "Entered cash by currency") : t("입력한 투자금 기준", "Based on entered funding")}</span>
    </div>
    {result && result.status !== "unavailable" ? <>
      <dl className={styles.totals}>
        <div><dt>{t("주문 예산", "Order budget")}</dt><dd>{formatWon(basis.budgetKrw)}</dd></div>
        <div><dt>{t("매수 원금", "Buy principal")}</dt><dd>{formatWon(result.principalKrw)}</dd></div>
        <div><dt>{t("예상 비용", "Estimated fees")}</dt><dd>{formatWon(result.feesKrw)}</dd></div>
        <div><dt>{t("예산 잔액", "Budget remaining")}</dt><dd>{formatWon(result.remainingKrw)}</dd></div>
      </dl>
      {orders.length ? <ul className={styles.orderList}>{orders.map(order => {
        const row = rowsByKey.get(order.key)!;
        return <li key={row.key}><span>{instrumentLabel(row)}<small>{row.accountName}</small></span>
          <span>{order.quantity === null ? t("금액 주문", "Amount order") : quantityText(order.quantity, row.unit)}
            <small>{order.currency === "KRW" ? formatWon(order.principalKrw) : `USD ${displayOrderNativeAmount(order.principalMinor, "USD")} · ${formatWon(order.principalKrw)}`}</small></span></li>;
      })}</ul> : <p>{t("예산과 주문 조건에 맞는 매수 수량이 없어요.", "No buy size meets the budget and order terms.")}</p>}
      {result.status === "approximate" && <Status as="p" role="status">{t("시간 한도 내에 찾은 주문 조합이에요.", "Best order combination found within the search limit.")}</Status>}
      {projection?.relaxed && <p>{t("예산과 잔액에 맞는 더 적은 정수 수량도 비교했어요.", "Smaller whole-unit orders were also considered to meet the cash limits.")}</p>}
    </> : <Status as="p" role="status">{t("계좌 잔액과 주문 단위를 확인해 주세요.", "Check the cash available and order increments.")}</Status>}
    {saleRows.length > 0 && <details className={styles.sales}><summary>{t("예상 매도 수량", "Estimated sale quantities")}</summary>
      <ul className={styles.orderList}>{saleRows.map(sale => {
        const row = rowsByKey.get(sale.key)!;
        return <li key={sale.key}><span>{instrumentLabel(row)}<small>{row.accountName}</small></span>
          <span>{quantityText(sale.quantity,row.unit)}<small>{formatWon(sale.principalKrw)}</small></span></li>;
      })}</ul><p>{t("보유량 내 정수 수량만 표시해요. 결제된 매도대금은 아래 기존 현금 합산으로 반영할 수 있어요.", "Whole units are capped by holdings. Add settled sale proceeds through the existing cash control below.")}</p>
    </details>}
    {basis.unavailable.length > 0 && <p>{t("주문 단가·단위 확인 필요", "Order prices or increments needed")} · {basis.unavailable.join(", ")}</p>}
    <p className={styles.basis}>{t("평가 단가와 환율 기준 · 기본 정수 주문 · 미입력 수수료 0 가정", "Uses valuation prices and FX · whole units by default · blank fees assumed zero")}</p>
    <details className={styles.settings}>
      <summary>{t("소수점·수수료·현금 조건", "Fractional orders, fees and cash")}</summary>
      <Form onSubmit={updateSettings} className={styles.settingsForm}>
        <Field className={styles.cashToggle}><Checkbox checked={draft.useCashLimits} onChange={event => {
          setDraft({...draft, useCashLimits: event.target.checked}); setMessage("");
        }} />{t("실제 주문 가능액으로 제한", "Limit to available broker cash")}</Field>
        {draft.useCashLimits && <div className={styles.inputs}>
          {getContributionWallets(basis).map(wallet => <NumericField key={wallet.walletKey}
            label={`${wallet.accountName} · ${wallet.currency}`} value={draft.cashByWallet[wallet.walletKey] ?? ""}
            onChange={amount => {setDraft(prev => ({...prev, cashByWallet: {...prev.cashByWallet,[wallet.walletKey]:amount}})); setMessage("");}} />)}
          <p>{t("계좌·통화별 증권사 주문 가능액을 입력해 주세요. 빈 칸의 잔액은 사용하지 않아요.", "Enter broker buying power per account and currency. Blank balances are left unused.")}</p>
        </div>}
        {buyRows.map(row => {
          const rule = draft.rules[row.key] ?? defaultContributionOrderRule;
          const fractional = rule.kind !== "whole";
          const label = `${instrumentLabel(row)} · ${row.accountName}`;
          return <details key={row.key} className={styles.assetRule}><summary>{label} · {row.unit === "gram" ? "g" : fractional ? t("소수점", "Fractional") : t("정수", "Whole shares")}</summary>
            <div className={styles.inputs}>
              {row.unit === "share" && <Field>{t("주문 방식", "Order type")}<Select value={rule.kind} onChange={event => updateRule(row.key, {kind: event.target.value as ContributionOrderKind, step: "", minimum:""})}>
                <option value="whole">{t("정수 수량", "Whole shares")}</option>
                <option value="fractional-shares">{t("소수점 수량", "Fractional shares")}</option>
                <option value="fractional-amount">{t("소수점 금액", "Fractional amount")}</option>
              </Select></Field>}
              {fractional && <>
                <NumericField label={rule.kind === "fractional-shares" ? t("수량 단위", "Share increment") : t(`금액 단위 (${row.currency})`, `Amount increment (${row.currency})`)} value={rule.step} onChange={step => updateRule(row.key,{step})} />
                <NumericField label={t(`최소 주문액 (${row.currency})`, `Minimum order (${row.currency})`)} value={rule.minimum} onChange={minimum => updateRule(row.key,{minimum})} />
              </>}
              <NumericField label={t(`고정 수수료 (${row.currency})`, `Fixed fee (${row.currency})`)} value={rule.fee} onChange={fee => updateRule(row.key,{fee})} />
              <NumericField label={t("수수료율 (%)", "Fee rate (%)")} value={rule.feePct} onChange={feePct => updateRule(row.key,{feePct})} />
              <NumericField label={t(`최소 수수료 (${row.currency})`, `Minimum fee (${row.currency})`)} value={rule.minimumFee} onChange={minimumFee => updateRule(row.key,{minimumFee})} />
              <NumericField label={t("매수 상한 (원)", "Buy cap (KRW)")} value={rule.capKrw} onChange={capKrw => updateRule(row.key,{capKrw})} />
            </div>
            <p>{t("기존 배분 규칙의 매수 상한", "Existing allocation cap")} {formatWon(row.maxBuyKrw)}</p>
          </details>;
        })}
        <div><Button type="submit" variant="secondary">{t("주문 조건 적용", "Apply order terms")}</Button></div>
      </Form>
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
