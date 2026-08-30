"use client";

import { useMemo, useState } from "react";

import type { AdditionalContributionFlowRow } from "@/lib/additional-contribution-view";

type FlowMode = "final" | "strategic";

export function AdditionalContributionFlowMap({
  cashAmountKrw,
  availableFundsKrw,
  trimProceedsKrw,
  rows,
}: {
  cashAmountKrw: number;
  availableFundsKrw: number;
  trimProceedsKrw: number;
  rows: readonly AdditionalContributionFlowRow[];
}) {
  const hasOverlay = rows.some((row) => row.reductionKrw > 0);
  const [mode, setMode] = useState<FlowMode>("final");
  const [activeId, setActiveId] = useState<string | null>(null);
  const layout = useMemo(
    () => buildFlowLayout(rows, availableFundsKrw, mode),
    [availableFundsKrw, mode, rows],
  );
  const activeRow = rows.find((row) => row.id === activeId) ?? null;

  return (
    <section aria-labelledby="allocation-flow-title" className="min-w-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[var(--muted)]">
            ALLOCATION FLOW
          </p>
          <h2 id="allocation-flow-title" className="mt-1 text-xl font-medium">
            투입금 흐름
          </h2>
          <p className="mt-2 text-xs text-[var(--muted)]">
            신규 {formatKrw(cashAmountKrw)} · 계산상 매도{" "}
            {formatKrw(trimProceedsKrw)}
          </p>
        </div>

        {hasOverlay ? (
          <div
            aria-label="배분안 비교"
            className="flex w-fit items-center gap-5 text-sm"
            role="group"
          >
            <ModeButton
              active={mode === "final"}
              label="최종 배분"
              onClick={() => setMode("final")}
            />
            <ModeButton
              active={mode === "strategic"}
              label="추세 적용 전"
              onClick={() => setMode("strategic")}
            />
          </div>
        ) : null}
      </div>

      <div className="relative mt-4 hidden min-h-[400px] overflow-hidden py-5 lg:block">
        {activeRow ? <FlowTooltip mode={mode} row={activeRow} /> : null}

        <svg
          aria-label={`${formatKrw(availableFundsKrw)} 재원 배분 흐름`}
          className="h-[390px] w-full overflow-visible"
          role="img"
          viewBox="0 0 1000 420"
        >
          <text fill="var(--muted)" fontSize="11" x="72" y="48">
            배분 재원
          </text>
          <text
            fill="var(--ink)"
            fontSize="30"
            fontWeight="500"
            textAnchor="middle"
            x="145"
            y="220"
          >
            {formatCompactKrw(availableFundsKrw)}
          </text>
          <circle cx="145" cy="210" fill="none" r="72" stroke="var(--line)" />
          <circle cx="217" cy="210" fill="var(--brand)" r="4" />

          {layout.map((item) => {
            const active = item.row.id === activeId;
            return (
              <g
                key={item.row.id}
                aria-label={`${item.row.name}, ${formatKrw(item.amountKrw)}`}
                className="cursor-default outline-none"
                onBlur={() => setActiveId(null)}
                onFocus={() => setActiveId(item.row.id)}
                onMouseEnter={() => setActiveId(item.row.id)}
                onMouseLeave={() => setActiveId(null)}
                role="button"
                tabIndex={0}
              >
                <path
                  d={item.path}
                  fill="none"
                  opacity={activeId && !active ? 0.25 : active ? 1 : 0.76}
                  stroke={
                    item.row.kind === "cash" ? "var(--faint)" : "var(--brand)"
                  }
                  strokeLinecap="round"
                  strokeWidth={active ? item.strokeWidth + 3 : item.strokeWidth}
                />
                <circle
                  cx="820"
                  cy={item.targetY}
                  fill={
                    item.row.kind === "cash" ? "var(--warning)" : "var(--brand)"
                  }
                  r={active ? 6 : 4}
                />
                <text
                  fill="var(--ink)"
                  fontSize="13"
                  fontWeight="500"
                  x="840"
                  y={item.targetY - 3}
                >
                  {truncateName(item.row.name)}
                </text>
                <text
                  fill="var(--muted)"
                  fontSize="11"
                  x="840"
                  y={item.targetY + 14}
                >
                  {formatKrw(item.amountKrw)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-6 divide-y divide-[var(--wash)] border-y border-[var(--line)] lg:hidden">
        {layout.map(({ amountKrw, row }) => (
          <button
            key={row.id}
            type="button"
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-1 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
            onClick={() => setActiveId(activeId === row.id ? null : row.id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {row.name}
              </span>
              <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                {row.accountName}
                {row.ticker ? ` · ${row.ticker}` : ""}
              </span>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[var(--wash)]">
                <span
                  className={`block h-full rounded-full ${
                    row.kind === "cash"
                      ? "bg-[var(--warning)]"
                      : "bg-[var(--brand)]"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(1.5, availableFundsKrw > 0 ? (amountKrw / availableFundsKrw) * 100 : 0))}%`,
                  }}
                />
              </span>
            </span>
            <span className="pt-0.5 text-sm font-medium tabular-nums">
              {formatKrw(amountKrw)}
            </span>
            {activeId === row.id ? (
              <span className="col-span-2 mt-4 grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                <span>목표 {formatPercent(row.targetWeightPct)}</span>
                <span>투입 후 {formatPercent(row.postTopupWeightPct)}</span>
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`border-b py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--brand)] ${
        active
          ? "border-[var(--ink)] text-[var(--ink)]"
          : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function FlowTooltip({
  mode,
  row,
}: {
  mode: FlowMode;
  row: AdditionalContributionFlowRow;
}) {
  const amountKrw =
    mode === "final" ? row.allocationKrw : row.strategicAllocationKrw;
  return (
    <div className="pointer-events-none absolute right-0 top-4 z-10 w-64 border border-[var(--line)] bg-[var(--surface)]/95 p-4 shadow-[0_12px_30px_rgba(37,40,36,0.08)] backdrop-blur-sm">
      <p className="truncate text-sm font-medium">{row.name}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {row.accountName}
        {row.ticker ? ` · ${row.ticker}` : ""}
      </p>
      <p className="mt-4 text-2xl font-medium tabular-nums">
        {formatKrw(amountKrw)}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--wash)] pt-3 text-xs">
        <div>
          <dt className="text-[var(--muted)]">목표 비중</dt>
          <dd className="mt-1 font-medium">
            {formatPercent(row.targetWeightPct)}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--muted)]">투입 후</dt>
          <dd className="mt-1 font-medium">
            {formatPercent(row.postTopupWeightPct)}
          </dd>
        </div>
      </dl>
      {row.reductionKrw > 0 ? (
        <p className="mt-3 text-xs text-[var(--warning)]">
          MA120 근거로 {formatKrw(row.reductionKrw)} 현금 보류
        </p>
      ) : null}
    </div>
  );
}

function buildFlowLayout(
  rows: readonly AdditionalContributionFlowRow[],
  cashAmountKrw: number,
  mode: FlowMode,
) {
  const visibleRows = rows
    .map((row) => ({
      row,
      amountKrw:
        mode === "final" ? row.allocationKrw : row.strategicAllocationKrw,
    }))
    .filter((item) => item.amountKrw > 0);
  const top = 70;
  const bottom = 370;
  const targetGap =
    visibleRows.length > 1 ? (bottom - top) / (visibleRows.length - 1) : 0;
  const sourceHeight = 190;
  let sourceOffset = -sourceHeight / 2;

  return visibleRows.map((item, index) => {
    const share = cashAmountKrw > 0 ? item.amountKrw / cashAmountKrw : 0;
    const sourceBandHeight = share * sourceHeight;
    const sourceY = 210 + sourceOffset + sourceBandHeight / 2;
    const targetY = visibleRows.length > 1 ? top + index * targetGap : 210;
    sourceOffset += sourceBandHeight;

    return Object.freeze({
      ...item,
      sourceY,
      targetY,
      strokeWidth: Math.max(1.5, Math.min(12, Math.sqrt(share) * 22)),
      path: `M 217 210 C 390 ${sourceY.toFixed(2)}, 560 ${targetY.toFixed(2)}, 820 ${targetY.toFixed(2)}`,
    });
  });
}

function truncateName(value: string) {
  return value.length > 18 ? `${value.slice(0, 17)}…` : value;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactKrw(value: number) {
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(value % 100_000_000 === 0 ? 0 : 1)}억`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(value / 10_000)}만`;
  }
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}
