import type {
  InvestmentLabStressReplay,
  InvestmentLabStressReplayStrategy,
  InvestmentLabStressReplayWindow,
} from "@/lib/investment-lab-stress-replay";

const STRATEGY_COLORS = Object.freeze({
  current_composition: "#173f38",
  equal_weight: "#4077a6",
  kodex200: "#df5b45",
  voo: "#7a5b9e",
  cash: "#777e73",
} as const);

export function InvestmentLabStressReplayView({
  model,
}: {
  model: InvestmentLabStressReplay;
}) {
  return (
    <section
      aria-labelledby="investment-lab-stress-replay-title"
      className="mx-auto w-full max-w-[1540px] space-y-10 border-t border-[#dde1db] px-5 py-16 sm:px-8 lg:px-10"
      data-account-scope={model.account}
      data-section="investment-lab-stress-replay"
      data-window-count={model.windows.length}
    >
      <header className="border-b border-[#dde1db] pb-8">
        <p className="text-[10px] font-medium uppercase text-[#777d75]">
          STRESS REPLAY
        </p>
        <h2
          className="mt-3 text-2xl font-semibold sm:text-3xl"
          id="investment-lab-stress-replay-title"
        >
          지금 구성으로 과거를 다시 지나갔다면
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-[#626b5f]">
          현재 보유 비중을 각 과거 구간의 첫날에 적용한 뒤 리밸런싱 없이
          보유했다고 가정합니다. 당시 상장 전이거나 가격 근거가 부족한 종목은
          임의로 채우지 않고 제외하며, 포함된 현재 평가액 비율을 함께 표시합니다.
        </p>
        <p className="mt-2 text-xs text-[#777e73]">
          세금·수수료·배당 재투자는 반영하지 않은 연구용 비교이며 투자 추천이
          아닙니다.
        </p>
      </header>

      <div className="space-y-4">
        {model.windows.map((window) => (
          <StressWindowCard key={window.id} window={window} />
        ))}
      </div>
    </section>
  );
}

export function InvestmentLabStressReplaySkeleton() {
  return (
    <section className="mx-auto w-full max-w-[1540px] space-y-4 border-t border-[#dde1db] px-5 py-16 sm:px-8 lg:px-10">
      <div className="h-32 animate-pulse border-y border-[#dde1db] bg-[#f2f4ef]" />
      <div className="h-72 animate-pulse border-y border-[#dde1db] bg-[#f2f4ef]" />
    </section>
  );
}

export function InvestmentLabStressReplayUnavailable() {
  return (
    <section
      className="mx-auto w-full max-w-[1540px] border-t border-[#dde1db] px-5 py-16 sm:px-8 lg:px-10"
      data-section="investment-lab-stress-replay"
      data-stress-replay-status="unavailable"
    >
      <div className="border-y border-[#d8c69d] py-4 text-sm text-[#725f2d]">
        과거 구간 비교 근거를 읽지 못했습니다. 기존 투자 랩 결과를 추정값으로
        대체하지 않았습니다.
      </div>
    </section>
  );
}

function StressWindowCard({ window }: { window: InvestmentLabStressReplayWindow }) {
  const readyStrategies = window.strategies.filter(
    (strategy) => strategy.status === "ready",
  );
  const hasMarketEvidence = readyStrategies.some(
    (strategy) => strategy.id !== "cash",
  );

  return (
    <article
      className="overflow-hidden rounded-[4px] border border-[#dfe3d5] bg-[#fbfcf7]"
      data-current-value-coverage={window.currentValueCoveragePct.toFixed(2)}
      data-eligible-instruments={window.eligibleInstrumentCount}
      data-stress-window={window.id}
      data-stress-window-status={window.status}
    >
      <header className="border-b border-[#e1e6dc] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{window.label}</h3>
            <p className="mt-1 text-sm text-[#687064]">{window.description}</p>
            <p className="mt-1 text-xs tabular-nums text-[#777e73]">
              {formatDate(window.startDate)} ~ {formatDate(window.endDate)}
            </p>
          </div>
          <StatusBadge status={window.status} />
        </div>
      </header>

      <div className="grid border-b border-[#e1e6dc] sm:grid-cols-3">
        <Metric
          detail={`${formatKrw(window.eligibleCurrentValueKrw)} / ${formatKrw(window.scopedCurrentValueKrw)}`}
          label="현재 평가액 커버리지"
          value={`${window.currentValueCoveragePct.toFixed(1)}%`}
        />
        <Metric
          detail={`제외 보유행 ${window.excludedHoldingCount}개`}
          label="당시 비교 가능 종목"
          value={`${window.eligibleInstrumentCount}개`}
        />
        <Metric
          detail="종목별 한 가지 근거만 선택"
          label="가격 근거"
          value={`조정 ${window.priceBasis.adjustedInstrumentCount} · 원종가 ${window.priceBasis.privateRawInstrumentCount}`}
        />
      </div>

      {hasMarketEvidence ? (
        <>
          <div className="border-b border-[#e1e6dc] p-4">
            <StressReplayChart strategies={readyStrategies} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-y border-[#e1e6dc] text-left text-xs font-semibold text-[#616a5e]">
                  <th className="px-4 py-3">비교 구성</th>
                  <th className="px-3 py-3 text-right">구간 수익률</th>
                  <th className="px-3 py-3 text-right">최대 낙폭</th>
                  <th className="px-4 py-3 text-right">최악의 하루</th>
                </tr>
              </thead>
              <tbody>
                {window.strategies.map((strategy) => (
                  <StrategyRow key={strategy.id} strategy={strategy} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="p-4 text-sm text-[#725f2d]">
          이 구간을 재생할 수 있는 가격 근거가 아직 없습니다. 종목을 임의의
          평균값으로 대체하지 않았습니다.
        </div>
      )}

      {window.excludedHoldings.length > 0 ? (
        <details className="border-t border-[#e1e6dc] px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-[#4f594e]">
            제외 근거 {window.excludedHoldings.length}건
          </summary>
          <ul className="mt-3 grid gap-2 text-[#687064] sm:grid-cols-2">
            {window.excludedHoldings.map((row, index) => (
              <li key={`${row.account}:${row.ticker ?? row.name}:${index}`}>
                <strong className="text-[#303a31]">
                  {row.ticker ?? row.name}
                </strong>{" "}
                · {row.account} · {exclusionReasonLabel(row.reason)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

function StressReplayChart({
  strategies,
}: {
  strategies: readonly InvestmentLabStressReplayStrategy[];
}) {
  const width = 760;
  const height = 220;
  const padding = 24;
  const values = strategies.flatMap((strategy) =>
    strategy.path.map((row) => row.normalizedValue),
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, 0.02);
  const min = rawMin - spread * 0.08;
  const max = rawMax + spread * 0.08;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#626b5f]">
        {strategies.map((strategy) => (
          <span className="inline-flex items-center gap-1.5" key={strategy.id}>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: STRATEGY_COLORS[strategy.id] }}
            />
            {strategy.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg
          aria-label="과거 구간 정규화 자산 경로"
          className="h-auto min-w-[680px] w-full"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              stroke="#dfe3d5"
              strokeDasharray="4 5"
              x1={padding}
              x2={width - padding}
              y1={padding + (height - padding * 2) * ratio}
              y2={padding + (height - padding * 2) * ratio}
            />
          ))}
          {strategies.map((strategy) => (
            <path
              d={linePath(strategy, { width, height, padding, min, max })}
              fill="none"
              key={strategy.id}
              stroke={STRATEGY_COLORS[strategy.id]}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={strategy.id === "current_composition" ? 3 : 2}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

function StrategyRow({ strategy }: { strategy: InvestmentLabStressReplayStrategy }) {
  return (
    <tr className="border-t border-[#e1e6dc]">
      <td className="px-4 py-3 font-medium">
        <span
          aria-hidden="true"
          className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: STRATEGY_COLORS[strategy.id] }}
        />
        {strategy.label}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatSignedPct(strategy.periodReturnPct)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {strategy.maxDrawdownPct === null
          ? "-"
          : `-${strategy.maxDrawdownPct.toFixed(2)}%`}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatSignedPct(strategy.worstDayPct)}
      </td>
    </tr>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="border-t border-[#e1e6dc] p-4 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#777e73]">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: InvestmentLabStressReplayWindow["status"] }) {
  const label =
    status === "ready" ? "전체 근거" : status === "partial" ? "부분 근거" : "근거 부족";
  const className =
    status === "ready"
      ? "border-[#cce2d5] bg-[#edf7f0] text-[#1d6546]"
      : status === "partial"
        ? "border-[#eadfbe] bg-[#fff9e8] text-[#725f2d]"
        : "border-[#ead0d0] bg-[#fff1f1] text-[#8a3636]";
  return (
    <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function linePath(
  strategy: InvestmentLabStressReplayStrategy,
  bounds: {
    width: number;
    height: number;
    padding: number;
    min: number;
    max: number;
  },
) {
  const { width, height, padding, min, max } = bounds;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;
  return strategy.path
    .map((row, index) => {
      const x =
        padding +
        (strategy.path.length > 1 ? index / (strategy.path.length - 1) : 0) *
          drawableWidth;
      const y = padding + ((max - row.normalizedValue) / (max - min)) * drawableHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function exclusionReasonLabel(
  reason: InvestmentLabStressReplayWindow["excludedHoldings"][number]["reason"],
) {
  return {
    missing_ticker: "시장 종목 식별자 없음",
    unsupported_currency: "지원하지 않는 통화",
    non_positive_value: "현재 평가액 없음",
    insufficient_price_history: "해당 구간 가격 이력 부족",
    insufficient_fx_history: "해당 구간 환율 이력 부족",
  }[reason];
}

function formatSignedPct(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}
