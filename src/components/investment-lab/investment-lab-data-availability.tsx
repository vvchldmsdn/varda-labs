import type {
  InvestmentLabDataAvailability,
  InvestmentLabRepairItem,
  InvestmentLabScenarioAvailability,
  InvestmentLabScenarioAvailabilityReason,
  InvestmentLabScenarioAvailabilityStatus,
} from "@/lib/investment-lab-data-availability";

export function InvestmentLabDataAvailabilityView({
  model,
}: {
  model: InvestmentLabDataAvailability;
}) {
  const actual = model.actualHistory;
  const market = model.marketHistory;

  return (
    <section
      className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
      data-availability-status={model.status}
      data-current-writer-dates={actual.latestCurrentWriterDateCount}
      data-market-fx-gaps={market.fxGapCount}
      data-market-observations={market.usableReturnObservations}
      data-market-price-gaps={market.priceGapCount}
      data-market-target={market.requestedReturnObservations}
      data-scenario-count={model.scenarioRows.length}
      data-section="investment-lab-data-availability"
    >
      <div className="border-b border-[#e1e6dc] px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">계산 데이터 준비 상태</h2>
            <p className="mt-1 text-sm text-[#687064]">
              보여줄 수 있는 근거와 아직 보완해야 하는 근거를 분리합니다.
            </p>
          </div>
          <span className="w-fit rounded-md border border-[#d4dbce] bg-white px-3 py-1.5 text-xs font-semibold text-[#4e594d]">
            자동 보완·DB 쓰기 없음
          </span>
        </div>
      </div>

      <div className="grid border-b border-[#e1e6dc] sm:grid-cols-2 xl:grid-cols-4">
        <AvailabilityMetric
          detail={formatRange(
            actual.latestCurrentWriterStartServiceDate,
            actual.latestCurrentWriterEndServiceDate,
          )}
          label="최신 신뢰 평가액 구간"
          value={`${actual.latestCurrentWriterDateCount}개 관측일`}
        />
        <AvailabilityMetric
          detail={`${formatRange(actual.availableStartServiceDate, actual.availableEndServiceDate)} · 계산에는 미사용`}
          label="레거시 표시 근거"
          value={`${actual.legacyDisplayDateCount}개 관측일`}
        />
        <AvailabilityMetric
          detail={`수익률 축 커버리지 ${market.returnCoveragePct.toFixed(1)}%`}
          label="시장 가격·환율"
          value={`${market.usableReturnObservations}/${market.requestedReturnObservations}`}
        />
        <AvailabilityMetric
          detail={`가격 ${market.priceGapCount} · 환율 ${market.fxGapCount}`}
          label="90일 축 누락 근거"
          value={
            market.priceGapCount + market.fxGapCount === 0
              ? "없음"
              : `${market.priceGapCount + market.fxGapCount}건`
          }
        />
      </div>

      <div className="px-4 py-4">
        <div className="mb-3">
          <h3 className="font-semibold">시나리오별 현재 판단</h3>
          <p className="mt-1 text-sm text-[#687064]">
            시장가격이 있어도 실제 평가액 근거나 과거 시점 정책이 없으면 별도로 표시합니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-y border-[#e1e6dc] bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
                <th className="px-3 py-3">시나리오 묶음</th>
                <th className="px-3 py-3">상태</th>
                <th className="px-3 py-3">판단 근거</th>
              </tr>
            </thead>
            <tbody>
              {model.scenarioRows.map((row) => (
                <tr
                  className="border-b border-[#e1e6dc] align-top"
                  data-scenario-availability={row.status}
                  data-scenario-family={row.id}
                  key={row.id}
                >
                  <td className="px-3 py-3 font-semibold">
                    {scenarioLabel(row.id)}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-3 text-[#5f685d]">
                    {row.reasons.map(scenarioReasonLabel).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid border-t border-[#e1e6dc] lg:grid-cols-2">
        <div className="px-4 py-4 lg:border-r lg:border-[#e1e6dc]">
          <h3 className="font-semibold">보완 경로</h3>
          <ul className="mt-3 space-y-2 text-sm text-[#5f685d]">
            {model.repairItems.map((item) => (
              <li key={item.id}>{repairItemLabel(item)}</li>
            ))}
          </ul>
        </div>
        <div className="border-t border-[#e1e6dc] px-4 py-4 lg:border-t-0">
          <h3 className="font-semibold">특수 보유자산</h3>
          {model.specialHoldings.length === 0 ? (
            <p className="mt-3 text-sm text-[#5f685d]">
              이 계정 범위에는 별도 처리 대상이 없습니다.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-[#5f685d]">
              {model.specialHoldings.map((holding) => (
                <li key={`${holding.account}:${holding.name}`}>
                  <strong className="text-[#2f3931]">{holding.name}</strong>
                  {" · "}
                  {specialHoldingLabel(holding.kind)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function InvestmentLabDataAvailabilitySkeleton() {
  return (
    <section className="h-72 animate-pulse rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
  );
}

export function InvestmentLabDataAvailabilityUnavailable() {
  return (
    <section
      className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] px-4 py-4 text-sm text-[#725f2d]"
      data-availability-status="unavailable"
      data-section="investment-lab-data-availability"
    >
      계산 데이터 준비 상태를 읽지 못했습니다. 기존 계산 결과를 추정값으로 대체하지 않습니다.
    </section>
  );
}

function AvailabilityMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-[#e1e6dc] px-4 py-4 last:border-b-0 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:border-b-0 xl:[&:nth-child(2n)]:border-r xl:last:border-r-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: InvestmentLabScenarioAvailabilityStatus }) {
  const style =
    status === "limited_input_ready"
      ? "border-[#c7dfd1] bg-[#edf7f0] text-[#356555]"
      : status === "market_only_ready"
        ? "border-[#d8dfbf] bg-[#f5f7e9] text-[#5e6b2d]"
        : status === "research_only"
          ? "border-[#d8d9e5] bg-[#f2f2f8] text-[#52566f]"
          : "border-[#eadfbe] bg-[#fff9e8] text-[#725f2d]";
  return (
    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${style}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: InvestmentLabScenarioAvailabilityStatus) {
  const labels: Record<InvestmentLabScenarioAvailabilityStatus, string> = {
    limited_input_ready: "최신 구간 입력 준비",
    market_only_ready: "시장 데이터만 준비",
    research_only: "연구용 검토 가능",
    blocked: "현재 차단",
  };
  return labels[status];
}

function scenarioLabel(id: InvestmentLabScenarioAvailability["id"]) {
  const labels: Record<InvestmentLabScenarioAvailability["id"], string> = {
    same_flow_baselines: "동일 거래흐름 대체투자 (KODEX 200·VOO·현금)",
    fixed_quantity: "현재 수량 유지",
    scheduled_weights: "현재 비중·동일 비중 정기 리밸런싱",
    historical_policy_weights: "목표 비중·추천 리밸런싱 과거 비교",
    hindsight_research: "최고수익·최소변동성·최소MDD·최대Sharpe",
  };
  return labels[id];
}

function scenarioReasonLabel(reason: InvestmentLabScenarioAvailabilityReason) {
  const labels: Record<InvestmentLabScenarioAvailabilityReason, string> = {
    latest_trusted_segment_ready: "최신 단일 writer 구간은 비교 입력으로 사용 가능",
    current_writer_segment_too_short: "신뢰 가능한 실제 평가액 구간이 2일 미만",
    market_history_incomplete: "90개 수익률 축의 가격·환율 근거가 불완전",
    authoritative_actual_history_pending: "장기 실제 평가액 경로의 계산 권한은 아직 없음",
    fount_scope_adjustment_required: "Fount 제외 경로 변환이 필요",
    manual_valuation_history_required:
      "금현물은 현재 수동 평가만 있고 과거 수동 평가 이력이 부족",
    special_holding_price_authority_required: "특수 보유자산의 별도 가격 권한이 필요",
    scheduled_rebalance_contract_pending: "월간·분기 리밸런싱 규칙과 비용 계약이 미정",
    point_in_time_policy_receipts_missing: "과거 시점 목표·추천 승인 기록이 없음",
    walk_forward_cost_constraints_pending: "walk-forward·회전율·비용·계정 제약 검증 전",
    multivariate_history_unavailable: "다변량 분석에 필요한 완전한 종목 구성이 없음",
  };
  return labels[reason];
}

function repairItemLabel(item: InvestmentLabRepairItem) {
  if (item.id === "actual_history") {
    return item.status === "not_needed"
      ? "실제 평가액: 별도 보완 불필요"
      : `실제 평가액: ${item.affectedCount}개 레거시·불완전 관측은 provider로 복원할 수 없어 별도 재구성 검토가 필요`;
  }
  if (item.id === "market_history") {
    return item.status === "not_needed"
      ? "시장 가격·환율: 현재 90개 수익률 축에 보완 대상 없음"
      : `시장 가격·환율: ${item.affectedCount}개 누락 근거는 승인 후 provider backfill 후보`;
  }
  if (item.id === "krx_gold") {
    return "KRX 금현물: 저장된 1g당 수동 가격은 현재 평가에 사용하며, 과거 비교는 명시적 수동 평가 이력이 쌓인 구간만 사용";
  }
  return "Fount: 가격 누락이 아니라 투자 랩 범위에서 제외하는 경로 변환 필요";
}

function specialHoldingLabel(kind: "fount" | "krx_gold" | "unresolved") {
  if (kind === "fount") return "투자 랩·시뮬레이션에서 의도적으로 제외";
  if (kind === "krx_gold") {
    return "저장된 1g당 수동 평가 사용 · 과거 계산은 수동 이력 필요";
  }
  return "정확한 상품 식별과 가격 권한 확인 필요";
}

function formatRange(start: string | null, end: string | null) {
  if (!start || !end) return "구간 없음";
  return `${start.replaceAll("-", ".")} ~ ${end.replaceAll("-", ".")}`;
}
