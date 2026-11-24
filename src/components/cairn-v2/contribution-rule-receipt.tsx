"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import type { SizedContributionOrder } from "@/lib/additional-contribution-order-sizing";
import type { ContributionOrderBasis } from "@/lib/cairn-v2/contribution-order-plan";
import type { ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import { instrumentLabel } from "@/lib/instrument-display";
import { useContributionOrderPlan } from "./contribution-order-context";
import { formatBuyQuantity, formatOrderUnitPrice } from "./contribution-order-display";
import styles from "./contribution-rule-receipt.module.css";

type Row = ReadyContribution["rows"][number];
type Rule = Row["ruleSteps"][number]["rule"];
type Translate = (ko: string, en: string) => string;
type Amount = (value: number) => string;
const ruleNames: Record<Rule, [string, string]> = {
  ma120: ["120일선 감액", "120-day MA adjustment"],
  fx: ["원·달러 환율", "USD/KRW"],
  rc: ["종목 위험 기여도", "Holding risk contribution"],
  regime: ["시장 국면", "Market conditions"],
  event: ["뉴스·이벤트", "News and events"],
  performance: ["성과 점검", "Performance"],
  minimum: ["최소 매수비율 보충", "Minimum-ratio top-up"],
};
const movingAverageReasons: Record<Row["maAdjustmentReason"], [string, string]> = {
  above_or_at_ma120: ["현재가가 120일선 이상", "Price at or above the 120-day MA"],
  below_ma120_buffer: ["120일선 하회 · 3% 이내 완충 구간", "Below the MA within the 3% buffer"],
  below_ma120_full_adjustment: ["120일선보다 3% 이상 낮아 전체 감액 적용", "At least 3% below the MA, full reduction applied"],
  asset_class_exempt: ["이동평균 조정 제외 자산", "Asset exempt from the MA adjustment"],
  asset_rule_disabled: ["이동평균 조정 꺼짐", "MA adjustment switched off"],
  evidence_unavailable: ["비교 가능한 120일선 자료 부족", "Comparable 120-day MA data unavailable"],
};
const saleReasons: Record<Row["trimReason"], [string, string]> = {
  eligible_overweight: ["목표 대비 초과 비중 매도", "Trim above target weight"],
  eligible_zero_target_exit: ["목표 비중 0%로 매도", "Sell at a 0% target"],
  not_overweight: ["매도 기준 비중 미만", "Below the sale threshold"],
  loss_position: ["평가손실로 매도 제외", "Sale excluded due to a loss"],
  target_zero_but_loss: ["목표 비중 0% · 평가손실로 매도 제외", "0% target · sale excluded due to a loss"],
  cost_basis_unavailable: ["매입원가 미확인으로 매도 제외", "Sale excluded without a verified cost basis"],
  target_zero_cost_basis_unavailable: ["목표 비중 0% · 매입원가 미확인으로 매도 제외", "0% target · sale excluded without a verified cost basis"],
  user_sale_excluded: ["사용자가 매도 제외", "Excluded from sales for this calculation"],
};
const fxReasons: Record<string, [string, string]> = {
  portfolio_fx_exposure_unclassified: ["계좌 내 일부 자산의 환노출 분류 미확인", "Currency exposure unclassified for some holdings"],
  fx_less_than_60_observations: ["환율 관측 60회 미만", "Fewer than 60 FX observations"],
  fx_stale_or_missing: ["최근 환율 자료 부족", "Recent FX data unavailable"],
  funding_currency_policy_undefined: ["투자금의 환율 기준 미확인", "No FX basis for this funding currency"],
  exposure_unclassified: ["종목의 환노출 분류 미확인", "Holding currency exposure unclassified"],
};
const multiple = (n: number) => "×" + n.toLocaleString("ko-KR", {minimumFractionDigits: 2, maximumFractionDigits: 4});
const signedAmount = (n: number, format: Amount) => (n > 0 ? "+" : n < 0 ? "−" : "") + format(Math.abs(n));

function evidenceForStep(rule: Rule, row: Row, result: ReadyContribution, t: Translate): string {
  const breakdown = row.modifierBreakdown;
  switch (rule) {
    case "ma120": {
      const ma = row.ma120Evidence;
      return [
        t(...movingAverageReasons[row.maAdjustmentReason]),
        ma.distanceFromMaPct == null ? "" : t(`120일선 대비 ${ma.distanceFromMaPct.toFixed(2)}%`, `${ma.distanceFromMaPct.toFixed(2)}% vs MA`),
        t(`기본 배분에 ${multiple(row.maEffectiveMultiplier)} 적용`, `Base allocation ${multiple(row.maEffectiveMultiplier)}`),
        ma.ma120 == null ? "" : t(`120일선 ${ma.ma120.toLocaleString("ko-KR", {maximumFractionDigits:4})} ${row.currency ?? ""}`, `MA ${ma.ma120.toLocaleString("en-US", {maximumFractionDigits:4})} ${row.currency ?? ""}`),
        ma.latestWindowPriceDate ?? "",
      ].filter(Boolean).join(" · ");
    }
    case "minimum":
      if (!result.modifierEvidence && !breakdown) return t("추가 배분 없음", "No top-up");
      if (breakdown?.topupEligible) return t(`보충 대상 · 우선점수 ${breakdown.topupScore}`, `Eligible · priority score ${breakdown.topupScore}`);
      return (breakdown?.topupBlockers ?? []).map(reason => {
        if (reason === "no_buy_allocation") return t("기본 매수 대상 아님", "No base buy allocation");
        if (reason === "target_gap_filled") return t("목표 부족액 소진", "Target gap filled");
        if (reason === "ma_not_eligible") return t("120일선 보충 조건 미달", "MA top-up condition unmet");
        if (reason === "penalty_below_threshold") return t("종합 매수 배수 0.85 미만", "Combined multiplier below 0.85");
        return t("보충 조건 미충족", "Top-up condition unmet");
      }).join(" · ") || t("추가 배분 없음", "No top-up");
  }
  const factor = breakdown?.multipliers[rule];
  if (factor?.status === "not_applicable") return t("적용 대상 아님", "Exempt");
  if (!factor || factor.status !== "ready") {
    const reason = rule === "fx" && factor?.reason && fxReasons[factor.reason];
    return reason ? t(...reason) : t("자료 부족 · 배수 미적용", "Insufficient evidence · no adjustment");
  }
  const fx = result.modifierEvidence?.fx;
  if (rule === "fx" && fx?.status === "ready") {
    return [multiple(factor.value),
      fx.value.trendMult == null ? "" : t(`환율 추세 ${multiple(fx.value.trendMult)}`, `FX trend ${multiple(fx.value.trendMult)}`),
      fx.value.percentile == null ? "" : t(`최근 ${fx.value.percentileLookback ?? fx.value.observationCount}개 환율 중 ${Math.round(fx.value.percentile)}백분위`, `Percentile ${Math.round(fx.value.percentile)} over ${fx.value.percentileLookback ?? fx.value.observationCount} FX observations`),
    ].filter(Boolean).join(" · ");
  }
  return multiple(factor.value);
}

function AllocationRow({row, result, showAccount, formatWon, quote, order, sizingIssue}: {
  row: Row; result: ReadyContribution; showAccount: boolean; formatWon: Amount;
  quote?: ContributionOrderBasis["rows"][number]; order?: SizedContributionOrder; sizingIssue: string;
}) {
  const { t } = useI18n();
  const steps = row.ruleSteps ?? [];
  const topup = steps.find(step => step.rule === "minimum")?.deltaKrw ?? 0;
  const reduction = row.allocationKrw - topup - row.strategicAllocationKrw;
  const visibleSteps = steps.filter(step => step.rule === "ma120" || step.rule === "minimum" || step.deltaKrw !== 0);
  const neutralSteps = steps.filter(step => !visibleSteps.includes(step));
  const stepLine = (step: Row["ruleSteps"][number]) => <li key={step.rule}>
    <div><b>{t(...ruleNames[step.rule])}</b><small>{evidenceForStep(step.rule, row, result, t)}</small></div>
    <span>{signedAmount(step.deltaKrw, formatWon)}</span>
  </li>;
  return <details className={styles.holding}>
    <summary>
      <span className={styles.identity}><strong>{instrumentLabel(row)}</strong>{showAccount && <small>{row.accountName}</small>}</span>
      <span className={styles.base}><small>{t("기본", "Base")}</small>{formatWon(row.strategicAllocationKrw)}</span>
      <span className={styles.cut} data-changed={reduction !== 0}><small>{t("감액", "Reduction")}</small>{reduction ? signedAmount(reduction, formatWon) : "—"}</span>
      <span className={styles.extra} data-changed={topup > 0}><small>{t("보충", "Top-up")}</small>{topup ? signedAmount(topup, formatWon) : "—"}</span>
      <span className={styles.final}><small>{t("최종", "Final")}</small>{formatWon(row.allocationKrw)} <ChevronDown size={14} aria-hidden /></span>
      {row.allocationKrw > 0 && <span className={styles.order}>
        <span>{t("예상 매수", "Estimated buy")} <strong>{quote && order ? formatBuyQuantity(order, quote, t) : sizingIssue}</strong></span>
        {quote && <span>{formatOrderUnitPrice(quote, t)}</span>}
      </span>}
    </summary>
    <div className={styles.body}>
      <ol className={styles.steps}>{visibleSteps.map(stepLine)}</ol>
      {neutralSteps.length > 0 && <details className={styles.neutral}><summary>{t("그 밖의 적용 근거", "Other rule details")}</summary><ol className={styles.steps}>{neutralSteps.map(stepLine)}</ol></details>}
      {order && <p>{t("예상 매수 원금", "Estimated buy principal")} <b>{formatWon(order.principalKrw)}</b></p>}
      {(row.trimAmountKrw > 0 || row.trimReason !== "not_overweight") && <p>{t(...saleReasons[row.trimReason])} {row.trimAmountKrw > 0 && formatWon(row.trimAmountKrw)}</p>}
    </div>
  </details>;
}

export function ContributionRuleReceipt({result, basis, showAccount, formatWon, onEditRatio}: {
  result: ReadyContribution; basis?: ContributionOrderBasis; showAccount: boolean; formatWon: Amount; onEditRatio: () => void;
}) {
  const { t } = useI18n();
  const { projection } = useContributionOrderPlan(basis);
  const sizing = projection?.result;
  const orders = new Map(sizing && sizing.status !== "unavailable" ? sizing.orders.map(order => [order.key, order]) : []);
  const quotes = new Map(basis?.rows.map(row => [row.key, row]));
  const sizingIssue = sizing?.status === "unavailable" && sizing.reason === "no_feasible_combination"
    ? t("조건에 맞는 주문 조합 없음", "No feasible order combination")
    : t("주문 조건 확인 필요", "Check order terms");
  const ranked = result.rows.toSorted((a,b) => b.allocationKrw - a.allocationKrw || b.strategicAllocationKrw - a.strategicAllocationKrw);
  const active = ranked.filter(row => row.strategicAllocationKrw > 0 || row.allocationKrw > 0);
  const other = ranked.filter(row => row.strategicAllocationKrw === 0 && row.allocationKrw === 0);
  const base = ranked.reduce((sum,row) => sum + row.strategicAllocationKrw, 0);
  const extra = ranked.reduce((sum,row) => sum + (row.ruleSteps?.find(step => step.rule === "minimum")?.deltaKrw ?? 0), 0);
  const reduction = result.totalAllocatedKrw - base - extra;
  const renderHolding = (row: Row) => {
    const quote = quotes.get(row.allocationKey);
    const issue = !basis ? t("주문 기준 미확인", "Order basis unavailable")
      : !quote ? t("단가·환율·단위 확인 필요", "Check price, FX or unit") : sizingIssue;
    return <AllocationRow key={row.allocationKey} row={row} result={result} showAccount={showAccount} formatWon={formatWon}
      quote={quote} order={orders.get(row.allocationKey)} sizingIssue={issue} />;
  };
  return <section className={styles.receipt} aria-label={t("종목별 매수 배분", "Buy allocation by holding")}>
    <header className={styles.title}><h3>{t("종목별 매수 배분", "Buy allocation by holding")}</h3><strong>{formatWon(result.totalAllocatedKrw)}</strong></header>
    <dl className={styles.totals}>
      <div><dt>{t("기본 배분", "Base allocation")}</dt><dd>{formatWon(base)}</dd></div>
      <div><dt>{t("규칙 감액", "Reductions")}</dt><dd className={styles.cut} data-changed={reduction !== 0}>{signedAmount(reduction, formatWon)}</dd></div>
      <div><dt>{t("최소비율 보충", "Minimum top-up")}</dt><dd className={styles.extra} data-changed={extra > 0}>{signedAmount(extra, formatWon)}</dd></div>
    </dl>
    <div className={styles.floor}>
      <span>{t("최소 매수비율", "Minimum buy ratio")} <b>{result.calculationParameters.minimumExecutionRatioPct}%</b></span>
      <Button type="button" variant="bare" onClick={onEditRatio}>{t("비율 변경", "Edit ratio")}</Button>
    </div>
    {result.minimumExecutionEvidenceAvailable === false && <p className={styles.note}>{t("이 투자금 통화에는 최소비율 보충 기준이 없어요.", "No minimum top-up policy is available for this funding currency.")}</p>}
    {result.minimumExecutionEvidenceAvailable === true && !result.minimumExecutionSatisfied &&
      <p className={styles.note}>{t("보충 가능한 종목의 매수 한도까지 배분했어요.", "Eligible holdings have reached their top-up capacity.")}</p>}
    <div className={styles.tableHead} aria-hidden="true"><span>{t("종목", "Holding")}</span><span>{t("기본", "Base")}</span><span>{t("감액", "Reduction")}</span><span>{t("보충", "Top-up")}</span><span>{t("최종", "Final")}</span></div>
    <div className={styles.holdings}>{active.map(renderHolding)}</div>
    {other.length > 0 && <details className={styles.other}><summary>{t(`매수 배분이 없는 종목 ${other.length}개`, `Holdings without buys (${other.length})`)}</summary>{other.map(renderHolding)}</details>}
  </section>;
}
