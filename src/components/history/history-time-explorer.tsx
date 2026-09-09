"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import { useMemo, useState, type ReactNode } from "react";

import {
  formatHistoryKrw,
  formatHistoryNumber,
  formatHistoryPercent,
  historySourceLabel,
} from "@/components/history/history-format";
import { HistoryPerformanceChart } from "@/components/history/history-performance-chart";
import { HistorySnapshotRail } from "@/components/history/history-snapshot-rail";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import styles from "./history-modern.module.css";
import {
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
  details,
  status,
}: {
  model: HistoryOverviewModel;
  scopeLabel: string;
  details?: ReactNode;
  status?: ReactNode;
}) {
  const { t } = useI18n();
  const returnAvailable = historyPointsWithMetric(model.points, "return").length > 0;
  const [mode, setMode] = useState<HistoryExplorerMode>(
    "value",
  );
  const [range, setRange] = useState<HistoryExplorerRange>("90D");
  const visiblePoints = useMemo(
    () => selectHistoryRange(historyPointsWithMetric(model.points, mode), range),
    [model.points, mode, range],
  );
  const rangeSummary = useMemo(
    () => summarizeHistoryRange(visiblePoints),
    [visiblePoints],
  );
  const [selectedDate, setSelectedDate] = useState(
    model.points.at(-1)?.date ?? null,
  );
  const [inspectedDate, setInspectedDate] = useState<string | null>(null);
  const selectablePoints = historyPointsWithMetric(visiblePoints, mode);
  const selectedPoint =
    selectablePoints.find((point) => point.date === selectedDate) ??
    selectablePoints.at(-1) ??
    null;
  const inspectedPoint = selectablePoints.find((point) => point.date === inspectedDate) ?? selectedPoint;
  const hasLiveValuation = visiblePoints.some(point => point.rowKind === "live");

  if (model.status === "no_data") {
    return (
      <section className="border-y border-[var(--line)] py-16 text-center">
        <p className="text-xs font-medium text-[var(--muted)]">HISTORY</p>
        <h1 className="mt-3 text-2xl font-semibold"><T ko="아직 탐색할 기록이 없습니다." en="No records to explore yet."/></h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--muted)]"><T ko="평가액을 임의로 보간하지 않습니다. 일일 포트폴리오 스냅샷이 저장되면 같은 화면에서 날짜별 흐름과 이벤트를 함께 볼 수 있습니다." en="Values are not interpolated. Once daily portfolio snapshots are recorded, you can explore values and events by date here."/></p>
        {details ? <div className="mt-6 flex justify-center">{details}</div> : null}
      </section>
    );
  }

  function changeRange(nextRange: HistoryExplorerRange) {
    setInspectedDate(null);
    const nextPoints = selectHistoryRange(model.points, nextRange);
    const nextMetricPoints = historyPointsWithMetric(nextPoints, mode);
    setRange(nextRange);
    setSelectedDate(
      nextMetricPoints.at(-1)?.date ?? nextPoints.at(-1)?.date ?? null,
    );
  }

  function changeMode(nextMode: HistoryExplorerMode) {
    if (nextMode === "return" && !returnAvailable) return;
    setInspectedDate(null);
    const nextMetricPoints = selectHistoryRange(historyPointsWithMetric(model.points, nextMode), range);
    setMode(nextMode);
    setSelectedDate(
      nextMetricPoints.at(-1)?.date ?? visiblePoints.at(-1)?.date ?? null,
    );
  }

  return (
    <section aria-labelledby="history-time-explorer-title" className={styles.explorer}>
      <div className={styles.stageMain}>
        <aside className={styles.hero} aria-label={t("선택한 날짜", "Selected date")}>
          <div className={styles.heroNumbers}>
            <p className={styles.heroDate}>{<T ko={formatDate(inspectedPoint?.date ?? null)} en={translateHomeHistory(formatDate(inspectedPoint?.date ?? null))}/>}</p>
            {inspectedPoint?.liveValuation ? <CurrentValuationEvidence point={inspectedPoint} /> : null}
            <p className={styles.heroValue} data-history-inspected-value>{<T ko={mode === "value" ? formatHistoryKrw(inspectedPoint?.valueKrw ?? null) : formatSignedPercent(inspectedPoint?.totalReturnPct ?? null)} en={translateHomeHistory(mode === "value" ? formatHistoryKrw(inspectedPoint?.valueKrw ?? null) : formatSignedPercent(inspectedPoint?.totalReturnPct ?? null))}/>} </p>
            <p className={styles.heroCaption}>{<T ko={mode === "value" ? "총평가액" : "저장 수익률"} en={translateHomeHistory(mode === "value" ? "총평가액" : "저장 수익률")}/>}<span className={tone(inspectedPoint?.movementKrw ?? null)}><T ko="이전 대비" en="Previous change"/> {<T ko={formatSignedKrw(inspectedPoint?.movementKrw ?? null)} en={translateHomeHistory(formatSignedKrw(inspectedPoint?.movementKrw ?? null))}/>}</span></p>
          </div>
          <div className={styles.controls}>
            <div className={styles.modeControls} aria-label={t("그래프 지표", "Chart metric")}>
              <ModeButton active={mode === "value"} label={t("평가액", "Value")} onClick={() => changeMode("value")} />
              <ModeButton active={mode === "return"} disabled={!returnAvailable} label={t("수익률", "Return")} onClick={() => changeMode("return")} />
            </div>
            <div className={styles.periodControls} aria-label={t("조회 기간", "Time range")}>
              {RANGE_OPTIONS.map((option) => <button key={option.key} type="button" aria-pressed={range === option.key} onClick={() => changeRange(option.key)}>{<T ko={option.label} en={translateHomeHistory(option.label)}/>}</button>)}
            </div>
          </div>
          <p className={styles.railNote}>{scopeLabel} · {rangeSummary.pointCount}<T ko="개 관측점" en=" observations"/><br />{hasLiveValuation ? <T ko="과거 저장 기록에 오늘의 현재 평가를 연결합니다. 오늘 값은 저장 스냅샷이 아닙니다." en="Recorded history connects to today's current valuation. Today's point is not a saved snapshot."/> : <T ko="저장된 값의 흐름을 살펴봅니다. 곡선은 관측점을 연결한 표시입니다." en="Explore recorded values. The curve visually connects observed points."/>}</p>
          {status ? <div className="text-[10px] leading-5 text-[var(--warning)]">{typeof status === "string" ? <T ko={status} en={translateHomeHistory(status)}/> : status}</div> : null}
        </aside>
        <div className={styles.plot}>
          <div className={styles.chartTitle}>
            <h2 id="history-time-explorer-title">{<T ko={mode === "value" ? "자산의 흐름" : "수익률의 흐름"} en={translateHomeHistory(mode === "value" ? "자산의 흐름" : "수익률의 흐름")}/>}</h2>
            <p><T ko="날짜를 따라 탐색" en="Explore by date"/></p>
          </div>
          <div className="varda-history-canvas">
            <HistoryPerformanceChart key={`${mode}-${range}`} mode={mode} onSelect={setSelectedDate} onInspect={setInspectedDate} points={visiblePoints} selectedDate={selectedPoint?.date ?? null} />
          </div>
        </div>
      </div>
      <footer className={styles.stageFooter}>
        <p>{hasLiveValuation ? <T ko="저장 기록 + 현재 평가 · 현금흐름 미보정" en="Records + current valuation · Not adjusted for cash flows"/> : <T ko="저장값 · 현금흐름 미보정" en="Recorded values · Not adjusted for cash flows"/>}</p>
        <div>
          <PresentationDialog mountOnOpen label="날짜별 기록" labelEn={"Records by date"} title="날짜별 기록과 현재 평가" titleEn={"Records and current valuation by date"}>
            <HistorySnapshotRail onSelect={setSelectedDate} points={visiblePoints} selectedDate={selectedPoint?.date ?? null} />
          </PresentationDialog>
          <PresentationDialog mountOnOpen label="기간 요약·근거" labelEn={"Period summary and sources"} title="히스토리 계산 근거" titleEn={"History calculation sources"} description="선택 범위의 변화 요약과 날짜별 저장 근거를 확인합니다." descriptionEn={"Review changes over the selected period and the records behind each date."} wide>
            <dl className={styles.overview}>
              <div><dt className={styles.label}><T ko="저장 수익률" en="Recorded return"/></dt><dd className={`${styles.value} ${tone(inspectedPoint?.totalReturnPct ?? null)}`}>{<T ko={formatSignedPercent(inspectedPoint?.totalReturnPct ?? null)} en={translateHomeHistory(formatSignedPercent(inspectedPoint?.totalReturnPct ?? null))}/>} </dd><dd className={styles.note}><T ko="손익" en="Gain/loss"/> {<T ko={formatSignedKrw(inspectedPoint?.totalPnlKrw ?? null)} en={translateHomeHistory(formatSignedKrw(inspectedPoint?.totalPnlKrw ?? null))}/>}</dd></div>
              <div><dt className={styles.label}><T ko="기간 평가액 변화" en="Period value change"/></dt><dd className={`${styles.value} ${tone(rangeSummary.changeKrw)}`}>{<T ko={formatSignedKrw(rangeSummary.changeKrw)} en={translateHomeHistory(formatSignedKrw(rangeSummary.changeKrw))}/>}</dd><dd className={styles.note}><T ko="현금흐름 미보정" en="Not adjusted for cash flows"/></dd></div>
              <div><dt className={styles.label}><T ko="기간 최대 낙폭" en="Period maximum drawdown"/></dt><dd className={`${styles.value} ${tone(rangeSummary.maxDrawdownPct)}`}>{<T ko={formatSignedPercent(rangeSummary.maxDrawdownPct)} en={translateHomeHistory(formatSignedPercent(rangeSummary.maxDrawdownPct))}/>} </dd><dd className={styles.note}>{<T ko={formatDate(rangeSummary.maxDrawdownDate)} en={translateHomeHistory(formatDate(rangeSummary.maxDrawdownDate))}/>}</dd></div>
            </dl>
            <RangeMetrics summary={rangeSummary} className="grid" />
            <RangeSummary summary={rangeSummary} />
            <SelectedDayEvidence point={selectedPoint} />
            <HistoryCalendar onSelect={setSelectedDate} points={visiblePoints} selectedDate={selectedPoint?.date ?? null} />
            {model.riskPointCount > 0 ? <StoredRiskHistory points={visiblePoints} /> : null}
          </PresentationDialog>
          {details}
        </div>
      </footer>
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
  const { t } = useI18n();
  return (
    <dl
      className={`${className} grid-cols-2 border-y border-[var(--line)] xl:grid-cols-4`}
    >
      <SummaryMetric
        detail={t(formatDate(rangeSummary.peakDate), translateHomeHistory(formatDate(rangeSummary.peakDate)))}
        label={t("표시 범위 최고 평가액", "Highest displayed value")}
        value={formatHistoryKrw(rangeSummary.peakValueKrw)}
      />
      <SummaryMetric
        detail={t(formatDate(rangeSummary.maxDrawdownDate), translateHomeHistory(formatDate(rangeSummary.maxDrawdownDate)))}
        label={t("최대 낙폭", "Maximum drawdown")}
        value={formatSignedPercent(rangeSummary.maxDrawdownPct)}
        valueClass={tone(rangeSummary.maxDrawdownPct)}
      />
      <SummaryMetric
        detail={formatSignedPercent(rangeSummary.changePct)}
        label={t("표시 범위 변화", "Displayed period change")}
        value={t(formatSignedKrw(rangeSummary.changeKrw), translateHomeHistory(formatSignedKrw(rangeSummary.changeKrw)))}
        valueClass={tone(rangeSummary.changeKrw)}
      />
      <SummaryMetric
        detail={t(`${formatDate(rangeSummary.startDate)} ~ ${formatDate(rangeSummary.endDate)}`, translateHomeHistory(`${formatDate(rangeSummary.startDate)} ~ ${formatDate(rangeSummary.endDate)}`))}
        label={t("관측점", "Observations")}
        value={t(`${rangeSummary.pointCount}개`, translateHomeHistory(`${rangeSummary.pointCount}개`))}
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
      className={`min-h-10 min-w-20 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[var(--ink)] text-[var(--paper)]"
          : "text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {<T ko={label} en={translateHomeHistory(label)}/>}
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
      <dt className="text-[11px] text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd
        className={`mt-2 truncate text-base font-semibold tabular-nums ${valueClass}`}
      >
        <T ko={value} en={translateHomeHistory(value)}/>
      </dd>
      <dd className="mt-2 truncate text-[11px] text-[var(--faint)]">
        {<T ko={detail} en={translateHomeHistory(detail)}/>}
      </dd>
    </div>
  );
}

function RangeSummary({
  summary,
}: {
  summary: ReturnType<typeof summarizeHistoryRange>;
}) {
  const { t } = useI18n();
  return (
    <dl className="grid border-b border-[var(--line)] py-5 sm:grid-cols-[1fr_auto_1fr_1.2fr] sm:items-center">
      <RangeValue
        detail={t(formatDate(summary.startDate), translateHomeHistory(formatDate(summary.startDate)))}
        label={t("시작 평가액", "Starting value")}
        value={formatHistoryKrw(summary.startValueKrw)}
      />
      <div className="hidden px-7 text-xl text-[var(--faint)] sm:block">→</div>
      <RangeValue
        detail={t(formatDate(summary.endDate), translateHomeHistory(formatDate(summary.endDate)))}
        label={t("종료 평가액", "Ending value")}
        value={formatHistoryKrw(summary.endValueKrw)}
      />
      <div className="mt-4 grid grid-cols-2 gap-5 border-t border-[var(--wash)] pt-4 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-7 sm:pt-0">
        <RangeValue
          detail={t("평가액 변화", "Value change")}
          label={t("변화 금액", "Amount changed")}
          value={t(formatSignedKrw(summary.changeKrw), translateHomeHistory(formatSignedKrw(summary.changeKrw)))}
          valueClass={tone(summary.changeKrw)}
        />
        <RangeValue
          detail={t("현금흐름 미보정", "Not adjusted for cash flows")}
          label={t("변화율", "Percentage change")}
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
      <dt className="text-[11px] text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className={`mt-2 text-lg font-semibold tabular-nums ${valueClass}`}>
        <T ko={value} en={translateHomeHistory(value)}/>
      </dd>
      <dd className="mt-1 text-[11px] text-[var(--faint)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</dd>
    </div>
  );
}

function SelectedDayEvidence({
  point,
}: {
  point: HistoryOverviewPoint | null;
}) {
  const { t } = useI18n();
  if (!point) return null;

  return (
    <section className="border-b border-[var(--line)] py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            SELECTED DATE
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            {<T ko={formatDate(point.date)} en={translateHomeHistory(formatDate(point.date))}/>}
          </h2>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {<T ko={historySourceLabel(point.source)} en={translateHomeHistory(historySourceLabel(point.source))}/>}
        </p>
      </div>

      {point.liveValuation ? <CurrentValuationEvidence point={point} detailed /> : null}

      <dl className="mt-5 grid border-y border-[var(--wash)] sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceMetric
          detail={point.gapDays === null
            ? point.rowKind === "live"
              ? t("비교할 이전 저장 기록 없음", "No previous saved record to compare")
              : t("첫 저장점", "First saved record")
            : t(`${point.gapDays}일 간격 · ${formatSignedPercent(point.movementPct)}`, `${point.gapDays} days apart · ${formatSignedPercent(point.movementPct)}`)}
          label={t("이전 저장점 대비", "Versus the previous record")}
          value={t(formatSignedKrw(point.movementKrw), translateHomeHistory(formatSignedKrw(point.movementKrw)))}
          valueClass={tone(point.movementKrw)}
        />
        <EvidenceMetric
          detail={formatSignedPercent(point.totalReturnPct)}
          label={t("저장 손익", "Recorded gain/loss")}
          value={t(formatSignedKrw(point.totalPnlKrw), translateHomeHistory(formatSignedKrw(point.totalPnlKrw)))}
          valueClass={tone(point.totalPnlKrw)}
        />
        <EvidenceMetric
          detail={formatSignedPercent(point.drawdownPct)}
          label={t("고점 대비", "Versus the peak")}
          value={t(formatSignedKrw(point.drawdownKrw), translateHomeHistory(formatSignedKrw(point.drawdownKrw)))}
          valueClass={tone(point.drawdownKrw)}
        />
        <EvidenceMetric
          detail={t("저장된 현금성 평가액", "Recorded cash-equivalent value")}
          label={t("현금", "Cash")}
          value={formatHistoryKrw(point.cashValueKrw)}
        />
      </dl>

      <div className="mt-5">
        <p className="text-xs font-semibold"><T ko="같은 날짜의 활동" en="Activity on this date"/></p>
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
                    {<T ko={eventTypeLabel(event)} en={translateHomeHistory(eventTypeLabel(event))}/>} · {event.assetName}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    {<T ko={[event.accountName, formatOptionalKrw(event.amountKrw)]
                      .filter(Boolean)
                      .join(" · ")} en={translateHomeHistory([event.accountName, formatOptionalKrw(event.amountKrw)]
                      .filter(Boolean)
                      .join(" · "))}/>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted)]"><T ko="이 날짜에 연결된 저장 이벤트가 없습니다." en="No recorded events are linked to this date."/></p>
        )}
        <p className="mt-4 text-xs leading-5 text-[var(--faint)]"><T ko="같은 날짜에 저장된 활동이며 평가액 변화의 원인으로 단정하지 않습니다." en="These activities were recorded on the same date; they do not establish the cause of value changes."/></p>
      </div>
    </section>
  );
}

function CurrentValuationEvidence({ point, detailed = false }: { point: HistoryOverviewPoint; detailed?: boolean }) {
  const { t } = useI18n();
  const live = point.liveValuation;
  if (!live) return null;
  // Keep the compact KST clock identical across server/browser ICU locale data.
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(live.capturedAt));
  return <div className="my-2 text-[11px] leading-5 text-[var(--muted)]" data-history-live="true">
    {live.priceSources.includes("design_preview") ? <p>{t("디자인 예시 · 실제 투자 데이터가 아닙니다", "Design example · Not actual investment data")}</p> : null}
    <p className="font-medium text-[var(--brand)]">{live.recordedPriceCount > 0 ? t("현재 평가 · 저장 가격 포함", "Current valuation · Includes recorded prices") : t("실시간 평가", "Live valuation")} · {time} KST</p>
    {detailed ? <><p>{t("현재 보유 수량 × 최신 가격 × 적용 환율로 계산한 표시 전용 값입니다. 과거 스냅샷을 수정하거나 오늘의 저장 수익률·위험 지표를 만들지 않습니다.", "A display-only valuation using current quantities, latest prices and the applied FX rate. It does not change past snapshots or create recorded return or risk metrics.")}</p>
      <p>{t(`최근 조회 시세 ${live.freshQuoteCount}종목 · 저장·수동 가격 ${live.recordedPriceCount}종목`, `${live.freshQuoteCount} recently fetched quotes · ${live.recordedPriceCount} recorded or manual prices`)}</p>
      {live.oldestPriceAt ? <p>{t("가장 오래된 가격 시각", "Oldest price timestamp")}: {live.oldestPriceAt}</p> : null}
    </> : null}
  </div>;
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
      <dt className="text-xs text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className={`mt-2 text-lg font-semibold tabular-nums ${valueClass}`}>
        <T ko={value} en={translateHomeHistory(value)}/>
      </dd>
      <dd className="mt-2 text-xs leading-5 text-[var(--faint)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</dd>
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
  const { t } = useI18n();
  const layout = useMemo(() => calendarLayout(points), [points]);
  if (layout.cells.length === 0) return null;

  return (
    <section className="border-b border-[var(--line)] py-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            VALUE RHYTHM
          </p>
          <h2 className="mt-1 text-base font-semibold"><T ko="기록 리듬" en="Record calendar"/></h2>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--muted)]">
          <span><T ko="하락" en="Down"/></span>
          <span className="h-3 w-7 rounded-[3px] bg-[var(--negative-mid)]" />
          <span className="h-3 w-7 rounded-[3px] bg-[var(--wash)]" />
          <span className="h-3 w-7 rounded-[3px] bg-[var(--brand)]" />
          <span><T ko="상승" en="Up"/></span>
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
              title={t(`${formatDate(cell.point.date)} · ${formatSignedKrw(cell.point.movementKrw)}`, translateHomeHistory(`${formatDate(cell.point.date)} · ${formatSignedKrw(cell.point.movementKrw)}`))}
              aria-label={t(`${formatDate(cell.point.date)} 이전 저장점 대비 ${formatSignedKrw(cell.point.movementKrw)}`, translateHomeHistory(`${formatDate(cell.point.date)} 이전 저장점 대비 ${formatSignedKrw(cell.point.movementKrw)}`))}
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
        <span>{<T ko={formatDate(points[0]?.date ?? null)} en={translateHomeHistory(formatDate(points[0]?.date ?? null))}/>}</span>
        <span><T ko="빈 날짜는 보간하지 않음" en="Dates without records are not interpolated"/></span>
        <span>{<T ko={formatDate(points.at(-1)?.date ?? null)} en={translateHomeHistory(formatDate(points.at(-1)?.date ?? null))}/>}</span>
      </div>
    </section>
  );
}

function StoredRiskHistory({
  points,
}: {
  points: readonly HistoryOverviewPoint[];
}) {
  const { t } = useI18n();
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
          <h2 className="mt-1 text-base font-semibold"><T ko="저장된 위험 기록" en="Recorded risk metrics"/></h2>
        </div>
        <p className="text-xs text-[var(--muted)]"><T ko="저장값이 있는" en="Recorded on"/>{riskPoints.length}<T ko="개 날짜" en=" dates"/></p>
      </div>
      <dl className="mt-5 grid border-t border-[var(--wash)] sm:grid-cols-2 lg:grid-cols-4">
        <RiskMetric
          detail={t("실제로 분산 효과를 내는 종목 수", "Effective number of diversifying holdings")}
          label={t("유효 분산 수", "Effective diversification")}
          value={formatHistoryNumber(latest.enb)}
        />
        <RiskMetric
          detail={t("종목들이 함께 움직인 정도", "How closely the holdings moved together")}
          label={t("평균 상관계수", "Average correlation")}
          value={formatHistoryNumber(latest.avgCorrelation)}
        />
        <RiskMetric
          detail={t("저장된 위험 계산 결과", "Recorded risk calculation")}
          label={t("포트 변동성", "Portfolio volatility")}
          value={formatHistoryPercent(latest.portfolioVolatility)}
        />
        <RiskMetric
          detail={t(latest.regimeScore === null
              ? "점수 기록 없음"
              : `저장 점수 ${formatHistoryNumber(latest.regimeScore)}`, translateHomeHistory(latest.regimeScore === null
              ? "점수 기록 없음"
              : `저장 점수 ${formatHistoryNumber(latest.regimeScore)}`))}
          label={t("시장 국면", "Market regime")}
          value={t(latest.regimeLabel ?? "기록 없음", translateHomeHistory(latest.regimeLabel ?? "기록 없음"))}
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
      <dt className="text-xs text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums"><T ko={value} en={translateHomeHistory(value)}/></dd>
      <dd className="mt-2 text-xs leading-5 text-[var(--faint)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</dd>
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
