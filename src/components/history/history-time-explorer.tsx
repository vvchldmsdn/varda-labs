"use client";

import { useMemo, useState } from "react";

import {
  formatHistoryKrw,
  formatHistoryNumber,
  formatHistoryPercent,
  historySourceLabel,
} from "@/components/history/history-format";
import { HistoryPerformanceChart } from "@/components/history/history-performance-chart";
import { HistorySnapshotRail } from "@/components/history/history-snapshot-rail";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import {
  historyPointMetric,
  historyPointsWithMetric,
  selectHistoryRange,
  summarizeHistoryRange,
  type HistoryExplorerMode,
  type HistoryExplorerRange,
} from "@/lib/history-explorer";
import type {
  HistoryOverviewEvent,
  HistoryOverviewModel,
  HistoryOverviewPoint,
} from "@/lib/history-overview";

const RANGE_OPTIONS: readonly Readonly<{
  key: HistoryExplorerRange;
  label: string;
}>[] = Object.freeze([
  { key: "30D", label: "30일" },
  { key: "90D", label: "90일" },
  { key: "1Y", label: "1년" },
  { key: "ALL", label: "전체" },
]);

export function HistoryTimeExplorer({
  model,
  scopeLabel,
}: {
  model: HistoryOverviewModel;
  scopeLabel: string;
}) {
  const returnAvailable = model.points.some(
    (point) => point.totalReturnPct !== null,
  );
  const [mode, setMode] = useState<HistoryExplorerMode>(
    returnAvailable ? "return" : "value",
  );
  const [range, setRange] = useState<HistoryExplorerRange>("90D");
  const visiblePoints = useMemo(
    () => selectHistoryRange(model.points, range),
    [model.points, range],
  );
  const rangeSummary = useMemo(
    () => summarizeHistoryRange(visiblePoints),
    [visiblePoints],
  );
  const [selectedDate, setSelectedDate] = useState(
    model.points.at(-1)?.date ?? null,
  );
  const selectedPoint =
    visiblePoints.find((point) => point.date === selectedDate) ??
    visiblePoints.at(-1) ??
    null;

  if (model.status === "no_data") {
    return (
      <section className="border-y border-[var(--line)] py-16 text-center">
        <p className="text-xs font-medium text-[var(--muted)]">HISTORY</p>
        <h1 className="mt-3 text-2xl font-semibold">
          아직 탐색할 기록이 없습니다.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]">
          평가액을 임의로 보간하지 않습니다. 일일 포트폴리오 스냅샷이 저장되면
          같은 화면에서 날짜별 흐름과 이벤트를 함께 볼 수 있습니다.
        </p>
      </section>
    );
  }

  function changeRange(nextRange: HistoryExplorerRange) {
    const nextPoints = selectHistoryRange(model.points, nextRange);
    const nextMetricPoints = historyPointsWithMetric(nextPoints, mode);
    setRange(nextRange);
    setSelectedDate(
      nextMetricPoints.at(-1)?.date ?? nextPoints.at(-1)?.date ?? null,
    );
  }

  function changeMode(nextMode: HistoryExplorerMode) {
    if (nextMode === "return" && !returnAvailable) return;
    const nextMetricPoints = historyPointsWithMetric(visiblePoints, nextMode);
    setMode(nextMode);
    setSelectedDate(
      nextMetricPoints.at(-1)?.date ?? visiblePoints.at(-1)?.date ?? null,
    );
  }

  return (
    <section aria-labelledby="history-time-explorer-title" className="varda-history-explorer">
      <div className="varda-history-heading">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] font-medium text-[var(--muted)]">
              HISTORY
            </p>
            <span className="border border-[var(--line)] bg-[var(--wash)] px-2 py-1 text-[10px] font-medium text-[var(--muted)]">
              실제 저장 기록
            </span>
          </div>
          <h1 id="history-time-explorer-title" className="varda-page-title">
            시간으로 보는 자산
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {scopeLabel} · {formatDate(selectedPoint?.date ?? null)}
          </p>
          <p
            className={`varda-primary-number mt-5 ${
              mode === "return"
                ? tone(selectedPoint?.totalReturnPct ?? null)
                : "text-[var(--ink)]"
            }`}
          >
            {formatPrimaryMetric(selectedPoint, mode)}
          </p>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            {selectedPoint
              ? `${historySourceLabel(selectedPoint.source)} · ${modeDescription(mode)}`
              : "선택한 날짜의 저장 근거가 없습니다."}
          </p>
        </div>

        <RangeMetrics summary={rangeSummary} className="hidden md:grid" />
      </div>

      <div className="varda-history-controls flex flex-col gap-5 border-b border-[var(--line)] py-5 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex w-fit border border-[var(--line)] bg-[var(--wash)] p-1"
          aria-label="그래프 지표"
        >
          <ModeButton
            active={mode === "value"}
            label="평가액"
            onClick={() => changeMode("value")}
          />
          <ModeButton
            active={mode === "return"}
            disabled={!returnAvailable}
            label="수익률"
            onClick={() => changeMode("return")}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-5">
          <div className="flex items-center gap-5" aria-label="조회 기간">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={range === option.key}
                className={`border-b py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)] ${
                  range === option.key
                    ? "border-[var(--ink)] text-[var(--ink)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
                onClick={() => changeRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <PresentationDialog
            description="선택 범위의 변화 요약, 날짜별 저장 근거와 저장된 위험 지표를 한곳에서 검토합니다."
            label="계산 근거"
            title="히스토리 계산 근거"
            wide
          >
            <RangeMetrics summary={rangeSummary} className="grid" />
            <RangeSummary summary={rangeSummary} />
            <SelectedDayEvidence point={selectedPoint} />
            <HistoryCalendar
              onSelect={setSelectedDate}
              points={visiblePoints}
              selectedDate={selectedPoint?.date ?? null}
            />
            {model.riskPointCount > 0 ? (
              <StoredRiskHistory points={visiblePoints} />
            ) : null}
          </PresentationDialog>
        </div>
      </div>

      <div className="varda-history-canvas">
        <HistoryPerformanceChart
          mode={mode}
          onSelect={setSelectedDate}
          points={visiblePoints}
          selectedDate={selectedPoint?.date ?? null}
        />
        <HistorySnapshotRail
          onSelect={setSelectedDate}
          points={visiblePoints}
          selectedDate={selectedPoint?.date ?? null}
        />
      </div>
    </section>
  );
}

function RangeMetrics({
  summary: rangeSummary,
  className,
}: {
  summary: ReturnType<typeof summarizeHistoryRange>;
  className: string;
}) {
  return (
    <dl
      className={`${className} grid-cols-2 border-y border-[var(--line)] xl:grid-cols-4`}
    >
      <SummaryMetric
        detail={formatDate(rangeSummary.peakDate)}
        label="표시 범위 최고 평가액"
        value={formatHistoryKrw(rangeSummary.peakValueKrw)}
      />
      <SummaryMetric
        detail={formatDate(rangeSummary.maxDrawdownDate)}
        label="최대 낙폭"
        value={formatSignedPercent(rangeSummary.maxDrawdownPct)}
        valueClass={tone(rangeSummary.maxDrawdownPct)}
      />
      <SummaryMetric
        detail={formatSignedPercent(rangeSummary.changePct)}
        label="표시 범위 변화"
        value={formatSignedKrw(rangeSummary.changeKrw)}
        valueClass={tone(rangeSummary.changeKrw)}
      />
      <SummaryMetric
        detail={`${formatDate(rangeSummary.startDate)} ~ ${formatDate(rangeSummary.endDate)}`}
        label="기록점"
        value={`${rangeSummary.pointCount}개`}
      />
    </dl>
  );
}

function ModeButton({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`min-w-20 px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[var(--ink)] text-white"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SummaryMetric({
  detail,
  label,
  value,
  valueClass = "text-[var(--ink)]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 border-b border-r border-[var(--line)] px-3 py-4 even:border-r-0 first:pl-0 sm:px-4 xl:border-b-0 xl:even:border-r xl:last:border-r-0">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd
        className={`mt-2 truncate text-base font-semibold tabular-nums ${valueClass}`}
      >
        {value}
      </dd>
      <dd className="mt-2 truncate text-[11px] text-[var(--faint)]">
        {detail}
      </dd>
    </div>
  );
}

function RangeSummary({
  summary,
}: {
  summary: ReturnType<typeof summarizeHistoryRange>;
}) {
  return (
    <dl className="grid border-b border-[var(--line)] py-5 sm:grid-cols-[1fr_auto_1fr_1.2fr] sm:items-center">
      <RangeValue
        detail={formatDate(summary.startDate)}
        label="시작 평가액"
        value={formatHistoryKrw(summary.startValueKrw)}
      />
      <div className="hidden px-7 text-xl text-[var(--faint)] sm:block">→</div>
      <RangeValue
        detail={formatDate(summary.endDate)}
        label="종료 평가액"
        value={formatHistoryKrw(summary.endValueKrw)}
      />
      <div className="mt-4 grid grid-cols-2 gap-5 border-t border-[var(--wash)] pt-4 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
        <RangeValue
          detail="평가액 변화"
          label="변화 금액"
          value={formatSignedKrw(summary.changeKrw)}
          valueClass={tone(summary.changeKrw)}
        />
        <RangeValue
          detail="현금흐름 미보정"
          label="변화율"
          value={formatSignedPercent(summary.changePct)}
          valueClass={tone(summary.changePct)}
        />
      </div>
    </dl>
  );
}

function RangeValue({
  detail,
  label,
  value,
  valueClass = "text-[var(--ink)]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="py-2">
      <dt className="text-[11px] text-[var(--muted)]">{label}</dt>
      <dd className={`mt-2 text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <dd className="mt-1 text-[11px] text-[var(--faint)]">{detail}</dd>
    </div>
  );
}

function SelectedDayEvidence({
  point,
}: {
  point: HistoryOverviewPoint | null;
}) {
  if (!point) return null;

  return (
    <section className="border-b border-[var(--line)] py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            SELECTED DATE
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {formatDate(point.date)}
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {historySourceLabel(point.source)}
        </p>
      </div>

      <dl className="mt-5 grid border-y border-[var(--wash)] sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceMetric
          detail={
            point.gapDays === null
              ? "첫 저장점"
              : `${point.gapDays}일 간격 · ${formatSignedPercent(point.movementPct)}`
          }
          label="이전 저장점 대비"
          value={formatSignedKrw(point.movementKrw)}
          valueClass={tone(point.movementKrw)}
        />
        <EvidenceMetric
          detail={formatSignedPercent(point.totalReturnPct)}
          label="저장 손익"
          value={formatSignedKrw(point.totalPnlKrw)}
          valueClass={tone(point.totalPnlKrw)}
        />
        <EvidenceMetric
          detail={formatSignedPercent(point.drawdownPct)}
          label="고점 대비"
          value={formatSignedKrw(point.drawdownKrw)}
          valueClass={tone(point.drawdownKrw)}
        />
        <EvidenceMetric
          detail="저장된 현금성 평가액"
          label="현금"
          value={formatHistoryKrw(point.cashValueKrw)}
        />
      </dl>

      <div className="mt-5">
        <p className="text-xs font-semibold">같은 날짜의 활동</p>
        {point.events.length > 0 ? (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {point.events.slice(0, 4).map((event, index) => (
              <li
                key={`${event.eventDate}:${event.eventType}:${event.assetName}:${index}`}
                className="grid grid-cols-[auto_1fr] gap-3 text-sm"
              >
                <span className="mt-1 h-2 w-2 rounded-full bg-[var(--brand)]" />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {eventTypeLabel(event)} · {event.assetName}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {[event.accountName, formatOptionalKrw(event.amountKrw)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]">
            이 날짜에 연결된 저장 이벤트가 없습니다.
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-[var(--faint)]">
          같은 날짜에 저장된 활동이며 평가액 변화의 원인으로 단정하지 않습니다.
        </p>
      </div>
    </section>
  );
}

function EvidenceMetric({
  detail,
  label,
  value,
  valueClass = "text-[var(--ink)]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="border-b border-[var(--wash)] py-4 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className={`mt-2 text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <dd className="mt-2 text-xs leading-5 text-[var(--faint)]">{detail}</dd>
    </div>
  );
}

function HistoryCalendar({
  onSelect,
  points,
  selectedDate,
}: {
  onSelect: (date: string) => void;
  points: readonly HistoryOverviewPoint[];
  selectedDate: string | null;
}) {
  const layout = useMemo(() => calendarLayout(points), [points]);
  if (layout.cells.length === 0) return null;

  return (
    <section className="border-b border-[var(--line)] py-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            VALUE RHYTHM
          </p>
          <h2 className="mt-1 text-base font-semibold">기록 리듬</h2>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
          <span>하락</span>
          <span className="h-3 w-7 rounded-[3px] bg-[var(--negative-mid)]" />
          <span className="h-3 w-7 rounded-[3px] bg-[var(--wash)]" />
          <span className="h-3 w-7 rounded-[3px] bg-[var(--brand)]" />
          <span>상승</span>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto pb-2">
        <div
          className="grid gap-[3px]"
          style={{
            gridTemplateColumns: `repeat(${layout.weekCount}, 17px)`,
            gridTemplateRows: "repeat(7, 17px)",
            minWidth: `${layout.weekCount * 20}px`,
          }}
        >
          {layout.cells.map((cell) => (
            <button
              key={cell.point.date}
              type="button"
              title={`${formatDate(cell.point.date)} · ${formatSignedKrw(cell.point.movementKrw)}`}
              aria-label={`${formatDate(cell.point.date)} 이전 저장점 대비 ${formatSignedKrw(cell.point.movementKrw)}`}
              aria-pressed={cell.point.date === selectedDate}
              className={`h-[17px] w-[17px] rounded-[4px] border transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] ${
                cell.point.date === selectedDate
                  ? "border-[var(--ink)]"
                  : "border-transparent"
              }`}
              style={{
                gridColumnStart: cell.week + 1,
                gridRowStart: cell.weekday + 1,
                backgroundColor: movementColor(cell.point, layout.maxMovement),
              }}
              onClick={() => onSelect(cell.point.date)}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-[var(--faint)]">
        <span>{formatDate(points[0]?.date ?? null)}</span>
        <span>빈 날짜는 보간하지 않음</span>
        <span>{formatDate(points.at(-1)?.date ?? null)}</span>
      </div>
    </section>
  );
}

function StoredRiskHistory({
  points,
}: {
  points: readonly HistoryOverviewPoint[];
}) {
  const riskPoints = points.filter((point) => point.risk !== null);
  const latest = riskPoints.at(-1)?.risk ?? null;
  if (!latest) return null;

  return (
    <section className="border-b border-[var(--line)] py-7">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            STORED RISK
          </p>
          <h2 className="mt-1 text-base font-semibold">저장된 위험 기록</h2>
        </div>
        <p className="text-xs text-[var(--muted)]">
          저장값이 있는 {riskPoints.length}개 날짜
        </p>
      </div>
      <dl className="mt-5 grid border-t border-[var(--wash)] sm:grid-cols-2 lg:grid-cols-4">
        <RiskMetric
          detail="실제로 분산 효과를 내는 종목 수"
          label="유효 분산 수"
          value={formatHistoryNumber(latest.enb)}
        />
        <RiskMetric
          detail="종목들이 함께 움직인 정도"
          label="평균 상관계수"
          value={formatHistoryNumber(latest.avgCorrelation)}
        />
        <RiskMetric
          detail="저장된 위험 계산 결과"
          label="포트 변동성"
          value={formatHistoryPercent(latest.portfolioVolatility)}
        />
        <RiskMetric
          detail={
            latest.regimeScore === null
              ? "점수 기록 없음"
              : `저장 점수 ${formatHistoryNumber(latest.regimeScore)}`
          }
          label="시장 국면"
          value={latest.regimeLabel ?? "기록 없음"}
        />
      </dl>
    </section>
  );
}

function RiskMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-[var(--wash)] py-4 sm:px-5 sm:first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-2 text-xs leading-5 text-[var(--faint)]">{detail}</dd>
    </div>
  );
}

function calendarLayout(points: readonly HistoryOverviewPoint[]) {
  if (points.length === 0) return { cells: [], weekCount: 0, maxMovement: 1 };
  const firstDate = Date.parse(`${points[0]!.date}T00:00:00Z`);
  const firstMondayOffset = (new Date(firstDate).getUTCDay() + 6) % 7;
  const calendarStart = firstDate - firstMondayOffset * 86_400_000;
  const cells = points.map((point) => {
    const timestamp = Date.parse(`${point.date}T00:00:00Z`);
    const dayOffset = Math.round((timestamp - calendarStart) / 86_400_000);
    return {
      point,
      week: Math.floor(dayOffset / 7),
      weekday: dayOffset % 7,
    };
  });
  const maxMovement = Math.max(
    0.0001,
    ...points.map((point) => Math.abs(point.movementPct ?? 0)),
  );
  return {
    cells,
    weekCount: Math.max(...cells.map((cell) => cell.week)) + 1,
    maxMovement,
  };
}

function movementColor(point: HistoryOverviewPoint, maxMovement: number) {
  if (point.movementKrw === null || point.movementKrw === 0)
    return "var(--wash)";
  const intensity = Math.min(1, Math.abs(point.movementPct ?? 0) / maxMovement);
  if (point.movementKrw > 0) {
    if (intensity > 0.66) return "var(--brand)";
    if (intensity > 0.33) return "var(--brand-mid)";
    return "var(--line)";
  }
  if (intensity > 0.66) return "var(--negative-mid)";
  if (intensity > 0.33) return "var(--warning-soft)";
  return "var(--warning-soft)";
}

function formatPrimaryMetric(
  point: HistoryOverviewPoint | null,
  mode: HistoryExplorerMode,
) {
  if (!point) return "기록 없음";
  if (mode === "value") return formatHistoryKrw(point.valueKrw);
  return formatSignedPercent(historyPointMetric(point, mode));
}

function modeDescription(mode: HistoryExplorerMode) {
  return mode === "value" ? "저장 평가액 기준" : "저장된 총 수익률 기준";
}

function eventTypeLabel(event: HistoryOverviewEvent) {
  if (event.eventType === "buy") return "매수";
  if (event.eventType === "sell") return "매도";
  if (event.eventType === "asset_added") return "자산 추가";
  if (event.eventType === "asset_removed") return "자산 제외";
  return event.eventType;
}

function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return "text-[var(--ink)]";
  return value > 0 ? "text-[var(--brand)]" : "text-[var(--negative)]";
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "기록 없음";
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatHistoryKrw(Math.abs(value))}`;
}

function formatOptionalKrw(value: number | null) {
  return value === null ? null : formatSignedKrw(value);
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "기록 없음";
  if (Math.abs(value) < 0.005) return "0%";
  return `${value > 0 ? "+" : "-"}${formatHistoryPercent(Math.abs(value))}`;
}

function formatDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "기록 없음";
}
