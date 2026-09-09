
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { LocalizedElement } from "@/components/i18n/localized-element";
import type { ReactNode } from "react";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { HistoryRecordsDialog, HistoryDetailLink } from "./history-records-dialog";
import { historyEvidencePage, normalizeHistoryDetail, type HistoryDetailParams } from "./history-detail-state";
import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import type { TenantEventLedgerQueryResult } from "@/db/queries/tenant-events";
import { buildHistoryOverview } from "@/lib/history-overview";
import type { HistoryLiveValuation } from "@/lib/history-live-valuation";
import {
  buildBalanceHistoryTrajectory,
  buildPortfolioHistoryTrajectory,
} from "@/lib/history-trajectory";

import { HistoryActivityStream } from "./history-activity-stream";
import {
  formatHistoryDateRange,
  formatHistoryKrw,
  formatHistoryPercent,
} from "./history-format";
import { HistoryPositionComparison } from "./history-position-comparison";
import { HistoryPositionDetail } from "./history-position-detail";
import { HistoryTimeExplorer } from "./history-time-explorer";
import { HistoryTrajectoryChart } from "./history-trajectory-chart";
import {
  BalanceHistoryTable,
  PortfolioHistoryTable,
} from "./history-tables";
import { TenantHistoryEvents } from "./tenant-history-events";
import styles from "./history-modern.module.css";

export function HistoryView({
  events,
  eventsSupported,
  generatedAt,
  history,
  detailParams = {},
  liveValuation,
}: {
  events: TenantEventLedgerQueryResult | null;
  eventsSupported: boolean;
  generatedAt: string;
  history: ReadOnlyHistoryBalance;
  detailParams?: HistoryDetailParams;
  liveValuation?: HistoryLiveValuation | null;
}) {
  const detail = normalizeHistoryDetail(detailParams);
  const overview = buildHistoryOverview({
    rows: history.portfolioRows,
    events: historyOverviewEvents(events),
    liveValuation,
  });
  // Record insights must never treat today's display-only valuation as a saved snapshot.
  const recordedOverview = detail ? buildHistoryOverview({
    rows: history.portfolioRows,
    events: historyOverviewEvents(events),
  }) : null;
  return (
    <main
      data-page="history"
      className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]"
    >
      <PortfolioPrimaryNavigation
        activePath="/history"
        generatedAt={generatedAt}
        selectedScopeKey={history.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content varda-stage-content">
        <div className={styles.page}>
          <header className={styles.header}>
            <h1 className="varda-page-title"><T ko="히스토리" en="History"/></h1>
            <PortfolioAnalysisScopeTabs basePath="/history" query={detailParams.preview === "design" ? { preview: "design" } : undefined} scopes={history.analysisScopes} selectedScopeKey={history.selectedScope.key} variant="underline" />
          </header>

          <HistoryTimeExplorer model={overview} scopeLabel={history.selectedScope.label} status={<>
            {history.unavailableSources.length ? <T ko={`일부 기록 확인 필요 · ${history.unavailableSources.map(historyReadSourceLabel).join(", ")}`} en={`Some records need review · ${history.unavailableSources.map(source => translateHomeHistory(historyReadSourceLabel(source))).join(", ")}`}/> : null}
            {liveValuation && (liveValuation.state === "partial" || liveValuation.state === "unavailable") ? <p><T ko="현재 평가 근거가 부족해 오늘 값을 추가하지 않았습니다. 저장 기록은 그대로 표시합니다." en="Today's value is unavailable because current valuation evidence is incomplete. Recorded history remains visible."/></p> : null}
          </>} details={
            <HistoryRecordsDialog key="history-records" panel={detail}>
              {detail === "raw" && recordedOverview ? <HistoryRawEvidence history={history} events={events} overview={recordedOverview} detailParams={detailParams} /> : detail === "records" ? (
          <div className={styles.support}>
            <div className={styles.activity}>
              <HistoryActivityStream result={events} supported={eventsSupported} />
            </div>
            <LocalizedElement as="aside" en={{"aria-label": "History insights and verification sources"}} className={styles.insights} aria-label="히스토리 인사이트와 검증 근거">
              {recordedOverview?.status === "ready" ? (
                <section className="varda-rail-section" data-history-recorded-insights="saved">
                  <h2 className="text-base font-semibold"><T ko="기록에서 발견한 변화" en="Changes in your records"/></h2>
                  <dl className="varda-rail-metrics mt-3">
                    <RailInsight label="저장 저점" value={formatHistoryKrw(recordedOverview.lowestValueKrw)} detail={formatDisplayDate(recordedOverview.lowestDate)} />
                    <RailInsight label="최대 상승" value={formatMovement(recordedOverview.bestMovement?.amountKrw ?? null)} detail={movementDetail(recordedOverview.bestMovement)} valueClass={tone(recordedOverview.bestMovement?.amountKrw ?? null)} />
                    <RailInsight label="최대 하락" value={formatMovement(recordedOverview.worstMovement?.amountKrw ?? null)} detail={movementDetail(recordedOverview.worstMovement)} valueClass={tone(recordedOverview.worstMovement?.amountKrw ?? null)} />
                    <RailInsight label="연속 움직임" value={`상승 ${recordedOverview.longestGainStreak} · 하락 ${recordedOverview.longestLossStreak}`} detail="저장점 방향 기준" />
                  </dl>
                </section>
              ) : <p className="text-sm leading-6 text-[var(--muted)]"><T ko="아직 저장된 평가 기록이 없습니다. 오늘의 현재 평가는 그래프에서 확인할 수 있으며, 저장 스냅샷이 생기면 기록 간 변화를 요약합니다." en="No saved valuations yet. Today's current value is available in the chart; changes between records will appear once snapshots are saved." /></p>}

              <section className="varda-rail-section">
                  <h2 className="text-sm font-medium"><T ko="저장 근거 확인" en="Check recorded sources"/></h2>
                <div className="mt-4 grid gap-2">
                  <HistoryDetailLink changes={{ detail: "raw" }}><T ko="원시 기록 검증" en="Inspect raw records"/></HistoryDetailLink>
                </div>
              </section>

              {history.unavailableSources.length > 0 ? (
                <section className="varda-rail-section text-[var(--warning)]">
                  <p className="text-xs leading-5"><T ko="일부 기록을 읽지 못했습니다:" en="Some records could not be read:"/>{history.unavailableSources.map(historyReadSourceLabel).join(", ")}<T ko=". 읽을 수 있는 저장 기록만 표시합니다." en=". Only available recorded data is displayed."/></p>
                </section>
              ) : null}
            </LocalizedElement>
          </div>

            ) : null}
            </HistoryRecordsDialog>
          } />
        </div>
      </div>
    </main>
  );
}

function HistoryRawEvidence({ history, events, overview, detailParams }: { history: ReadOnlyHistoryBalance; events: TenantEventLedgerQueryResult | null; overview: ReturnType<typeof buildHistoryOverview>; detailParams: HistoryDetailParams }) {
  const balanceTrajectory = history.balanceAccount
    ? buildBalanceHistoryTrajectory({
        rows: history.balanceRows,
        account: history.balanceAccount,
      })
    : null;
  const portfolioTrajectory = buildPortfolioHistoryTrajectory({
    rows: history.portfolioRows,
    account: history.selectedScope.key,
  });
  const balancePage = historyEvidencePage(history.balanceRows, detailParams.balancePage);
  const portfolioPage = historyEvidencePage(history.portfolioRows, detailParams.portfolioPage);
  const eventPage = historyEvidencePage(events?.state === "ready" || events?.state === "partial" ? events.events : [], detailParams.eventPage);
  return <>
    <div className="mb-5"><HistoryDetailLink changes={{ detail: "records" }}><T ko="기록·이벤트로 돌아가기" en="Back to records and events"/></HistoryDetailLink></div>

          <div className="space-y-10">
            <p
              data-history-semantic="stored-evidence-not-recomputed"
              className="max-w-4xl text-sm leading-7 text-[var(--muted)]"
            ><T ko="계좌 성과는 저장된 계좌 스냅샷을 읽고, 자산그룹 성과는 각 기준일에 유효했던 멤버십과 포지션 스냅샷으로 계산합니다. 누락값을 임의 보간하지 않으며 잔액 기록과 성과 시계열을 합치지 않습니다." en="Account performance uses recorded account snapshots. Asset-group performance uses membership and position snapshots valid on each date. Missing values are not interpolated, and balance records are kept separate from performance series."/></p>

            <dl className="grid border-y border-[var(--wash)] sm:grid-cols-2 lg:grid-cols-4">
              <EvidenceMetric
                label="잔액 기록"
                value={String(history.summary.balanceRowCount)}
                detail={formatHistoryDateRange(history.summary.balanceDateRange)}
              />
              <EvidenceMetric
                label="포트폴리오 기록"
                value={String(history.summary.portfolioRowCount)}
                detail={formatHistoryDateRange(history.summary.portfolioDateRange)}
              />
              <EvidenceMetric
                label="표시용 합산"
                value={String(history.summary.derivedPortfolioRowCount)}
                detail={`부분 합산 ${history.summary.partialPortfolioRowCount}건`}
              />
              <EvidenceMetric
                label="같은 날짜의 대체 행"
                value={String(overview.excludedAlternativeRowCount)}
                detail={`충돌 날짜 ${overview.ambiguousDateCount}개`}
              />
            </dl>

            {history.lane === "all" || history.lane === "balance" ? (
              <RawSection title="잔액 기록" detail="저장된 잔액 증거">
                {balanceTrajectory && history.balanceAccount ? (
                  <>
                    <HistoryTrajectoryChart model={balanceTrajectory} />
                    <BalanceHistoryTable
                      rows={balancePage.rows}
                      account={history.balanceAccount}
                    />
                    <EvidencePagination pagination={balancePage} queryKey="balancePage" label="잔액 기록" />
                  </>
                ) : (
                  <UnsupportedScopeMessage><T ko="이 범위에는 배분 기준이 없는 레거시 잔액 기록을 적용하지 않습니다." en="Legacy balance records without allocation rules are not applied to this scope."/></UnsupportedScopeMessage>
                )}
              </RawSection>
            ) : null}

            {history.lane === "all" || history.lane === "portfolio" ? (
              <RawSection title="포트폴리오 성과" detail="저장값과 표시용 합산 구분">
                <HistoryTrajectoryChart model={portfolioTrajectory} />
                {history.selectedScope.kind === "account" ? (
                  <>
                    <HistoryPositionComparison
                      model={history.positionComparison}
                      scopeKey={history.selectedScope.key}
                    />
                    <HistoryPositionDetail
                      model={history.positionDetail}
                      scopeKey={history.selectedScope.key}
                    />
                  </>
                ) : (
                  <UnsupportedScopeMessage><T ko="전체·자산그룹의 과거 보유 상세 비교는 계좌 경계를 넘는 별도 증거 모델이 필요해 표시하지 않습니다." en="Historical holding comparisons for all assets or asset groups are unavailable because they require a separate model across account boundaries."/></UnsupportedScopeMessage>
                )}
                <PortfolioHistoryTable
                  rows={portfolioPage.rows}
                  lane={history.lane}
                  positionDetail={history.positionDetail}
                  selectedScope={history.selectedScope}
                />
                <EvidencePagination pagination={portfolioPage} queryKey="portfolioPage" label="포트폴리오 기록" />
              </RawSection>
            ) : null}

            {history.lane === "all" || history.lane === "events" ? (
              <RawSection title="이벤트 원문" detail="소유 계정에 연결된 저장 근거">
                {events ? (
                  <>
                    <TenantHistoryEvents result={events} visibleEvents={eventPage.rows} />
                    <EvidencePagination pagination={eventPage} queryKey="eventPage" label="이벤트 원문" />
                  </>
                ) : (
                  <UnsupportedScopeMessage><T ko="이 범위의 이벤트 포함 규칙이 없거나 조회가 시작되지 않았습니다." en="Event inclusion rules for this scope are unavailable, or retrieval has not started."/></UnsupportedScopeMessage>
                )}
              </RawSection>
            ) : null}
          </div>

  </>;
}

function EvidencePagination({ pagination, queryKey, label }: { pagination: { page: number; pageCount: number; total: number; start: number; end: number }; queryKey: string; label: string }) {
  return <LocalizedElement as="nav" en={{"aria-label": translateHomeHistory(`${label} 페이지`)}} aria-label={`${label} 페이지`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
    <span>{pagination.total}<T ko="건 중" en="records; showing"/> {pagination.start}–{pagination.end} · {pagination.page}/{pagination.pageCount}<T ko="페이지" en="page"/></span>
    <div className="flex gap-2">
      {pagination.page > 1 ? <HistoryDetailLink changes={{ [queryKey]: String(pagination.page - 1), detail: "raw" }}><T ko="이전" en="Previous"/></HistoryDetailLink> : null}
      {pagination.page < pagination.pageCount ? <HistoryDetailLink changes={{ [queryKey]: String(pagination.page + 1), detail: "raw" }}><T ko="다음" en="Next"/></HistoryDetailLink> : null}
    </div>
  </LocalizedElement>;
}

function historyOverviewEvents(events: TenantEventLedgerQueryResult | null) {
  if (events?.state !== "ready" && events?.state !== "partial") return [];
  return events.events.map((event) => ({
    eventDate: event.eventDate,
    eventType: event.eventType,
    assetName: event.assetName,
    accountName: event.accountName,
    amountKrw: finiteNumber(event.amountKrw),
    quantityDelta: finiteNumber(event.quantityDelta),
  }));
}

function finiteNumber(value: number | string | null) {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function RailInsight({
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
    <div className="varda-rail-metric">
      <dt>{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className={valueClass} title={value}>
        <T ko={value} en={translateHomeHistory(value)}/>
      </dd>
      <LocalizedElement as="dd" en={{"title": translateHomeHistory(detail)}} className="mt-1 truncate text-[9px] font-normal text-[var(--faint)]" title={detail}>{<T ko={detail} en={translateHomeHistory(detail)}/>}</LocalizedElement>
    </div>
  );
}

function EvidenceMetric({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="border-b border-[var(--wash)] px-4 py-4 first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <dt className="text-xs text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums"><T ko={value} en={translateHomeHistory(value)}/></dd>
      <dd className="mt-1 text-xs text-[var(--faint)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</dd>
    </div>
  );
}

function RawSection({
  children,
  detail,
  title,
}: {
  children: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <section>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold">{<T ko={title} en={translateHomeHistory(title)}/>}</h2>
        <p className="text-xs text-[var(--muted)]">{<T ko={detail} en={translateHomeHistory(detail)}/>}</p>
      </div>
      {children}
    </section>
  );
}

function UnsupportedScopeMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 border-y border-[var(--warning-soft)] bg-[var(--surface)] px-3 py-4 text-sm text-[var(--warning)]">
      {children}
    </p>
  );
}

function historyReadSourceLabel(
  source: ReadOnlyHistoryBalance["unavailableSources"][number],
) {
  if (source === "balance") return "잔액";
  if (source === "portfolio") return "포트폴리오";
  if (source === "position_detail") return "포지션 상세";
  return "포지션 비교";
}

function movementDetail(
  movement: { date: string; percent: number | null; gapDays: number } | null,
) {
  if (!movement) return "비교 저장점 없음";
  return `${formatDisplayDate(movement.date)} · ${movement.gapDays}일 간격 · ${formatSignedPercent(movement.percent)}`;
}

function formatMovement(value: number | null) {
  return value === null ? "기록 없음" : formatSignedKrw(value);
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "기록 없음";
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}${formatHistoryKrw(Math.abs(value))}`;
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "기록 없음";
  if (Math.abs(value) < 0.005) return "0%";
  return `${value > 0 ? "+" : "-"}${formatHistoryPercent(Math.abs(value))}`;
}

function formatDisplayDate(value: string | null) {
  return value ? value.replaceAll("-", ".") : "기록 없음";
}

function tone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return "text-[var(--ink)]";
  return value > 0 ? "text-[var(--brand)]" : "text-[var(--negative)]";
}
