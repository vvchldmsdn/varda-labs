"use client";

import { PortfolioText, usePortfolioText } from "@/components/portfolio/portfolio-text";
import { T } from "@/components/i18n/localized-text";
import { MethodDetails } from "@/components/explanations/method-details";
import { acquireBodyScrollLock } from "@/lib/body-scroll-lock";


import { useEffect, useRef, useState } from "react";
import { Workflow, X } from "lucide-react";

import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";
import { Button as CairnButton, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";


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
      <CairnButton variant="secondary"
        type="button"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-[var(--brand)]"
        onClick={() => { dialogRef.current?.showModal(); setOpen(true); }}
      >
        <Workflow size={16} aria-hidden="true" /> {" "}<PortfolioText ko={"계산 로직 보기"} />{" "}</CairnButton>

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
              <CairnSectionTitle id="contribution-logic-title" className="mt-1 text-xl font-medium">
                <PortfolioText ko={"이번 추가 투입안이 만들어진 과정"} />{" "}</CairnSectionTitle>
              <p className="mt-1 text-sm text-[var(--muted)]">
                <PortfolioText ko={"실제 주문이 아닌 읽기 전용 계산입니다. 각 단계의 재원과 종목별 판단을 그대로 표시합니다."} />{" "}</p>
            </div>
            <CairnButton variant="ghost"
              type="button"
              aria-label={pt("계산 로직 닫기")}
              className="varda-icon-button"
              onClick={() => dialogRef.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </CairnButton>
          </header>

          <div className="varda-dialog-content min-h-0 overflow-y-auto overscroll-contain">
            <MethodDetails topic="contribution" />
            <section aria-labelledby="calculation-flow-title">
              <CairnSectionTitle level="h3" id="calculation-flow-title" className="text-sm font-medium"><PortfolioText ko={"금액 흐름"} /></CairnSectionTitle>
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
                value="기본 매수금액에 120일선 배수 적용"
                valueEn="Apply the trend multiplier to the base buy"
                detail={preview.ma120Evidence.mode === "off" ? "추세 필터가 꺼져 있어 기본 배분액을 그대로 사용합니다." : "승인 목표까지 부족한 금액에 비례해 기본 배분액을 구한 뒤, 가격이 120일선 아래인 종목은 이번 매수금액을 줄입니다."}
                detailEn={preview.ma120Evidence.mode === "off" ? "The trend filter is off. The base allocation goes through unchanged." : "First allocate by the gap to each approved target. Reduce this purchase if the price is below its 120-day average."}
              />
              <PolicyFact
                label="3. 최소매수비율"
                labelEn="3. Minimum buy ratio"
                value={preview.minimumExecutionEvidenceAvailable === false ? "근거 부족 · 미적용" : `${formatKrw(preview.minimumExecutionTargetKrw)} · ${preview.minimumExecutionSatisfied ? "충족" : "미충족"}`}
                valueEn={preview.minimumExecutionEvidenceAvailable === false ? "Missing evidence · not applied" : `${formatKrw(preview.minimumExecutionTargetKrw)} · ${preview.minimumExecutionSatisfied ? "Met" : "Not met"}`}
                detail={preview.modifierEvidence ? "감액 후 합계가 설정 비율에 못 미치면 적격 종목의 목표 부족액까지 보충합니다. 뉴스 등 시장 자료가 없으면 해당 배수는 1입니다." : `이번 기본 계획에서는 매수 가능 재원의 ${formatNumber(preview.calculationParameters.minimumExecutionRatioPct)}%를 참고기준으로 표시합니다.`}
                detailEn={preview.modifierEvidence ? "If the reduced total falls below the configured ratio, top up eligible holdings within their target gaps. Missing market factors use 1×." : `This base plan shows ${formatNumber(preview.calculationParameters.minimumExecutionRatioPct)}% of funds as a reference.`}
              />
            </section>

            <details className="border-b border-[var(--line)] pb-3 text-sm leading-7 text-[var(--muted)]">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-[var(--ink)]"><T ko="MA120 배율은 어떻게 쓰이나요?" en="How do MA120 multipliers work?" /></summary>
              <p><T ko="목표비중으로 기본 배분액을 먼저 구합니다. 배수가 0.8이면 기본 배분액의 80%가 다음 계산 단계로 넘어갑니다." en="Calculate the base buy from the target weight first. A 0.8 multiplier carries 80% of that buy into the next step." /></p>
              <div className="my-4 overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs sm:text-sm">
                  <caption className="pb-2 text-left text-xs text-[var(--muted)]"><T ko="가격이 120일선보다 3% 이상 낮을 때 기본 매수금액에 곱하는 배수" en="Base buy multipliers at least 3% below MA120" /></caption>
                  <thead><tr className="border-b border-[var(--line)]"><th scope="col" className="py-2 font-medium"><T ko="자산 성격" en="Asset class" /></th><th scope="col" className="py-2 text-right font-medium"><T ko="배율" en="Multiplier" /></th></tr></thead>
                  <tbody>{MA120_CLASS_EXPLANATIONS.map((item) => <tr key={item.key} className="border-b border-[var(--wash)]"><th scope="row" className="py-2 pr-3 font-normal"><T ko={item.ko} en={item.en} /></th><td className="py-2 text-right tabular-nums">{item.multiplier}</td></tr>)}</tbody>
                </table>
              </div>
              <p><T ko="평균선 바로 아래에서 갑자기 크게 바뀌지 않도록, 0~3% 아래 구간에서는 배율을 서서히 낮춥니다. 예를 들어 광범위 지수형은 평균선에서 1.0, 1.5% 아래에서 0.9, 3% 이상 아래에서 0.8입니다." en="Between 0% and 3% below the average, the multiplier decreases gradually. For a broad index holding, it is 1.0 at the average, 0.9 at 1.5% below, and 0.8 at 3% or more below." /></p>
              <p className="mt-2"><T ko="금·채권·예적금·연금형 자산, 추세 규칙을 끈 종목, 가격 근거가 부족한 종목은 1배를 적용합니다." en="Gold, bonds, savings and pensions use 1×. So do holdings with the rule disabled or insufficient price evidence." /></p>
              <p className="mt-2"><T ko="기본 매수금액이 10만원이고 배수가 0.8이면 2만원 감액해 8만원을 배분합니다." en="A KRW 100,000 base buy at 0.8× is reduced by KRW 20,000 to KRW 80,000." /></p>
              <p className="mt-2 text-xs"><T ko="이 배율과 3% 구간은 기존 서비스에서 이어온 정책값입니다. 자산별 최적 배율이나 손실 방지 효과가 검증되었다는 뜻은 아닙니다. 금·채권의 적용 제외도 안전한 자산이라는 판정은 아닙니다." en="These multipliers and the 3% range are inherited policy settings, not proven optimal values or a guarantee against loss. Exemption does not mean that gold or bonds are risk-free." /></p>
            </details>

            <details className="border-b border-[var(--line)] pb-5 text-sm leading-7 text-[var(--muted)]">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-[var(--ink)]"><T ko="정확한 계산식과 조정 규칙" en="Exact formulas and adjustment rules" /></summary>
              <p><PortfolioText ko={"목표액 = (현재 총평가액 + 신규 투입금) × 승인 목표비중"} /></p>
              <p><PortfolioText ko={"종목별 부족액 = 목표액 − 매도 후 평가액 (0 미만이면 0)"} /></p>
              <p><PortfolioText ko={"신규 투입금 + 계산상 매도대금을 부족액 비례로 배분합니다. 매도 종목은 다시 매수하지 않습니다. 원 단위 최대잔여 방식으로 결정하며 매도는 보유 평가액, 매수는 목표 부족액을 넘지 않습니다."} /></p>
              {preview.modifierEvidence ? <p><T ko="최종 매수금 = MA120 반영 매수금 × 환율·위험기여·시장·뉴스·성과 승수 + 적격 보충액. 적용 근거가 없는 승수는 미적용하며 남는 재원은 현금으로 둡니다." en="Final buy = trend-adjusted allocation × FX, risk, regime, news and performance multipliers + eligible topup. Unsupported factors are not applied; unallocated funds remain in cash." /></p> : null}
              <p><PortfolioText ko={"목표 0% 종목도 손실이 아니고 원가 근거가 있을 때 정리합니다. 원 단위로 표현할 수 없는 1원 미만 평가액은 남을 수 있습니다. 수수료·세금·주문 단위는 반영하지 않은 금액 계획입니다."} /></p>
              <p><T ko="MA120 감액 합계는 기본 배분액에서 추세 배수로 줄인 금액의 합입니다. 이후 적격 종목에 더한 금액은 보충액으로 따로 표시합니다." en="Total MA120 reductions add up the trend cuts to the base buys. Subsequent top-ups appear separately." /></p>
            </details>

            <details className="mt-4" aria-labelledby="holding-calculation-title">
              <summary className="min-h-11 cursor-pointer py-3">
                <div>
                  <CairnSectionTitle level="h3" id="holding-calculation-title" className="text-sm font-medium"><PortfolioText ko={"종목별 계산 근거"} /></CairnSectionTitle>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    <T ko="기본 배분과 조정 후 최종 금액을 비교합니다." en="Compare the base allocation with the final adjusted amounts." />{" "}</p>
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
                      <th className="px-2 py-3 text-right"><PortfolioText ko={"MA 반영 매수금"} /></th>
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
                          <p>{formatKrw(row.rawAllocationKrw ?? row.strategicAllocationKrw - row.ma120ReductionKrw)}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">× {formatNumber(row.maEffectiveMultiplier)}</p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]"><PortfolioText ko={"부족액"} />{" "}{formatKrw(row.baseNeedKrw)}</p>
                        </td>
                        <td className={`px-2 py-3 text-right font-medium tabular-nums ${actionTone(row.action)}`}><PortfolioText ko={actionLabel(row)} /></td>
                        <td className="max-w-[270px] px-2 py-3 text-xs leading-5 text-[var(--muted)]"><PortfolioText ko={decisionReason(row)} /><MaEvidenceDetails evidence={row.ma120Evidence} /><ModifierDetails row={row} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <section className="mt-6 border-l-2 border-[var(--warning)] pl-4 text-sm">
              <CairnSectionTitle level="h3" className="font-medium"><PortfolioText ko={"현재 계산 범위"} /></CairnSectionTitle>
              <p className="mt-1 leading-6 text-[var(--muted)]">
                <T ko="확인된 근거만 반영합니다. 근거가 없는 감액은 미적용으로 표시하며, 수수료·세금·실제 주문 단위는 포함하지 않습니다." en="Only verified evidence is applied. Missing evidence is marked as not applied. Fees, taxes and actual order sizes are excluded." /></p>
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

function ModifierDetails({ row }: { row: AdditionalContributionResultPreview["rows"][number] }) {
  const detail = row.modifierBreakdown;
  if (!detail) return null;
  const labels = [["fx", "환율", "FX"], ["rc", "위험 기여", "Risk contribution"], ["regime", "시장 국면", "Regime"], ["event", "뉴스", "News"], ["performance", "성과", "Performance"]] as const;
  return <details className="mt-3 border-t border-[var(--line)] pt-1">
    <summary className="min-h-11 cursor-pointer py-3 font-medium"><T ko="감액·추가 배분 근거" en="Reduction and top-up evidence" /></summary>
    <p><T ko="MA120 반영 매수금" en="Buy after MA120" /> {formatKrw(row.rawAllocationKrw ?? 0)}</p>
    <dl className="my-2 space-y-1">{labels.map(([key, ko, en]) => {
      const factor = detail.multipliers[key];
      return <div key={key} className="flex flex-wrap justify-between gap-x-3"><dt><T ko={ko} en={en} /></dt><dd>{factor.status === "ready" ? `× ${formatNumber(factor.value)}` : factor.status === "not_applicable" ? <T ko="적용 제외" en="Not applicable" /> : <T ko="근거 부족 · 미적용" en="Missing evidence · not applied" />}</dd></div>;
    })}</dl>
    <p><T ko="감액 후" en="After reductions" /> {formatKrw(detail.penalizedAllocationKrw)}</p>
    <p><T ko="추가 배분" en="Top-up" /> {formatKrw(detail.topupAllocationKrw)} · {detail.topupEligible ? <T ko="적격" en="Eligible" /> : <T ko="대상 아님" en="Not eligible" />}</p>
    {detail.topupEligible ? <p><T ko="배분 점수" en="Allocation score" /> {formatNumber(detail.topupScore)}</p> : null}
  </details>;
}

function PolicyFact({ detail, detailEn, label, labelEn, value, valueEn }: { detail: string; detailEn?: string; label: string; labelEn?: string; value: string; valueEn?: string }) {
  return <div><p className="text-xs font-medium text-[var(--muted)]"><PortfolioText ko={label} en={labelEn} /></p><p className="mt-2 font-medium"><PortfolioText ko={value} en={valueEn} /></p><details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs text-[var(--muted)]"><T ko="이 규칙 자세히 보기" en="About this rule" /></summary><p className="pb-3 text-sm leading-7 text-[var(--muted)]"><PortfolioText ko={detail} en={detailEn} /></p></details></div>;
}

// These multipliers apply to the base buy after allocation by approved target gaps.
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
  if (row.trimReason === "user_sale_excluded") reasons.push("이번 계산에서 매도 제외로 선택한 종목입니다. 매수 가능 여부는 기존 기준을 따릅니다.");
  if (row.trimReason === "loss_position" || row.trimReason === "target_zero_but_loss") reasons.push("손실 중이므로 매도하지 않습니다.");
  if (row.trimReason === "cost_basis_unavailable" || row.trimReason === "target_zero_cost_basis_unavailable") reasons.push("매입원가 근거가 없어 매도하지 않습니다.");
  if (row.maAdjustmentReason === "asset_class_exempt") reasons.push("MA120 감액 제외 자산입니다.");
  if (row.maAdjustmentReason === "asset_rule_disabled") reasons.push("추세 필터 또는 종목별 MA 규칙이 꺼져 있습니다.");
  if (row.maAdjustmentReason === "evidence_unavailable") reasons.push("MA120 자료가 부족해 기본 매수금액을 유지했습니다.");
  if (row.maAdjustmentReason === "below_ma120_full_adjustment" || row.maAdjustmentReason === "below_ma120_buffer") reasons.push(`MA120 배율 ${formatNumber(row.maEffectiveMultiplier)}을 반영했습니다.`);
  reasons.push(row.action === "buy" ? "매도 후 목표 부족액을 기준으로 기본 매수금액을 배분했습니다." : row.baseNeedKrw > 0 ? "부족액은 있으나 원 단위 상한과 재원 배분 결과 매수금이 없습니다." : "목표액을 이미 충족해 이번 매수 배분은 0원입니다.");
  return reasons.join(" ");
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) { return `${formatNumber(value)}%`; }
function formatSignedPercent(value: number) { return `${value > 0 ? "+" : ""}${formatNumber(value)}%`; }
function formatNumber(value: number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value); }
