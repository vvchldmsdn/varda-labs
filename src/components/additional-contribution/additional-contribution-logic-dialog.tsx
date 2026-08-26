"use client";

import { useRef } from "react";

import type { AdditionalContributionResultPreview } from "@/lib/additional-contribution-view";

export function AdditionalContributionLogicDialog({
  preview,
}: {
  preview: AdditionalContributionResultPreview;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
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
        className="border-b border-[#1c2824] pb-0.5 text-sm font-medium text-[#1c2824] transition-colors hover:border-[#517064] hover:text-[#517064]"
        onClick={() => dialogRef.current?.showModal()}
      >
        계산 로직 보기
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="contribution-logic-title"
        className="fixed inset-0 m-auto max-h-[88vh] w-[min(1160px,calc(100vw-24px))] overflow-hidden rounded-lg border border-[#cfd5cd] bg-[#f7f8f5] p-0 text-[#171916] shadow-2xl backdrop:bg-black/35"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-start justify-between gap-5 border-b border-[#d9ded7] px-5 py-5 sm:px-7">
            <div>
              <p className="text-[11px] font-medium text-[#718077]">CALCULATION LOGIC</p>
              <h2 id="contribution-logic-title" className="mt-1 text-xl font-medium">
                이번 추가 투입안이 만들어진 과정
              </h2>
              <p className="mt-1 text-sm text-[#657068]">
                실제 주문이 아닌 읽기 전용 계산입니다. 각 단계의 재원과 종목별 판단을 그대로 표시합니다.
              </p>
            </div>
            <button
              type="button"
              aria-label="계산 로직 닫기"
              className="grid size-9 shrink-0 place-items-center rounded-full border border-[#cfd5cd] bg-white text-xl hover:bg-[#eef1eb]"
              onClick={() => dialogRef.current?.close()}
            >
              ×
            </button>
          </header>

          <div className="overflow-y-auto px-5 py-6 sm:px-7">
            <section aria-labelledby="calculation-flow-title">
              <h3 id="calculation-flow-title" className="text-sm font-medium">금액 흐름</h3>
              <div className="mt-3 grid gap-px overflow-hidden rounded-md border border-[#d9ded7] bg-[#d9ded7] sm:grid-cols-5">
                <FlowStep index="01" label="신규 투입금" value={formatKrw(preview.cashAmountKrw)} />
                <FlowStep index="02" label="계산상 매도" value={`+${formatKrw(preview.totalTrimProceedsKrw)}`} />
                <FlowStep index="03" label="매수 가능 재원" value={formatKrw(preview.totalAvailableFundsKrw)} />
                <FlowStep index="04" label="최종 매수 배분" value={formatKrw(preview.totalAllocatedKrw)} />
                <FlowStep index="05" label="남는 현금" value={formatKrw(preview.residualCashKrw)} />
              </div>
            </section>

            <section className="mt-5 grid gap-4 border-y border-[#d9ded7] py-5 md:grid-cols-3">
              <PolicyFact
                label="1. 초과 종목 정리"
                value={`목표 대비 +${formatNumber(preview.calculationParameters.trimDriftThresholdPct)}% 이상`}
                detail={`수익 중인 종목만 목표비중의 ${formatNumber(preview.calculationPolicy.trimLandingTargetMultiplier * 100)}% 지점까지 계산상 매도하고, 그 금액을 투입금에 더합니다.`}
              />
              <PolicyFact
                label="2. MA120 매수 강도"
                value="자산 성격별로 목표 부족액 조정"
                detail="금과 채권은 감점하지 않습니다. 그 외 자산은 MA120 아래 3%까지 단계적으로, 그보다 낮으면 자산군 배율을 전부 적용합니다."
              />
              <PolicyFact
                label="3. 최소 집행 확인"
                value={`${formatKrw(preview.minimumExecutionTargetKrw)} · ${preview.minimumExecutionSatisfied ? "충족" : "미충족"}`}
                detail={`기준 ${formatNumber(preview.calculationParameters.minimumExecutionRatioPct)}%. 다만 목표 부족액을 넘겨 억지로 매수하지는 않습니다.`}
              />
            </section>

            <section className="mt-7" aria-labelledby="holding-calculation-title">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 id="holding-calculation-title" className="text-sm font-medium">종목별 계산 근거</h3>
                  <p className="mt-1 text-xs text-[#657068]">
                    원래 목표로 계산한 금액과 MA120 반영 후 최종 금액을 함께 비교합니다.
                  </p>
                </div>
                <span className="text-xs text-[#657068]">{rows.length}개 종목</span>
              </div>

              <div className="mt-3 overflow-x-auto border-y border-[#d9ded7]">
                <table className="w-full min-w-[1080px] border-collapse text-sm">
                  <thead className="text-left text-[11px] font-medium text-[#657068]">
                    <tr>
                      <th className="px-2 py-3">종목</th>
                      <th className="px-2 py-3 text-right">현재 → 목표</th>
                      <th className="px-2 py-3 text-right">평가손익</th>
                      <th className="px-2 py-3 text-right">계산상 매도</th>
                      <th className="px-2 py-3 text-right">기본 매수안</th>
                      <th className="px-2 py-3 text-right">MA 반영 목표</th>
                      <th className="px-2 py-3 text-right">최종 결과</th>
                      <th className="px-2 py-3">판단 이유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.accountCode}:${row.ticker ?? row.name}`} className="border-t border-[#e1e5df] align-top">
                        <td className="px-2 py-3">
                          <p className="font-medium">{row.name}</p>
                          <p className="mt-0.5 text-xs text-[#727b74]">{row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}</p>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">{formatPercent(row.currentWeightPct)} → {formatPercent(row.targetWeightPct)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{row.unrealizedReturnPct === null ? "근거 없음" : formatSignedPercent(row.unrealizedReturnPct)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{row.trimAmountKrw > 0 ? formatKrw(row.trimAmountKrw) : "-"}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{formatKrw(row.strategicAllocationKrw)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          <p>{formatPercent(row.effectiveTargetWeightPct)}</p>
                          <p className="mt-0.5 text-xs text-[#727b74]">× {formatNumber(row.maEffectiveMultiplier)}</p>
                        </td>
                        <td className={`px-2 py-3 text-right font-medium tabular-nums ${actionTone(row.action)}`}>{actionLabel(row)}</td>
                        <td className="max-w-[270px] px-2 py-3 text-xs leading-5 text-[#5e6961]">{decisionReason(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6 border-l-2 border-[#b8a46d] pl-4 text-sm">
              <h3 className="font-medium">현재 계산 범위</h3>
              <p className="mt-1 leading-6 text-[#657068]">
                원 서비스 후반부에 있던 환율 진입시점, 위험기여, 시장 레짐, 뉴스, 성과감시 감액은 사용자별 정규화 근거가 아직 없어 이번 계산에 임의로 넣지 않았습니다. 근거가 연결되면 같은 단계에 추가할 수 있습니다.
              </p>
            </section>
          </div>
        </div>
      </dialog>
    </>
  );
}

function FlowStep({ index, label, value }: { index: string; label: string; value: string }) {
  return <div className="bg-[#f7f8f5] px-4 py-4"><p className="text-[10px] text-[#7a827b]">{index}</p><p className="mt-2 text-xs text-[#657068]">{label}</p><p className="mt-1 font-medium tabular-nums">{value}</p></div>;
}

function PolicyFact({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div><p className="text-[11px] font-medium text-[#718077]">{label}</p><p className="mt-2 font-medium">{value}</p><p className="mt-1 text-xs leading-5 text-[#657068]">{detail}</p></div>;
}

function actionLabel(row: AdditionalContributionResultPreview["rows"][number]) {
  if (row.action === "trim") return `매도 ${formatKrw(row.trimAmountKrw)}`;
  if (row.action === "buy") return `매수 ${formatKrw(row.allocationKrw)}`;
  return "유지";
}

function actionTone(action: "buy" | "hold" | "trim") {
  return action === "buy" ? "text-[#347e62]" : action === "trim" ? "text-[#bb554f]" : "text-[#687068]";
}

function decisionReason(row: AdditionalContributionResultPreview["rows"][number]) {
  if (row.action === "trim") return row.trimReason === "eligible_zero_target_exit" ? "목표비중이 0%이고 수익 중이라 전액을 계산상 매도했습니다." : "목표 대비 초과 폭이 기준을 넘고 수익 중이라 목표의 105%까지 계산상 매도했습니다.";
  if (row.trimReason === "loss_position" || row.trimReason === "target_zero_but_loss") return "비중은 높지만 손실 중이어서 매도하지 않았습니다.";
  if (row.trimReason === "cost_basis_unavailable" || row.trimReason === "target_zero_cost_basis_unavailable") return "매입원가 근거가 없어 자동 매도를 막았습니다.";
  if (row.maAdjustmentReason === "asset_class_exempt") return row.action === "buy" ? "금·채권 자산은 MA120 감점 없이 목표 부족액을 배분했습니다." : "금·채권 자산은 MA120 감점 대상이 아니며 현재 추가 매수가 필요하지 않습니다.";
  if (row.maAdjustmentReason === "below_ma120_full_adjustment" || row.maAdjustmentReason === "below_ma120_buffer") return row.action === "buy" ? "MA120 아래에 있어 자산군별 매수 강도를 적용한 뒤 배분했습니다." : "MA120 아래 조정 후에는 추가 매수 부족액이 없었습니다.";
  if (row.action === "buy") return "목표비중보다 부족해 사용 가능한 재원을 부족액 비례로 배분했습니다.";
  return "현재 비중이 목표에 가깝거나 다른 종목의 부족 정도가 더 컸습니다.";
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number) { return `${formatNumber(value)}%`; }
function formatSignedPercent(value: number) { return `${value > 0 ? "+" : ""}${formatNumber(value)}%`; }
function formatNumber(value: number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value); }
