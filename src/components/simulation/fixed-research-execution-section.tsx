import Link from "next/link";

import type { FixedResearchSimulationResult } from "@/lib/simulation-fixed-research-execution";

type ReadyExecution = Extract<
  FixedResearchSimulationResult,
  { status: "ready" }
>;

export function FixedResearchExecutionSection({
  executions,
  recommendedEndServiceDate,
}: {
  executions: readonly FixedResearchSimulationResult[];
  recommendedEndServiceDate: string | null;
}) {
  const readyCount = executions.filter(
    (execution) => execution.status === "ready",
  ).length;

  return (
    <section
      aria-labelledby="fixed-research-execution-title"
      className="border-b border-[#d7ddcf] py-5"
      data-fixed-research-execution
      data-ready-execution-count={readyCount}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="fixed-research-execution-title" className="text-lg font-semibold">
            3개월 연구 시뮬레이션
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            선택한 기준일까지의 90개 수익률을 5거래일 묶음으로 재표본해
            63거래일 경로 500개를 계산합니다. 두 종목은 각각 100% 보유한 경우로
            독립 실행하며, 같은 난수표를 써 비교 오차를 줄입니다.
          </p>
        </div>
        <span className="w-fit rounded-md border border-[#d8d9e5] bg-[#f2f2f8] px-3 py-1.5 text-xs font-semibold text-[#52566f]">
          연구용 · 저장 안 함 · 예측 아님
        </span>
      </div>

      {readyCount === 0 && recommendedEndServiceDate ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[#e6d8ae] bg-[#fff9e9] px-4 py-3 text-sm text-[#62542c] sm:flex-row sm:items-center sm:justify-between">
          <p>
            현재 기준일의 완전한 입력이 없습니다. 확인된 최근 관측일을 자동 적용하지
            않고, 직접 선택하면 그 날짜로 실행합니다.
          </p>
          <Link
            href={`/simulation?end=${recommendedEndServiceDate}`}
            className="inline-flex w-fit shrink-0 rounded-md border border-[#cdbf95] bg-white px-3 py-2 font-semibold text-[#4f462c] hover:bg-[#f4efdf]"
          >
            {formatDate(recommendedEndServiceDate)}로 실행
          </Link>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {executions.map((execution) =>
          execution.status === "ready" ? (
            <ResearchExecutionPanel execution={execution} key={execution.id} />
          ) : (
            <UnavailableExecutionPanel execution={execution} key={execution.id} />
          ),
        )}
      </div>
    </section>
  );
}

function ResearchExecutionPanel({ execution }: { execution: ReadyExecution }) {
  return (
    <article
      className="overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
      data-research-execution={execution.id}
      data-research-execution-status="ready"
      data-research-horizon={execution.assumptions.horizon}
      data-research-path-count={execution.assumptions.pathCount}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[#e1e5da] px-4 py-4">
        <div>
          <p className="text-xs font-semibold text-[#687064]">단일 종목 100%</p>
          <h3 className="mt-1 text-lg font-semibold">
            {execution.ticker} · {execution.name}
          </h3>
        </div>
        <span className="rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]">
          계산 완료
        </span>
      </header>

      <div className="grid grid-cols-2 border-b border-[#e1e5da] sm:grid-cols-4">
        <Metric label="중앙 경로 수익률" value={formatSignedPct(execution.terminal.p50ReturnPct)} />
        <Metric label="손실 종료 확률" value={formatPct(execution.terminal.lossProbabilityPct)} />
        <Metric label="MDD 중앙값" value={formatPct(execution.terminal.maxDrawdownP50Pct)} />
        <Metric label="MDD 상위 10%" value={formatPct(execution.terminal.maxDrawdownP90Pct)} />
      </div>

      <ResearchFanChart execution={execution} />

      <div className="grid border-t border-[#e1e5da] text-xs text-[#687064] sm:grid-cols-2">
        <p className="px-4 py-3 sm:border-r sm:border-[#e1e5da]">
          종료 분포 P10 {execution.terminal.p10Index.toFixed(1)} · P50{" "}
          {execution.terminal.p50Index.toFixed(1)} · P90{" "}
          {execution.terminal.p90Index.toFixed(1)}
        </p>
        <p className="px-4 py-3">
          기준일 {formatDate(execution.source.endServiceDate)} · 시작지수 100 ·
          수수료·세금·리밸런싱 미포함
        </p>
      </div>
    </article>
  );
}

function UnavailableExecutionPanel({
  execution,
}: {
  execution: Exclude<FixedResearchSimulationResult, { status: "ready" }>;
}) {
  return (
    <article
      className="rounded-lg border border-[#e6d8ae] bg-[#fffdf6] px-4 py-4"
      data-research-execution={execution.id}
      data-research-execution-status="unavailable"
      data-research-unavailable-reason={execution.reason}
    >
      <p className="text-xs font-semibold text-[#786b49]">단일 종목 100%</p>
      <h3 className="mt-1 text-lg font-semibold">
        {execution.ticker} · {execution.name}
      </h3>
      <p className="mt-3 text-sm leading-6 text-[#6b6044]">
        {unavailableReasonLabel(execution.reason)}
      </p>
    </article>
  );
}

function ResearchFanChart({ execution }: { execution: ReadyExecution }) {
  const width = 760;
  const height = 280;
  const padding = 28;
  const values = [
    ...execution.bands.flatMap((band) => [band.p10, band.p50, band.p90]),
    ...execution.samplePaths.flatMap((path) =>
      path.points.map((point) => point.indexValue),
    ),
  ];
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = Math.max(rawMax - rawMin, 1);
  const min = rawMin - spread * 0.08;
  const max = rawMax + spread * 0.08;
  const x = (stepIndex: number) =>
    padding +
    (stepIndex / execution.assumptions.horizon) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - min) / (max - min)) * (height - padding * 2);
  const bandArea = [
    ...execution.bands.map((band) => [x(band.stepIndex), y(band.p90)] as const),
    ...[...execution.bands]
      .reverse()
      .map((band) => [x(band.stepIndex), y(band.p10)] as const),
  ];

  return (
    <figure className="px-3 py-4" data-research-fan-chart={execution.id}>
      <svg
        aria-label={`${execution.name} 연구 시뮬레이션 경로와 P10 P50 P90 구간`}
        className="h-auto w-full"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          stroke="#d5dacf"
          strokeDasharray="4 5"
          x1={padding}
          x2={width - padding}
          y1={y(100)}
          y2={y(100)}
        />
        <path d={closedPath(bandArea)} fill="#dce8de" opacity="0.9" />
        {execution.samplePaths.map((path) => (
          <path
            d={linePath(
              path.points.map((point) => [
                x(point.stepIndex),
                y(point.indexValue),
              ]),
            )}
            fill="none"
            key={path.pathIndex}
            opacity="0.22"
            stroke="#78867a"
            strokeWidth="1"
          />
        ))}
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p10)]),
          )}
          fill="none"
          stroke="#8ca295"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p90)]),
          )}
          fill="none"
          stroke="#8ca295"
          strokeDasharray="5 4"
          strokeWidth="1.5"
        />
        <path
          d={linePath(
            execution.bands.map((band) => [x(band.stepIndex), y(band.p50)]),
          )}
          fill="none"
          stroke="#173f38"
          strokeWidth="2.5"
        />
        <text fill="#687064" fontSize="11" x={padding} y={height - 6}>
          시작
        </text>
        <text
          fill="#687064"
          fontSize="11"
          textAnchor="end"
          x={width - padding}
          y={height - 6}
        >
          63거래일
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-[#687064]">
        <span>진한 선: 중앙값(P50)</span>
        <span>연한 구간: P10~P90</span>
        <span>가는 선: 대표 경로 12개</span>
      </figcaption>
    </figure>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-r border-[#e1e5da] px-3 py-3 last:border-r-0 sm:border-b-0">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function linePath(points: readonly (readonly [number, number])[]) {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
}

function closedPath(points: readonly (readonly [number, number])[]) {
  return `${linePath(points)} Z`;
}

function unavailableReasonLabel(
  reason: Exclude<FixedResearchSimulationResult, { status: "ready" }>["reason"],
) {
  const labels = {
    explicit_end_required:
      "연구 실행은 기준일을 직접 선택한 뒤에만 시작합니다.",
    input_matrix_unavailable:
      "이 기준일에는 완전한 90개 수익률 입력이 없어 실행하지 않았습니다.",
    input_matrix_shape_mismatch:
      "입력 기간 또는 종목 구성이 고정 연구 규격과 일치하지 않습니다.",
    research_vector_invalid:
      "단일 종목 100% 연구 가정을 검증하지 못했습니다.",
    draw_plan_blocked: "재표본 추출 계획을 만들지 못했습니다.",
    gross_growth_blocked: "재표본 경로의 누적 수익률을 계산하지 못했습니다.",
    normalized_nav_blocked: "정규화 경로를 계산하지 못했습니다.",
    summary_blocked: "경로는 계산했지만 분포·위험 요약 검증을 통과하지 못했습니다.",
  } as const;
  return labels[reason];
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatSignedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
