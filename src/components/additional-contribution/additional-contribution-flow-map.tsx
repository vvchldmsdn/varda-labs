"use client";

import { useMemo, useState } from "react";

import type { AdditionalContributionFlowRow } from "@/lib/additional-contribution-view";

type FlowMode = "final" | "strategic";

export function AdditionalContributionFlowMap({
  cashAmountKrw,
  rows,
}: {
  cashAmountKrw: number;
  rows: readonly AdditionalContributionFlowRow[];
}) {
  const hasOverlay = rows.some((row) => row.reductionKrw > 0);
  const [mode, setMode] = useState<FlowMode>("final");
  const [activeId, setActiveId] = useState<string | null>(null);
  const layout = useMemo(
    () => buildFlowLayout(rows, cashAmountKrw, mode),
    [cashAmountKrw, mode, rows],
  );
  const activeRow = rows.find((row) => row.id === activeId) ?? null;

  return (
    <section aria-labelledby="allocation-flow-title" className="min-w-0">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-medium text-[#7b8079]">ALLOCATION FLOW</p>
          <h2 id="allocation-flow-title" className="mt-1 text-xl font-medium">
            투입금 흐름
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#6d736b]">
            목표비중까지의 부족분을 기준으로 계산한 읽기 전용 배분안입니다.
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

      <div className="relative mt-7 hidden min-h-[430px] overflow-hidden border-y border-[#d9ddd7] py-5 lg:block">
        {activeRow ? (
          <FlowTooltip
            mode={mode}
            row={activeRow}
          />
        ) : (
          <p className="pointer-events-none absolute right-0 top-5 z-10 text-xs text-[#858a83]">
            흐름에 마우스를 올리면 배분 근거를 확인합니다
          </p>
        )}

        <svg
          aria-label={`${formatKrw(cashAmountKrw)} 투입금 배분 흐름`}
          className="h-[390px] w-full overflow-visible"
          role="img"
          viewBox="0 0 1000 420"
        >
          <defs>
            <linearGradient id="holding-flow" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#8db5a3" stopOpacity="0.45" />
              <stop offset="1" stopColor="#4f8f76" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="cash-flow" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#d7b38e" stopOpacity="0.42" />
              <stop offset="1" stopColor="#b68157" stopOpacity="0.82" />
            </linearGradient>
          </defs>

          <text fill="#7b8079" fontSize="11" x="72" y="48">
            새 투입금
          </text>
          <text
            fill="#20231f"
            fontSize="30"
            fontWeight="500"
            textAnchor="middle"
            x="145"
            y="220"
          >
            {formatCompactKrw(cashAmountKrw)}
          </text>
          <circle cx="145" cy="210" fill="none" r="72" stroke="#ccd2cb" />
          <circle cx="145" cy="210" fill="#f7f8f5" r="11" stroke="#347e62" strokeWidth="2" />

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
                  stroke={item.row.kind === "cash" ? "url(#cash-flow)" : "url(#holding-flow)"}
                  strokeLinecap="round"
                  strokeWidth={active ? item.strokeWidth + 3 : item.strokeWidth}
                />
                <circle
                  cx="820"
                  cy={item.targetY}
                  fill={item.row.kind === "cash" ? "#b68157" : "#4f8f76"}
                  r={active ? 6 : 4}
                />
                <text
                  fill="#20231f"
                  fontSize="13"
                  fontWeight="500"
                  x="840"
                  y={item.targetY - 3}
                >
                  {truncateName(item.row.name)}
                </text>
                <text fill="#777d75" fontSize="11" x="840" y={item.targetY + 14}>
                  {formatKrw(item.amountKrw)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-6 divide-y divide-[#e0e4de] border-y border-[#d9ddd7] lg:hidden">
        {layout.map(({ amountKrw, row }) => (
          <button
            key={row.id}
            type="button"
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-1 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#347e62]"
            onClick={() => setActiveId(activeId === row.id ? null : row.id)}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{row.name}</span>
              <span className="mt-1 block truncate text-xs text-[#777d75]">
                {row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}
              </span>
              <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-[#e5e8e3]">
                <span
                  className={`block h-full rounded-full ${
                    row.kind === "cash" ? "bg-[#b68157]" : "bg-[#5f9a82]"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(1.5, cashAmountKrw > 0 ? (amountKrw / cashAmountKrw) * 100 : 0))}%`,
                  }}
                />
              </span>
            </span>
            <span className="pt-0.5 text-sm font-medium tabular-nums">
              {formatKrw(amountKrw)}
            </span>
            {activeId === row.id ? (
              <span className="col-span-2 mt-4 grid grid-cols-2 gap-3 text-xs text-[#666c64]">
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
      className={`border-b py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#347e62] ${
        active
          ? "border-[#20231f] text-[#20231f]"
          : "border-transparent text-[#71776f] hover:text-[#20231f]"
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
  const amountKrw = mode === "final" ? row.allocationKrw : row.strategicAllocationKrw;
  return (
    <div className="pointer-events-none absolute right-0 top-4 z-10 w-64 border border-[#d3d8d1] bg-[#fbfcf9]/95 p-4 shadow-[0_12px_30px_rgba(37,40,36,0.08)] backdrop-blur-sm">
      <p className="truncate text-sm font-medium">{row.name}</p>
      <p className="mt-1 text-xs text-[#777d75]">
        {row.accountName}{row.ticker ? ` · ${row.ticker}` : ""}
      </p>
      <p className="mt-4 text-2xl font-medium tabular-nums">
        {formatKrw(amountKrw)}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[#e0e4de] pt-3 text-xs">
        <div>
          <dt className="text-[#7b8079]">목표 비중</dt>
          <dd className="mt-1 font-medium">{formatPercent(row.targetWeightPct)}</dd>
        </div>
        <div>
          <dt className="text-[#7b8079]">투입 후</dt>
          <dd className="mt-1 font-medium">{formatPercent(row.postTopupWeightPct)}</dd>
        </div>
      </dl>
      {row.reductionKrw > 0 ? (
        <p className="mt-3 text-xs text-[#9a6745]">
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
      strokeWidth: Math.max(4, Math.min(34, Math.sqrt(share) * 58)),
      path: `M 156 ${sourceY.toFixed(2)} C 370 ${sourceY.toFixed(2)}, 560 ${targetY.toFixed(2)}, 820 ${targetY.toFixed(2)}`,
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
