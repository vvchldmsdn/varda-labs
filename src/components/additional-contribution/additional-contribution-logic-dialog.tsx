"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";
import { T } from "@/components/i18n/localized-text";
import { MethodDetails } from "@/components/explanations/method-details";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";


import { useEffect, useRef, useState } from "react";
import { Workflow, X } from "lucide-react";

import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";

export function AdditionalContributionLogicDialog({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  const pt = usePortfolioText();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    return acquireBodyScrollLock(document.body);
  }, [open]);
  const rows = preview.rows.toSorted(
    (left, right) =>
      right.trimAmountKrw - left.trimAmountKrw ||
      right.allocationKrw - left.allocationKrw ||
      left.name.localeCompare(right.name, "ko"),
  );

  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--brand)]"
        onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}
      >
        <Workflow size={16} aria-hidden="true" /> {" "}<PortfolioText ko={"계산 로직 보기"} />{" "}</button>

      <dialog
        ref={dialogRef}
        aria-labelledby="contribution-logic-title"
        className="varda-dialog fixed inset-0 m-auto max-h-[88dvh] w-[min(1160px,calc(100vw-24px))] overflow-hidden p-0"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="flex max-h-[88dvh] flex-col">
          <header className="varda-dialog-header flex shrink-0 items-start justify-between gap-5">
            <div>
              <p className="text-[11px] font-medium text-[var(--muted)]">CALCULATION LOGIC</p>
              <h2 id="contribution-logic-title" className="mt-1 text-xl font-medium">
                <PortfolioText ko={"이번 추가 투입안이 만들어진 과정"} />{" "}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                <PortfolioText ko={"실제 주문이 아닌 읽기 전용 계산입니다. 각 단계의 재원과 종목별 판단을 그대로 표시합니다."} />{" "}</p>
            </div>
            <button
              type="button"
              aria-label={pt("계산 로직 닫기")}
              className="varda-icon-button"
              onClick={() => dialogRef.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="varda-dialog-content min-h-0 overflow-y-auto overscroll-contain">
            <MethodDetails topic="contribution" />
            <section aria-labelledby="calculation-flow-title">
              <h3 id="calculation-flow-title" className="text-sm font-medium"><PortfolioText ko={"금액 흐름"} /></h3>
              <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-[var(--line)] bg-[var(--line)] sm:grid-cols-5">
                <FlowStep index="01" label="신규 투입금" value={formatKrw(preview.cashAmountKrw)} />
                <FlowStep index="02" label="계산상 매도" value={`+${formatKrw(preview.totalTrimProceedsKrw)}`} />
                <FlowStep index="03" label="매수 가능 재원" value={formatKrw(preview.totalAvailableFundsKrw)} />
                <FlowStep index="04" label="최종 매수 배분" value={formatKrw(preview.totalAllocatedKrw)} />
                <FlowStep index="05" label="남는 현금" value={formatKrw(preview.residualCashKrw)} />
              </div>
            </section>

            <section className="mt-5 grid gap-4 border-y border-[var(--line)] py-5 md:grid-cols-3">
              <PolicyFact
                label="1. 초과 종목 정리"
                value={`목표 대비 +${formatNumber(preview.calculationParameters.trimDriftThresholdPct)}% 이상`}
                detail={`투입 전 비중으로 초과 폭을 판단합니다. 원가 근거가 있고 평가손익이 0 이상인 종목만, 투입 후 총액 기준 목표비중의 ${formatNumber(preview.calculationPolicy.trimLandingTargetMultiplier * 100)}% 지점까지 계산상 매도합니다.`}
              />
              <PolicyFact
                label="2. 가격 추세 반영"
                labelEn="2. Price trend adjustment"
                value="목표 부족액을 조정해 다시 배분"
                valueEn="Adjust target gaps, then allocate"
                detail={preview.ma120Evidence.mode === "off" ? "추세 필터가 꺼져 있어 원래 목표비중을 사용합니다." : "MA120은 최근 120개 일별 가격의 평균입니다. 가격이 평균 아래이면 이번 계산의 목표액을 낮추고, 남은 부족액을 기준으로 재원을 나눕니다. 배율이 0.8이라고 최종 매수금이 반드시 20% 줄어드는 것은 아닙니다."}
                detailEn={preview.ma120Evidence.mode === "off" ? "The trend filter is off, so original target weights are used." : "MA120 is the average of the latest 120 daily price observations. Below that average, this calculation lowers the target value and allocates funds using the remaining gaps. A 0.8 multiplier does not guarantee a 20% cut in the final purchase amount."}
              />
              <PolicyFact
                label="3. 집행 참고기준"
                value={`${formatKrw(preview.minimumExecutionTargetKrw)} · ${preview.minimumExecutionSatisfied ? "충족" : "미충족"}`}
                detail={`매수 가능 재원의 ${formatNumber(preview.calculationParameters.minimumExecutionRatioPct)}%를 참고기준으로 확인합니다. 유효 목표 부족액이 작으면 미달할 수 있으며, 기준을 맞추기 위한 추가 매수는 하지 않습니다.`}
              />
            </section>

            <details className="border-b border-[var(--line)] pb-3 text-sm leading-7 text-[var(--muted)]">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-[var(--ink)]"><T ko="MA120 배율은 어떻게 쓰이나요?" en="How do MA120 multipliers work?" /></summary>
              <p><T ko="저장한 목표비중은 그대로 둡니다. 이번 매수 계획에서만 목표액을 낮춰 부족액을 다시 계산합니다. 부족한 금액이 여전히 매수 재원보다 크면 매수금이 그대로일 수 있고, 다른 종목의 배분은 늘어날 수 있습니다." en="Your saved target weights stay unchanged. Only the target value for this purchase plan is lowered, then the gap is recalculated. If the gap still exceeds available funds, the purchase amount may stay the same; other holdings may receive more." /></p>
              <div className="my-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs sm:text-sm">
                  <caption className="pb-2 text-left text-xs text-[var(--muted)]"><T ko="가격이 MA120보다 3% 이상 낮을 때의 목표액 배율" en="Target-value multipliers when the price is at least 3% below MA120" /></caption>
                  <thead><tr className="border-b border-[var(--line)]"><th scope="col" className="py-2 font-medium"><T ko="자산 성격" en="Asset class" /></th><th scope="col" className="py-2 text-right font-medium"><T ko="배율" en="Multiplier" /></th></tr></thead>
                  <tbody>{MA120_CLASS_EXPLANATIONS.map((item) => <tr key={item.key} className="border-b border-[var(--wash)]"><th scope="row" className="py-2 pr-3 font-normal"><T ko={item.ko} en={item.en} /></th><td className="py-2 text-right tabular-nums">{item.multiplier}</td></tr>)}</tbody>
                </table>
              </div>
              <p><T ko="평균선 바로 아래에서 갑자기 크게 바뀌지 않도록, 0~3% 아래 구간에서는 배율을 서서히 낮춥니다. 예를 들어 광범위 지수형은 평균선에서 1.0, 1.5% 아래에서 0.9, 3% 이상 아래에서 0.8입니다." en="Between 0% and 3% below the average, the multiplier decreases gradually. For a broad index holding, it is 1.0 at the average, 0.9 at 1.5% below, and 0.8 at 3% or more below." /></p>
              <p className="mt-2"><T ko="금·채권은 이 MA120 목표 조정에서 제외합니다. 예·적금, 연금형 자산 등 적용 제외 자산이나 규칙이 꺼진 종목도 배율 1.0을 사용합니다. 가격 근거가 부족하거나 맞지 않으면 목표를 임의로 낮추지 않습니다." en="Gold and bonds are exempt from this MA120 target adjustment. Exempt asset types such as savings, deposits and pension-type assets, or holdings with the rule disabled, also use 1.0. Missing or incompatible price evidence does not trigger a target reduction." /></p>
              <p className="mt-2"><T ko="예시: 새로 넣는 돈이 10만원이고 유일한 매수 후보의 조정 후 부족액이 34만원이면, 최종 매수금은 10만원입니다. 반대로 부족액이 재원보다 작으면 그 부족액까지만 배분하고 나머지는 현금으로 남깁니다." en="Example: with ₩100,000 available and an adjusted gap of ₩340,000 for the only purchase candidate, the final purchase remains ₩100,000. If the gap is smaller than the available funds, the purchase is capped at that gap and the rest stays in cash." /></p>
              <p className="mt-2 text-xs"><T ko="이 배율과 3% 구간은 기존 서비스에서 이어온 정책값입니다. 자산별 최적 배율이나 손실 방지 효과가 검증되었다는 뜻은 아닙니다. 금·채권의 적용 제외도 안전한 자산이라는 판정은 아닙니다." en="These multipliers and the 3% range are inherited policy settings, not proven optimal values or a guarantee against loss. Exemption does not mean that gold or bonds are risk-free." /></p>
            </details>

            <details className="border-b border-[var(--line)] pb-5 text-sm leading-7 text-[var(--muted)]">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-[var(--ink)]"><T ko="정확한 계산식과 조정 규칙" en="Exact formulas and adjustment rules" /></summary>
              <p><PortfolioText ko={"유효 목표액 = (현재 총평가액 + 신규 투입금) × 목표비중 × MA120 배율"} /></p>
              <p><PortfolioText ko={"종목별 부족액 = 유효 목표액 − 계산상 매도 후 평가액 (0 미만이면 0)"} /></p>
              <p><PortfolioText ko={"신규 투입금 + 계산상 매도대금을 부족액 비례로 배분합니다. 매도 종목은 다시 매수하지 않습니다. 원 단위 최대잔여 방식으로 결정하며 매도는 보유 평가액, 매수는 유효 부족액을 넘지 않습니다."} /></p>
              <p><PortfolioText ko={"목표 0% 종목도 손실이 아니고 원가 근거가 있을 때 정리합니다. 원 단위로 표현할 수 없는 1원 미만 평가액은 남을 수 있습니다. 수수료·세금·주문 단위는 반영하지 않은 금액 계획입니다."} /></p>
              <p><T ko="‘감액 종목 감소 합계’는 매수금이 줄어든 종목의 감소액을 합한 값입니다. 다른 종목으로 옮겨간 금액도 포함하므로, 총매수금 감소나 현금 증가와 같지는 않습니다." en="Total reductions across holdings sums decreases for holdings receiving less. It includes money reassigned to other holdings, so it is not the same as a decrease in total purchases or an increase in cash." /></p>
            </details>

            <details className="mt-4" aria-labelledby="holding-calculation-title">
              <summary className="min-h-11 cursor-pointer py-3">
                <div>
                  <h3 id="holding-calculation-title" className="text-sm font-medium"><PortfolioText ko={"종목별 계산 근거"} /></h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    <PortfolioText ko={"원래 목표로 계산한 금액과 MA120 반영 후 최종 금액을 함께 비교합니다."} />{" "}</p>
                </div>
                <span className="text-xs text-[var(--muted)]">{rows.length}<PortfolioText ko={"개 종목"} /></span>
              </summary>

              <div className="mt-3 overflow-x-auto border-y border-[var(--line)]">
                <table className="w-full min-w-[1080px] border-collapse text-sm">
                  <thead className="text-left text-[11px] font-medium text-[var(--muted)]">
                    <tr>
                      <th className="px-2 py-3"><PortfolioText ko={"종목"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"현재 → 목표"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"평가손익"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"계산상 매도"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"기본 매수안"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"MA 반영 목표"} /></th>
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"최종 결과"} /></th>
                      <th className="px-2 py-3"><PortfolioText ko={"판단 이유"} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.allocationKey ?? `${row.accountCode}:${row.market}:${row.currency}:${row.ticker ?? row.name}`} className="border-t border-[var(--wash)] align-top">
                        <td className="px-2 py-3">
                          <p className="font-medium">{row.name}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">{row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}</p>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums"><p>{formatPercent(row.currentWeightPct)} → {formatPercent(row.targetWeightPct)}</p><p className="mt-0.5 text-xs text-[var(--muted)]"><PortfolioText ko={row.driftRatioPct === null ? "목표 0%" : `드리프트 ${formatSignedPercent(row.driftRatioPct)}`} /></p></td>
                        <td className="px-2 py-3 text-right tabular-nums"><PortfolioText ko={row.unrealizedReturnPct === null ? "근거 없음" : formatSignedPercent(row.unrealizedReturnPct)} /></td>
                        <td className="px-2 py-3 text-right tabular-nums">{row.trimAmountKrw > 0 ? formatKrw(row.trimAmountKrw) : "-"}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{formatKrw(row.strategicAllocationKrw)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          <p>{formatPercent(row.effectiveTargetWeightPct)}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">× {formatNumber(row.maEffectiveMultiplier)}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]"><PortfolioText ko={"부족액"} />{" "}{formatKrw(row.baseNeedKrw)}</p>
                        </td>
                        <td className={`px-2 py-3 text-right font-medium tabular-nums ${actionTone(row.action)}`}><PortfolioText ko={actionLabel(row)} /></td>
                        <td className="max-w-[270px] px-2 py-3 text-xs leading-5 text-[var(--muted)]"><PortfolioText ko={decisionReason(row)} /><MaEvidenceDetails evidence={row.ma120Evidence} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <section className="mt-6 border-l-2 border-[var(--warning)] pl-4 text-sm">
              <h3 className="font-medium"><PortfolioText ko={"현재 계산 범위"} /></h3>
              <p className="mt-1 leading-6 text-[var(--muted)]">
                <T ko="목표비중과 현재 보유 상태, 확인된 가격 추세로 금액을 나눕니다. 현재가 시각이나 MA120 이력이 7일보다 오래되거나 검증되지 않으면 추세 감액을 적용하지 않습니다. 환율 전망·뉴스·금리·산업 전망을 자동 매수계수로 쓰지 않습니다. 시장·투입 가정에서 신규금 보류와 환율 변화를 기본안 옆에서 비교할 수 있습니다. 수수료·세금·실제 주문 단위는 포함하지 않습니다." en="Amounts use your targets, holdings and verified price trends. Trend reductions are skipped when the price timestamp or MA120 history is over seven days old or cannot be verified. FX forecasts, news, rates and industry outlooks are not automatic purchase multipliers. Market & cash assumptions lets you compare new-money reserves and FX changes alongside the base allocation. Fees, taxes and actual order sizes are excluded." /></p>
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}

function FlowStep({ index, label, value }: { index: string; label: string; value: string }) {
  return <div className="bg-[var(--paper)] px-4 py-4"><p className="text-[10px] text-[var(--faint)]">{index}</p><p className="mt-2 text-xs text-[var(--muted)]"><PortfolioText ko={label} /></p><p className="mt-1 font-medium tabular-nums"><PortfolioText ko={value} /></p></div>;
}

function PolicyFact({ detail, detailEn, label, labelEn, value, valueEn }: { detail: string; detailEn?: string; label: string; labelEn?: string; value: string; valueEn?: string }) {
  return <div><p className="text-xs font-medium text-[var(--muted)]"><PortfolioText ko={label} en={labelEn} /></p><p className="mt-2 font-medium"><PortfolioText ko={value} en={valueEn} /></p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted)]"><T ko="이 규칙 자세히 보기" en="About this rule" /></summary><p className="pb-3 text-sm leading-7 text-[var(--muted)]"><PortfolioText ko={detail} en={detailEn} /></p></details></div>;
}

// Display copy for the existing gyeol_fin_explainable_rebalance_v1 policy;
// these are target-value multipliers, never final-purchase guarantees.
const MA120_CLASS_EXPLANATIONS = [
  { key: "broad_index", ko: "광범위 지수형", en: "Broad index", multiplier: "0.8" },
  { key: "dividend_quality", ko: "배당·퀄리티형", en: "Dividend / quality", multiplier: "0.8" },
  { key: "large_growth", ko: "대형 성장형", en: "Large growth", multiplier: "0.7" },
  { key: "thematic", ko: "테마형", en: "Thematic", multiplier: "0.5" },
  { key: "other", ko: "기타·분류 미지정", en: "Other / unclassified", multiplier: "0.8" },
  { key: "defensive_gold", ko: "금 · MA120 조정 제외", en: "Gold · exempt from MA120 adjustment", multiplier: "1.0" },
  { key: "bond", ko: "채권 · MA120 조정 제외", en: "Bonds · exempt from MA120 adjustment", multiplier: "1.0" },
] as const;

function actionLabel(row: AdditionalContributionResultPreview["rows"][number]) {
  if (row.action === "trim") return `매도 ${formatKrw(row.trimAmountKrw)}`;
  if (row.action === "buy") return `매수 ${formatKrw(row.allocationKrw)}`;
  return "유지";
}

function actionTone(action: "buy" | "hold" | "trim") {
  return action === "buy" ? "text-[var(--brand)]" : action === "trim" ? "text-[var(--negative)]" : "text-[var(--muted)]";
}

function MaEvidenceDetails({ evidence }: { evidence: AdditionalContributionResultPreview["rows"][number]["ma120Evidence"] }) {
  const reasons = evidence.blockers ?? [];
  const stale = reasons.some((reason) => reason === "stale_comparison_price" || reason === "stale_history");
  const future = reasons.some((reason) => reason.startsWith("future_"));
  const timeMissing = reasons.some((reason) => reason.includes("price_time") || reason === "invalid_evaluation_time");
  return <div className="mt-2 text-[10px] leading-5">
    {stale ? <p className="text-[var(--warning)]"><T ko="관측이 7일보다 오래되어 추세 조정을 건너뛰었습니다." en="Trend adjustment skipped: an observation is more than seven days old." /></p> : null}
    {future ? <p className="text-[var(--warning)]"><T ko="판단 시점보다 미래인 관측은 사용하지 않습니다." en="Observations after the evaluation time are excluded." /></p> : null}
    {timeMissing ? <p className="text-[var(--warning)]"><T ko="가격의 실제 관측 시각을 확인하지 못했습니다." en="The actual price observation time could not be verified." /></p> : null}
    {evidence.latestWindowPriceDate ? <p>MA120 <T ko="이력 끝" en="history ends" /> {evidence.latestWindowPriceDate}</p> : null}
    {evidence.comparisonPriceAsOf ? <p><T ko="비교 가격 시각" en="Comparison price as of" /> {evidence.comparisonPriceAsOf}</p> : null}
  </div>;
}

function decisionReason(row: AdditionalContributionResultPreview["rows"][number]) {
  if (row.action === "trim") return row.trimReason === "eligible_zero_target_exit" ? "목표가 0%이고 원가가 확인되며 손실이 없어 원 단위로 정리합니다. 1원 미만 평가액은 남을 수 있습니다." : "원가 근거와 0 이상 손익을 확인했습니다. 투입 후 총액 기준 목표의 105%까지 계산상 매도합니다.";
  const reasons: string[] = [];
  if (row.trimReason === "loss_position" || row.trimReason === "target_zero_but_loss") reasons.push("손실 중이므로 매도하지 않습니다.");
  if (row.trimReason === "cost_basis_unavailable" || row.trimReason === "target_zero_cost_basis_unavailable") reasons.push("매입원가 근거가 없어 매도하지 않습니다.");
  if (row.maAdjustmentReason === "asset_class_exempt") reasons.push("MA120 감액 제외 자산입니다.");
  if (row.maAdjustmentReason === "asset_rule_disabled") reasons.push("추세 필터 또는 종목별 MA 규칙이 꺼져 있습니다.");
  if (row.maAdjustmentReason === "evidence_unavailable") reasons.push("MA120 근거가 없어 목표를 임의 감액하지 않습니다.");
  if (row.maAdjustmentReason === "below_ma120_full_adjustment" || row.maAdjustmentReason === "below_ma120_buffer") reasons.push(`MA120 배율 ${formatNumber(row.maEffectiveMultiplier)}을 반영했습니다.`);
  reasons.push(row.action === "buy" ? "계산상 매도 후 유효 목표 부족액에 비례해 매수금을 배분했습니다." : row.baseNeedKrw > 0 ? "부족액은 있으나 원 단위 상한과 재원 배분 결과 매수금이 없습니다." : "유효 목표 부족액이 없어 추가 매수하지 않습니다.");
  return reasons.join(" ");
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) { return `${formatNumber(value)}%`; }
function formatSignedPercent(value: number) { return `${value > 0 ? "+" : ""}${formatNumber(value)}%`; }
function formatNumber(value: number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value); }
