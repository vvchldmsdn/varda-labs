import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";
import type { SimulationOwnerInputPreflightModel } from "@/lib/simulation-owner-input-preflight";

export function OwnerInputPreflightSection({
  model,
  preservedQuery,
  scopes,
  selectedScope,
}: {
  model: SimulationOwnerInputPreflightModel;
  preservedQuery: PortfolioAnalysisScopeQuery;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const positiveHistoryWeight = model.evidenceSummary?.admittedWeightBps ?? 0;

  return (
    <section
      aria-labelledby="owner-simulation-input-title"
      className="border-b border-[var(--line)] py-5"
      data-owner-simulation-preflight
      data-owner-simulation-scope={model.account}
      data-owner-simulation-status={model.status}
      data-owner-simulation-runtime-trust={model.runtimeTrustStatus}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--muted)]">
            로그인 사용자 보유종목 기준
          </p>
          <h2 className="mt-1 text-lg font-semibold" id="owner-simulation-input-title">
            내 포트폴리오 입력 점검
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            현재 보유 구성과 저장된 과거 가격 이력을 계좌별로 점검합니다. 이 비중은
            아래의 일회성 연구 계산에만 사용하며 저장된 목표 비중, 최적화, 추천 또는
            주문 근거로 사용하지 않습니다.
          </p>
        </div>
        <PortfolioAnalysisScopeTabs
          basePath="/simulation"
          query={preservedQuery}
          scopes={scopes}
          selectedScopeKey={selectedScope.key}
        />
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="분석 범위" value={selectedScope.label} />
        <Metric
          detail={`${model.summary.sourceHoldingCount}개 보유 행에서 집계`}
          label="분석 종목"
          value={`${model.summary.aggregatedInstrumentCount}개`}
        />
        <Metric
          detail="현재 평가액 기준 진단값"
          label="현재 평가액"
          value={formatKrw(model.summary.currentValueKrw)}
        />
        <Metric
          detail={historyCoverageDetail(model)}
          label="과거 이력 확인"
          value={formatWeight(positiveHistoryWeight)}
        />
      </dl>

      {model.historicalPriceBasis === "raw_price_return" ? (
        <p
          className="mt-3 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm leading-6 text-[var(--warning)]"
          data-owner-simulation-raw-close-basis
        >
          현재 단일 사용자 연구 모드는 저장된 KIS 종가를 사용합니다. 배당과
          액면분할·병합 조정은 주장하지 않으며, 이 결과는 추천이나 주문 근거로
          저장되지 않습니다.
        </p>
      ) : null}

      {model.summary.fountExcludedHoldingCount > 0 ? (
        <p
          className="mt-3 rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]"
          data-owner-simulation-fount-excluded
        >
          Fount {model.summary.fountExcludedHoldingCount}건은 사용자 결정에 따라 투자 랩과
          시뮬레이션에서 제외했습니다. 제외 금액은 {formatKrw(model.summary.fountExcludedCurrentValueKrw)}입니다.
        </p>
      ) : null}

      {model.blockers.length > 0 ? (
        <div
          className="mt-3 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--warning)]"
          data-owner-simulation-blockers={model.blockers.join(",")}
        >
          <p className="font-semibold">입력 후보를 확정하지 않았습니다.</p>
          <p className="mt-1 leading-6">{model.blockers.map(blockerLabel).join(" · ")}</p>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="border-y border-[var(--line)] text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-3 font-semibold">종목</th>
              <th className="px-3 py-3 font-semibold">계좌</th>
              <th className="px-3 py-3 text-right font-semibold">현재 평가액</th>
              <th className="px-3 py-3 text-right font-semibold">현재 비중</th>
              <th className="px-3 py-3 font-semibold">과거 이력 상태</th>
            </tr>
          </thead>
          <tbody>
            {model.instruments.map((row) => (
              <tr
                className="border-b border-[var(--line)] align-top"
                data-owner-simulation-instrument={row.instrumentKey}
                data-owner-simulation-history-status={row.historicalStatus}
                key={row.instrumentKey}
              >
                <td className="px-3 py-3">
                  <p className="font-semibold">{row.name}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {row.ticker} · {row.market} · {row.currency}
                  </p>
                </td>
                <td className="px-3 py-3">{row.accounts.join(", ")}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {formatKrw(row.currentValueKrw)}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {row.weightBps === null ? "-" : formatWeight(row.weightBps)}
                </td>
                <td className="px-3 py-3">
                  <p className={historyStatusClass(row.historicalStatus)}>
                    {historyStatusLabel(row.historicalStatus)}
                  </p>
                  {row.classification === "physical_commodity_position" ? (
                    <p className="mt-1 text-xs leading-5 text-[var(--warning)]">
                      금현물은 사용자가 기록한 평가 이력만 사용합니다.
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {model.valuationGaps.length > 0 ? (
        <div className="mt-4" data-owner-simulation-valuation-gaps>
          <h3 className="text-sm font-semibold">평가액을 확인하지 못한 보유종목</h3>
          <ul className="mt-2 space-y-1 text-sm text-[var(--warning)]">
            {model.valuationGaps.map((gap, index) => (
              <li key={`${gap.account}-${gap.ticker ?? gap.name}-${index}`}>
                {gap.name} · {gap.account} · {valuationGapLabel(gap.reason)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {model.identityGaps.length > 0 ? (
        <div className="mt-4" data-owner-simulation-identity-gaps>
          <h3 className="text-sm font-semibold">종목 식별을 완료하지 못한 보유종목</h3>
          <ul className="mt-2 space-y-1 text-sm text-[var(--warning)]">
            {model.identityGaps.map((gap, index) => (
              <li key={`${gap.account}-${gap.ticker ?? gap.name}-${index}`}>
                {gap.name} · {gap.account} · {formatKrw(gap.currentValueKrw)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
        저장 이력이 일부 부족해도 확인 가능한 종목과 비중은 숨기지 않습니다. 부족한
        상장 종목은 임의의 평균값이나 현재 가격으로 과거를 만들지 않으며, 공급자 보강
        경로가 준비되기 전까지 부족한 범위를 명시한 진단을 제공합니다.
      </p>
    </section>
  );
}

function Metric({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
      {detail ? <dd className="mt-1 text-xs text-[var(--muted)]">{detail}</dd> : null}
    </div>
  );
}

function historyCoverageDetail(model: SimulationOwnerInputPreflightModel) {
  if (!model.evidenceSummary) return "저장 이력 점검 전 또는 입력 진단 필요";
  const manual = model.evidenceSummary.manualHistoryRequiredWeightBps;
  return manual > 0
    ? `수동 이력 필요 ${formatWeight(manual)}`
    : "양수 비중 중 사용 가능한 이력";
}

function blockerLabel(blocker: SimulationOwnerInputPreflightModel["blockers"][number]) {
  const labels = {
    account_scope_mismatch: "계좌 범위가 서버 조회 결과와 일치하지 않음",
    empty_positive_portfolio: "평가액이 양수인 보유종목이 없음",
    valuation_evidence_incomplete: "현재 평가액을 확인하지 못한 보유종목이 있음",
    instrument_identity_unresolved: "종목 식별자를 확정하지 못한 보유종목이 있음",
    instrument_limit_exceeded: "분석 가능한 최대 종목 수를 초과함",
    weight_derivation_failed: "현재 평가액 기반 비중 계산을 완료하지 못함",
  } as const;
  return labels[blocker];
}

function historyStatusLabel(status: string) {
  const labels: Record<string, string> = {
    not_evaluated: "과거 이력 점검 전",
    provenance_ready_for_separate_review: "저장 이력 사용 가능",
    stored_coverage_incomplete: "저장 이력 부족",
    provenance_incomplete: "출처 근거 부족",
    zero_weight_not_evaluated: "0bps 행 보존",
    excluded_by_policy: "정책상 제외",
    manual_history_required: "수동 평가 이력 필요",
    identity_unresolved: "종목 식별 필요",
  };
  return labels[status] ?? "부분 진단";
}

function historyStatusClass(status: string) {
  return status === "provenance_ready_for_separate_review"
    ? "font-semibold text-[var(--brand)]"
    : status === "zero_weight_not_evaluated" || status === "excluded_by_policy"
      ? "font-semibold text-[var(--muted)]"
      : "font-semibold text-[var(--warning)]";
}

function valuationGapLabel(reason: string) {
  const labels: Record<string, string> = {
    missing_price: "현재 가격 없음",
    missing_fx: "환율 없음",
    unsupported_currency: "지원하지 않는 통화",
  };
  return labels[reason] ?? reason;
}

function formatWeight(weightBps: number) {
  return `${(weightBps / 100).toFixed(2)}%`;
}

function formatKrw(value: number) {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(Math.round(value))}원`;
}
