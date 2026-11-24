"use client";

import { instrumentLabel } from "@/lib/instrument-display";
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { RecoveryJourneyLink } from '@/components/recovery/recovery-return';
import { contributionJourneyHref, type ContributionJourney } from '@/lib/contribution-journey';
import { betaHref } from '@/lib/cairn-v2/navigation';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, FormActions as CairnFormActions, Input, Status as CairnStatus, InfoDisclosure } from "@/components/cairn-ui";

import { ContributionOrderOptions } from "./contribution-order-options";
import { useContributionOrderPlan } from "./contribution-order-context";
import { validContributionOrderRule, validContributionWalletAmount, type ContributionOrderSettings } from "@/lib/cairn-v2/contribution-order-plan";
import {parseSaleExclusionKeys} from "@/lib/additional-contribution-sale-exclusions";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { PlannedTrades } from "@/components/additional-contribution/planned-trades";
import { parseContributionInput, parseMinimumBuyPct } from "@/lib/cairn-v2/planning-contract";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { requestKey, type BetaView } from "@/lib/cairn-v2/read-contract";
import { useBetaContext } from "./use-beta-context";
import { useBetaExistingCrudAvailable } from './beta-provider';
import { ContributionOrderPreview } from "./contribution-order-preview";
import { ContributionFundingBar } from "./contribution-funding-bar";
import { ContributionRuleReceipt } from "./contribution-rule-receipt";
import styles from "./beta.module.css";

import {AdditionalContributionAllocationTable} from "./reused/allocation-list";
import {MoneyInput} from "./reused/money-input";
import presentation from "./reused/contribution.module.css";

const krw = (value: number) => value.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
export { driftNumber, targetMessage } from "@/lib/cairn-v2/target-presentation";
import { driftNumber, targetMessage } from "@/lib/cairn-v2/target-presentation";
export { ContributionHome } from "./home-contribution";

export function TargetDetail({view}: {view: BetaView}) {
  const target = view.domain?.planning?.targets;
  const available = useBetaExistingCrudAvailable();
  return <div className={styles.planningDetail} data-target-state={target?.state ?? view.domain?.state}>
    {target?.state !== "ready" && <CairnStatus as="p" role="status" className={styles.muted}>{targetMessage(view)}</CairnStatus>}
    {target && target.state !== 'ready' && <RecoveryNotice beta allowResolve={available && Boolean(view.domain)} scope={target.provenance?.scopeKey} kind={target.state === 'missing' ? 'targets' : target.state === 'partial' ? 'market' : 'retry'} />}
    {target?.provenance && <InfoDisclosure summary="목표 기준"><p className={styles.muted}>{target.state === "ready" ? "승인 목표" : "목표 정책 조회 근거"} · revision {target.provenance.approvalRevision ?? "없음"} · 적용일 {target.provenance.effectiveServiceDate ?? "없음"} · 평가 기준일 {target.provenance.serviceDate}</p></InfoDisclosure>}
    {target?.maxDrift && <p className={styles.detailNumber}>{driftNumber(target.maxDrift.driftPct)}<small>%p</small></p>}
    <p className={styles.muted}>현재 비중과 목표의 차이 · %p</p>
    {target?.state === "ready" && target.rows.length > 0 && <div className={styles.planningTableViewport}><table className={styles.planningTable}><caption>승인 목표와 비교 가능한 현재 비중</caption><thead><tr><th>종목 · 계좌</th><th>현재</th><th>승인 목표</th><th>편차</th></tr></thead><tbody>{target.rows.map(row => <tr key={row.key}><th>{instrumentLabel(row)}<small>{instrumentLabel(row)} · {row.account} · {row.currency}{row.plannedOnly ? " · 미보유 계획" : ""}</small></th><td>{row.currentWeightPct.toFixed(2)}%</td><td>{row.effectiveTargetPct?.toFixed(2) ?? "—"}%</td><td>{driftNumber(row.driftPct, 2)}%p</td></tr>)}</tbody></table></div>}
  </div>;
}
export function ContributionDetail({view, context, onEdit, onCalculate}: {view: BetaView; context: BetaContext; onEdit?: (dirty: boolean) => void; onCalculate?: (amount: string, keys?: string[], minBuyPct?: string) => void}) {
  const inputId = useId();
  const { locale, t } = useI18n();
  const available = useBetaExistingCrudAvailable();
  const [, setContext] = useBetaContext(context);
  const submitted = typeof context.cashAmountKrw === "string" ? context.cashAmountKrw : "";
  const submittedFloor = typeof context.minBuyPct === "string" ? context.minBuyPct : "";
  const committedSale = parseSaleExclusionKeys(context.excludeSell);
  const committedKeys = committedSale.ok ? committedSale.keys : [];
  // A single URL parameter returns as a string, while the picker submits a list.
  const queryKey = requestKey(committedSale.ok
    ? { ...context, excludeSell: committedKeys.length ? committedKeys : undefined }
    : context);
  const [draft, setDraft] = useState({ key: queryKey, amount: submitted, keys: committedKeys, floor: submittedFloor });
  const amount = draft.key === queryKey ? draft.amount : submitted;
  const excludedSales = draft.key === queryKey ? draft.keys : committedKeys;
  const floor = draft.key === queryKey ? draft.floor : submittedFloor;
  const read = view.domain?.planning?.contribution;
  const {settings, setSettings} = useContributionOrderPlan(read?.orderBasis);
  const [orderDraft, setOrderDraft] = useState<{key: string; settings: ContributionOrderSettings} | null>(null);
  const orders = orderDraft?.key === queryKey ? orderDraft.settings : settings;
  const ordersChanged = orders !== settings;
  const [orderError, setOrderError] = useState("");
  const changedInputs = amount !== submitted || floor !== submittedFloor || JSON.stringify(excludedSales) !== JSON.stringify(committedKeys);
  const dirty = changedInputs || ordersChanged;
  const input = parseContributionInput(submitted);
  const pending = context.currency === "KRW" && input.state === "ready" &&
    (view.domain?.state === "loading" || (read != null && read.inputKrw !== input.amount));
  const result = !dirty && !pending && read?.state === "ready" ? read.result : null;
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [validate, setValidate] = useState(false);
  const showForm = !result || editorKey === queryKey;
  const invalid = validate && parseContributionInput(amount).state !== "ready";
  const invalidFloor = validate && !parseMinimumBuyPct(floor || undefined).ok;
  const receiptRef = useRef<HTMLHeadingElement>(null);
  const focusAfterCalculate = useRef<string | null>(null);

  useEffect(() => {
    if (result && !showForm && queryKey === focusAfterCalculate.current) {
      receiptRef.current?.focus();
      focusAfterCalculate.current = null;
    }
  }, [queryKey, result, showForm]);

  function edit(nextAmount: string, keys: string[], nextFloor = floor) {
    setDraft({ key: queryKey, amount: nextAmount, keys, floor: nextFloor });
    onEdit?.(ordersChanged || nextAmount !== submitted || nextFloor !== submittedFloor || JSON.stringify(keys) !== JSON.stringify(committedKeys));
  }

  function calculate(event: FormEvent) {
    event.preventDefault();
    if (parseContributionInput(amount).state !== "ready") {
      setValidate(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    const parsedFloor = parseMinimumBuyPct(floor || undefined);
    if (!parsedFloor.ok) {
      setValidate(true);
      document.getElementById(inputId + "-floor")?.focus();
      return;
    }
    const invalidOption = read?.orderOptions?.find(option => {
      const rule = orders.rules[option.key];
      return rule && !validContributionOrderRule(rule, option.currency, option.unit);
    });
    if (invalidOption) {
      setOrderError(t(`${invalidOption.label}의 주문 단위, 최소 매수액과 수수료를 확인해 주세요.`, `Check order increments, minimum purchase and fees for ${invalidOption.label}.`));
      return;
    }
    const invalidWallet = orders.useCashLimits && read?.orderOptions?.find(option =>
      option.canBuy && option.currency && option.unit && !validContributionWalletAmount(orders.cashByWallet[option.walletKey], option.currency));
    if (invalidWallet) {
      setOrderError(t(`${invalidWallet.accountName}의 ${invalidWallet.currency} 가용 현금을 확인해 주세요.`, `Check available cash in ${invalidWallet.currency} for ${invalidWallet.accountName}.`));
      return;
    }
    if (ordersChanged) setSettings(orders);
    setOrderDraft(null);
    setOrderError("");
    const minBuyPct = parsedFloor.value?.toString();
    const nextContext = { ...context, cashAmountKrw: amount, excludeSell: excludedSales.length ? excludedSales : undefined, minBuyPct };
    const nextKey = requestKey(nextContext);
    setDraft({ key: nextKey, amount, keys: excludedSales, floor: minBuyPct ?? "" });
    focusAfterCalculate.current = nextKey;
    setEditorKey(null);
    setValidate(false);
    onEdit?.(false);
    if (onCalculate) onCalculate(amount, excludedSales, minBuyPct);
    else setContext(nextContext);
  }

  const formatWon = (value: number) => locale === "en" ? `₩${krw(value)}` : `${krw(value)}원`;
  const journey: ContributionJourney = { scope: context.scope, amount, currency: "KRW", beta: true, excludeSell: excludedSales };
  const trades = result?.rows.map((row, index) => ({
    key: row.allocationKey ?? `${row.accountCode}:${row.ticker ?? row.name}:${index}`,
    name: instrumentLabel(row), account: context.scope === "all" ? row.accountName : undefined,
    sell: row.trimAmountKrw, buy: row.allocationKrw,
  }));

  return <div className={`${styles.planningDetail} ${presentation.surface}`} data-contribution-state={pending ? "loading" : dirty ? "edited" : read?.state ?? view.domain?.state}>
    {showForm && !pending && <CairnForm className={presentation.form} noValidate onSubmit={calculate}>
      <CairnField htmlFor={inputId}>{t("얼마를 더 투자할까요?", "How much will you add?")}</CairnField>
      <div className={presentation.amountInput}>
        <MoneyInput presentation="amount" data-long={amount.length > 9} id={inputId} name="cashAmountKrw"
          aria-label={t("신규 투자금", "New investment")} autoComplete="off" value={amount}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? inputId + "-error" : undefined}
          placeholder={t("금액 입력", "Enter amount")} onValueChange={value => edit(value, excludedSales)} />
        <span>{t("원", "KRW")}</span>
      </div>
      {invalid && <p role="alert" id={inputId + "-error"}>{t("1원부터 1,000억 원까지 원 단위로 입력해 주세요.", "Enter a whole amount from ₩1 to ₩100 billion.")}</p>}
      <div className={presentation.presets} role="group" aria-label={t("투입 금액 빠른 선택", "Investment presets")}>
        {[1000000, 3000000, 5000000, 10000000].map(value => <CairnButton variant="bare" type="button"
          key={value} aria-pressed={amount === String(value)}
          onClick={() => { edit(String(value), excludedSales); document.getElementById(inputId)?.focus(); }}>
          {locale === "en" ? `₩${value / 1000000}M` : `${value / 10000}만`}
        </CairnButton>)}
      </div>
      <div className={presentation.floorInput}>
        <CairnField htmlFor={inputId + "-floor"}>{t("이번 계산의 최소 매수비율 (%)", "Minimum buy ratio for this calculation (%)")}</CairnField>
        <Input id={inputId + "-floor"} inputMode="decimal" autoComplete="off" placeholder={t("저장된 설정", "Saved setting")}
          value={floor} onChange={event => edit(amount, excludedSales, event.target.value)}
          aria-invalid={invalidFloor || undefined} aria-describedby={inputId + "-floor-help"} />
        <p id={inputId + "-floor-help"}>{invalidFloor
          ? t("0~100 사이의 비율을 소수 둘째 자리까지 입력해 주세요.", "Enter 0–100 with up to two decimal places.")
          : t("비워 두면 저장된 설정을 사용해요. 적격 종목에 추가 배분할 때 쓰는 기준이에요.", "Leave blank to use your saved setting. This guides top-ups to eligible holdings.")}</p>
      </div>
      <ContributionOrderOptions options={read?.orderOptions ?? []} settings={orders} excluded={excludedSales}
        onSettings={next => {
          setOrderDraft({key:queryKey, settings:next});
          setOrderError("");
          onEdit?.(true);
        }}
        onExclude={keys => edit(amount, keys)} />
      {orderError && <CairnStatus role="alert">{orderError}</CairnStatus>}
      <CairnFormActions className={presentation.submitRow}>
        <CairnButton variant="primary" className={presentation.calculate} type="submit" disabled={context.currency !== "KRW"}>{t("배분 계산", "Calculate allocation")}</CairnButton>
        {read?.state === "ready" && <CairnButton variant="bare" type="button" onClick={() => {
          edit(submitted, committedKeys, submittedFloor);
          setOrderDraft(null);
          setOrderError("");
          onEdit?.(false);
          setValidate(false);
          setEditorKey(null);
          focusAfterCalculate.current = queryKey;
        }}>{t("취소", "Cancel")}</CairnButton>}
      </CairnFormActions>
    </CairnForm>}

    {context.currency !== "KRW" ? <CairnStatus as="p" role="status" className={styles.muted}>{t("이 화면에서 계산하려면 표시 통화를 원화로 바꿔 주세요.", "Switch the display currency to KRW to calculate here.")}</CairnStatus>
      : pending ? <CairnStatus as="p" role="status" className={styles.muted}>{t(`${formatWon(input.amount!)} 배분을 계산 중이에요.`, `Calculating the allocation for ${formatWon(input.amount!)}.`)}</CairnStatus>
      : (read?.state === "blocked" || read?.state === "unavailable") ? <RecoveryNotice beta allowResolve={available && context.mode === "domain"} scope={context.scope} reasons={read.blockers} kind={read.state === "unavailable" ? "retry" : undefined} returnHref={betaHref("/beta", { ...context, cashAmountKrw: amount, excludeSell: excludedSales }) + "#beta-contribution"} />
      : !dirty && !result && read?.state !== "idle" && <CairnStatus as="p" role="status" className={styles.muted}>{read?.message ?? t("계산 조건 확인 중", "Checking inputs")}</CairnStatus>}

    {!showForm && result && trades && <>
      <div className={presentation.receiptHead}>
        <h3 ref={receiptRef} tabIndex={-1} className={styles.visuallyHidden}>{t("예상 배분", "Projected allocation")}</h3>
        <span>{t("새 투자금", "New investment")} <strong>{formatWon(result.cashAmountKrw)}</strong>{excludedSales.length > 0 && ` · ${t(`매도 제외 ${excludedSales.length}건`, `${excludedSales.length} excluded from sales`)}`}</span>
        <CairnButton type="button" variant="bare" onClick={() => {
          setEditorKey(queryKey);
          requestAnimationFrame(() => document.getElementById(inputId)?.focus());
        }}>{t("조건 변경", "Edit inputs")}</CairnButton>
      </div>
      <ContributionFundingBar result={result} basis={read?.orderBasis} presentation="strategy" />

      <ContributionRuleReceipt result={result} basis={read?.orderBasis} showAccount={context.scope === "all"} formatWon={formatWon}
        onEditRatio={() => {
          setEditorKey(queryKey);
          requestAnimationFrame(() => document.getElementById(inputId + "-floor")?.focus());
        }} />
      {read?.orderBasis && <details className={presentation.evidence}>
        <summary>{t("주문 수량·예상 비용", "Order quantities and fees")}</summary>
        <ContributionOrderPreview basis={read.orderBasis} preview={result} formatWon={formatWon}
          onIncludeCash={updated => {
            onEdit?.(false);
            if (onCalculate) onCalculate(updated, committedKeys, submittedFloor || undefined);
            else setContext({...context,cashAmountKrw:updated});
          }} />
      </details>}
      {result.totalTrimProceedsKrw > 0 && <details className={presentation.evidence}>
        <summary>{t("매도 계획과 재투자 배분", "Planned sales and reinvestment")}</summary>
        <PlannedTrades rows={trades} totalSell={result.totalTrimProceedsKrw} totalBuy={result.totalAllocatedKrw}
          available={result.totalAvailableFundsKrw} remainingCash={result.residualCashKrw} formatAmount={formatWon} english={locale === "en"} />
      </details>}
      {available && <nav className={presentation.resultActions} aria-label={t("투자 계획 이어가기", "Continue your plan")}>
        <RecoveryJourneyLink className={presentation.primaryLink} prefetch={false} href={contributionJourneyHref("plan", journey)}>
          {t("계획 편집기 열기", "Open plan editor")} <span aria-hidden="true">→</span>
        </RecoveryJourneyLink>
        <details>
          <summary>{t("다른 작업", "More actions")}</summary>
          <div>
            <RecoveryJourneyLink prefetch={false} href={contributionJourneyHref("compare", journey)}>{t("새 투자금 배분 비교", "Compare new-money allocations")}</RecoveryJourneyLink>
            <RecoveryJourneyLink prefetch={false} href={contributionJourneyHref("tracking", journey)}>{t("저장한 배분안 보기", "View saved allocations")}</RecoveryJourneyLink>
          </div>
        </details>
      </nav>}
      <details className={presentation.evidence}>
        <summary>{t("전체 비중 비교와 계산 기준", "All weights and calculation basis")}</summary>
        <AdditionalContributionAllocationTable preview={result} />
        <p>{result.policyLabel} · {result.policyVersion}
          {read?.approvalRevision != null && ` · ${t("승인", "Revision")} ${read.approvalRevision}`}
          {result.source === "legacy_account_policy" && ` · ${t("기존 계좌 정책", "Legacy account policy")}`}
        </p>
        <p>{t("적용일", "Effective date")} {result.effectiveServiceDate ?? "—"} · {t("평가 기준일", "Valuation date")} {result.serviceDate}</p>
        <p>{t("투입 후 비중은 남는 현금을 포함한 총액을 기준으로 계산해요.", "Weights use the projected total including remaining cash.")} {formatWon(result.postTopupTotalKrw)}</p>
        <p>{t("이 표의 목표 배분은 수량 조정 전 기준이에요.", "This table shows target amounts before order sizing.")}</p>
        {view.domain?.planning?.targets.rows.some(row => row.plannedOnly) && <p>{t("미보유 계획 종목은 현재 보유액 0으로 계산합니다.", "Planned holdings start with zero current value.")}</p>}
      </details>
    </>}
  </div>;
}
