import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DashboardAccount,
  DashboardData,
  DashboardHolding,
} from "@/lib/portfolio-dashboard";
import {
  selectTodayHoldingDetail,
  todayHoldingDetailHref,
  type TodayHoldingDetailQuery,
  type TodayHoldingDetailResult,
} from "@/lib/today-holding-detail";

const accountTabs: { code: DashboardAccount; label: string }[] = [
  { code: "brokerage", label: "Brokerage" },
  { code: "isa", label: "ISA" },
  { code: "irp", label: "IRP" },
  { code: "all", label: "All" },
];

export function TodayMovement({
  data,
  detailQuery = { ticker: null, market: null },
}: {
  data: DashboardData;
  detailQuery?: TodayHoldingDetailQuery;
}) {
  const movement = data.todayMovement;
  const holdingById = new Map(data.holdings.map((holding) => [holding.id, holding]));
  const detail = selectTodayHoldingDetail(data, detailQuery);

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-4 text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-[#626b5f]">
                {formatDate(data.generatedAt)}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">
                오늘 변동
              </h1>
              <p className="mt-2 text-sm text-[#687064]">
                기준일 {formatDate(data.latestSnapshotReferenceDate)} · 스냅샷{" "}
                {formatDate(data.latestSnapshotDate)} · USD/KRW{" "}
                {formatNumber(data.usdKrwRate)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/"
                className="rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-sm font-semibold text-[#334038]"
              >
                Dashboard
              </Link>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-[#dce2d2] bg-white p-1 sm:grid-cols-4">
                {accountTabs.map((tab) => (
                  <Link
                    key={tab.code}
                    href={tab.code === "brokerage" ? "/today" : `/today?account=${tab.code}`}
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
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="상태" value={movement.ready ? "준비됨" : "준비 안 됨"} />
          <MetricCard label="기준 데이터" value={sourceLabel(movement.source)} />
          <MetricCard
            label="오늘 변동"
            value={formatSignedKrw(movement.changeKrw)}
            tone={toneFor(movement.changeKrw)}
          />
          <MetricCard
            label="환율 영향"
            value={formatSignedKrw(movement.fxChangeKrw)}
            tone={toneFor(movement.fxChangeKrw)}
          />
          <MetricCard
            label="매매 흐름"
            value={formatSignedKrw(movement.tradeFlowKrw)}
            tone={toneFor(movement.tradeFlowKrw)}
          />
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          <MetricCard label="기준 평가액" value={formatKrw(movement.previousTotalKrw)} />
          <MetricCard label="변동률" value={formatPct(movement.returnPct)} />
          <MetricCard
            label="현재 보유 매칭률"
            value={formatCoveragePct(movement.coverage.currentCoveragePct)}
          />
          <MetricCard
            label="기준 스냅샷 매칭률"
            value={formatCoveragePct(movement.coverage.snapshotCoveragePct)}
          />
        </section>

        {!movement.ready ? (
          <section className="rounded-lg border border-[#e2d5a8] bg-[#fffaf0] p-4 text-sm text-[#5d4b1b]">
            <p className="font-semibold">사유: {reasonLabel(movement.reason)}</p>
          </section>
        ) : null}

        <HoldingDetailPanel
          detail={detail}
          baselineReferenceDate={data.latestSnapshotReferenceDate}
          snapshotDate={data.latestSnapshotDate}
          usdKrwRate={data.usdKrwRate}
        />

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
          <div className="flex flex-col gap-1 border-b border-[#e1e5d8] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Contributions</h2>
              <p className="text-sm text-[#687064]">
                {movement.contributionRows.length} rows
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#eef1e8] text-xs uppercase text-[#687064]">
                <tr>
                  <Th>Holding</Th>
                  <Th>Account</Th>
                  <Th>Source</Th>
                  <Th align="right">Previous</Th>
                  <Th align="right">Current</Th>
                  <Th align="right">Change</Th>
                  <Th align="right">Return</Th>
                  <Th align="right">FX</Th>
                  <Th align="right">Trade flow</Th>
                </tr>
              </thead>
              <tbody>
                {movement.contributionRows.length > 0 ? (
                  movement.contributionRows.map((row) => {
                    const holding = holdingById.get(row.holdingId) ?? null;
                    return (
                      <tr key={row.holdingId} className="border-t border-[#e7eadf]">
                        <Td>
                          <HoldingLabel
                            holding={holding}
                            selectedAccount={data.selectedAccount}
                          />
                        </Td>
                        <Td>{holding?.account ?? "-"}</Td>
                        <Td>{sourceLabel(row.source)}</Td>
                        <Td align="right">{formatKrw(row.previousValueKrw)}</Td>
                        <Td align="right">{formatKrw(holding?.valueKrw ?? null)}</Td>
                        <Td align="right" className={toneFor(row.changeKrw)}>
                          {formatSignedKrw(row.changeKrw)}
                        </Td>
                        <Td align="right">{formatPct(row.returnPct)}</Td>
                        <Td align="right" className={toneFor(row.fxChangeKrw)}>
                          {formatSignedKrw(row.fxChangeKrw)}
                        </Td>
                        <Td align="right" className={toneFor(row.tradeFlowKrw)}>
                          {formatSignedKrw(row.tradeFlowKrw)}
                        </Td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <Td colSpan={9}>No contribution rows.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
          <div className="flex flex-col gap-1 border-b border-[#e1e5d8] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Exclusions</h2>
              <p className="text-sm text-[#687064]">{movement.exclusions.length} rows</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#eef1e8] text-xs uppercase text-[#687064]">
                <tr>
                  <Th>Subject</Th>
                  <Th>Reason</Th>
                  <Th>Holding</Th>
                  <Th>Account</Th>
                  <Th>Currency</Th>
                  <Th>Source</Th>
                  <Th align="right">Value</Th>
                </tr>
              </thead>
              <tbody>
                {movement.exclusions.length > 0 ? (
                  movement.exclusions.map((row, index) => (
                    <tr
                      key={`${row.subject}-${row.reason}-${row.holdingId ?? row.snapshotId ?? index}`}
                      className="border-t border-[#e7eadf]"
                    >
                      <Td>{row.subject}</Td>
                      <Td>{reasonLabel(row.reason)}</Td>
                      <Td>
                        <div className="font-semibold text-[#1f2722]">
                          {row.ticker ?? "-"}
                        </div>
                        <div className="text-xs text-[#687064]">
                          {row.assetName ?? "-"}
                        </div>
                      </Td>
                      <Td>{row.account ?? "-"}</Td>
                      <Td>{row.currency ?? "-"}</Td>
                      <Td>{sourceLabel(row.source)}</Td>
                      <Td align="right">{formatKrw(row.valueKrw)}</Td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <Td colSpan={7}>No exclusions.</Td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function HoldingDetailPanel({
  detail,
  baselineReferenceDate,
  snapshotDate,
  usdKrwRate,
}: {
  detail: TodayHoldingDetailResult;
  baselineReferenceDate: string | null;
  snapshotDate: string | null;
  usdKrwRate: number | null;
}) {
  if (detail.status === "empty") return null;

  if (detail.status === "not_found") {
    return (
      <section className="rounded-lg border border-[#e2d5a8] bg-[#fffaf0] p-4 text-sm text-[#5d4b1b]">
        <p className="font-semibold">종목 상세를 찾을 수 없음</p>
        <p className="mt-1">
          현재 보유 자산에서 {detail.query.ticker ?? "-"}
          {detail.query.market ? ` / ${detail.query.market}` : ""}에 해당하는
          종목을 찾지 못했습니다.
        </p>
      </section>
    );
  }

  if (detail.status === "ambiguous") {
    return (
      <section className="rounded-lg border border-[#e2d5a8] bg-[#fffaf0] p-4 text-sm text-[#5d4b1b]">
        <p className="font-semibold">계좌를 더 좁혀 선택 필요</p>
        <p className="mt-1">
          {detail.query.ticker ?? "-"}에 해당하는 현재 보유 자산이 여러 개입니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {detail.candidates.map((candidate) => (
            <Link
              key={`${candidate.account}-${candidate.market}-${candidate.ticker}`}
              href={todayHoldingDetailHref(candidate.account as DashboardAccount, candidate)}
              className="rounded-md border border-[#d8c68f] bg-white px-3 py-2 text-xs font-semibold text-[#5d4b1b]"
            >
              {candidate.ticker ?? "-"} / {candidate.account} / {candidate.market}
            </Link>
          ))}
        </div>
      </section>
    );
  }

  const holding = detail.holding;
  const contribution = detail.contribution;

  return (
    <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
      <div className="flex flex-col gap-1 border-b border-[#e1e5d8] px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-[#687064]">선택 종목</p>
          <h2 className="text-lg font-semibold">
            {holding.ticker ?? "-"} / {holding.name}
          </h2>
          <p className="text-sm text-[#687064]">
            {holding.account} / {holding.market} / {holding.currency}
          </p>
        </div>
        <Link
          href={holding.account === "brokerage" ? "/today" : `/today?account=${holding.account}`}
          className="w-fit rounded-md border border-[#dce2d2] bg-white px-3 py-2 text-sm font-semibold text-[#334038]"
        >
          선택 해제
        </Link>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-3">
        <DetailGroup title="현재 데이터">
          <DetailRow label="수량" value={formatNumber(holding.quantity)} />
          <DetailRow label="현재가" value={formatNumber(holding.currentPrice)} />
          <DetailRow label="현재 평가액" value={formatKrw(holding.valueKrw)} />
          <DetailRow label="가격 출처" value={holding.priceSource ?? "-"} />
          <DetailRow label="가격 유형" value={quoteTypeLabel(holding.priceQuoteType)} />
          <DetailRow label="가격 상태" value={statusLabel(holding.priceStatus)} />
          <DetailRow label="가져온 시각" value={formatDateTime(holding.priceFetchedAt)} />
          <DetailRow label="가격 시각" value={formatDateTime(holding.priceAsOf)} />
          {holding.currency === "USD" ? (
            <DetailRow label="저장 USD/KRW" value={formatNumber(usdKrwRate)} />
          ) : null}
        </DetailGroup>

        <DetailGroup title="기준 데이터">
          <DetailRow label="기준일" value={formatDate(baselineReferenceDate)} />
          <DetailRow label="스냅샷 저장일" value={formatDate(snapshotDate)} />
          <DetailRow
            label="변동 기준"
            value={sourceLabel(contribution?.source ?? holding.dailySource)}
          />
          <DetailRow
            label="기준 평가액"
            value={formatKrw(contribution?.previousValueKrw ?? holding.previousCloseValueKrw)}
          />
          <DetailRow
            label="전일종가 기준 평가액"
            value={formatKrw(holding.previousCloseValueKrw)}
          />
        </DetailGroup>

        <DetailGroup title="변동 분해">
          <DetailRow
            label="오늘 변동"
            value={formatSignedKrw(contribution?.changeKrw ?? holding.dailyChangeKrw)}
            tone={toneFor(contribution?.changeKrw ?? holding.dailyChangeKrw)}
          />
          <DetailRow
            label="변동률"
            value={formatPct(contribution?.returnPct ?? holding.dailyReturnPct)}
          />
          <DetailRow
            label="환율 영향"
            value={formatSignedKrw(contribution?.fxChangeKrw ?? holding.fxDailyChangeKrw)}
            tone={toneFor(contribution?.fxChangeKrw ?? holding.fxDailyChangeKrw)}
          />
          <DetailRow
            label="매매 흐름"
            value={formatSignedKrw(contribution?.tradeFlowKrw ?? 0)}
            tone={toneFor(contribution?.tradeFlowKrw ?? 0)}
          />
        </DetailGroup>
      </div>

      {detail.exclusions.length > 0 ? (
        <div className="border-t border-[#e1e5d8] px-4 py-3">
          <h3 className="text-sm font-semibold">제외 사유</h3>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {detail.exclusions.map((exclusion, index) => (
              <div
                key={`${exclusion.subject}-${exclusion.reason}-${index}`}
                className="rounded-md border border-[#e6dec4] bg-[#fffdf6] p-3 text-sm"
              >
                <p className="font-semibold text-[#5d4b1b]">
                  {reasonLabel(exclusion.reason)}
                </p>
                <p className="mt-1 text-[#687064]">
                  {exclusion.subject} / {sourceLabel(exclusion.source)}
                </p>
                <p className="mt-1 text-[#2e352f]">
                  {exclusion.ticker ?? "-"} / {exclusion.assetName ?? "-"} /{" "}
                  {exclusion.account ?? "-"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[#e1e5d8] bg-white p-3">
      <h3 className="text-sm font-semibold text-[#1f2722]">{title}</h3>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[#687064]">{label}</span>
      <span className={cn("text-right font-semibold text-[#1f2722]", tone)}>
        {value}
      </span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <p className="text-sm font-medium text-[#687064]">{label}</p>
      <p className={cn("mt-2 text-xl font-semibold tracking-normal", tone)}>
        {value}
      </p>
    </div>
  );
}

function HoldingLabel({
  holding,
  selectedAccount,
}: {
  holding: DashboardHolding | null;
  selectedAccount: DashboardAccount;
}) {
  if (holding?.ticker) {
    return (
      <Link
        href={todayHoldingDetailHref(selectedAccount, holding)}
        className="block rounded-sm outline-offset-2 hover:text-[#1e3a34] hover:underline focus:outline focus:outline-2 focus:outline-[#1e3a34]"
      >
        <div className="font-semibold text-[#1f2722]">{holding.ticker}</div>
        <div className="text-xs text-[#687064]">{holding.name}</div>
      </Link>
    );
  }

  return (
    <div>
      <div className="font-semibold text-[#1f2722]">
        {holding?.ticker ?? "Unknown holding"}
      </div>
      <div className="text-xs text-[#687064]">{holding?.name ?? "-"}</div>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "px-4 py-3 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
  className,
}: {
  children: ReactNode;
  align?: "left" | "right";
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-4 py-3 align-top",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </td>
  );
}

function sourceLabel(source: string | null) {
  if (source === "daily_position_snapshot") return "일일 스냅샷";
  if (source === "asset_price_snapshot") return "전일 종가";
  return "-";
}

function reasonLabel(reason: string | null) {
  if (!reason) return "-";
  if (reason === "missing_baseline_snapshot") return "기준 스냅샷 없음";
  if (reason === "missing_fresh_live_prices") return "실시간 가격 없음";
  if (reason === "manual_valuation_not_updated_in_cycle") {
    return "이번 주기 수동 평가 미입력";
  }
  if (reason === "missing_previous_close_fallback") return "전일 종가 없음";
  if (reason === "unsupported_currency") return "지원하지 않는 통화";
  if (reason === "missing_current_fx") return "현재 환율 없음";
  if (reason === "missing_baseline_fx") return "기준 환율 없음";
  if (reason === "coverage_below_threshold") return "매칭률 부족";
  return reason.replaceAll("_", " ");
}

function quoteTypeLabel(value: string | null) {
  if (value === "live") return "실시간";
  if (value === "delayed") return "지연";
  if (value === "realtime") return "실시간";
  if (value === "manual_valuation") return "수동 평가";
  return value ?? "-";
}

function statusLabel(value: string | null) {
  if (value === "ok") return "정상";
  if (value === "stored_manual") return "저장된 수동값";
  return value ?? "-";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 10).replaceAll("-", ".");
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return value.replace("T", " ").slice(0, 16);
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `₩${Math.round(value).toLocaleString("en-US")}`;
}

function formatSignedKrw(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}₩${rounded.toLocaleString("en-US")}`;
}

function formatPct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function formatCoveragePct(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function toneFor(value: number | null) {
  if (value === null || !Number.isFinite(value) || value === 0) return "text-[#2e352f]";
  return value > 0 ? "text-[#087443]" : "text-[#b42318]";
}

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
