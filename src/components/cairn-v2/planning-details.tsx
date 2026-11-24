"use client";

import { instrumentLabel } from "@/lib/instrument-display";
import { RecoveryNotice } from '@/components/recovery/recovery-notice';
import { RecoveryJourneyLink } from '@/components/recovery/recovery-return';
import { contributionJourneyHref, type ContributionJourney } from '@/lib/contribution-journey';
import { betaHref } from '@/lib/cairn-v2/navigation';
import { Button as CairnButton, Field as CairnField, Form as CairnForm, FormActions as CairnFormActions, Status as CairnStatus, InfoDisclosure } from "@/components/cairn-ui";

import {SaleExclusionPicker} from "../sale-exclusion-picker";
import {parseSaleExclusionKeys} from "@/lib/additional-contribution-sale-exclusions";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/locale-provider";
import { PlannedTrades } from "@/components/additional-contribution/planned-trades";
import { parseContributionInput, type ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { requestKey, type BetaView } from "@/lib/cairn-v2/read-contract";
import { useBetaContext } from "./use-beta-context";
import { useBetaExistingCrudAvailable } from './beta-provider';
import { ContributionOrderPreview } from "./contribution-order-preview";
import styles from "./beta.module.css";

import {AdditionalContributionAllocationTable} from "./reused/allocation-list";
import {MoneyInput} from "./reused/money-input";
import presentation from "./reused/contribution.module.css";

type ReadyContributionRow = ReadyContribution["rows"][number];
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
export function ContributionDetail({view, context, onEdit, onCalculate}: {view: BetaView; context: BetaContext; onEdit?: (dirty: boolean) => void; onCalculate?: (amount: string,keys?:string[]) => void}) {
  const inputId = useId();
  const { locale, t } = useI18n();
  const available = useBetaExistingCrudAvailable();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [, setContext] = useBetaContext(context);
  const submitted = typeof context.cashAmountKrw === "string" ? context.cashAmountKrw : "";
  const committedSale = parseSaleExclusionKeys(context.excludeSell);
  const committedKeys = committedSale.ok ? committedSale.keys : [];
  // A single URL parameter returns as a string, while the picker submits a list.
  const queryKey = requestKey(committedSale.ok
    ? { ...context, excludeSell: committedKeys.length ? committedKeys : undefined }
    : context);
  const [draft, setDraft] = useState({ key: queryKey, amount: submitted, keys: committedKeys });
  const amount = draft.key === queryKey ? draft.amount : submitted;
  const excludedSales = draft.key === queryKey ? draft.keys : committedKeys;
  const dirty = amount !== submitted || JSON.stringify(excludedSales) !== JSON.stringify(committedKeys);
  const read = view.domain?.planning?.contribution;
  const input = parseContributionInput(submitted);
  const pending = context.currency === "KRW" && input.state === "ready" &&
    (view.domain?.state === "loading" || (read != null && read.inputKrw !== input.amount));
  const result = !dirty && !pending && read?.state === "ready" ? read.result : null;
  const [editorKey, setEditorKey] = useState<string | null>(null);
  const [validate, setValidate] = useState(false);
  const showForm = !result || editorKey === queryKey;
  const invalid = validate && parseContributionInput(amount).state !== "ready";
  const receiptRef = useRef<HTMLHeadingElement>(null);
  const focusAfterCalculate = useRef<string | null>(null);

  useEffect(() => {
    if (result && !showForm && queryKey === focusAfterCalculate.current) {
      receiptRef.current?.focus();
      focusAfterCalculate.current = null;
    }
  }, [queryKey, result, showForm]);

  function edit(nextAmount: string, keys: string[]) {
    setDraft({ key: queryKey, amount: nextAmount, keys });
    onEdit?.(nextAmount !== submitted || JSON.stringify(keys) !== JSON.stringify(committedKeys));
  }

  function calculate(event: FormEvent) {
    event.preventDefault();
    if (parseContributionInput(amount).state !== "ready") {
      setValidate(true);
      document.getElementById(inputId)?.focus();
      return;
    }
    const nextContext = { ...context, cashAmountKrw: amount, excludeSell: excludedSales.length ? excludedSales : undefined };
    focusAfterCalculate.current = requestKey(nextContext);
    setEditorKey(null);
    setValidate(false);
    onEdit?.(false);
    if (onCalculate) onCalculate(amount, excludedSales);
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
      <SaleExclusionPicker english={locale === "en"} options={read?.selectionRows ?? []} value={excludedSales} onChange={keys => edit(amount, keys)} />
      <CairnFormActions className={presentation.submitRow}>
        <CairnButton variant="primary" className={presentation.calculate} type="submit" disabled={context.currency !== "KRW"}>{t("배분 계산", "Calculate allocation")}</CairnButton>
        {read?.state === "ready" && <CairnButton variant="bare" type="button" onClick={() => {
          edit(submitted, committedKeys);
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
        <span>{t("새 투자금", "New money")} <strong>{formatWon(result.cashAmountKrw)}</strong>{excludedSales.length > 0 && ` · ${t(`매도 제외 ${excludedSales.length}건`, `${excludedSales.length} excluded from sales`)}`}</span>
        <CairnButton type="button" variant="bare" onClick={() => {
          setEditorKey(queryKey);
          requestAnimationFrame(() => document.getElementById(inputId)?.focus());
        }}>{t("조건 변경", "Edit inputs")}</CairnButton>
      </div>
      {read?.orderBasis && <ContributionOrderPreview basis={read.orderBasis} totalBudgetKrw={result.cashAmountKrw} formatWon={formatWon}
        onIncludeCash={updated => {
          onEdit?.(false);
          if (onCalculate) onCalculate(updated, committedKeys);
          else setContext({...context,cashAmountKrw:updated});
        }} />}
      {read?.orderBasis ? <details className={presentation.evidence}>
        <summary>{t("목표 배분과 매도 계획", "Target allocation and sale plan")}</summary>
        <PlannedTrades rows={trades} totalSell={result.totalTrimProceedsKrw} totalBuy={result.totalAllocatedKrw}
          available={result.totalAvailableFundsKrw} remainingCash={result.residualCashKrw} formatAmount={formatWon} english={locale === "en"} />
      </details> : <PlannedTrades rows={trades} totalSell={result.totalTrimProceedsKrw} totalBuy={result.totalAllocatedKrw}
        available={result.totalAvailableFundsKrw} remainingCash={result.residualCashKrw} formatAmount={formatWon} english={locale === "en"} />}
      {available && <nav className={presentation.resultActions} aria-label={t("투자 계획 이어가기", "Continue your plan")}>
        <RecoveryJourneyLink className={presentation.primaryLink} prefetch={false} href={contributionJourneyHref("plan", journey)}>
          {t("목표 배분으로 계획 만들기", "Create a plan from the target allocation")} <span aria-hidden="true">→</span>
        </RecoveryJourneyLink>
        <details>
          <summary>{t("다른 작업", "More actions")}</summary>
          <div>
            <RecoveryJourneyLink prefetch={false} href={contributionJourneyHref("compare", journey)}>{t("새 투자금 배분 비교", "Compare new-money allocations")}</RecoveryJourneyLink>
            <RecoveryJourneyLink prefetch={false} href={contributionJourneyHref("tracking", journey)}>{t("저장한 배분안 보기", "View saved allocations")}</RecoveryJourneyLink>
          </div>
        </details>
      </nav>}
      <details className={`${styles.planningEvidence} ${presentation.evidence}`} onToggle={event => {
        if (event.target === event.currentTarget) setEvidenceOpen(event.currentTarget.open);
      }}>
        <summary>{t("종목별 비중과 계산 근거", "Weights and calculation details")}</summary>
        {evidenceOpen && <>
          <div className={presentation.evidenceRows}>
            {result.rows.map((row, index) => <HoldingAllocationEvidence key={trades[index].key}
              row={row} fx={result.modifierEvidence?.fx} showAccount={context.scope === "all"} formatWon={formatWon} />)}
          </div>
          <details>
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
      </details>
    </>}
  </div>;
}

function HoldingAllocationEvidence({ row, fx, showAccount, formatWon }: {
  row: ReadyContributionRow;
  fx?: NonNullable<ReadyContribution["modifierEvidence"]>["fx"];
  showAccount: boolean;
  formatWon: (amount: number) => string;
}) {
  const { t } = useI18n();
  const ma = row.ma120Evidence;
  const breakdown = row.modifierBreakdown;
  const fxFactor = breakdown?.multipliers.fx;
  const formatMultiplier = (value: number) => "×" + value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const formatPercent = (value: number) => (value > 0 ? "+" : "") + value.toFixed(2) + "%";
  const currencyPrice = ma.ma120 != null ? `${ma.ma120.toLocaleString("ko-KR", { maximumFractionDigits: 4 })} ${row.currency ?? ""}` : null;
  const factorText = fxFactor?.status === "ready" ? formatMultiplier(fxFactor.value) :
    fxFactor?.status === "not_applicable" ? t("적용 제외", "Exempt") : t("미적용", "Not applied");
  return <details className={presentation.holdingEvidence}>
    <summary>
      <span>{instrumentLabel(row)}{showAccount && <small>{row.accountName}</small>}</span>
      <strong>{row.trimAmountKrw > 0 ? t("매도", "Sell") + " " + formatWon(row.trimAmountKrw) :
        row.allocationKrw > 0 ? t("매수", "Buy") + " " + formatWon(row.allocationKrw) : t("유지", "Hold")}</strong>
    </summary>
    <dl className={presentation.evidenceFactors}>
      <div>
        <dt>{t("120일 이동평균 · 목표 비중", "120-day MA · Target weight")}</dt>
        <dd><strong>{formatMultiplier(row.maEffectiveMultiplier)}</strong>
          <span>{t(...movingAverageReasons[row.maAdjustmentReason])}
            {ma.distanceFromMaPct != null && ` · ${formatPercent(ma.distanceFromMaPct)}`}</span>
          {currencyPrice && <small>{t("이동평균", "Moving average")} {currencyPrice}
            {ma.latestWindowPriceDate ? ` · ${ma.latestWindowPriceDate}` : ""}</small>}
          <small>{row.targetWeightPct.toFixed(2)}% → {row.effectiveTargetWeightPct.toFixed(2)}%</small>
        </dd>
      </div>
      <div>
        <dt>{t("원·달러 환율 · 매수 배수", "USD/KRW · Buy multiplier")}</dt>
        <dd><strong>{factorText}</strong>
          {fxFactor?.status === "ready" && fx?.status === "ready" ? <>
            <span>{fx.value.percentile != null && fx.value.percentileLookback != null
              ? t(`최근 ${fx.value.percentileLookback}개 환율 중 ${fx.value.percentile.toFixed(0)}백분위`,
                `${fx.value.percentile.toFixed(0)}th percentile across the last ${fx.value.percentileLookback} observations`)
              : t(`환율 관측 ${fx.value.observationCount}개`, `${fx.value.observationCount} FX observations`)}</span>
            <small>{fx.value.trendMult != null && `${t("환율 추세", "FX trend")} ${formatMultiplier(fx.value.trendMult)} · `}
              {t("환율 기준 배수", "Base FX multiplier")} {formatMultiplier(fx.value.multiplier)}</small>
          </> : <span>{fxFactor?.status === "not_applicable"
            ? t("국내 자산·환헤지 정책 적용", "Domestic or currency-hedged exposure")
            : t("이 종목에 적용된 환율 조정 없음", "No FX adjustment applied to this holding")}</span>}
        </dd>
      </div>
    </dl>
    <dl className={presentation.evidenceAmounts}>
      <div><dt>{t("현재 평가액", "Current value")}</dt><dd>{formatWon(row.currentValueKrw)}</dd></div>
      <div><dt>{t("기본 매수 배분", "Base buy allocation")}</dt><dd>{formatWon(row.rawAllocationKrw ?? row.strategicAllocationKrw)}</dd></div>
      {breakdown && <div><dt>{t("감액 후 / 추가 배분", "After reductions / Top-up")}</dt><dd>{formatWon(breakdown.penalizedAllocationKrw)} / {formatWon(breakdown.topupAllocationKrw)}</dd></div>}
      <div><dt>{t("투입 후 비중", "Projected weight")}</dt><dd>{row.postTopupWeightPct.toFixed(2)}%</dd></div>
    </dl>
    <p>{t(...saleReasons[row.trimReason])}
      {row.unrealizedReturnPct != null && ` · ${t("미실현 수익률", "Unrealized return")} ${formatPercent(row.unrealizedReturnPct)}`}</p>
  </details>;
}

const saleReasons: Record<ReadyContributionRow["trimReason"], [string, string]> = {
  eligible_overweight: ["매도 기준 비중에 도달", "Overweight sale threshold reached"],
  eligible_zero_target_exit: ["목표 비중 0%로 정리 대상", "Eligible for sale at a 0% target"],
  not_overweight: ["매도 기준 비중 미만", "Below the sale threshold"],
  loss_position: ["평가손실로 매도 제외", "Sale excluded due to a loss"],
  target_zero_but_loss: ["목표 비중 0% · 평가손실로 매도 제외", "0% target · sale excluded due to a loss"],
  cost_basis_unavailable: ["매입원가 미확인으로 매도 제외", "Sale excluded without a verified cost basis"],
  target_zero_cost_basis_unavailable: ["목표 비중 0% · 매입원가 미확인으로 매도 제외", "0% target · sale excluded without a verified cost basis"],
  user_sale_excluded: ["이번 계산에서 매도 제외로 선택", "Excluded from sales for this calculation"],
};
const movingAverageReasons: Record<ReadyContributionRow["maAdjustmentReason"], [string, string]> = {
  above_or_at_ma120: ["가격이 이동평균 이상", "Price at or above its moving average"],
  below_ma120_buffer: ["이동평균 아래 완충 구간", "Price in the moving-average buffer"],
  below_ma120_full_adjustment: ["이동평균 하락 조정 적용", "Full moving-average adjustment"],
  asset_class_exempt: ["이동평균 조정 제외 자산", "Asset exempt from moving-average adjustments"],
  asset_rule_disabled: ["이동평균 조정 꺼짐", "Moving-average adjustment off"],
  evidence_unavailable: ["이동평균 자료 부족", "Insufficient moving-average data"],
};
