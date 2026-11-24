"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/cairn-ui";
import { useI18n } from "@/components/i18n/locale-provider";
import type { ContributionOrderBasis } from "@/lib/cairn-v2/contribution-order-plan";
import type { ReadyContribution } from "@/lib/cairn-v2/planning-contract";
import { instrumentLabel } from "@/lib/instrument-display";
import { useContributionOrderPlan } from "./contribution-order-context";
import styles from "./contribution-rule-receipt.module.css";

type Row = ReadyContribution["rows"][number];
type Rule = Row["ruleSteps"][number]["rule"];
type Translate = (ko: string, en: string) => string;
type Amount = (value: number) => string;
const ruleNames: Record<Rule, [string, string]> = {
  ma120: ["120일선 반영 후 재배분", "Reallocation after 120-day MA"],
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

export function ContributionBudgetSteps({result, formatWon}: {result: ReadyContribution; formatWon: Amount}) {
  const {t} = useI18n();
  const deltas = new Map<Rule, number>();
  for (const row of result.rows) {
    for (const step of row.ruleSteps ?? []) deltas.set(step.rule, (deltas.get(step.rule) ?? 0) + step.deltaKrw);
  }
  const base = result.rows.reduce((sum, row) => sum + row.strategicAllocationKrw, 0);
  return <dl className={styles.bridge} aria-label={t("매수 배분의 변화", "Changes to the buy allocation")}>
    <div><dt>{t("목표 비중 기준 매수 배분", "Base buy allocation at target weights")}</dt><dd>{formatWon(base)}</dd></div>
    {[...deltas].filter(([,delta]) => delta !== 0).map(([rule, delta]) => <div key={rule}><dt>{t(...ruleNames[rule])}</dt>
      <dd data-direction={delta > 0 ? "up" : "down"}>{signedAmount(delta, formatWon)}</dd></div>)}
    <div><dt>{t("규칙 반영 후 매수 배분", "Buy allocation after rules")}</dt><dd>{formatWon(result.totalAllocatedKrw)}</dd></div>
  </dl>;
}

function evidenceForStep(rule: Rule, row: Row, result: ReadyContribution, t: Translate): string {
  const breakdown = row.modifierBreakdown;
  switch (rule) {
    case "ma120": {
      const ma = row.ma120Evidence;
      return [
        t(...movingAverageReasons[row.maAdjustmentReason]),
        ma.distanceFromMaPct == null ? "" : t(`120일선 대비 ${ma.distanceFromMaPct.toFixed(2)}%`, `${ma.distanceFromMaPct.toFixed(2)}% vs MA`),
        t(`목표 비중 ${row.targetWeightPct.toFixed(2)}% → ${row.effectiveTargetWeightPct.toFixed(2)}% (${multiple(row.maEffectiveMultiplier)})`,
          `Target ${row.targetWeightPct.toFixed(2)}% → ${row.effectiveTargetWeightPct.toFixed(2)}% (${multiple(row.maEffectiveMultiplier)})`),
        ma.ma120 == null ? "" : t(`120일선 ${ma.ma120.toLocaleString("ko-KR", {maximumFractionDigits:4})} ${row.currency ?? ""}`, `MA ${ma.ma120.toLocaleString("en-US", {maximumFractionDigits:4})} ${row.currency ?? ""}`),
        ma.latestWindowPriceDate ?? "",
      ].filter(Boolean).join(" · ");
    }
    case "minimum":
      if (!result.modifierEvidence) return t("참고 비율", "Reference ratio");
      if (result.effectiveMinimumRatioPct == null) return t("환율·시장 국면 근거 부족으로 보충 보류", "Top-up paused pending FX and market evidence");
      if (breakdown?.topupEligible) return t(`보충 대상 · 우선점수 ${breakdown.topupScore}`, `Eligible · priority score ${breakdown.topupScore}`);
      return (breakdown?.topupBlockers ?? []).map(reason => {
        if (reason === "no_buy_allocation") return t("기본 매수 대상 아님", "No base buy allocation");
        if (reason === "target_gap_filled") return t("목표 부족액 소진", "Target gap filled");
        if (reason === "ma_not_eligible") return t("120일선 보충 조건 미달", "MA top-up condition unmet");
        if (reason === "penalty_below_threshold") return t("종합 매수 배수 0.85 미만", "Combined multiplier below 0.85");
        const factor = reason.replace("_unavailable", "") as Exclude<Rule, "ma120" | "minimum">;
        return t(...ruleNames[factor]) + " " + t("자료 부족", "unavailable");
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

export function ContributionRuleReceipt({result, basis, showAccount, formatWon, onEditRatio}: {
  result: ReadyContribution; basis?: ContributionOrderBasis; showAccount: boolean; formatWon: Amount; onEditRatio: () => void;
}) {
  const {t} = useI18n();
  const {projection} = useContributionOrderPlan(basis);
  const sizing = projection?.result;
  const orders = sizing && sizing.status !== "unavailable" ? new Map(sizing.orders.map(order => [order.key, order.principalKrw])) : null;
  const quoted = new Set(basis?.rows.map(row => row.key));
  const ranked = result.rows.toSorted((a, b) =>
    Math.abs(b.allocationKrw - b.strategicAllocationKrw) - Math.abs(a.allocationKrw - a.strategicAllocationKrw) ||
    b.allocationKrw - a.allocationKrw);
  const floor = result.effectiveMinimumRatioPct;
  const evidence = result.modifierEvidence;
  const missing = [];
  if (evidence && evidence.fundingBasis !== "KRW") missing.push(t("투자금 통화 기준 미확인", "Funding currency basis unavailable"));
  if (evidence && evidence.fx.status !== "ready") missing.push(t(...(fxReasons[evidence.fx.reason] ?? ["환율 추세 자료 부족", "FX trend data unavailable"])));
  if (evidence && evidence.regime.status !== "ready") missing.push(t("확인된 시장 국면 자료 부족", "Market-regime data unavailable"));
  return <section className={styles.receipt} aria-label={t("매수 배분 근거", "Buy allocation rules")}>
    <div className={styles.floor}>
      <header><h3>{t("최소 매수비율", "Minimum buy ratio")}</h3>
        <Button type="button" variant="bare" onClick={onEditRatio}>{t("비율 변경", "Edit ratio")}</Button>
      </header>
      <div className={styles.pair}><strong>{result.calculationParameters.minimumExecutionRatioPct}%</strong>
        <span>{floor == null ? t("자동 보충 보류", "Automatic top-up paused")
          : !evidence ? t("참고 기준", "Reference only")
          : t(`적용 비율 ${floor}%`, `Effective ratio ${floor}%`)}</span></div>
      {floor == null ? <p>{missing.join(" · ") || t("자동 보충에 필요한 근거 부족", "Insufficient evidence to top up")}.</p>
        : <p>{t(`최소 매수 기준 ${formatWon(result.minimumExecutionTargetKrw)} · 전략 매수 배분 ${formatWon(result.totalAllocatedKrw)}`,
          `Minimum allocation target ${formatWon(result.minimumExecutionTargetKrw)} · planned buys ${formatWon(result.totalAllocatedKrw)}`)}
          {evidence && !result.minimumExecutionSatisfied && t(" · 적격 종목의 부족액 한도로 미달", " · limited by eligible target gaps")}</p>}
      {result.totalBuyCapacityKrw < result.totalAvailableFundsKrw && <p>{t(
        `조정된 목표 비중까지 살 수 있는 금액은 전체 ${formatWon(result.totalBuyCapacityKrw)}이에요.`,
        `Target-weight gaps cap total buys at ${formatWon(result.totalBuyCapacityKrw)}.`
      )}</p>}
      {evidence && floor != null && <p>{evidence.regime.status === "ready" && t(`시장 국면 ${evidence.regime.value}`, `Market regime ${({안정:"stable",주의:"caution",경계:"high risk"})[evidence.regime.value]}`)}
        {evidence.fx.status === "ready" && evidence.fx.value.hot && t(" · 환율 부담으로 10%p 추가 축소", " · elevated FX reduces the target another 10 pp")}</p>}
    </div>
    <header className={styles.title}><h3>{t("종목별 배분 근거", "Allocation by holding")}</h3>
      <p>{t("종목을 펼치면 어떤 규칙이 배분액을 바꿨는지 볼 수 있어요.", "Open a holding to see which rules changed its allocation.")}</p></header>
    <div className={styles.holdings}>{ranked.map(row => {
      const delta = row.allocationKrw - row.strategicAllocationKrw;
      const changes = row.ruleSteps?.filter(step => step.deltaKrw !== 0) ?? [];
      const ordered = orders && quoted.has(row.allocationKey) ? orders.get(row.allocationKey) ?? 0 : null;
      return <details className={styles.holding} key={row.allocationKey}>
        <summary><span className={styles.identity}><b>{instrumentLabel(row)}</b>{showAccount && <small>{row.accountName}</small>}
          <small>{changes.map(step => t(...ruleNames[step.rule])).join(" · ") || (row.trimAmountKrw > 0 ? t("매도 대상", "Planned sale") : t("매수 배분 증감 없음", "Buy allocation unchanged"))}</small>
        </span>
        <span className={styles.outcome}><b>{formatWon(row.allocationKrw)}</b>
          {delta !== 0 && <small data-direction={delta > 0 ? "up" : "down"}>{signedAmount(delta, formatWon)}</small>}</span>
        <ChevronDown size={16} aria-hidden /></summary>
        <div className={styles.body}>
          <dl className={styles.bounds}>
            <div><dt>{t("기본 매수 배분", "Base buy allocation")}</dt><dd>{formatWon(row.strategicAllocationKrw)}</dd></div>
            <div><dt>{t("규칙 반영 후", "After rules")}</dt><dd>{formatWon(row.allocationKrw)}</dd></div>
          </dl>
          {changes.some(step => step.rule === "ma120") && row.maEffectiveMultiplier === 1 && <p>{t(
            "다른 종목의 목표 비중이 조정되면서 남은 목표 부족액에 비례해 이 종목 배분도 달라졌어요.",
            "Changes to other holdings’ target weights changed this holding’s share of the remaining target gaps.")}</p>}
          <ol className={styles.steps}>{row.ruleSteps?.map(step => <li key={step.rule}>
            <div><strong>{t(...ruleNames[step.rule])}</strong><small>{evidenceForStep(step.rule, row, result, t)}</small></div>
            <div><b data-direction={step.deltaKrw > 0 ? "up" : step.deltaKrw < 0 ? "down" : undefined}>{signedAmount(step.deltaKrw, formatWon)}</b>
              {step.deltaKrw !== 0 && <small>{t("조정 후", "After")} {formatWon(step.afterKrw)}</small>}</div>
          </li>)}</ol>
          {ordered != null && <p>{t("주문 단위 적용 후 매수 원금", "Buy principal after order sizing")} <strong>{formatWon(ordered)}</strong></p>}
          <p>{t(`투입 후 예상 비중 ${row.postTopupWeightPct.toFixed(2)}%`, `Projected weight ${row.postTopupWeightPct.toFixed(2)}%`)} · {t(...saleReasons[row.trimReason])}
            {row.trimAmountKrw > 0 && " " + formatWon(row.trimAmountKrw)}</p>
        </div>
      </details>;
    })}</div>
  </section>;
}
