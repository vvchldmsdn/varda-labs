import Link from "next/link";

import type {
  InvestmentLabObservedHistory,
  InvestmentLabObservedHistorySegment,
} from "@/lib/investment-lab-observed-history-segments";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScopeKey,
  type PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";

const WIDTH = 1000;
const HEIGHT = 300;
const PADDING_X = 48;
const PADDING_Y = 28;

export function InvestmentLabObservedHistoryView({
  model,
  query,
  scopeKey,
}: {
  model: InvestmentLabObservedHistory;
  query: PortfolioAnalysisScopeQuery;
  scopeKey: PortfolioAnalysisScopeKey;
}) {
  if (model.status === "unavailable" || model.segments.length === 0) {
    return null;
  }

  const currentWriterSegment = model.segments
    .filter((segment) => segment.role === "current_writer")
    .at(-1);
  const latestCalculationHref =
    currentWriterSegment && currentWriterSegment.observationCount >= 2
      ? buildPortfolioAnalysisScopeHref("/investment-lab", scopeKey, {
          start: currentWriterSegment.startServiceDate,
          end: currentWriterSegment.endServiceDate,
          kodexWeight: query.kodexWeight,
          basketAnchor: query.basketAnchor,
        })
      : null;

  return (
    <section
      className="border-y border-[#dfe3d5] bg-[#fbfcf7] px-4 py-5"
      data-interpolation="none"
      data-observed-history-status={model.status}
      data-provider-backfill="none"
      data-segment-count={model.coverage.segmentCount}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">선택 구간 관측 경로</h2>
            <span className="rounded-md border border-[#eadfbe] bg-[#fff9e8] px-2 py-1 text-xs font-semibold text-[#725f2d]">
              부분 표시
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#626b5f]">
            저장 방식이 바뀐 지점은 연결하지 않았습니다. 아래 선은 실제로 저장된
            평가액만 표시하며, 비어 있는 날짜의 평균값 생성이나 외부 API 보충은
            하지 않습니다.
          </p>
        </div>
        {latestCalculationHref ? (
          <Link
            className="inline-flex h-10 items-center justify-center rounded-md bg-[#183f38] px-4 text-sm font-semibold text-white hover:bg-[#12332d]"
            href={latestCalculationHref}
          >
            최신 계산 가능 구간 열기
          </Link>
        ) : null}
      </div>

      <div className="mt-5">
        <ObservedHistoryChart segments={model.segments} />
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-4 border-t border-[#dfe3d5] pt-4 md:grid-cols-2">
        {model.segments.map((segment, index) => (
          <SegmentSummary
            key={`${segment.role}:${segment.startServiceDate}:${index}`}
            segment={segment}
          />
        ))}
      </div>

      <p className="mt-4 text-xs leading-5 text-[#777e73]">
        관측일 {model.coverage.admittedDateCount}일
        {model.coverage.skippedDateCount > 0
          ? ` · 입력 검증에서 제외 ${model.coverage.skippedDateCount}일`
          : ""}
        {" · "}구간 사이에는 수익률·시나리오 계산을 적용하지 않습니다.
      </p>
    </section>
  );
}

function ObservedHistoryChart({
  segments,
}: {
  segments: readonly InvestmentLabObservedHistorySegment[];
}) {
  const rows = segments.flatMap((segment) => segment.rows);
  const timestamps = rows.map((row) => Date.parse(`${row.serviceDate}T00:00:00Z`));
  const values = rows.map((row) => row.totalMarketValueKrw);
  const minTimestamp = Math.min(...timestamps);
  const maxTimestamp = Math.max(...timestamps);
  const timestampRange = Math.max(maxTimestamp - minTimestamp, 1);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valueRange = Math.max(maxValue - minValue, 1);
  const paddedMin = minValue - valueRange * 0.08;
  const paddedMax = maxValue + valueRange * 0.08;
  const x = (serviceDate: string) =>
    PADDING_X +
    ((Date.parse(`${serviceDate}T00:00:00Z`) - minTimestamp) / timestampRange) *
      (WIDTH - PADDING_X * 2);
  const y = (value: number) =>
    PADDING_Y +
    ((paddedMax - value) / (paddedMax - paddedMin)) *
      (HEIGHT - PADDING_Y * 2);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-sm text-[#5f665d]">
        <Legend color="#8a6b3d" label="이전 서비스 관측" />
        <Legend color="#1e3a34" label="현재 저장기 관측" />
        <span>점 하나가 실제 저장 관측일입니다.</span>
      </div>
      <svg
        aria-labelledby="observed-history-title observed-history-description"
        className="block h-auto w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title id="observed-history-title">저장 출처별 실제 평가액 관측 경로</title>
        <desc id="observed-history-description">
          레거시 관측과 현재 저장기 관측을 서로 연결하지 않고 표시한 그래프
        </desc>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = PADDING_Y + ratio * (HEIGHT - PADDING_Y * 2);
          return (
            <line
              key={ratio}
              stroke="#dfe3d8"
              strokeDasharray="4 6"
              strokeWidth="1"
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={lineY}
              y2={lineY}
            />
          );
        })}
        {segments.map((segment, index) => {
          const color = segmentColor(segment.role);
          const points = segment.rows
            .map(
              (row) =>
                `${x(row.serviceDate)},${y(row.totalMarketValueKrw)}`,
            )
            .join(" ");
          return (
            <g key={`${segment.role}:${segment.startServiceDate}:${index}`}>
              {segment.rows.length > 1 ? (
                <polyline
                  fill="none"
                  points={points}
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
              ) : null}
              {segment.rows.map((row) => (
                <circle
                  key={row.serviceDate}
                  cx={x(row.serviceDate)}
                  cy={y(row.totalMarketValueKrw)}
                  fill="#fbfcf7"
                  r="4"
                  stroke={color}
                  strokeWidth="3"
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-[#72786e]">
        <span>{formatDate(rows[0]?.serviceDate)}</span>
        <span>{formatDate(rows.at(-1)?.serviceDate)}</span>
      </div>
    </div>
  );
}

function SegmentSummary({
  segment,
}: {
  segment: InvestmentLabObservedHistorySegment;
}) {
  const firstValue = segment.rows[0].totalMarketValueKrw;
  const lastValue = segment.rows.at(-1)!.totalMarketValueKrw;
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm font-semibold">{segmentLabel(segment.role)}</p>
      <p className="mt-1 text-sm text-[#626b5f]">
        {formatDate(segment.startServiceDate)} ~ {formatDate(segment.endServiceDate)}
        {" · "}{segment.observationCount}개 관측
      </p>
      <p className="mt-2 text-sm tabular-nums text-[#394138]">
        {formatKrw(firstValue)} → {formatKrw(lastValue)}
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1 w-7 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function segmentColor(role: InvestmentLabObservedHistorySegment["role"]) {
  return role === "legacy_display" ? "#8a6b3d" : "#1e3a34";
}

function segmentLabel(role: InvestmentLabObservedHistorySegment["role"]) {
  return role === "legacy_display" ? "이전 서비스 관측" : "현재 저장기 관측";
}

function formatDate(value?: string) {
  return value ? value.replaceAll("-", ".") : "-";
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}
