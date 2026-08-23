import Link from "next/link";
import type { ReactNode } from "react";

import {
  formatDate,
  formatKrw,
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import {
  TodayContributionExplorer,
  type TodayContributionDisplayRow,
} from "@/components/today/today-contribution-explorer";
import { SelectedHoldingHistoryChart } from "@/components/today/selected-holding-history-chart";
import type {
  DashboardData,
  DashboardHolding,
} from "@/lib/portfolio-dashboard";
import {
  buildPortfolioAnalysisScopeHref,
  type PortfolioAnalysisScope,
  type PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";
import {
  selectTodayHoldingDetail,
  todayHoldingDetailHref,
  type TodayHoldingDetailQuery,
  type TodayHoldingDetailResult,
} from "@/lib/today-holding-detail";
import {
  buildTodayMovementAttribution,
  selectTodayHoldingHistory,
} from "@/lib/today-movement-view";

export function TodayMovement({
  data,
  detailQuery = { holdingAccount: null, ticker: null, market: null },
}: {
  data: DashboardData;
  detailQuery?: TodayHoldingDetailQuery;
}) {
  const movement = data.todayMovement;
  const attribution = buildTodayMovementAttribution(movement);
  const detail = selectTodayHoldingDetail(data, detailQuery);
  const holdingById = new Map(data.holdings.map((holding) => [holding.id, holding]));
  const accountLabelByCode = new Map(
    data.accountSummaries.map((account) => [account.code, account.label]),
  );
  const rows = movement.contributionRows
    .map((row): TodayContributionDisplayRow | null => {
      const holding = holdingById.get(row.holdingId);
      if (!holding) return null;
      return {
        accountLabel: accountLabelByCode.get(holding.account) ?? holding.account,
        changeKrw: row.changeKrw,
        fxImpactKrw: row.fxChangeKrw,
        href: todayHoldingDetailHref(data.selectedScope.key, holding),
        key: [holding.account, holding.market, holding.ticker ?? holding.name].join("|"),
        name: holding.name,
        priceImpactKrw: row.priceChangeKrw,
        returnPct: row.returnPct,
        selected: isSelectedHolding(detail, holding),
        ticker: holding.ticker,
        tradeFlowKrw: row.tradeFlowKrw,
      };
    })
    .filter((row): row is TodayContributionDisplayRow => row !== null)
    .toSorted(compareContributionRows);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7f8f5] text-[#20231f]">
      <PortfolioPrimaryNavigation
        activePath="/today"
        generatedAt={data.generatedAt}
        selectedScopeKey={data.selectedScope.key}
      />

      <div className="mx-auto w-full max-w-[1540px] px-5 pb-12 pt-8 sm:px-8 lg:px-10 lg:pb-16 lg:pt-10">
        <section aria-labelledby="today-movement-title">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-[11px] font-medium text-[#7b8079]">PORTFOLIO / TODAY</p>
                <h1 id="today-movement-title" className="sr-only">오늘 변동</h1>
              </div>
              <p className="text-xs text-[#7b8079]">
                기준일 {formatDate(data.latestSnapshotReferenceDate ?? data.latestSnapshotDate)}
              </p>
            </div>

            <PortfolioAnalysisScopeTabs
              basePath="/today"
              query={detailQuery.ticker ? detailQuery : undefined}
              scopes={[...data.analysisScopes].toSorted(compareTodayScope)}
              selectedScopeKey={data.selectedScope.key}
              variant="underline"
            />
          </div>

          <div className="pb-10 pt-12 text-center sm:pb-12 sm:pt-14 lg:pb-14 lg:pt-16">
            <p className="text-xs font-medium text-[#737970]">
              {scopeLabel(data.selectedScope)} 오늘 평가액 변동
            </p>
            <p className={`mt-3 text-5xl font-normal tabular-nums sm:text-6xl lg:text-[80px] ${toneClass(attribution.changeKrw)}`}>
              {movement.ready ? formatSignedKrw(attribution.changeKrw) : "계산 대기"}
            </p>
            <dl className="mx-auto mt-7 flex max-w-3xl flex-wrap items-center justify-center gap-y-3 text-sm text-[#6e746c]">
              <HeroFact
                label="변동률"
                value={formatPercent(movement.returnPct, true)}
                tone={movement.returnPct}
              />
              <HeroFact
                divided
                label="가격"
                value={formatSignedKrw(attribution.priceImpactKrw)}
                tone={attribution.priceImpactKrw}
              />
              <HeroFact
                divided
                label="환율"
                value={formatSignedKrw(attribution.fxImpactKrw)}
                tone={attribution.fxImpactKrw}
              />
            </dl>
          </div>
        </section>

        {!movement.ready ? (
          <section className="mb-8 border-y border-[#dfd4b7] bg-[#fbf8ee] px-4 py-4 text-sm text-[#67582f]">
            <p className="font-medium">{reasonLabel(movement.reason)}</p>
            <p className="mt-1 text-xs leading-5 text-[#827553]">
              현재 가격과 기준 스냅샷이 모두 연결되기 전에는 임의의 변동값을 만들지 않습니다.
            </p>
          </section>
        ) : null}

        <MovementBridge
          currentEvidenceKrw={attribution.currentEvidenceKrw}
          movementExcludedCurrentValueKrw={
            attribution.movementExcludedCurrentValueKrw
          }
          fxImpactKrw={attribution.fxImpactKrw}
          previousTotalKrw={attribution.previousEvidenceKrw}
          priceImpactKrw={attribution.priceImpactKrw}
          tradeFlowKrw={attribution.tradeFlowKrw}
        />

        <section className="mt-12" aria-labelledby="contribution-title">
          <div className="mb-5 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <p className="text-[11px] font-medium text-[#7b8079]">MOVEMENT ATTRIBUTION</p>
              <h2 id="contribution-title" className="mt-1 text-xl font-medium">
                종목별 기여
              </h2>
            </div>
            <p className="text-xs text-[#777d75]">
              절대 변동액 순 · {rows.length}개 종목
            </p>
          </div>
          <TodayContributionExplorer rows={rows} />
        </section>

        <HoldingDetailPanel
          data={data}
          detail={detail}
          selectedScopeKey={data.selectedScope.key}
        />

        <section className="mt-12 border-y border-[#d9ddd7]" aria-label="데이터 근거">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4">
            <EvidenceMetric
              label="기준 근거"
              value={sourceLabel(movement.source)}
              note={formatDate(data.latestSnapshotReferenceDate)}
            />
            <EvidenceMetric
              label="현재 가격 커버리지"
              value={formatCoverage(movement.coverage.currentCoveragePct)}
              note={`${data.dataHealth.movementEligibleAssetCount}개 변동 대상`}
              divided
            />
            <EvidenceMetric
              label="기준 스냅샷 커버리지"
              value={formatCoverage(movement.coverage.snapshotCoveragePct)}
              note={`${movement.contributionRows.length}개 기여 근거`}
              divided
            />
            <EvidenceMetric
              label="USD/KRW"
              value={formatNumber(data.usdKrwRate)}
              note={`${formatDate(data.dataHealth.latestFxRateDate)} · ${data.dataHealth.latestFxSource ?? "-"}`}
              divided
            />
          </div>
        </section>

        {movement.exclusions.length > 0 ? (
          <details className="mt-6 border-y border-[#d9ddd7] py-4">
            <summary className="cursor-pointer text-sm font-medium text-[#555c54] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]">
              계산 제외 근거 {movement.exclusions.length}건
            </summary>
            <div className="mt-4 divide-y divide-[#e3e6e0] border-t border-[#e3e6e0]">
              {movement.exclusions.map((row, index) => (
                <div
                  key={`${row.subject}-${row.reason}-${row.holdingId ?? row.snapshotId ?? index}`}
                  className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] sm:gap-5"
                >
                  <span className="font-medium text-[#2d322d]">
                    {row.assetName ?? row.ticker ?? row.subject}
                  </span>
                  <span className="text-[#737971]">{reasonLabel(row.reason)}</span>
                  <span className="text-[#737971]">{row.account ?? sourceLabel(row.source)}</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}

        <footer className="mt-7 flex flex-col justify-between gap-2 text-xs text-[#7b8079] sm:flex-row">
          <span>평가액 변동 = 가격 영향 + 환율 영향</span>
          <span>순매매는 성과 변동과 분리해 현재 비교 평가액에만 반영</span>
        </footer>
      </div>
    </main>
  );
}

function MovementBridge({
  currentEvidenceKrw,
  movementExcludedCurrentValueKrw,
  fxImpactKrw,
  previousTotalKrw,
  priceImpactKrw,
  tradeFlowKrw,
}: {
  currentEvidenceKrw: number | null;
  movementExcludedCurrentValueKrw: number;
  fxImpactKrw: number | null;
  previousTotalKrw: number | null;
  priceImpactKrw: number | null;
  tradeFlowKrw: number | null;
}) {
  const steps = [
    { label: "기준 평가액", value: previousTotalKrw, signed: false },
    { label: "가격 영향", value: priceImpactKrw, signed: true },
    { label: "환율 영향", value: fxImpactKrw, signed: true },
    { label: "순매매", value: tradeFlowKrw, signed: true },
    { label: "현재 비교 평가액", value: currentEvidenceKrw, signed: false },
  ];

  return (
    <section aria-labelledby="movement-bridge-title">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">VALUE BRIDGE</p>
          <h2 id="movement-bridge-title" className="mt-1 text-xl font-medium">
            오늘 변동 구성
          </h2>
        </div>
        <div className="hidden text-right text-xs text-[#777d75] sm:block">
          <p>저장된 기준과 현재 근거 비교</p>
          {movementExcludedCurrentValueKrw > 0 ? (
            <p className="mt-1">
              변동 제외 보유액 {formatKrw(movementExcludedCurrentValueKrw)} 정적 포함
            </p>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto border-y border-[#d9ddd7]">
        <div className="grid min-w-[800px] grid-cols-5">
          {steps.map((step, index) => (
            <div
              key={step.label}
              className={`relative min-h-32 px-5 py-5 ${index > 0 ? "border-l border-[#e0e3de]" : ""}`}
            >
              <p className="text-xs text-[#747a72]">{step.label}</p>
              <p className={`mt-4 text-xl font-medium tabular-nums ${step.signed ? toneClass(step.value) : "text-[#202420]"}`}>
                {step.signed ? formatSignedKrw(step.value) : formatNullableKrw(step.value)}
              </p>
              {index < steps.length - 1 ? (
                <span className="absolute -right-2.5 top-1/2 z-10 grid h-5 w-5 -translate-y-1/2 place-items-center bg-[#f7f8f5] text-[#a0a59e]" aria-hidden="true">
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HoldingDetailPanel({
  data,
  detail,
  selectedScopeKey,
}: {
  data: DashboardData;
  detail: TodayHoldingDetailResult;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  if (detail.status === "empty") return null;

  if (detail.status === "not_found" || detail.status === "ambiguous") {
    return (
      <section className="mt-10 border-y border-[#dfd4b7] bg-[#fbf8ee] px-4 py-4 text-sm text-[#67582f]">
        <p className="font-medium">
          {detail.status === "not_found" ? "선택한 종목을 찾지 못했습니다." : "같은 티커가 여러 계좌에 있어 계좌 선택이 필요합니다."}
        </p>
        {detail.status === "ambiguous" ? (
          <div className="mt-3 flex flex-wrap gap-4">
            {detail.candidates.map((candidate) => (
              <Link
                key={`${candidate.account}-${candidate.market}-${candidate.ticker}`}
                className="border-b border-[#67582f] pb-0.5 text-xs font-medium"
                href={todayHoldingDetailHref(selectedScopeKey, candidate)}
                scroll={false}
              >
                {candidate.name} · {candidate.account}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  const holding = detail.holding;
  const contribution = detail.contribution;
  const changeKrw = contribution?.changeKrw ?? holding.dailyChangeKrw;
  const fxImpactKrw = contribution?.fxChangeKrw ?? holding.fxDailyChangeKrw;
  const priceImpactKrw =
    contribution?.priceChangeKrw ?? holding.priceDailyChangeKrw;
  const tradeFlowKrw = contribution?.tradeFlowKrw ?? 0;
  const previousValueKrw = contribution?.previousValueKrw ?? holding.previousCloseValueKrw;
  const currentEvidenceKrw =
    previousValueKrw === null || changeKrw === null
      ? null
      : previousValueKrw + changeKrw + tradeFlowKrw;
  const historyHolding = data.holdings.find(
    (candidate) =>
      candidate.account === holding.account &&
      candidate.market === holding.market &&
      candidate.ticker === holding.ticker,
  );
  const historyPoints = historyHolding
    ? selectTodayHoldingHistory(data.holdingHistory, historyHolding.id)
    : [];

  return (
    <section className="mt-12 border-y border-[#d9ddd7]" aria-labelledby="holding-detail-title">
      <div className="flex flex-col justify-between gap-4 py-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">SELECTED HOLDING</p>
          <h2 id="holding-detail-title" className="mt-1 text-2xl font-medium">
            {holding.name}
          </h2>
          <p className="mt-1 text-xs text-[#777d75]">
            {holding.account} · {holding.ticker ?? "티커 없음"} · {holding.market.toUpperCase()} · {holding.currency}
          </p>
        </div>
        <Link
          className="w-fit border-b border-[#343833] pb-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#347e62]"
          href={buildPortfolioAnalysisScopeHref("/today", selectedScopeKey)}
          scroll={false}
        >
          선택 해제
        </Link>
      </div>

      <SelectedHoldingHistoryChart
        currency={holding.currency}
        name={holding.name}
        points={historyPoints}
      />

      <div className="grid lg:grid-cols-3">
        <DetailColumn title="현재 근거">
          <DetailRow label="현재 비교 평가액" value={formatNullableKrw(currentEvidenceKrw)} />
          <DetailRow label="수량" value={formatNumber(holding.quantity)} />
          <DetailRow label="현재가" value={formatNumber(holding.currentPrice)} />
          <DetailRow
            label="현재 USD/KRW"
            value={
              holding.currency === "USD"
                ? formatNumber(contribution?.currentFxRate ?? data.usdKrwRate)
                : "해당 없음"
            }
          />
          <DetailRow label="가격 출처" value={holding.priceSource ?? "-"} />
          <DetailRow label="가격 시각" value={formatDateTime(holding.priceAsOf)} />
        </DetailColumn>

        <DetailColumn divided title="기준 근거">
          <DetailRow label="기준일" value={formatDate(data.latestSnapshotReferenceDate)} />
          <DetailRow label="기준 평가액" value={formatNullableKrw(previousValueKrw)} />
          <DetailRow
            label="기준가"
            value={formatNumber(contribution?.previousPrice ?? null)}
          />
          <DetailRow label="근거 유형" value={sourceLabel(contribution?.source ?? holding.dailySource)} />
          <DetailRow
            label="기준 USD/KRW"
            value={
              holding.currency === "USD"
                ? formatNumber(contribution?.previousFxRate ?? null)
                : "해당 없음"
            }
          />
        </DetailColumn>

        <DetailColumn divided title="변동 분해">
          <DetailRow label="평가액 변동" value={formatSignedKrw(changeKrw)} tone={changeKrw} />
          <DetailRow label="가격 영향" value={formatSignedKrw(priceImpactKrw)} tone={priceImpactKrw} />
          <DetailRow label="환율 영향" value={formatSignedKrw(fxImpactKrw)} tone={fxImpactKrw} />
          <DetailRow label="순매매" value={formatSignedKrw(tradeFlowKrw)} tone={tradeFlowKrw} />
        </DetailColumn>
      </div>
    </section>
  );
}

function HeroFact({
  divided = false,
  label,
  tone,
  value,
}: {
  divided?: boolean;
  label: string;
  tone: number | null;
  value: string;
}) {
  return (
    <div className={`flex items-center gap-2 px-4 ${divided ? "border-l border-[#d7dbd5]" : ""}`}>
      <dt>{label}</dt>
      <dd className={`font-medium tabular-nums ${toneClass(tone)}`}>{value}</dd>
    </div>
  );
}

function EvidenceMetric({
  divided = false,
  label,
  note,
  value,
}: {
  divided?: boolean;
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className={`min-h-32 px-5 py-5 ${divided ? "border-t border-[#e0e3de] sm:border-l sm:border-t-0" : ""}`}>
      <p className="text-xs text-[#747a72]">{label}</p>
      <p className="mt-3 text-xl font-medium tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#7b8079]">{note}</p>
    </div>
  );
}

function DetailColumn({
  children,
  divided = false,
  title,
}: {
  children: ReactNode;
  divided?: boolean;
  title: string;
}) {
  return (
    <div className={`min-h-64 py-6 lg:px-7 ${divided ? "border-t border-[#e0e3de] lg:border-l lg:border-t-0" : "lg:pr-7"}`}>
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="mt-5 divide-y divide-[#e7e9e5]">{children}</dl>
    </div>
  );
}

function DetailRow({
  label,
  tone = null,
  value,
}: {
  label: string;
  tone?: number | null;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3 text-sm">
      <dt className="text-[#737971]">{label}</dt>
      <dd className={`max-w-[65%] text-right font-medium break-words ${tone === null ? "text-[#252925]" : toneClass(tone)}`}>
        {value}
      </dd>
    </div>
  );
}

function isSelectedHolding(
  detail: TodayHoldingDetailResult,
  holding: DashboardHolding,
) {
  return (
    detail.status === "selected" &&
    detail.holding.account === holding.account &&
    detail.holding.market === holding.market &&
    detail.holding.ticker === holding.ticker
  );
}

function compareContributionRows(
  left: TodayContributionDisplayRow,
  right: TodayContributionDisplayRow,
) {
  const magnitude = Math.abs(right.changeKrw) - Math.abs(left.changeKrw);
  if (magnitude !== 0) return magnitude;
  return left.name.localeCompare(right.name, "ko");
}

function compareTodayScope(left: PortfolioAnalysisScope, right: PortfolioAnalysisScope) {
  const rank = { all: 0, account: 1, portfolio_group: 2 } as const;
  return rank[left.kind] - rank[right.kind];
}

function scopeLabel(scope: PortfolioAnalysisScope) {
  return scope.kind === "all" ? "전체 자산" : scope.label;
}

function sourceLabel(source: string | null) {
  if (source === "daily_position_snapshot") return "일일 포지션 스냅샷";
  if (source === "asset_price_snapshot") return "전일 종가 근거";
  return "근거 없음";
}

function reasonLabel(reason: string | null) {
  if (!reason) return "오늘 변동 계산 근거를 준비하고 있습니다.";
  const labels: Record<string, string> = {
    missing_baseline_snapshot: "비교할 기준 스냅샷이 없습니다.",
    missing_fresh_live_prices: "현재 가격 근거가 부족합니다.",
    manual_valuation_not_updated_in_cycle: "이번 주기에 수동 평가 종목이 갱신되지 않았습니다.",
    missing_previous_close_fallback: "비교할 전일 종가가 없습니다.",
    unsupported_currency: "지원하지 않는 통화가 포함되어 있습니다.",
    missing_current_fx: "현재 환율 근거가 없습니다.",
    missing_baseline_fx: "기준 환율 근거가 없습니다.",
    coverage_below_threshold: "현재 가격 또는 기준 스냅샷의 커버리지가 부족합니다.",
  };
  return labels[reason] ?? reason;
}

function formatNullableKrw(value: number | null) {
  return value === null ? "-" : formatKrw(value);
}

function formatCoverage(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 4 }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(date);
}
