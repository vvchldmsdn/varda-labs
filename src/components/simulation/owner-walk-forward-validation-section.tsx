import type { SimulationOwnerWalkForwardValidationResult } from "@/lib/simulation-owner-walk-forward-validation";

export function OwnerWalkForwardValidationSection({
  result,
}: {
  result: SimulationOwnerWalkForwardValidationResult;
}) {
  return (
    <section
      aria-labelledby="owner-walk-forward-validation-title"
      className="border-b border-[var(--line)] py-5"
      data-owner-walk-forward-validation
      data-owner-walk-forward-validation-account={result.account}
      data-owner-walk-forward-validation-ready-folds={
        result.summary.readyFoldCount
      }
      data-owner-walk-forward-validation-status={result.status}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            학습 구간과 확인 구간 분리
          </p>
          <h2
            className="mt-1 text-lg font-semibold"
            id="owner-walk-forward-validation-title"
          >
            과거 구간 밖 검증
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            앞선 60개 수익률로 후보 비중을 만든 뒤, 계산에 쓰지 않은 다음
            10개 수익률에서 현재 비중과 비교합니다. 시작점을 10개씩 옮겨
            총 세 번 반복해 같은 90개 구간에만 맞춘 결과인지 점검합니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)]">
          과거 진단 · 추천 아님
        </span>
      </div>

      {result.folds.length === 0 ? (
        <div
          className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-4"
          data-owner-walk-forward-validation-unavailable-reason={result.reason}
        >
          <p className="font-semibold">구간 밖 검증을 만들지 않았습니다.</p>
          <p className="mt-1 text-sm leading-6 text-[var(--warning)]">
            {reasonLabel(result.reason)} 현재 포트폴리오 확률 경로는 그대로
            유지됩니다.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              detail={`${result.summary.unavailableFoldCount}개 계산 불가`}
              label="비교 가능한 구간"
              value={`${result.summary.readyFoldCount}/${result.summary.foldCount}`}
            />
            <Metric
              detail="후보 변동성이 실제로 더 낮았던 구간"
              label="변동성 완화 확인"
              value={`${result.summary.candidateLowerVolatilityFoldCount}/${result.summary.readyFoldCount}`}
            />
            <Metric
              detail="후보 - 현재, 세 검증 구간 평균"
              label="검증 변동성 차이"
              value={formatSignedPctPoint(
                result.summary.meanVolatilityDeltaPctPoints,
              )}
            />
            <Metric
              detail={`${result.summary.comparableOutOfSampleStepCount}개 검증 수익률 연결`}
              label="누적 수익률"
              value={`${formatSignedPct(result.summary.compoundedCurrentReturnPct)} → ${formatSignedPct(result.summary.compoundedCandidateReturnPct)}`}
            />
          </dl>

          <div className="mt-4 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="text-xs text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-3 font-semibold">회차</th>
                  <th className="px-3 py-3 font-semibold">학습 구간</th>
                  <th className="px-3 py-3 font-semibold">검증 구간</th>
                  <th className="px-3 py-3 text-right font-semibold">
                    학습 변동성
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    검증 변동성
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    검증 수익률
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    최대 낙폭
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    비중 이동
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.folds.map((fold) => (
                  <tr
                    className="border-t border-[var(--line)]"
                    data-owner-walk-forward-fold={fold.foldIndex + 1}
                    data-owner-walk-forward-fold-status={fold.status}
                    key={fold.foldIndex}
                  >
                    <td className="px-3 py-3 font-semibold">
                      {fold.foldIndex + 1}차
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatRange(
                        fold.trainStartServiceDate,
                        fold.trainEndServiceDate,
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatRange(
                        fold.testStartServiceDate,
                        fold.testEndServiceDate,
                      )}
                    </td>
                    {fold.status === "ready" ? (
                      <>
                        <ComparisonCell
                          candidate={
                            fold.training.candidateAnnualizedVolatilityPct
                          }
                          current={fold.training.currentAnnualizedVolatilityPct}
                        />
                        <ComparisonCell
                          candidate={
                            fold.outcome.candidateAnnualizedVolatilityPct
                          }
                          current={fold.outcome.currentAnnualizedVolatilityPct}
                        />
                        <ComparisonCell
                          candidate={fold.outcome.candidateReturnPct}
                          current={fold.outcome.currentReturnPct}
                          signed
                        />
                        <ComparisonCell
                          candidate={fold.outcome.candidateMaxDrawdownPct}
                          current={fold.outcome.currentMaxDrawdownPct}
                        />
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatWeight(fold.constraints.oneWayTurnoverBps)}
                        </td>
                      </>
                    ) : (
                      <td className="px-3 py-3 text-[var(--warning)]" colSpan={5}>
                        계산 불가 · {reasonLabel(fold.reason)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-3 space-y-1 text-xs leading-5 text-[var(--muted)]">
        <p>
          각 셀은 현재 → 후보 순서입니다. 후보는 매 회차의 학습 구간만 보고
          다시 계산하며, 뒤의 검증 수익률은 비중 계산에 사용하지 않습니다.
        </p>
        <p>
          세 검증 구간은 서로 겹치지 않지만 학습 구간은 일부 겹칩니다. 현재
          보유 비중을 과거에도 동일했다고 가정하고, 수수료·세금은 0으로
          두므로 독립 실험이나 미래 성과 보장이 아닙니다.
        </p>
      </div>
    </section>
  );
}

function ComparisonCell({
  candidate,
  current,
  signed = false,
}: {
  candidate: number;
  current: number;
  signed?: boolean;
}) {
  const formatter = signed ? formatSignedPct : formatPct;
  return (
    <td className="px-3 py-3 text-right tabular-nums">
      {formatter(current)} → {formatter(candidate)}
    </td>
  );
}

function Metric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[var(--muted)]">{detail}</dd>
    </div>
  );
}

function reasonLabel(
  reason: SimulationOwnerWalkForwardValidationResult["reason"],
) {
  if (!reason) return "일부 구간만 계산할 수 있습니다.";
  const labels = {
    current_execution_unavailable: "현재 포트폴리오 계산이 먼저 준비되어야 합니다.",
    input_matrix_unavailable: "공동 수익률 행렬이 준비되지 않았습니다.",
    input_matrix_shape_mismatch: "수익률 행렬과 현재 비중의 종목 순서가 다릅니다.",
    input_shape_mismatch: "학습 구간과 현재 비중의 종목 순서가 다릅니다.",
    test_outcome_calculation_failed: "검증 구간의 성과를 계산하지 못했습니다.",
    no_ready_folds: "계산 가능한 검증 회차가 없습니다.",
    candidate_requires_two_instruments:
      "계산 가능한 종목이 하나뿐이면 비중 대안을 만들 수 없습니다.",
    candidate_estimation_failed: "제약 안에서 후보 비중을 계산하지 못했습니다.",
    candidate_not_lower_volatility:
      "학습 구간에서 현재보다 낮은 변동성 후보를 만들지 못했습니다.",
    candidate_constraint_failed: "회전율·외화·집중도 제약을 만족하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatRange(start: string | null, end: string | null) {
  return start && end ? `${start} ~ ${end}` : "-";
}

function formatPct(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number | null) {
  return value === null
    ? "-"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatSignedPctPoint(value: number | null) {
  return value === null
    ? "-"
    : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%p`;
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}
