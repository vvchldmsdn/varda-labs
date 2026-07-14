import type {
  InvestmentLabRollingComparison,
  InvestmentLabRollingWindow,
} from "@/lib/investment-lab-rolling-comparison";

export function InvestmentLabRollingComparisonView({
  model,
}: {
  model: InvestmentLabRollingComparison;
}) {
  return (
    <section
      aria-labelledby="investment-lab-rolling-title"
      className="mx-auto w-full max-w-[1500px] space-y-4 px-4 pb-4"
      data-rolling-candidate-windows={model.candidateWindowCount}
      data-rolling-complete-windows={model.completeWindowCount}
      data-rolling-excluded-windows={model.excludedWindowCount}
      data-rolling-observation-count={model.policy.observationCount}
      data-rolling-status={model.status}
      data-section="investment-lab-rolling-comparison"
    >
      <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <p className="text-xs font-semibold text-[#687064]">
          Historical hindsight · read-only
        </p>
        <h2
          id="investment-lab-rolling-title"
          className="mt-1 text-xl font-semibold sm:text-2xl"
        >
          과거 최고·최저 rolling 구간
        </h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[#626b5f]">
          저장된 완전 관측 구간 중 실제 포트폴리오의 현금흐름 조정
          추정수익률이 가장 높고 낮았던 {model.policy.observationCount}개 관측일을
          찾고, 같은 시작 평가액과 같은 매수·매도 흐름을 KODEX 200 및 VOO에
          적용한 결과를 나란히 비교합니다. 사후 해석이며 예측·추천·최적화가
          아닙니다.
        </p>
        <p className="mt-2 text-xs text-[#777e73]">
          후보 {model.candidateWindowCount}개 · 완전 관측 {model.completeWindowCount}
          개 · 근거 불완전으로 제외 {model.excludedWindowCount}개
        </p>
      </header>

      {model.status === "ready" && model.worstWindow && model.bestWindow ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <RollingWindowCard label="최저 구간" tone="negative" window={model.worstWindow} />
          <RollingWindowCard label="최고 구간" tone="positive" window={model.bestWindow} />
        </div>
      ) : (
        <div className="rounded-lg border border-[#eadfbe] bg-[#fff9e8] p-4 text-sm text-[#725f2d]">
          비교 가능한 완전 관측 rolling 구간이 2개 미만입니다. 일부 가격·환율·
          거래 일정으로 결과를 보충하지 않고 이 섹션 전체를 표시하지 않습니다.
        </div>
      )}
    </section>
  );
}

function RollingWindowCard({
  label,
  tone,
  window,
}: {
  label: string;
  tone: "positive" | "negative";
  window: InvestmentLabRollingWindow;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
      <header className="border-b border-[#e1e6dc] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3
            className={
              tone === "negative"
                ? "text-lg font-semibold text-[#a43c3c]"
                : "text-lg font-semibold text-[#16734a]"
            }
          >
            {label}
          </h3>
          <p className="text-sm tabular-nums text-[#626b5f]">
            {formatDate(window.startServiceDate)} ~ {formatDate(window.endServiceDate)}
          </p>
        </div>
        <p className="mt-1 text-xs text-[#777e73]">
          {window.observationCount}개 관측일 · 실제 흐름 {window.actualFlowCount}건
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="bg-[#eef2e8] text-left text-xs font-semibold text-[#616a5e]">
              <th className="px-4 py-3">경로</th>
              <th className="px-3 py-3 text-right">추정수익률</th>
              <th className="px-3 py-3 text-right">실제 대비</th>
              <th className="px-4 py-3 text-right">종료 평가액</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow
              difference={null}
              endValueKrw={window.actualEndValueKrw}
              label="실제 포트폴리오"
              returnValue={window.actualReturn}
            />
            <MetricRow
              difference={window.kodex200DifferencePercentagePoints}
              endValueKrw={window.kodex200EndValueKrw}
              label="전액 KODEX 200"
              returnValue={window.kodex200Return}
            />
            <MetricRow
              difference={window.vooDifferencePercentagePoints}
              endValueKrw={window.vooEndValueKrw}
              label="전액 VOO"
              returnValue={window.vooReturn}
            />
          </tbody>
        </table>
      </div>
    </article>
  );
}

function MetricRow({
  difference,
  endValueKrw,
  label,
  returnValue,
}: {
  difference: number | null;
  endValueKrw: number;
  label: string;
  returnValue: number;
}) {
  return (
    <tr className="border-t border-[#e1e6dc]">
      <td className="px-4 py-3 font-medium">{label}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatReturn(returnValue)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {difference === null ? "기준" : formatPercentagePoints(difference)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatKrw(endValueKrw)}
      </td>
    </tr>
  );
}

function formatReturn(value: number) {
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(2)}%`;
}

function formatPercentagePoints(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%p`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
