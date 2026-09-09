"use client";
import { T } from "@/components/i18n/localized-text";
import { translateHomeHistory } from "@/components/home/home-history-messages";
import { useI18n } from "@/components/i18n/locale-provider";


import Link from "next/link";
import { useId, useState, type CSSProperties } from "react";
import styles from "@/components/home/portfolio-overview.module.css";
import interaction from "./today-interaction.module.css";

import {
  formatPercent,
  formatSignedKrw,
  toneClass,
} from "@/components/home/portfolio-format";

export type TodayContributionDisplayRow = Readonly<{
  accountLabel: string;
  changeKrw: number;
  fxImpactKrw: number | null;
  href: string;
  key: string;
  name: string;
  priceImpactKrw: number | null;
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
  const { t } = useI18n();
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const [mobileSelectedKey, setMobileSelectedKey] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.selected) ?? null;
  const mobileSelectedRow = rows.find((row) => row.key === mobileSelectedKey) ?? selectedRow ?? rows[0] ?? null;
  const activeRow =
    rows.find((row) => row.href === hoveredHref) ?? selectedRow ?? rows[0] ?? null;
  const maxMagnitude = Math.max(
    1,
    ...rows.map((row) => Math.abs(row.changeKrw)),
  );

  if (rows.length === 0) {
    return (
      <div className="grid min-h-72 place-items-center border-y border-[var(--wash)] text-center">
        <div>
          <p className="text-base font-medium text-[var(--ink)]"><T ko="표시할 변동 근거가 없습니다." en="No change data is available."/></p>
          <p className="mt-2 text-sm text-[var(--muted)]"><T ko="기준 스냅샷과 현재 가격이 연결되면 종목별 기여가 나타납니다." en="Contributions appear when current prices can be matched to the baseline snapshot."/></p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.explorer} ${interaction.explorer}`}>
      <div className={styles.contributionRows}>
        <div className={styles.axisLabels} aria-hidden="true"><span><T ko="감소" en="Decrease"/></span><span><T ko="증가" en="Increase"/></span></div>
        <div
          className={styles.contributionScroll}
          tabIndex={0}
          aria-label={t("종목별 변동 기여 목록", "Value change contributions by holding")}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const viewport = event.currentTarget;
            const positions: Record<string, number> = {
              Home: 0,
              End: viewport.scrollHeight,
              PageDown: viewport.scrollTop + viewport.clientHeight * .85,
              PageUp: viewport.scrollTop - viewport.clientHeight * .85,
              ArrowDown: viewport.scrollTop + 58,
              ArrowUp: viewport.scrollTop - 58,
            };
            const position = positions[event.key];
            if (position === undefined) return;
            event.preventDefault();
            viewport.scrollTop = position;
          }}
        >
          {rows.map((row, rowIndex) => {

            return (
              <div key={row.key}>
              <Link
                aria-current={row.selected ? "true" : undefined}
                className={`${styles.contributionRow} ${interaction.desktopRow}`}
                data-holding-detail-trigger="row"
                data-active={activeRow?.key === row.key}
                style={{ "--row-delay": `${Math.min(rowIndex * 35, 280)}ms` } as CSSProperties}
                href={row.href}
                scroll={false}
                onBlur={() => setHoveredHref(null)}
                onFocus={() => setHoveredHref(row.href)}
                onMouseEnter={() => setHoveredHref(row.href)}
                onMouseLeave={() => setHoveredHref(null)}
              >
                <ContributionRowContent row={row} maximum={maxMagnitude} active={activeRow?.key === row.key} />
              </Link>
              <button
                type="button"
                className={`${styles.contributionRow} ${interaction.mobileRow}`}
                data-today-select-holding={row.key}
                data-active={mobileSelectedRow?.key === row.key}
                aria-pressed={mobileSelectedRow?.key === row.key}
                aria-controls="today-selected-holding-summary"
                onClick={() => setMobileSelectedKey(row.key)}
                style={{ "--row-delay": `${Math.min(rowIndex * 35, 280)}ms` } as CSSProperties}
              >
                <ContributionRowContent row={row} maximum={maxMagnitude} active={mobileSelectedRow?.key === row.key} />
              </button>
              </div>
            );
          })}
        </div>
      </div>

      <aside className={`${styles.activeContribution} ${interaction.desktopSummary}`} aria-live="polite">
        <p className={styles.eyebrow}>CONTRIBUTION DETAIL</p>
        <h3 key={`name:${activeRow?.key}`} className={styles.activeValue}>
          {activeRow?.name ?? "-"}
        </h3>
        <strong key={`value:${activeRow?.key}`} className={`${styles.activeValue} ${toneClass(activeRow?.changeKrw ?? null)}`}>
          {<T ko={formatSignedKrw(activeRow?.changeKrw ?? null)} en={translateHomeHistory(formatSignedKrw(activeRow?.changeKrw ?? null))}/>}
        </strong>

        <dl className="mt-8 divide-y divide-[var(--wash)] border-y border-[var(--wash)]">
          <AttributionRow label={t("가격 영향", "Price impact")} value={activeRow?.priceImpactKrw ?? null} />
          <AttributionRow label={t("환율 영향", "FX impact")} value={activeRow?.fxImpactKrw ?? null} />
          {activeRow && (activeRow.priceImpactKrw === null || activeRow.fxImpactKrw === null) ? (
            <p className="text-xs text-[var(--muted)]"><T ko="거래·평가 근거 확인이 필요해 원인별 분해를 보류했습니다." en="Attribution is unavailable until trade and valuation data can be verified."/></p>
          ) : null}
          <AttributionRow label={t("순매매", "Net trades")} value={activeRow?.tradeFlowKrw ?? null} />
        </dl>

        {activeRow ? <Link href={activeRow.href} scroll={false} className={styles.textLink} data-holding-detail-trigger="summary"><T ko="종목 상세 보기 →" en="View holding details →"/></Link> : null}
      </aside>
      {mobileSelectedRow ? (
        <Link
          id="today-selected-holding-summary"
          href={mobileSelectedRow.href}
          prefetch={false}
          scroll={false}
          className={interaction.mobileSummary}
          data-holding-detail-trigger="summary"
          aria-label={t(`${mobileSelectedRow.name} 상세 보기`, `View ${mobileSelectedRow.name} details`)}
        >
          <span className={interaction.summaryHeading} aria-live="polite" aria-atomic="true">
            <span className={interaction.summaryIdentity}><small><T ko="선택한 종목" en="Selected holding"/></small><strong>{mobileSelectedRow.name}</strong></span>
            <span className={interaction.summaryMovement}><strong className={toneClass(mobileSelectedRow.changeKrw)}><T ko={formatSignedKrw(mobileSelectedRow.changeKrw)} en={translateHomeHistory(formatSignedKrw(mobileSelectedRow.changeKrw))}/></strong><small>{formatPercent(mobileSelectedRow.returnPct, true)}</small></span>
          </span>
          <span className={interaction.summaryAction}><span><T ko="요약을 눌러 상세 보기" en="Tap summary for details"/></span><span aria-hidden="true">↗</span></span>
        </Link>
      ) : null}
    </div>
  );
}

function ContributionRowContent({ row, maximum, active }: { row: TodayContributionDisplayRow; maximum: number; active: boolean }) {
  return <>
    <span className="min-w-0">
      <span className="block truncate text-sm font-medium text-[var(--ink)]" title={row.name}>{row.name}</span>
      <span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{row.accountLabel}{row.ticker ? ` · ${row.ticker}` : ""}</span>
    </span>
    <DotContributionBar value={row.changeKrw} maximum={maximum} active={active} />
    <span className="text-right">
      <span className={`block text-sm font-semibold ${toneClass(row.changeKrw)}`}><T ko={formatSignedKrw(row.changeKrw)} en={translateHomeHistory(formatSignedKrw(row.changeKrw))}/></span>
      <span className="block text-xs text-[var(--muted)]">{formatPercent(row.returnPct, true)}</span>
    </span>
  </>;
}

function DotContributionBar({ value, maximum, active }: { value: number; maximum: number; active: boolean }) {
  const patternId = useId();
  const center = 250;
  const length = Math.abs(value) / maximum * 238;
  const positive = value >= 0;
  return (
    <span className={styles.contributionBar} aria-hidden="true">
      <svg viewBox="0 0 500 32" preserveAspectRatio="xMidYMid meet" className={styles.dotMatrix}>
        <defs>
          <pattern id={`${patternId}-track`} width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.7" fill="var(--line)" />
          </pattern>
          <pattern id={`${patternId}-value`} width="8" height="8" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r={active ? 2.55 : 2.05} fill={positive ? active ? "var(--accent)" : "var(--ink)" : "var(--negative)"} className={styles.matrixDot} />
          </pattern>
        </defs>
        <rect x="10" y="0" width="480" height="32" fill={`url(#${patternId}-track)`} opacity=".55" />
        <rect
          x={positive ? center : center - length}
          y="0"
          width={length}
          height="32"
          fill={`url(#${patternId}-value)`}
          className={positive ? styles.dotRevealPositive : styles.dotRevealNegative}
        />
        <line x1={center} x2={center} y1="-3" y2="35" stroke="var(--muted)" strokeWidth=".6" />
      </svg>
    </span>
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
      <dt className="text-sm text-[var(--muted)]">{<T ko={label} en={translateHomeHistory(label)}/>}</dt>
      <dd className={`text-sm font-semibold ${toneClass(value)}`}>
        {<T ko={formatSignedKrw(value)} en={translateHomeHistory(formatSignedKrw(value))}/>}
      </dd>
    </div>
  );
}
