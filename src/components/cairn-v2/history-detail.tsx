"use client";
import { Button as CairnButton, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";

import Link from "next/link";
import { useState } from "react";
import type { FixtureView } from "@/lib/cairn-v2/fixtures";
import type { BetaContext } from "@/lib/cairn-v2/navigation";
import { historySourceView } from "@/lib/cairn-v2/read-display";
import { historyComparison, readStateText } from "@/lib/cairn-v2/read-presentation";
import { displayReadMoney } from "@/lib/cairn-v2/read-contract";
import { historySnapshotHref } from "@/lib/cairn-v2/snapshot-contract";
import { historyDisplayReturnHref, historyEventHref, historyReturnHref } from "@/lib/cairn-v2/history-return";
import { useBetaExistingCrudAvailable, useBetaPreferences, useBetaReadFreshness } from "./beta-provider";
import { RecoveryNotice } from "@/components/recovery/recovery-notice";
import { HistoryChart, historyRows } from "./beta-charts";
import { CairnSelect } from "./reused/cairn-select";
import { MetricControls } from "./history-detail-controls";
import styles from "./history-detail.module.css";
import {
  CURRENT_VALUATION_SOURCE,
  currentValuationTime,
  historyWithCurrentValue,
} from "@/lib/cairn-v2/history-current";
import { buildReturnTimeline, returnTimelineLabel } from "@/lib/return-timeline";
import { selectHistoryPoint } from "@/lib/cairn-v2/history-selection";

// Presentation hierarchy from the original HistoryTimeExplorer: selected-day hero,
// large plot, quiet period controls and source evidence. Its model is not imported:
// the accepted beta projection, date selection and return links remain authoritative.
export function HistoryDetail({
  view: inputView,
  context,
}: {
  view: FixtureView;
  context: BetaContext;
}) {
  const { period, setPeriod, metric, historyDate, setHistoryDate } = useBetaPreferences();
  const [source, setSource] = useState<string>();
  const historySource = historySourceView(inputView, source, historyDate);
  const view =
    metric === "value" ? historyWithCurrentValue(historySource.view) : historySource.view;
  const displayMoney = (n: number | null, signed = false) =>
    displayReadMoney(view, n, context.currency, signed);
  const freshness = useBetaReadFreshness();
  const managementAvailable = useBetaExistingCrudAvailable();
  const rows = historyRows(view, period);
  const timeline =
    metric === "return" && view.domain?.recoveredReturn
      ? buildReturnTimeline(
          rows.map((row) => ({
            date: row.date,
            returnPct: row.exampleReturnPct,
            segment: row.segment,
          })),
          view.domain.recoveredReturn,
          period === "ALL" ? undefined : period === "1M" ? 31 : period === "3M" ? 92 : 183,
        )
      : [];
  const { returnPoint, selectedDate, selected, latestDate } = selectHistoryPoint(rows, timeline, historyDate);
  const isCurrent = selected?.source === CURRENT_VALUATION_SOURCE;
  const comparison = historyComparison(
    rows.filter((row) => row.source !== CURRENT_VALUATION_SOURCE),
    !!view.domain,
  );
  const stateText = readStateText(view.domain?.historyState, "저장된 평가가 없습니다.");
  const historyState = view.domain?.historyState;
  const recoveryKind = historyState === "unavailable" || view.domain?.historyReadStatus === "partial" ? "retry" : historyState === "empty" || historyState === "partial" || rows.filter(row => row.source !== CURRENT_VALUATION_SOURCE).length < 2 ? "history" : null;
  const returnHref = selectedDate && !isCurrent ? historyReturnHref(context, selectedDate, freshness?.store.pendingEpoch(), new URLSearchParams({
    _historyDate:selectedDate,_historyPeriod:period,_historyMetric:metric,_historyScope:context.scope,_historyCurrency:context.currency,_historyReturn:"origin",
  })) : historyDisplayReturnHref(context, {period,metric}, freshness?.store.pendingEpoch());
  const recoveryNotice = context.mode === "domain" && historyState !== "loading" && historyState !== "unauthorized" && recoveryKind && (recoveryKind === "retry" || managementAvailable)
    ? <RecoveryNotice kind={recoveryKind} scope={context.scope} beta returnHref={returnHref} /> : null;
  const sourceControl =
    historySource.options.length > 1 ? (
      <CairnSelect
        label="이력 출처"
        value={historySource.selected}
        options={historySource.options}
        onValueChange={setSource}
        className={styles.sourceSelect}
      />
    ) : (
      <p className={styles.sourceLabel}>{view.domain ? "저장된 관측 이력" : "가상 데이터"}</p>
    );
  if (stateText && !timeline.length)
    return (
      <div className={styles.surface}>
        {sourceControl}
        <CairnStatus as="p" className={styles.empty} role="status">
          {stateText}
        </CairnStatus>
        {recoveryNotice}
      </div>
    );
  const unit = context.currency === "KRW" ? "원" : "USD";
  const selectedValue =
    metric === "value"
      ? selected?.valueKrw
      : returnPoint
        ? returnPoint.returnPct
        : selected?.exampleReturnPct;
  const caption =
    metric === "value"
      ? isCurrent
        ? "홈과 같은 현재 투자자산 평가액"
        : selected?.rowKind === "partial"
          ? "확인 소계 · 부분 이력"
          : "선택 날짜의 저장 평가액"
      : returnPoint
        ? returnTimelineLabel(returnPoint)
        : selected?.rowKind === "partial"
          ? "부분 이력 · 전체 수익률 확인 전"
          : view.domain
            ? selectedValue === null || selectedValue === undefined
              ? "선택 날짜의 저장 수익률 없음"
              : "기존 저장 수익률 · KRW 기준"
            : "가상 예시 수익률";
  const included = selected?.includedAccounts?.length
    ? selected.includedAccounts.join(", ")
    : selected?.account !== "all"
      ? selected?.account
      : null;
  const families = rows.map((row) => sourceFamily(row.source));
  const sourceKinds = [...new Set(families)];
  return (
    <div className={styles.surface}>
      {recoveryNotice}
      <div className={styles.toolbar}>
        {sourceControl}
        <div className={styles.toolbarActions}>
          <CairnButton variant="secondary"
            type="button"
            className={styles.latestButton}
            onClick={() => setHistoryDate(latestDate ?? null)}
          >
            최신으로
          </CairnButton>
          <MetricControls />
        </div>
      </div>
      <div className={styles.stage}>
        <aside className={styles.hero} aria-label="선택 날짜와 기간 요약">
          <div>
            <p className={styles.eyebrow}>{isCurrent ? "현재 평가 · 저장 전" : "선택한 관측일"}</p>
            <p className={styles.date}>
              {(returnPoint?.date ?? selected?.date)?.replaceAll("-", ".") ?? "기록 없음"}
            </p>
            <p
              className={styles.value}
              data-tone={metric === "return" ? tone(selectedValue) : "neutral"}
              data-history-selected-value
            >
              {metric === "value"
                ? displayMoney(selected?.valueKrw ?? null)
                : (selectedValue?.toFixed(2) ?? "—")}
              <small>{metric === "return" ? "%" : unit}</small>
            </p>
            <p className={styles.caption}>{caption}</p>
            {view.domain?.historyObservationPolicy && (
              <p className={styles.note}>
                {isCurrent ? (
                  currentValuationTime(view)
                ) : (
                  <>
                    관측일 기준
                    {!selected?.storageSnapshotDate
                      ? " · 저장 조회일 확인 전"
                      : selected.storageSnapshotDate !== selected.date
                        ? " · 저장 조회일 " + selected.storageSnapshotDate
                        : " · 저장 조회일과 같음"}
                  </>
                )}
              </p>
            )}
          </div>
          <div className={styles.periodSummary}>
            <p className={styles.eyebrow}>저장 기간 평가액 변화</p>
            <p
              className={styles.periodValue}
              data-tone={tone(comparison.value)}
              data-history-period-change
            >
              {displayMoney(comparison.value, true)}
              <small>{unit}</small>
            </p>
            <p className={styles.note}>{comparison.reason}</p>
            {comparison.value !== null && <p className={styles.note}>투자 수익·손실과 다릅니다.</p>}
          </div>
          <p className={styles.range}>
            {rows[0]?.date ?? "기록 없음"} — {rows.at(-1)?.date ?? "기록 없음"}
            <span>{rows.length}개 관측점 · 달력 기간</span>
          </p>
        </aside>
        <div className={styles.plot}>
          <div className={styles.plotHeading}>
            <CairnSectionTitle level="h3">{metric === "value" ? "평가액의 흐름" : "수익률의 흐름"}</CairnSectionTitle>
            <p>날짜를 따라 탐색</p>
          </div>
          <HistoryChart view={view} />
          <div className={styles.periodControls} role="group" aria-label="히스토리 기간">
            {(["1M", "3M", "6M", "ALL"] as const).map((option) => (
              <CairnButton variant="selection"
                key={option}
                type="button"
                aria-pressed={option === period}
                onClick={() => setPeriod(option)}
              >
                {option}
              </CairnButton>
            ))}
          </div>
          {view.domain && sourceKinds.length > 1 && (
            <div
              className={styles.sourceTrack}
              role="img"
              aria-label={
                "관측점별 기록 출처 · " +
                sourceKinds
                  .map(
                    (kind) =>
                      sourceNames[kind] +
                      " " +
                      families.filter((value) => value === kind).length +
                      "일",
                  )
                  .join(" · ")
              }
            >
              <div className={styles.track} aria-hidden="true">
                {rows.map((row, index) => (
                  <i key={row.date + index} data-source={families[index]} />
                ))}
              </div>
              <p className={styles.trackLegend}>
                {sourceKinds.map((kind) => (
                  <span key={kind}>
                    <i data-source={kind} />
                    {sourceNames[kind]}
                  </span>
                ))}
              </p>
            </div>
          )}
          <p className={styles.plotNote}>
            {rows.some((row) => row.source === CURRENT_VALUATION_SOURCE)
              ? "마지막 주황 점은 홈과 같은 현재 평가입니다. 점선은 저장된 평가와 현재 평가를 구분합니다."
              : "확인된 관측점을 연결한 표시입니다. 빈 날짜의 평가나 수익률을 만들지 않습니다."}
          </p>
        </div>
      </div>
      <footer className={styles.footer}>
        <div className={styles.links}>
          {view.domain && selectedDate && (
            <>
              <Link
                id="history-evidence"
                prefetch={false}
                href={historyEventHref(context, selectedDate, freshness?.store.pendingEpoch(), {
                  date: selectedDate,
                  period,
                  metric,
                })}
              >
                이 날짜의 거래·이벤트 근거 읽기 ↗
              </Link>
              {!isCurrent && selected && (
                <Link
                  prefetch={false}
                  href={historySnapshotHref(
                    context,
                    { date: selected.date, period, metric },
                    freshness?.store.pendingEpoch(),
                    selected.storageSnapshotDate ?? selected.date,
                  )}
                >
                  이 날짜의 저장된 평가 읽기 ↗
                </Link>
              )}
            </>
          )}
        </div>
        <details className={styles.evidence}>
          <summary>출처·포함 범위 근거</summary>
          <dl>
            <div>
              <dt>조회 범위</dt>
              <dd>{view.scopeLabel}</dd>
            </div>
            <div>
              <dt>화면 조회 시각</dt>
              <dd>{view.asOf || "확인 전"}</dd>
            </div>
            <div>
              <dt>선택 출처</dt>
              <dd>{historySource.label || "기존 이력"}</dd>
            </div>
            <div>
              <dt>관측일 / 저장 조회일</dt>
              <dd>
                {selectedDate ?? "—"} / {selected?.storageSnapshotDate ?? "해당 날짜의 저장 행 없음"}
              </dd>
            </div>
            <div>
              <dt>출처 코드</dt>
              <dd>{returnPoint?.basis === "recovered" ? "복구 기간 수익률 · 추정" : selected?.source ?? "확인 전"}</dd>
            </div>
            <div>
              <dt>기록 종류 / 포함 계좌</dt>
              <dd>
                {selected?.rowKind ?? "확인 전"} / {included ?? "범위 확인 전"}
              </dd>
            </div>
          </dl>
          <p>
            저장된 원래 금액과 수익률을 표시합니다. 표시 통화가 바뀌어도 과거 KRW 기록을 현재 환율로
            환산해 과거 USD 성과로 만들지 않습니다.
          </p>
          <p>
            부분 기록과 수익률은 근거가 달라지는 구간을 분리합니다. 날짜별 거래·이벤트 근거와 저장된
            평가의 지원 범위는 각 작업 화면에서 확인합니다.
          </p>
        </details>
      </footer>
    </div>
  );
}

function tone(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) || value === 0
    ? "neutral"
    : value > 0
      ? "positive"
      : "negative";
}
function sourceFamily(source: string | undefined) {
  return source === CURRENT_VALUATION_SOURCE
    ? "current"
    : source === "base44_import"
      ? "imported"
      : source?.startsWith("broker_reconstructed_close_v1:")
        ? "reconstructed"
        : source === "varda_manual_daily_snapshot" || source === "varda_daily_snapshot_v1"
          ? "stored"
          : "other";
}
const sourceNames = {
  current: "현재 평가",
  stored: "저장 평가",
  imported: "이관 기록",
  reconstructed: "재구성 기록",
  other: "기타 출처",
} as const;
