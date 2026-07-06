import Link from "next/link";

import type {
  DashboardAccount,
  DashboardData,
  DashboardEventActivity,
  DashboardHolding,
  NonInvestmentAsset,
  RecentPortfolioPoint,
} from "@/lib/portfolio-dashboard";

const accountTabs: { code: DashboardAccount; label: string }[] = [
  { code: "brokerage", label: "증권" },
  { code: "isa", label: "ISA" },
  { code: "irp", label: "IRP" },
  { code: "all", label: "전체" },
];

const navItems = [
  "홈",
  "오늘 변동",
  "추가 투입",
  "포트 구조",
  "히스토리",
  "투자랩",
  "시뮬레이션 검증",
  "설정",
];

export function PortfolioDashboard({ data }: { data: DashboardData }) {
  const topHoldings = data.holdings.slice(0, 7);
  const heatmapHoldings = data.holdings.slice(0, 16);
  const maxHeatmapValue =
    Math.max(...heatmapHoldings.map((holding) => holding.valueKrw), 0) || 1;

  return (
    <main className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 px-4 py-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        <aside className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-3 lg:min-h-[calc(100vh-2rem)]">
          <div className="mb-5 flex items-center gap-3 px-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-[#1e3a34] text-sm font-semibold text-white">
              V
            </div>
            <div>
              <p className="text-sm font-semibold tracking-normal">Varda Labs</p>
              <p className="text-xs text-[#73786c]">Portfolio</p>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {navItems.map((item, index) => (
              <span
                key={item}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
                  index === 0
                    ? "bg-[#e5ece3] text-[#16211c]"
                    : "text-[#697064] hover:bg-[#eef1e8]",
                )}
              >
                {item}
              </span>
            ))}
          </nav>
          <div className="mt-5 rounded-md border border-[#e2e6da] bg-white p-3 text-xs text-[#687064]">
            <p className="font-medium text-[#2a2f29]">기준일</p>
            <p className="mt-1">{formatDate(data.latestSnapshotDate)}</p>
            <p className="mt-3 font-medium text-[#2a2f29]">USD/KRW</p>
            <p className="mt-1">{formatNumber(data.usdKrwRate)}</p>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-sm font-medium text-[#626b5f]">
                  {formatDate(data.generatedAt)}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#151815] sm:text-3xl">
                  포트폴리오 요약
                </h1>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-[#dce2d2] bg-white p-1 sm:grid-cols-4">
                {accountTabs.map((tab) => (
                  <Link
                    key={tab.code}
                    href={tab.code === "brokerage" ? "/" : `/?account=${tab.code}`}
                    className={cn(
                      "rounded-md px-3 py-2 text-center text-sm font-semibold transition",
                      data.selectedAccount === tab.code
                        ? "bg-[#1e3a34] text-white"
                        : "text-[#5d665b] hover:bg-[#edf1e8]",
                    )}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-4">
              <MetricBlock
                label="총 평가액"
                value={formatKrwCompact(data.totalValueKrw)}
                emphasis
              />
              <MetricBlock
                label="오늘 변동"
                value={formatSignedKrwCompact(data.todayChangeKrw)}
                tone={moneyToneFor(data.todayChangeKrw)}
                subValue={formatPct(data.todayReturnPct, true)}
              />
              <MetricBlock
                label="총 손익"
                value={formatSignedKrwCompact(data.totalPnlKrw)}
                tone={moneyToneFor(data.totalPnlKrw)}
                subValue={`${formatPct(data.totalReturnPct, true)} · 실현 ${formatSignedKrwCompact(data.realizedPnlKrw)}`}
              />
              <MetricBlock
                label="보유 원금"
                value={formatKrw(data.costBasisKrw)}
                subValue={principalSubValue(data)}
              />
            </div>
          </header>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold tracking-normal">
                  계정 자산 분포
                </h2>
                <div className="grid w-full grid-cols-3 rounded-md border border-[#dce2d2] bg-white p-1 text-sm sm:w-[260px]">
                  <span className="whitespace-nowrap rounded-md bg-[#1e3a34] px-2 py-1.5 text-center font-semibold text-white">
                    수익률
                  </span>
                  <span className="whitespace-nowrap px-2 py-1.5 text-center font-semibold text-[#6c7469]">
                    위험
                  </span>
                  <span className="whitespace-nowrap px-2 py-1.5 text-center font-semibold text-[#6c7469]">
                    기여도
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-4">
                {heatmapHoldings.map((holding) => (
                  <HeatmapCell
                    key={holding.id}
                    holding={holding}
                    maxValue={maxHeatmapValue}
                  />
                ))}
              </div>
            </section>

            <section className="grid gap-3">
              {data.accountSummaries.map((summary) => (
                <div
                  key={summary.code}
                  className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{summary.label}</p>
                    <p className="text-xs text-[#687064]">
                      {summary.holdingCount}개
                    </p>
                  </div>
                  <p className="mt-3 text-xl font-semibold">
                    {formatKrw(summary.totalValueKrw)}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm font-medium",
                      moneyToneClass(summary.totalPnlKrw),
                    )}
                  >
                    {formatSignedKrw(summary.totalPnlKrw)} ·{" "}
                    {formatPct(summary.totalReturnPct, true)}
                  </p>
                </div>
              ))}
            </section>
          </div>

          <section className="overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
            <div className="flex flex-col gap-2 border-b border-[#e3e7da] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold tracking-normal">보유 자산</h2>
              <p className="text-sm text-[#687064]">
                미매칭 스냅샷 {data.dataHealth.unmatchedSnapshotRowsAllTime}건
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#eef2e8] text-left text-xs font-semibold uppercase text-[#616a5e]">
                    <th className="px-4 py-3">종목</th>
                    <th className="px-3 py-3">계정</th>
                    <th className="px-3 py-3 text-right">수량</th>
                    <th className="px-3 py-3 text-right">현재가</th>
                    <th className="px-3 py-3 text-right">평가액</th>
                    <th className="px-3 py-3 text-right">비중</th>
                    <th className="px-3 py-3 text-right">목표</th>
                    <th className="px-3 py-3 text-right">드리프트</th>
                    <th className="px-3 py-3 text-right">오늘</th>
                    <th className="px-4 py-3 text-right">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((holding) => (
                    <HoldingRow key={holding.id} holding={holding} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <h2 className="text-base font-semibold tracking-normal">오늘 브리핑</h2>
            <div className="mt-4 space-y-3">
              <BriefingRow
                label="평가액 변동"
                value={formatSignedKrw(data.todayChangeKrw)}
                tone={moneyToneFor(data.todayChangeKrw)}
              />
              <BriefingRow
                label="수익률"
                value={formatPct(data.todayReturnPct, true)}
                tone={toneFor(data.todayReturnPct)}
              />
              <BriefingRow
                label="환율 영향"
                value={formatSignedKrw(data.todayFxChangeKrw)}
                tone={moneyToneFor(data.todayFxChangeKrw)}
              />
              <BriefingRow
                label="실현손익"
                value={formatSignedKrw(data.realizedPnlKrw)}
                tone={moneyToneFor(data.realizedPnlKrw)}
              />
            </div>
            <p
              className={cn(
                "mt-4 rounded-md border px-3 py-2 text-xs font-medium",
                data.dataHealth.movementReady
                  ? "border-[#d7e3d2] bg-[#f3f8ef] text-[#2c643f]"
                  : "border-[#eadfc7] bg-[#fff8e7] text-[#7a5b16]",
              )}
            >
              {movementHealthText(data)}
            </p>
          </section>

          {data.nonInvestmentAssets.length > 0 ? (
            <NonInvestmentCard
              assets={data.nonInvestmentAssets}
              totalValue={data.nonInvestmentTotalKrw}
            />
          ) : null}

          <EventActivityPanel activities={data.eventActivity} data={data} />

          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <h2 className="text-base font-semibold tracking-normal">주요 변동 종목</h2>
            <div className="mt-3 space-y-2">
              {data.topMovers.length > 0 ? (
                data.topMovers.map((holding) => (
                  <CompactHolding key={holding.id} holding={holding} />
                ))
              ) : (
                <p className="rounded-md bg-[#eef2e8] px-3 py-2 text-sm text-[#687064]">
                  변동 데이터 없음
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-normal">30일 추세</h2>
              <p className="text-xs text-[#687064]">
                {data.recentSnapshots.length}일
              </p>
            </div>
            <TrendBars points={data.recentSnapshots} />
          </section>

          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <h2 className="text-base font-semibold tracking-normal">보유 자산 상위</h2>
            <div className="mt-3 space-y-2">
              {topHoldings.map((holding) => (
                <div key={holding.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium">{holding.name}</span>
                    <span className="shrink-0 font-semibold">
                      {formatPct(holding.currentWeight)}
                    </span>
                  </div>
                  <div className="h-2 rounded-sm bg-[#e4e8dc]">
                    <div
                      className="h-2 rounded-sm bg-[#1e3a34]"
                      style={{
                        width: `${Math.min(Math.max(holding.currentWeight, 0), 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
            <h2 className="text-base font-semibold tracking-normal">데이터</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
              <DataPill
                label="전체자산"
                value={String(data.dataHealth.importedAssetCount)}
              />
              <DataPill
                label="투자자산"
                value={String(data.dataHealth.investmentAssetCount)}
              />
              <DataPill
                label="포지션"
                value={String(data.dataHealth.latestSnapshotPositions)}
              />
              <DataPill
                label="미매칭"
                value={String(data.dataHealth.unmatchedSnapshotRowsAllTime)}
              />
              <DataPill
                label="이벤트"
                value={String(data.dataHealth.selectedEventLedgerCount)}
              />
              <DataPill
                label="실현매도"
                value={String(data.dataHealth.selectedRealizedSellEventCount)}
              />
              <DataPill
                label="헤드라인"
                value={headlineBasisLabel(data.dataHealth.headlineBasis)}
              />
              <DataPill
                label="손익차이"
                value={formatSignedKrwCompact(
                  data.dataHealth.portfolioSnapshotPnlDeltaKrw,
                )}
              />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function EventActivityPanel({
  activities,
  data,
}: {
  activities: DashboardEventActivity[];
  data: DashboardData;
}) {
  return (
    <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">이벤트 활동</h2>
          <p className="mt-1 text-xs text-[#687064]">
            최근 {activities.length}건 · 전체 {data.dataHealth.selectedEventLedgerCount}건
          </p>
        </div>
        {data.dataHealth.selectedUnmatchedSellEventCount > 0 ? (
          <span className="rounded-md border border-[#eadfc7] bg-[#fff8e7] px-2 py-1 text-xs font-semibold text-[#7a5b16]">
            보존 {data.dataHealth.selectedUnmatchedSellEventCount}
          </span>
        ) : null}
      </div>
      <div className="mt-3 space-y-2">
        {activities.length > 0 ? (
          activities.map((activity) => (
            <EventActivityRow key={activity.id} activity={activity} />
          ))
        ) : (
          <p className="rounded-md bg-[#eef2e8] px-3 py-2 text-sm text-[#687064]">
            이벤트 없음
          </p>
        )}
      </div>
    </section>
  );
}

function EventActivityRow({ activity }: { activity: DashboardEventActivity }) {
  return (
    <div className="rounded-md bg-white px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-[#687064]">
              {formatDate(activity.eventDate)}
            </span>
            <span className="rounded-sm bg-[#edf1e8] px-1.5 py-0.5 text-[11px] font-semibold text-[#3d463b]">
              {eventTypeLabel(activity.eventType)}
            </span>
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
                mappingStatusClass(activity.mappingStatus),
              )}
            >
              {mappingStatusLabel(activity.mappingStatus)}
            </span>
          </div>
          <p className="mt-1 truncate font-semibold text-[#171916]">
            {activity.ticker ? `${activity.ticker} · ` : ""}
            {activity.assetName}
          </p>
          <p className="mt-1 truncate text-xs text-[#687064]">
            {activity.accountLabel}
            {activity.source ? ` · ${activity.source}` : ""}
            {activity.ruleVersion ? ` · ${activity.ruleVersion}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              moneyToneClass(activity.realizedPnlKrw ?? activity.amountKrw),
            )}
          >
            {activity.realizedPnlKrw !== null
              ? formatSignedKrw(activity.realizedPnlKrw)
              : formatSignedKrw(activity.amountKrw)}
          </p>
          <p className="mt-1 text-[11px] font-medium text-[#737b70]">
            {activity.realizedPnlKrw !== null
              ? activity.missingCost
                ? "실현·원가추정"
                : "실현손익"
              : activity.quantityDelta !== null
                ? `수량 ${formatQuantity(activity.quantityDelta)}`
                : "금액"}
          </p>
        </div>
      </div>
    </div>
  );
}

function MetricBlock({
  label,
  value,
  subValue,
  tone = "neutral",
  emphasis = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  tone?: "positive" | "negative" | "neutral";
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#e1e5d9] bg-white px-4 py-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p
        className={cn(
          "mt-2 min-w-0 whitespace-nowrap font-semibold tracking-normal",
          emphasis ? "text-xl sm:text-2xl" : "text-lg sm:text-xl",
          toneClassValue(tone),
        )}
      >
        {value}
      </p>
      {subValue ? <p className="mt-1 text-xs text-[#687064]">{subValue}</p> : null}
    </div>
  );
}

function HeatmapCell({
  holding,
  maxValue,
}: {
  holding: DashboardHolding;
  maxValue: number;
}) {
  const signal = holding.dailyReturnPct ?? holding.totalReturnPct ?? 0;
  const intensity = Math.min(Math.abs(signal) / 4, 1);
  const valueRatio = Math.max(holding.valueKrw / maxValue, 0.18);
  const color =
    signal >= 0
      ? `rgba(34, 128, 92, ${0.18 + intensity * 0.62})`
      : `rgba(189, 68, 73, ${0.18 + intensity * 0.62})`;

  return (
    <div
      className="aspect-square rounded-md border border-white/80 p-3 text-[#111511]"
      style={{ backgroundColor: color }}
    >
      <div className="flex h-full flex-col justify-between">
        <div>
          <p className="truncate text-sm font-semibold">{holding.ticker ?? "-"}</p>
          <p className="mt-1 truncate text-xs text-[#25302a]">{holding.name}</p>
        </div>
        <div>
          <div className="mb-2 h-1.5 rounded-sm bg-white/45">
            <div
              className="h-1.5 rounded-sm bg-[#111511]/75"
              style={{ width: `${Math.min(valueRatio * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs font-semibold">{formatPct(signal, true)}</p>
        </div>
      </div>
    </div>
  );
}

function HoldingRow({ holding }: { holding: DashboardHolding }) {
  return (
    <tr className="border-t border-[#e3e7da] bg-white/60">
      <td className="px-4 py-3">
        <div className="max-w-[260px]">
          <p className="truncate font-semibold text-[#171916]">{holding.name}</p>
          <p className="truncate text-xs text-[#687064]">
            {holding.ticker ?? "-"} · {holding.market} · {holding.currency}
          </p>
        </div>
      </td>
      <td className="px-3 py-3 text-[#4e574c]">{accountLabel(holding.account)}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatQuantity(holding.quantity)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPrice(holding.currentPrice, holding.currency)}
      </td>
      <td className="px-3 py-3 text-right font-semibold tabular-nums">
        {formatKrw(holding.valueKrw)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPct(holding.currentWeight)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPct(holding.effectiveTargetWeight)}
      </td>
      <td className={cn("px-3 py-3 text-right tabular-nums", toneClass(holding.driftPct))}>
        {formatPct(holding.driftPct, true)}
      </td>
      <td
        className={cn(
          "px-3 py-3 text-right tabular-nums",
          moneyToneClass(holding.dailyChangeKrw),
        )}
      >
        <p>{formatSignedKrw(holding.dailyChangeKrw)}</p>
        <p className="text-[11px] font-medium text-[#737b70]">
          {movementSourceLabel(holding.dailySource)}
        </p>
      </td>
      <td
        className={cn(
          "px-4 py-3 text-right font-semibold tabular-nums",
          toneClass(holding.totalReturnPct),
        )}
      >
        {formatPct(holding.totalReturnPct, true)}
      </td>
    </tr>
  );
}

function NonInvestmentCard({
  assets,
  totalValue,
}: {
  assets: NonInvestmentAsset[];
  totalValue: number;
}) {
  return (
    <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">
            비투자/현금성 자산
          </h2>
          <p className="mt-1 text-xs text-[#687064]">투자 비중·드리프트 제외</p>
        </div>
        <p className="shrink-0 text-sm font-semibold">{formatKrw(totalValue)}</p>
      </div>
      <div className="mt-3 space-y-2">
        {assets.map((asset) => (
          <div
            key={asset.id}
            className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">{asset.name}</p>
              <p className="text-xs text-[#687064]">
                {accountLabel(asset.account)} · {assetTypeLabel(asset.assetType)}
              </p>
            </div>
            <p className="shrink-0 font-semibold">{formatKrw(asset.valueKrw)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BriefingRow({
  label,
  value,
  subValue,
  tone = "neutral",
}: {
  label: string;
  value: string;
  subValue?: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2">
      <span className="text-sm text-[#687064]">{label}</span>
      <span className={cn("text-right text-sm font-semibold", toneClassValue(tone))}>
        {value}
        {subValue ? (
          <span className="ml-2 text-xs font-medium text-[#777f73]">{subValue}</span>
        ) : null}
      </span>
    </div>
  );
}

function CompactHolding({ holding }: { holding: DashboardHolding }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{holding.name}</p>
        <p className="text-xs text-[#687064]">
          {holding.ticker ?? "-"} · {movementSourceLabel(holding.dailySource)}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "text-sm font-semibold",
            moneyToneClass(holding.dailyChangeKrw),
          )}
        >
          {formatSignedKrw(holding.dailyChangeKrw)}
        </p>
        <p className={cn("text-xs", toneClass(holding.dailyReturnPct))}>
          {formatPct(holding.dailyReturnPct, true)}
        </p>
      </div>
    </div>
  );
}

function TrendBars({ points }: { points: RecentPortfolioPoint[] }) {
  if (points.length === 0) {
    return (
      <p className="mt-3 rounded-md bg-[#eef2e8] px-3 py-2 text-sm text-[#687064]">
        히스토리 없음
      </p>
    );
  }

  const values = points.map((point) => point.totalMarketValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);

  return (
    <div className="mt-4 flex h-24 items-end gap-1 rounded-md bg-white px-3 py-3">
      {points.map((point) => {
        const height = 18 + ((point.totalMarketValue - min) / range) * 70;
        return (
          <div
            key={point.date}
            className="min-w-0 flex-1 rounded-sm bg-[#3d6b5e]"
            title={`${formatDate(point.date)} ${formatKrw(point.totalMarketValue)}`}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

function DataPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-2 py-2">
      <p className="text-xs text-[#687064]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function movementHealthText(data: DashboardData) {
  if (data.dataHealth.movementReady) {
    const source =
      data.dataHealth.movementSource === "asset_price_snapshot"
        ? "전일종가 fallback"
        : "포지션 스냅샷";
    const coverage =
      data.dataHealth.movementSource === "asset_price_snapshot"
        ? data.dataHealth.previousCloseCoveragePct
        : data.dataHealth.movementCurrentCoveragePct;
    return `${source} 기준 · 커버리지 ${formatPct(coverage)}`;
  }

  return data.dataHealth.movementReason === "incomplete_baseline_snapshot"
    ? "기준 스냅샷 커버리지가 낮아 오늘 변동을 보수적으로 숨김"
    : "오늘 변동 기준 데이터 없음";
}

function movementSourceLabel(source: DashboardHolding["dailySource"]) {
  if (source === "daily_position_snapshot") return "스냅샷";
  if (source === "asset_price_snapshot") return "전일종가";
  return "-";
}

function eventTypeLabel(value: string) {
  if (value === "buy") return "매수";
  if (value === "sell") return "매도";
  if (value === "dividend") return "배당";
  if (value === "deposit") return "입금";
  if (value === "withdrawal") return "출금";
  if (value === "rebalance") return "리밸런싱";
  return value;
}

function mappingStatusLabel(value: DashboardEventActivity["mappingStatus"]) {
  if (value === "mapped") return "mapped";
  if (value === "legacy_only") return "legacy only";
  return "unmatched";
}

function mappingStatusClass(value: DashboardEventActivity["mappingStatus"]) {
  if (value === "mapped") return "bg-[#edf6ec] text-[#25633f]";
  if (value === "legacy_only") return "bg-[#fff8e7] text-[#7a5b16]";
  return "bg-[#f8ecec] text-[#9a3439]";
}

function principalSubValue(data: DashboardData) {
  const parts = [`${data.holdings.length}개 보유`];
  if (Math.abs(data.realizedCostBasisKrw) >= 0.5) {
    parts.push(`실현원가 ${formatKrwCompact(data.realizedCostBasisKrw)}`);
  }
  return parts.join(" · ");
}

function headlineBasisLabel(value: DashboardData["dataHealth"]["headlineBasis"]) {
  if (value === "current_assets_plus_event_ledger") return "현재+실현";
  return value;
}

function formatKrw(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "-";
  const cleanValue = Math.abs(value) < 0.5 ? 0 : value;
  const formatted = formatKrw(Math.abs(cleanValue));
  if (cleanValue > 0) return `+${formatted}`;
  if (cleanValue < 0) return `-${formatted}`;
  return formatted;
}

function formatKrwCompact(value: number | null) {
  if (value === null) return "-";
  return compactKrw(value, false);
}

function formatSignedKrwCompact(value: number | null) {
  if (value === null) return "-";
  return compactKrw(value, true);
}

function compactKrw(value: number, signed: boolean) {
  const cleanValue = Math.abs(value) < 0.5 ? 0 : value;
  const absValue = Math.abs(cleanValue);
  const prefix = signed && cleanValue > 0 ? "+" : cleanValue < 0 ? "-" : "";

  if (absValue >= 100_000_000) {
    return `${prefix}${(absValue / 100_000_000).toFixed(1)}억`;
  }
  if (absValue >= 10_000) {
    return `${prefix}${Math.round(absValue / 10_000).toLocaleString("ko-KR")}만`;
  }
  return `${prefix}${formatKrw(absValue)}`;
}

function formatPct(value: number | null, signed = false) {
  if (value === null) return "-";
  const cleanValue = Math.abs(value) < 0.005 ? 0 : value;
  const sign = signed && cleanValue > 0 ? "+" : "";
  return `${sign}${cleanValue.toFixed(2)}%`;
}

function formatNumber(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 6,
  }).format(value);
}

function formatPrice(value: number, currency: string) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatKrw(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 10).replaceAll("-", ".");
}

function accountLabel(value: string) {
  if (value === "brokerage") return "증권";
  if (value === "isa") return "ISA";
  if (value === "irp") return "IRP";
  return value;
}

function assetTypeLabel(value: string) {
  if (value === "housing_subscription") return "청약";
  if (value === "savings") return "저축";
  if (value === "fixed_deposit") return "예금";
  return value;
}

function toneFor(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || Math.abs(value) < 0.005) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function moneyToneFor(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || Math.abs(value) < 0.5) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function toneClass(value: number | null) {
  return toneClassValue(toneFor(value));
}

function moneyToneClass(value: number | null) {
  return toneClassValue(moneyToneFor(value));
}

function toneClassValue(tone: "positive" | "negative" | "neutral") {
  if (tone === "positive") return "text-[#1d7a4a]";
  if (tone === "negative") return "text-[#b43d43]";
  return "text-[#2e352f]";
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
