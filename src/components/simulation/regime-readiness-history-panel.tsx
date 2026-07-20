import type { SimulationRegimeReadinessHistory } from "@/lib/simulation-regime-readiness-history";

export function RegimeReadinessHistoryPanel({
  model,
}: {
  model: SimulationRegimeReadinessHistory;
}) {
  return (
    <section
      aria-labelledby="regime-readiness-history-title"
      className="border-b border-[#d7ddcf] py-5"
      data-regime-readiness-history
      data-regime-readiness-history-policy={model.policy.version}
      data-regime-point-in-time-status={model.pointInTime.status}
      data-regime-safe-date-count={model.summary.pointInTimeSafeDateCount}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="regime-readiness-history-title"
            className="text-lg font-semibold"
          >
            체제 데이터 시점 검증
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
            선택 기준일과 직전 6개 서비스 날짜를 독립적으로 점검합니다.
            날짜를 자동으로 되돌리지 않으며, 사후 연구 가능 여부와 당시
            실제 이용 가능성이 입증됐는지를 분리합니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#e6d8ae] bg-[#fffdf6] px-3 py-1.5 text-xs font-semibold text-[#6b6044]">
          엄격한 시점 검증 미확립
        </span>
      </div>

      <div className="mt-4 grid border-y border-[#e1e5da] sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem
          label="검사 날짜"
          value={`${model.summary.inspectedDateCount}일`}
          detail="선택일 포함 최근 서비스 날짜"
        />
        <SummaryItem
          label="사후 연구 가능"
          value={`${model.summary.retrospectiveReadyDateCount}일`}
          detail="공개일 기반 계산 준비도"
        />
        <SummaryItem
          label="시점 안전 날짜"
          value={`${model.summary.pointInTimeSafeDateCount}일`}
          detail="공개시각과 vintage 입증 기준"
        />
        <SummaryItem
          label="자동 날짜 대체"
          value="사용 안 함"
          detail="선택한 날짜를 그대로 판정"
        />
      </div>

      <div className="mt-4 rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4">
        <p className="font-semibold">현재 import만으로 당시 공개 상태를 증명할 수 없습니다.</p>
        <p className="mt-2 text-sm leading-6 text-[#6b6044]">
          factor별 공개 날짜는 보존됐지만 공개 시각과 revision vintage는
          보존되지 않았습니다. 같은 날짜 공개값은 다음 서비스 날짜부터만
          사후 연구에 사용하며, 아래 결과를 당시 알 수 있었던 예측이나
          추천으로 해석하지 않습니다.
        </p>
      </div>

      {model.entries.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-left text-sm">
            <thead className="border-y border-[#d7ddcf] text-xs text-[#687064]">
              <tr>
                <th className="px-3 py-3 font-semibold">기준일</th>
                <th className="px-3 py-3 font-semibold">사후 연구</th>
                <th className="px-3 py-3 font-semibold">적용 공개일</th>
                <th className="px-3 py-3 text-right font-semibold">정렬 상태</th>
                <th className="px-3 py-3 text-right font-semibold">후보 상태</th>
                <th className="px-3 py-3 font-semibold">엄격한 시점 검증</th>
              </tr>
            </thead>
            <tbody>
              {model.entries.map((entry) => (
                <tr
                  className="border-b border-[#e1e5da] align-top"
                  data-regime-history-date={entry.serviceDate}
                  data-regime-history-research-status={entry.retrospectiveStatus}
                  data-regime-history-point-in-time-status={entry.pointInTimeStatus}
                  key={entry.serviceDate}
                >
                  <td className="px-3 py-3 font-semibold tabular-nums">
                    {formatDate(entry.serviceDate)}
                    {entry.serviceDate === model.selectedEndServiceDate ? (
                      <span className="ml-2 text-xs font-normal text-[#687064]">
                        선택일
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <StatusText
                      ready={entry.retrospectiveStatus === "research_ready"}
                      reason={entry.reason}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <FactorReleaseList factors={entry.readiness?.factors ?? []} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {entry.readiness
                      ? `${entry.readiness.alignedRowCount}/${entry.readiness.requiredAlignedRowCount}`
                      : "-"}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {entry.readiness
                      ? `${entry.readiness.selectedNeighborCount}/${entry.readiness.eligibleCandidateRowCount}`
                      : "-"}
                  </td>
                  <td className="px-3 py-3 text-[#8a5d1f]">
                    공개시각·vintage 없음
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[#687064]">
          기준일을 직접 선택하면 최근 날짜별 준비도를 검사합니다.
        </p>
      )}

      <div className="mt-4 border-t border-[#e1e5da] pt-4">
        <p className="text-xs font-semibold text-[#687064]">시점 안전 날짜</p>
        <p className="mt-1 text-sm">
          {model.safeEndServiceDates.length > 0
            ? model.safeEndServiceDates.map(formatDate).join(", ")
            : "현재 보존된 provenance로 입증된 날짜가 없습니다."}
        </p>
      </div>
    </section>
  );
}

function FactorReleaseList({
  factors,
}: {
  factors: NonNullable<
    SimulationRegimeReadinessHistory["entries"][number]["readiness"]
  >["factors"];
}) {
  if (factors.length === 0) return <span>-</span>;
  return (
    <ul className="space-y-1 text-xs">
      {factors.map((factor) => (
        <li key={factor.factorKey}>
          <span className="font-semibold">{factor.label}</span>{" "}
          <span className="tabular-nums text-[#687064]">
            {factor.currentReleaseDate
              ? `${formatDate(factor.currentReleaseDate)} · ${factor.currentCarryDays}일 경과`
              : "적용값 없음"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatusText({
  ready,
  reason,
}: {
  ready: boolean;
  reason: SimulationRegimeReadinessHistory["entries"][number]["reason"];
}) {
  if (ready) return <span className="font-semibold text-[#176b43]">계산 가능</span>;
  return (
    <span className="text-[#8a5d1f]">
      사용 불가 · {reasonLabel(reason)}
    </span>
  );
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border-b border-r border-[#e1e5da] px-4 py-3 last:border-r-0 xl:border-b-0">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#7a8175]">{detail}</p>
    </div>
  );
}

function reasonLabel(
  reason: SimulationRegimeReadinessHistory["entries"][number]["reason"],
) {
  const labels = {
    explicit_end_required: "기준일 필요",
    input_matrix_unavailable: "공통 수익률 부족",
    input_matrix_shape_mismatch: "입력 규격 불일치",
    factor_rows_invalid: "factor 행 오류",
    current_factor_state_incomplete: "현재 factor 불완전",
    current_factor_state_stale: "현재 factor 오래됨",
    insufficient_aligned_regime_rows: "정렬 상태 부족",
    insufficient_candidate_rows: "후보 상태 부족",
    factor_state_degenerate: "유효 factor 변화 부족",
  } as const;
  return reason ? labels[reason] : "확인 필요";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
