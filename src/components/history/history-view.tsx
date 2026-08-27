import type { ReactNode } from "react";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
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

  return (
    <main
      data-page="history"
      className="min-h-screen overflow-x-hidden bg-[#f8f9f6] text-[#171a16]"
    >
      <PortfolioPrimaryNavigation
        activePath="/history"
        generatedAt={generatedAt}
        selectedScopeKey={history.selectedScope.key}
      />

      <div className="mx-auto w-full max-w-[1540px] px-5 pb-16 pt-7 sm:px-8 lg:px-10">
        <header>
          <div className="flex items-center justify-between gap-5 text-[11px] text-[#777d75]">
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
          <p className="mt-7 border-y border-[#e4d6b9] bg-[#fffaf0] px-4 py-3 text-sm text-[#76591f]">
            일부 기록을 읽지 못했습니다: {history.unavailableSources
              .map(historyReadSourceLabel)
              .join(", ")}. 읽을 수 있는 저장 기록만 계속 표시합니다.
          </p>
        ) : null}

        <section
          className="flex min-h-[300px] flex-col items-center justify-center border-b border-[#dde1db] py-14 text-center"
          aria-labelledby="history-title"
        >
          <p className="text-xs text-[#747a72]">{history.selectedScope.label}</p>
          <h1 id="history-title" className="mt-3 text-2xl font-semibold">
            자산의 시간을 다시 봅니다
          </h1>
          {overview.status === "ready" ? (
            <>
              <p className="mt-5 text-[clamp(3.2rem,7vw,6.6rem)] font-normal leading-none tracking-normal tabular-nums">
                {formatHistoryKrw(overview.latestValueKrw)}
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
                <span className="text-[#737970]">첫 기록 대비</span>
                <span className={`font-semibold tabular-nums ${tone(overview.valuationChangeKrw)}`}>
                  {formatSignedKrw(overview.valuationChangeKrw)}
                </span>
                <span className="h-3 w-px bg-[#d8dcd6]" />
                <span className={`font-semibold tabular-nums ${tone(overview.valuationChangePct)}`}>
                  {formatSignedPercent(overview.valuationChangePct)}
                </span>
              </div>
              <p className="mt-4 text-xs text-[#858a83]">
                {formatDisplayDate(overview.startDate)}부터 {overview.pointCount}개 저장점 · 현금흐름을 보정하지 않은 평가액 변화
              </p>
            </>
          ) : (
            <div className="mt-7 max-w-xl">
              <p className="text-3xl font-semibold">표시할 평가액 기록이 없습니다.</p>
              <p className="mt-3 text-sm leading-6 text-[#72786f]">
                누락값을 임의로 만들지 않습니다. 저장된 포트폴리오 스냅샷이 생기면 같은 화면에서 시간축이 열립니다.
              </p>
            </div>
          )}
        </section>

        {overview.status === "ready" ? (
          <>
            <dl
              className="grid border-b border-[#dde1db] sm:grid-cols-2 xl:grid-cols-6"
              aria-label="히스토리 핵심 지표"
            >
              <InsightMetric
                label="저장 고점"
                value={formatHistoryKrw(overview.peakValueKrw)}
                detail={formatDisplayDate(overview.peakDate)}
              />
              <InsightMetric
                label="저장 저점"
                value={formatHistoryKrw(overview.lowestValueKrw)}
                detail={formatDisplayDate(overview.lowestDate)}
              />
              <InsightMetric
                label="고점 대비 최대 하락"
                value={formatSignedPercent(overview.maxDrawdownPct)}
                detail={formatDisplayDate(overview.maxDrawdownDate)}
                valueClass={tone(overview.maxDrawdownPct)}
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

            <HistoryTimeExplorer model={overview} />
          </>
        ) : null}

        <HistoryActivityStream result={events} supported={eventsSupported} />

        <details className="mt-8 border-y border-[#dde1db] py-5">
          <summary className="cursor-pointer list-none text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]">
            원시 기록과 검증 근거 보기
          </summary>
          <div className="mt-6 space-y-10">
            <p
              data-history-semantic="stored-evidence-not-recomputed"
              className="max-w-4xl text-sm leading-7 text-[#686f67]"
            >
              계좌 성과는 저장된 계좌 스냅샷을 읽고, 자산그룹 성과는 각 기준일에 유효했던 멤버십과 포지션 스냅샷으로 계산합니다. 누락값을 임의 보간하지 않으며 잔액 기록과 성과 시계열을 합치지 않습니다.
            </p>

            <dl className="grid border-y border-[#e1e4df] sm:grid-cols-2 lg:grid-cols-4">
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
        </details>
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
  valueClass = "text-[#20231f]",
}: {
  detail: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0 border-b border-[#dde1db] px-4 py-5 first:pl-0 sm:border-r xl:border-b-0 xl:last:border-r-0">
      <dt className="text-xs text-[#747a72]">{label}</dt>
      <dd className={`mt-2 truncate text-lg font-semibold tabular-nums ${valueClass}`}>
        {value}
      </dd>
      <dd className="mt-2 text-xs text-[#858a83]">{detail}</dd>
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
    <div className="border-b border-[#e1e4df] px-4 py-4 first:pl-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <dt className="text-xs text-[#747a72]">{label}</dt>
      <dd className="mt-2 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-[#858a83]">{detail}</dd>
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
        <p className="text-xs text-[#747a72]">{detail}</p>
      </div>
      {children}
    </section>
  );
}

function UnsupportedScopeMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 border-y border-[#ead9b5] bg-[#fff9eb] px-3 py-4 text-sm text-[#76591f]">
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
  if (value === null || Math.abs(value) < 0.005) return "text-[#20231f]";
  return value > 0 ? "text-[#347e62]" : "text-[#cb5551]";
}
