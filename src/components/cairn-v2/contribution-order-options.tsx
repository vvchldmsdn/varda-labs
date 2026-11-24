"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { Button, Checkbox, Field, Input, Select } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import { SALE_EXCLUSION_LIMIT } from "@/lib/additional-contribution-sale-exclusions";
import { instrumentLabel } from "@/lib/instrument-display";
import {
  defaultContributionOrderRule, fractionalShareStep, withFractionalBuy,
  type ContributionOrderOption, type ContributionOrderRule, type ContributionOrderSettings,
} from "@/lib/cairn-v2/contribution-order-plan";
import styles from "./contribution-order-options.module.css";

function nameOf(option: ContributionOrderOption) {
  return instrumentLabel({ name: option.label, ticker: option.ticker, market: option.market });
}

function OptionCheck({ label, checked, disabled, name, value, onChange }: {
  label: string; checked: boolean; disabled?: boolean; name?: string; value?: string; onChange: (checked: boolean) => void;
}) {
  return <Field className={styles.check}>
    <Checkbox aria-label={label} name={name} value={value} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span aria-hidden="true"><Check size={14} strokeWidth={2.5} /></span>
  </Field>;
}

function NumericField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return <Field className={styles.field}>{label}
    <Input inputMode="decimal" value={value} maxLength={18} autoComplete="off" onChange={event => onChange(event.target.value)} />
  </Field>;
}

export function ContributionOrderOptions({options, settings, excluded, onSettings, onExclude}: {
  options: readonly ContributionOrderOption[]; settings: ContributionOrderSettings; excluded: readonly string[];
  onSettings: (settings: ContributionOrderSettings) => void; onExclude: (keys: string[]) => void;
}) {
  const {t} = useI18n();
  const id = useId();
  const [search, setSearch] = useState("");
  const [advancedKey, setAdvancedKey] = useState("");
  const editable = options.filter(option => option.canBuy && option.unit !== null && option.currency !== null);
  const active = editable.find(option => option.key === advancedKey) ?? editable[0];
  const activeRule = active && (settings.rules[active.key] ?? defaultContributionOrderRule);
  const wallets = [...new Map(editable.map(option => [option.walletKey, option])).values()];
  const excludedKeys = new Set(excluded);
  const query = search.trim().toLowerCase();
  const visible = options.filter(option => [nameOf(option), option.label, option.accountName, option.ticker].join(" ").toLowerCase().includes(query));
  const buyCount = options.filter(option => option.canBuy && option.unit === "share" && settings.rules[option.key] && settings.rules[option.key].kind !== "whole").length;
  const sellCount = options.filter(option => option.canSell && !excludedKeys.has(option.key) && option.unit === "share" && settings.rules[option.key]?.fractionalSell).length;

  function updateRule(key: string, patch: Partial<ContributionOrderRule>) {
    onSettings({ ...settings, rules: { ...settings.rules, [key]: { ...(settings.rules[key] ?? defaultContributionOrderRule), ...patch } } });
  }

  return <div className={styles.options}>
    <details className={styles.picker}>
      <summary>
        <span className={styles.summaryBody}><strong>{t("종목별 거래 설정", "Trading by holding")}</strong>
          <small>{t(`소수점 매수 ${buyCount} · 소수점 매도 ${sellCount} · 매도 제외 ${excludedKeys.size}`, `Fractional buys ${buyCount} · sells ${sellCount} · excluded ${excludedKeys.size}`)}</small></span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className={styles.content}>
        <p className={styles.hint}>{t(
          `증권사에서 가능한 소수점 매수·매도를 선택하세요. 기본 계산 단위는 ${fractionalShareStep}주예요. 배분을 계산하면 소수점 설정이 이 기기에 저장돼요.`,
          `Select the fractional buys and sells your broker supports. The default increment is ${fractionalShareStep} share. Calculating saves your fractional settings on this device.`
        )}</p>
        {options.length >= 8 && <Field className={styles.search}><Search size={15} aria-hidden="true" />
          <Input aria-label={t("종목·계좌 검색", "Search holdings or accounts")} type="search" value={search}
            placeholder={t("종목·계좌 검색", "Search holdings or accounts")} onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></Field>}
        {visible.length ? <table className={styles.table}>
          <thead><tr><th scope="col">{t("종목", "Holding")}</th><th scope="col">{t("소수점", "Fractional")}<br />{t("매수", "buy")}</th><th scope="col">{t("소수점", "Fractional")}<br />{t("매도", "sell")}</th><th scope="col">{t("매도", "Sale")}<br />{t("제외", "excluded")}</th></tr></thead>
          <tbody>{visible.map(option => {
            const {key} = option;
            const rule = settings.rules[key] ?? defaultContributionOrderRule;
            const label = nameOf(option);
            const identity = label + " · " + option.accountName;
            const canFraction = option.unit === "share" && option.currency !== null;
            const skip = excludedKeys.has(key);
            return <tr key={key}><th scope="row"><b>{label}</b><small>{option.accountName}{option.unit === "gram" && " · 1g"}</small></th>
              <td>{canFraction && option.canBuy ? <OptionCheck label={t(`${identity} 소수점 매수`, `${identity} fractional buy`)}
                checked={rule.kind !== "whole"} onChange={enabled => updateRule(key, withFractionalBuy(rule, enabled))} /> : <span aria-label={t("해당 없음", "Not applicable")}>—</span>}</td>
              <td>{canFraction && option.canSell ? <OptionCheck label={t(`${identity} 소수점 매도`, `${identity} fractional sell`)}
                checked={!skip && !!rule.fractionalSell} disabled={skip} onChange={enabled => updateRule(key, {fractionalSell: enabled})} /> : "—"}</td>
              <td>{option.canSell ? <OptionCheck name="excludeSell" value={key} label={t(`${identity} 매도 제외`, `${identity} exclude from sales`)} checked={skip}
                disabled={!skip && excludedKeys.size >= SALE_EXCLUSION_LIMIT}
                onChange={enabled => onExclude(enabled ? [...excluded, key].sort() : excluded.filter(selected => selected !== key))} /> : "—"}</td>
            </tr>;
          })}</tbody>
        </table> : <p role="status">{options.length ? t("검색 결과가 없어요.", "No matches.") : t("설정할 종목이 없어요.", "No holdings available to configure.")}</p>}
        {excludedKeys.size >= SALE_EXCLUSION_LIMIT && <p role="status">{t(`매도 제외는 최대 ${SALE_EXCLUSION_LIMIT}종목까지 선택할 수 있어요.`, `You can exclude up to ${SALE_EXCLUSION_LIMIT} holdings.`)}</p>}
        {excludedKeys.size > 0 && <Button variant="bare" type="button" className={styles.clearExclusions} onClick={() => onExclude([])}>
          {t("매도 제외 모두 해제", "Clear sale exclusions")}
        </Button>}
      </div>
    </details>
    {editable.length > 0 && <details className={styles.advanced}>
      <summary><SlidersHorizontal size={15} aria-hidden="true" /><span>{t("주문 단위·수수료·가용 현금", "Increments, fees and available cash")}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={styles.content}>
        {active && activeRule && <>
          <Field className={styles.field}>{t("주문 조건을 조정할 종목", "Holding to configure")}
            <Select value={active.key} onChange={event => setAdvancedKey(event.target.value)}>
              {editable.map(option => <option key={option.key} value={option.key}>{nameOf(option)} · {option.accountName}</option>)}
            </Select></Field>
          <div className={styles.grid}>
            {activeRule.kind !== "whole" && <>
              <Field className={styles.field}>{t("소수점 매수 방식", "Fractional buy type")}
                <Select value={activeRule.kind} onChange={event => {
                  const kind = event.target.value === "fractional-amount" ? "fractional-amount" : "fractional-shares";
                  updateRule(active.key, {kind, step: kind === "fractional-shares" ? fractionalShareStep : active.currency === "USD" ? "0.01" : "1"});
                }}>
                  <option value="fractional-shares">{t("수량 단위", "Share increment")}</option>
                  <option value="fractional-amount">{t("금액 단위", "Amount increment")}</option>
                </Select></Field>
              <NumericField label={activeRule.kind === "fractional-shares" ? t("매수 단위 (주)", "Buy increment (shares)") : t(`매수 단위 (${active.currency})`, `Buy increment (${active.currency})`)}
                value={activeRule.step} onChange={step => updateRule(active.key, {step})} />
            </>}
            <NumericField label={t(`최소 매수액 (${active.currency})`, `Minimum buy (${active.currency})`)} value={activeRule.minimum} onChange={minimum => updateRule(active.key, {minimum})} />
            <NumericField label={t("매수 상한 (원)", "Buy cap (KRW)")} value={activeRule.capKrw} onChange={capKrw => updateRule(active.key,{capKrw})} />
            <NumericField label={t(`고정 수수료 (${active.currency})`, `Fixed fee (${active.currency})`)} value={activeRule.fee} onChange={fee => updateRule(active.key,{fee})} />
            <NumericField label={t("수수료율 (%)", "Fee rate (%)")} value={activeRule.feePct} onChange={feePct => updateRule(active.key,{feePct})} />
            <NumericField label={t(`최소 수수료 (${active.currency})`, `Minimum fee (${active.currency})`)} value={activeRule.minimumFee} onChange={minimumFee => updateRule(active.key,{minimumFee})} />
          </div>
        </>}
        <Field className={styles.cashLimit} htmlFor={id}><Checkbox id={id} checked={settings.useCashLimits} onChange={event => onSettings({...settings, useCashLimits: event.target.checked})} />{t("계좌별 가용 현금으로 제한", "Limit buys by available cash")}</Field>
        {settings.useCashLimits && <><p className={styles.hint}>{t("비워 둔 계좌·통화 잔액은 0으로 계산해요.", "Blank balances count as zero.")}</p>
          <div className={styles.grid}>{wallets.map(wallet => <NumericField key={wallet.walletKey} label={`${wallet.accountName} · ${wallet.currency}`}
            value={settings.cashByWallet[wallet.walletKey] ?? ""} onChange={amount => onSettings({...settings, cashByWallet:{...settings.cashByWallet, [wallet.walletKey]:amount}})} />)}</div></>}
      </div>
    </details>}
  </div>;
}
