import { InvestmentLabComparisonChart } from "./investment-lab-comparison-chart";
import type { InvestmentLabAnchorBlocker } from "@/lib/investment-lab-anchor-basket-anchor";
import type { InvestmentLabAnchorBasketScenario } from "@/lib/investment-lab-anchor-basket-scenario";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabPeriodSelection } from "@/lib/investment-lab-period-selection";
import type { InvestmentLabAnchorSpecialHoldingEvidence } from "@/lib/investment-lab-special-holding-authority";

export function InvestmentLabAnchorBasket({
  model,
  period,
  fixedMixSelection,
}: {
  model: InvestmentLabAnchorBasketScenario;
  period: InvestmentLabPeriodSelection;
  fixedMixSelection: InvestmentLabFixedMixSelection;
}) {
  const ready = model.status === "ready" && model.summary !== null;
  const anchor = model.anchor;

  return (
    <section
      className="border-t border-[#dfe3d5] bg-[#f3f4ef] px-4 py-6"
      data-anchor-basket-candidate-dates={anchor.candidateAnchorDates.length}
      data-anchor-basket-comparison-dates={
        ready ? model.summary!.comparisonDateCount : 0
      }
      data-anchor-basket-economic-instruments={
        anchor.coverage.economicInstrumentCount
      }
      data-anchor-basket-policy={model.policy.version}
      data-anchor-basket-selected-date={anchor.selectedAnchorDate ?? ""}
      data-anchor-basket-source-rows={anchor.coverage.sourcePositionRows}
      data-anchor-basket-status={model.status}
      data-anchor-basket-unresolved-rows={
        anchor.coverage.unresolvedPositionRows
      }
      data-section="investment-lab-anchor-basket"
    >
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[#657065]">
              Historical research
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              기준일 바스켓: 초기 동일비중·흐름 균등배분
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
              선택한 과거 기준일에 실제로 저장된 종목만 사용합니다. 기준일에만
              동일비중으로 시작하고 이후 실제 매수·매도 금액은 종목마다 같은
              비율로 나눠 적용하며 자동 리밸런싱은 하지 않습니다.
            </p>
          </div>
          <AnchorForm
            anchorDates={anchor.candidateAnchorDates}
            fixedMixSelection={fixedMixSelection}
            period={period}
            selectedAnchorDate={anchor.selectedAnchorDate}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCell
            label="선택 기준일"
            value={formatDate(anchor.selectedAnchorDate)}
          />
          <SummaryCell
            label="저장 포지션"
            value={`${anchor.coverage.sourcePositionRows}건`}
          />
          <SummaryCell
            label="식별 가능한 종목"
            value={`${anchor.coverage.economicInstrumentCount}개`}
          />
          <SummaryCell
            label="미식별 포지션"
            tone={
              anchor.coverage.unresolvedPositionRows > 0
                ? "negative"
                : "neutral"
            }
            value={`${anchor.coverage.unresolvedPositionRows}건`}
          />
        </div>

        {ready ? (
          <ReadyResult model={model as ReadyScenario} />
        ) : (
          <UnavailableResult model={model} />
        )}

        <SpecialHoldingEvidence rows={anchor.specialHoldingEvidence} />

        <p className="text-xs leading-5 text-[#73786c]">
          현재 보유 종목을 더 오래된 과거로 소급하지 않습니다. ticker·시장·통화,
          종가, USD/KRW 근거가 한 종목이라도 없으면 일부 종목만 제외한 그래프를
          만들지 않고 전체 비교를 중단합니다. 이 결과는 연구용 비교이며 목표비중,
          추천 또는 주문 근거가 아닙니다.
        </p>
      </div>
    </section>
  );
}

function SpecialHoldingEvidence({
  rows,
}: {
  rows: readonly InvestmentLabAnchorSpecialHoldingEvidence[];
}) {
  if (rows.length === 0) return null;
  const resolvedCount = rows.filter(
    (row) => row.identityStatus === "resolved",
  ).length;
  const eligibleCount = rows.filter(
    (row) =>
      row.historicalAuthorityOutcome === "eligible_historical_instrument",
  ).length;
  const separateModelCount = rows.filter(
    (row) =>
      row.historicalAuthorityOutcome === "separate_valuation_model_required",
  ).length;
  const unsupportedCount = rows.filter(
    (row) => row.historicalAuthorityOutcome === "permanently_unsupported",
  ).length;
  return (
    <div
      className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
      data-anchor-special-holding-eligible={eligibleCount}
      data-anchor-special-holding-resolved={resolvedCount}
      data-anchor-special-holding-rows={rows.length}
      data-anchor-special-holding-separate-model={separateModelCount}
      data-anchor-special-holding-unavailable={rows.length - resolvedCount}
      data-anchor-special-holding-unsupported={unsupportedCount}
      data-section="investment-lab-anchor-special-holding-evidence"
    >
      <div className="border-b border-[#e1e6dc] px-4 py-3">
        <h3 className="font-semibold">ticker 없는 저장 포지션 근거</h3>
        <p className="mt-1 text-xs leading-5 text-[#687064]">
          이름이나 현재 자산값으로 종목을 추론하지 않습니다. 같은 legacy 자산의
          Base44 이관 스냅샷 메타데이터와 ticker가 합의될 때만 복구합니다.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
              <th className="px-4 py-3">저장 포지션</th>
              <th className="px-3 py-3">계좌·축</th>
              <th className="px-3 py-3">identity 상태</th>
              <th className="px-3 py-3">과거 평가 판정</th>
              <th className="px-4 py-3">판정 근거</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className="border-t border-[#e1e6dc] align-top"
                data-special-holding-status={row.identityStatus}
                key={`${row.account}:${row.name}:${row.source ?? "unknown"}`}
              >
                <td className="px-4 py-3 font-semibold">{row.name}</td>
                <td className="px-3 py-3 text-[#5f685d]">
                  {row.account} · {row.market ?? "-"}/{row.currency ?? "-"}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={
                      row.identityStatus === "resolved"
                        ? "font-semibold text-[#08784d]"
                        : "font-semibold text-[#9a6b18]"
                    }
                  >
                    {row.identityStatus === "resolved"
                      ? `listed ${row.resolvedTicker}`
                      : "사용 불가"}
                  </span>
                </td>
                <td className="px-3 py-3 font-semibold text-[#34443d]">
                  {specialHoldingOutcomeLabel(
                    row.historicalAuthorityOutcome,
                  )}
                </td>
                <td className="px-4 py-3 text-[#5f685d]">
                  {specialHoldingReasonLabel(row.reason)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ReadyScenario = InvestmentLabAnchorBasketScenario & Readonly<{
  status: "ready";
  summary: NonNullable<InvestmentLabAnchorBasketScenario["summary"]>;
}>;

function ReadyResult({ model }: { model: ReadyScenario }) {
  const summary = model.summary!;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          label="종료 평가액"
          value={formatKrw(summary.scenarioEndValueKrw)}
        />
        <SummaryCell
          label="실제 대비 차이"
          tone={summary.endDifferenceKrw >= 0 ? "positive" : "negative"}
          value={formatSignedKrw(summary.endDifferenceKrw)}
        />
        <SummaryCell
          label="기준일 종목당 비중"
          value={`${summary.equalWeightPct.toFixed(2)}%`}
        />
        <SummaryCell
          label="현금흐름 조정 추정 수익률"
          tone={
            (model.returnEstimate?.scenarioReturn ?? 0) >= 0
              ? "positive"
              : "negative"
          }
          value={
            model.returnEstimate
              ? formatSignedPercent(model.returnEstimate.scenarioReturn)
              : "계산 불가"
          }
        />
      </div>
      <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <InvestmentLabComparisonChart
          chartId="investment-lab-anchor-basket-chart"
          description="실제 포트폴리오와 기준일 저장 보유 종목을 동일비중으로 시작한 same-flow 경로를 비교합니다."
          rows={model.rows}
          scenarioLabel="기준일 바스켓"
          title="실제 포트폴리오와 기준일 보유 바스켓 비교"
        />
      </div>
      <p className="text-sm text-[#687064]">
        종목 {summary.instrumentCount}개 · 비교일 {summary.comparisonDateCount}개
        · 실제 흐름 {model.coverage.sourceFlowCount}건 · 종목별 체결 근거 {" "}
        {model.coverage.scenarioFlowLegCount}건
      </p>
    </div>
  );
}

function UnavailableResult({ model }: { model: InvestmentLabAnchorBasketScenario }) {
  const reasons = [
    ...model.anchor.blockers.map(anchorBlockerLabel),
    ...model.evidenceBlockers.slice(0, 4).map((row) =>
      [evidenceBlockerLabel(row.reason), row.instrumentKey, row.evidenceDate]
        .filter(Boolean)
        .join(" · "),
    ),
  ];
  return (
    <div className="rounded-md border border-[#ead9b2] bg-[#fff9ea] px-4 py-3 text-sm leading-6 text-[#73551b]">
      <p className="font-semibold">전체 바스켓 비교를 만들 수 없습니다.</p>
      <p>
        {reasons.length > 0
          ? reasons.join(" / ")
          : "필요한 저장 포지션·가격·환율 근거가 완전하지 않습니다."}
      </p>
      <p className="mt-1">
        식별 가능한 종목만 골라 결과를 과장하지 않기 위해 그래프를 숨겼습니다.
      </p>
    </div>
  );
}

function AnchorForm({
  anchorDates,
  selectedAnchorDate,
  period,
  fixedMixSelection,
}: {
  anchorDates: readonly string[];
  selectedAnchorDate: string | null;
  period: InvestmentLabPeriodSelection;
  fixedMixSelection: InvestmentLabFixedMixSelection;
}) {
  if (anchorDates.length === 0) return null;
  return (
    <form action="/investment-lab" className="flex items-end gap-2" method="get">
      <PeriodHiddenInputs period={period} />
      {fixedMixSelection.kodexWeightPct !== null ? (
        <input
          name="kodexWeight"
          type="hidden"
          value={fixedMixSelection.kodexWeightPct}
        />
      ) : null}
      <label className="grid gap-1 text-xs font-semibold text-[#586358]">
        기준일
        <select
          className="h-10 rounded-md border border-[#cfd5c9] bg-white px-3 text-sm outline-none"
          defaultValue={selectedAnchorDate ?? anchorDates[0]}
          name="basketAnchor"
        >
          {anchorDates.map((date) => (
            <option key={date} value={date}>
              {formatDate(date)}
            </option>
          ))}
        </select>
      </label>
      <button
        className="h-10 rounded-md bg-[#173c35] px-4 text-sm font-semibold text-white"
        type="submit"
      >
        적용
      </button>
    </form>
  );
}

function PeriodHiddenInputs({ period }: { period: InvestmentLabPeriodSelection }) {
  if (
    period.status !== "selected" ||
    !period.selectedStartServiceDate ||
    !period.selectedEndServiceDate
  ) {
    return null;
  }
  return (
    <>
      <input name="start" type="hidden" value={period.selectedStartServiceDate} />
      <input name="end" type="hidden" value={period.selectedEndServiceDate} />
    </>
  );
}

function SummaryCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p
        className={`mt-2 text-xl font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#08784d]"
            : tone === "negative"
              ? "text-[#bd2929]"
              : "text-[#111411]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function anchorBlockerLabel(reason: InvestmentLabAnchorBlocker) {
  const labels: Record<InvestmentLabAnchorBlocker, string> = {
    invalid_service_date_axis: "비교 날짜 축이 유효하지 않음",
    no_complete_anchor_evidence: "포트폴리오와 포지션이 함께 저장된 기준일 없음",
    requested_anchor_unavailable: "선택한 기준일 근거 없음",
    ambiguous_portfolio_source: "포트폴리오 저장 출처가 중복됨",
    tickerless_anchor_holding: "ticker가 없는 저장 포지션 존재",
    unsupported_anchor_holding_axis: "지원하지 않는 시장·통화 포지션 존재",
    physical_anchor_holding: "별도 가격 근거가 필요한 실물 포지션 존재",
    invalid_anchor_position_evidence: "수량 또는 평가액 근거가 유효하지 않음",
    duplicate_anchor_identity: "같은 계좌의 종목 identity가 중복됨",
    ambiguous_anchor_identity_metadata: "종목 이름 근거가 서로 다름",
    instrument_limit_exceeded: "기준일 종목 수 상한 초과",
  };
  return labels[reason];
}

function evidenceBlockerLabel(reason: string) {
  if (reason.includes("price")) return "필요 종가 근거 누락 또는 중복";
  if (reason.includes("fx")) return "필요 환율 근거 누락 또는 중복";
  if (reason.includes("execution")) return "매수·매도 체결 근거 불완전";
  return "계산 근거 불완전";
}

function specialHoldingReasonLabel(
  reason: InvestmentLabAnchorSpecialHoldingEvidence["reason"],
) {
  const labels: Record<
    InvestmentLabAnchorSpecialHoldingEvidence["reason"],
    string
  > = {
    stored_snapshot_ticker_recovered:
      "Base44 이관 포지션 ticker 합의로 복구",
    stored_snapshot_ticker_conflict: "이관 포지션 ticker가 서로 충돌",
    stored_snapshot_metadata_mismatch: "이관 포지션 메타데이터 불일치",
    instrument_keyed_official_close_required:
      "실물 commodity용 instrument-keyed 공식 종가 모델 필요",
    explicit_product_classification_required:
      "명시적 상품 분류와 평가 권위 필요",
    non_investment_asset_type_unsupported: "투자 바스켓 제외 자산 유형",
  };
  return labels[reason];
}

function specialHoldingOutcomeLabel(
  outcome: InvestmentLabAnchorSpecialHoldingEvidence["historicalAuthorityOutcome"],
) {
  if (outcome === "eligible_historical_instrument") {
    return "과거 종목 후보";
  }
  if (outcome === "separate_valuation_model_required") {
    return "별도 평가 모델 필요";
  }
  return "지원하지 않음";
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "-";
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatSignedKrw(value: number) {
  return `${value >= 0 ? "+" : "-"}₩${Math.abs(Math.round(value)).toLocaleString(
    "ko-KR",
  )}`;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
