"use client";

import Link from "next/link";
import { useState } from "react";

import {
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";

export type TodayContributionDisplayRow = Readonly<{
  accountLabel: string;
  changeKrw: number;
  fxImpactKrw: number;
  href: string;
  key: string;
  name: string;
  priceImpactKrw: number;
  returnPct: number | null;
  selected: boolean;
  ticker: string | null;
  tradeFlowKrw: number;
}>;

export function TodayContributionExplorer({
  rows,
}: {
  rows: readonly TodayContributionDisplayRow[];
}) {
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.selected) ?? null;
  const activeRow =
    rows.find((row) => row.href === hoveredHref) ?? selectedRow ?? rows[0] ?? null;
  const maxMagnitude = Math.max(
    1,
    ...rows.map((row) => Math.abs(row.changeKrw)),
  );

  if (rows.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center border-y border-[#e1e4df] text-center">
        <div>
          <p className="text-base font-medium text-[#272b27]">표시할 변동 근거가 없습니다.</p>
          <p className="mt-2 text-sm text-[#727870]">
            기준 스냅샷과 현재 가격이 연결되면 종목별 기여가 나타납니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid border-y border-[#e1e4df] lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 py-3 lg:border-r lg:border-[#e1e4df]">
        <div className="divide-y divide-[#eceeea]">
          {rows.map((row) => {
            const width = Math.max(1.5, (Math.abs(row.changeKrw) / maxMagnitude) * 48);
            const positive = row.changeKrw >= 0;

            return (
              <Link
                key={row.key}
                aria-current={row.selected ? "true" : undefined}
                className={`group grid min-h-14 grid-cols-[minmax(0,1fr)_88px] items-center gap-4 px-1 py-2.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#347e62] sm:grid-cols-[minmax(130px,220px)_minmax(150px,1fr)_100px] sm:px-3 ${
                  row.selected ? "bg-[#f3f6f1]" : "hover:bg-[#f7f8f5]"
                }`}
                href={row.href}
                scroll={false}
                onBlur={() => setHoveredHref(null)}
                onFocus={() => setHoveredHref(row.href)}
                onMouseEnter={() => setHoveredHref(row.href)}
                onMouseLeave={() => setHoveredHref(null)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#222622]" title={row.name}>
                    {row.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[#777d75]">
                    {row.accountLabel}
                    {row.ticker ? ` · ${row.ticker}` : ""}
                  </span>
                </span>

                <span className="relative hidden h-5 sm:block" aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[#d9ddd7]" />
                  <span
                    className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full transition-[width] duration-200 ${
                      positive ? "bg-[#4c9276]" : "bg-[#cc6b67]"
                    }`}
                    style={
                      positive
                        ? { left: "50%", width: `${width}%` }
                        : { right: "50%", width: `${width}%` }
                    }
                  />
                </span>

                <span className="text-right">
                  <span className={`block text-sm font-semibold ${toneClass(row.changeKrw)}`}>
                    {formatSignedKrw(row.changeKrw)}
                  </span>
                  <span className="block text-xs text-[#777d75]">
                    {formatPercent(row.returnPct, true)}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <aside className="min-h-60 px-5 py-5 lg:min-h-full lg:px-6">
        <p className="text-[11px] font-medium text-[#777d75]">ACTIVE CONTRIBUTION</p>
        <h3 className="mt-3 text-xl font-medium text-[#202420]">
          {activeRow?.name ?? "-"}
        </h3>
        <p className={`mt-1 text-3xl font-medium ${toneClass(activeRow?.changeKrw ?? null)}`}>
          {formatSignedKrw(activeRow?.changeKrw ?? null)}
        </p>

        <dl className="mt-8 divide-y divide-[#e3e6e0] border-y border-[#e3e6e0]">
          <AttributionRow label="가격 영향" value={activeRow?.priceImpactKrw ?? null} />
          <AttributionRow label="환율 영향" value={activeRow?.fxImpactKrw ?? null} />
          <AttributionRow label="순매매" value={activeRow?.tradeFlowKrw ?? null} />
        </dl>

        <p className="mt-5 text-xs leading-5 text-[#747a72]">
          행을 가리키면 변동 구성이 바뀝니다. 선택하면 해당 종목의 현재·기준 근거를 확인합니다.
        </p>
      </aside>
    </div>
  );
}

function AttributionRow({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-[#737971]">{label}</dt>
      <dd className={`text-sm font-semibold ${toneClass(value)}`}>
        {formatSignedKrw(value)}
      </dd>
    </div>
  );
}
