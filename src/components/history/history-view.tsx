import type { ReactNode } from "react";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PresentationDeck } from "@/components/presentation/presentation-deck";
import { PresentationDialog } from "@/components/presentation/presentation-dialog";
import type { ReadOnlyHistoryBalance } from "@/db/queries/history-balance";
import type { TenantEventLedgerQueryResult } from "@/db/queries/tenant-events";
import { buildHistoryOverview } from "@/lib/history-overview";
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

export function HistoryView({
  events,
  eventsSupported,
  generatedAt,
  history,
}: {
  events: TenantEventLedgerQueryResult | null;
  eventsSupported: boolean;
  generatedAt: string;
  history: ReadOnlyHistoryBalance;
}) {
  const overview = buildHistoryOverview({
    rows: history.portfolioRows,
    events: historyOverviewEvents(events),
  });
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
  const scenes = [
    { id: "timeline", label: "성과 그래프" },
    ...(overview.status === "ready"
      ? [{ id: "insights", label: "움직임" }]
      : []),
    { id: "activity", label: "활동" },
    { id: "evidence", label: "검증 근거" },
  ];

  return (
    <main
      data-page="history"
      className="varda-page varda-presentation-page bg-[var(--paper)] text-[var(--ink)]"
    >
      <PortfolioPrimaryNavigation
        activePath="/history"
        generatedAt={generatedAt}
        selectedScopeKey={history.selectedScope.key}
      />

      <div className="varda-content varda-presentation-content">
        <PresentationDeck ariaLabel="히스토리 프레젠테이션" scenes={scenes}>
        <div className="varda-presentation-frame">
        <header>
          <div className="flex items-center justify-between gap-5 text-[11px] text-[var(--muted)]">
            <p>PORTFOLIO / HISTORY</p>
            <p className="tabular-nums">
              기준일 {formatDisplayDate(overview.endDate)}
            </p>
          </div>
          <div className="mt-3">
            <PortfolioAnalysisScopeTabs
              basePath="/history"
              scopes={history.analysisScopes}
              selectedScopeKey={history.selectedScope.key}
              variant="underline"
            />
          </div>
        </header>

        {history.unavailableSources.length > 0 ? (
          <p className="mt-7 border-y border-[var(--warning-soft)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--warning)]">
            일부 기록을 읽지 못했습니다: {history.unavailableSources
              .map(historyReadSourceLabel)
              .join(", ")}. 읽을 수 있는 저장 기록만 계속 표시합니다.
          </p>
        ) : null}

        <HistoryTimeExplorer
          model={overview}
          scopeLabel={history.selectedScope.label}
        />
        </div>

        {overview.status === "ready" ? (
          <div className="varda-presentation-frame justify-center">
          <section className="border-b border-[var(--line)] py-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-medium text-[var(--muted)]">
                  MOVEMENT INSIGHTS
                </p>
                <h2 className="mt-1 text-xl font-semibold">움직임 인사이트</h2>
              </div>
              <p className="text-xs text-[var(--muted)]">
                저장점 간 변화 · 현금흐름 미보정
              </p>
            </div>
            <dl
              className="mt-5 grid border-y border-[var(--line)] sm:grid-cols-2 xl:grid-cols-4"
              aria-label="히스토리 움직임 지표"
            >
              <InsightMetric
                label="저장 저점"
                value={formatHistoryKrw(overview.lowestValueKrw)}
                detail={formatDisplayDate(overview.lowestDate)}
              />
              <InsightMetric
                label="가장 크게 오른 저장점"
                value={formatMovement(overview.bestMovement?.amountKrw ?? null)}
                detail={movementDetail(overview.bestMovement)}
                valueClass={tone(overview.bestMovement?.amountKrw ?? null)}
              />
              <InsightMetric
                label="가장 크게 내린 저장점"
                value={formatMovement(overview.worstMovement?.amountKrw ?? null)}
                detail={movementDetail(overview.worstMovement)}
                valueClass={tone(overview.worstMovement?.amountKrw ?? null)}
              />
              <InsightMetric
                label="연속 움직임"
                value={`상승 ${overview.longestGainStreak} · 하락 ${overview.longestLossStreak}`}
                detail="저장점 간 방향 기준"
              />
            </dl>
          </section>
          </div>
        ) : null}

        <div className="varda-presentation-frame justify-center">
        <HistoryActivityStream result={events} supported={eventsSupported} />
        </div>

        <div className="varda-presentation-frame justify-center">
          <section className="border-y border-[var(--line)] py-10">
            <p className="varda-kicker">AUDIT TRAIL</p>
            <h2 className="mt-2 text-2xl font-medium">저장 기록을 그대로 검증합니다</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--muted)]">
              성과 그래프에서 사용한 저장점, 포지션 비교와 이벤트 원문은 별도 검증 창에서 확인할 수 있습니다.
            </p>
            <div className="mt-8">
            <PresentationDialog
              label="원시 기록과 검증 근거 보기"
              title="히스토리 원시 기록"
              wide
            >
          <div className="space-y-10">
            <p
              data-history-semantic="stored-evidence-not-recomputed"
              className="max-w-4xl text-sm leading-7 text-[var(--muted)]"
            >
              계좌 성과는 저장된 계좌 스냅샷을 읽고, 자산그룹 성과는 각 기준일에 유효했던 멤버십과 포지션 스냅샷으로 계산합니다. 누락값을 임의 보간하지 않으며 잔액 기록과 성과 시계열을 합치지 않습니다.
            </p>

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
                      rows={history.balanceRows}
                      account={history.balanceAccount}
                    />
                  </>
                ) : (
                  <UnsupportedScopeMessage>
                    이 범위에는 배분 기준이 없는 레거시 잔액 기록을 적용하지 않습니다.
                  </UnsupportedScopeMessage>
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
                  <UnsupportedScopeMessage>
                    전체·자산그룹의 과거 보유 상세 비교는 계좌 경계를 넘는 별도 증거 모델이 필요해 표시하지 않습니다.
                  </UnsupportedScopeMessage>
                )}
                <PortfolioHistoryTable
                  rows={history.portfolioRows}
                  lane={history.lane}
                  positionDetail={history.positionDetail}
                  selectedScope={history.selectedScope}
                />
              </RawSection>
            ) : null}

            {history.lane === "all" || history.lane === "events" ? (
              <RawSection title="이벤트 원문" detail="소유 계정에 연결된 저장 근거">
                {events ? (
                  <TenantHistoryEvents result={events} />
                ) : (
                  <UnsupportedScopeMessage>
                    이 범위의 이벤트 포함 규칙이 없거나 조회가 시작되지 않았습니다.
                  </UnsupportedScopeMessage>
                )}
              </RawSection>
            ) : null}
          </div>
            </PresentationDialog>
            </div>
          </section>
        </div>
        </PresentationDeck>
      </div>
    </main>
  );
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

function InsightMetric({
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
    <div className="min-w-0 border-b border-[var(--line)] px-4 py-5 first:pl-0 sm:border-r xl:border-b-0 xl:last:border-r-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className={`mt-2 truncate text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <dd className="mt-2 text-xs text-[var(--faint)]">{detail}</dd>
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
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[var(--faint)]">{detail}</dd>
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
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-[var(--muted)]">{detail}</p>
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
