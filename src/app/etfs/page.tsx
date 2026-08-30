import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import {
  getReadOnlyEtfHoldings,
  searchReadOnlyEtfMasters,
  type ReadOnlyEtfHoldingsResult,
  type ReadOnlyEtfMasterSearchResult,
} from "@/db/queries/etf-holdings";
import type {
  GroupedEtfHoldingRow,
  GroupedNumericValue,
  GroupedTextValue,
} from "@/lib/etf-holdings";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

type EtfsPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    ticker?: string | string[];
    etfMasterId?: string | string[];
    id?: string | string[];
    asOfDate?: string | string[];
  }>;
};

export default async function EtfsPage({ searchParams }: EtfsPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="ETF reference data remains closed until the signed-in product user is resolved."
        description="ETF masters and holdings are shared reference data, but product access still requires an active Varda Labs user session."
        resolution={resolution}
        title="ETF Reference"
      />
    );
  }

  const query = firstParam(params.q);
  const ticker = firstParam(params.ticker);
  const explicitMasterId = firstParam(params.etfMasterId) ?? firstParam(params.id);
  const asOfDate = firstParam(params.asOfDate);
  const searchQuery = query ?? ticker ?? null;
  const masters = await searchReadOnlyEtfMasters({ query: searchQuery, limit: 24 });
  const selectedMasterId =
    explicitMasterId ??
    findMasterIdByTicker(masters, ticker) ??
    masters[0]?.id ??
    null;
  const selectedAsOfDate = asOfDate ?? undefined;
  const holdings = selectedMasterId
    ? await getReadOnlyEtfHoldings({
        etfMasterId: selectedMasterId,
        asOfDate: selectedAsOfDate,
      })
    : ticker
      ? await getReadOnlyEtfHoldings({
          etfTicker: ticker,
          asOfDate: selectedAsOfDate,
        })
      : null;

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 px-4 py-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">
                  Varda Labs
                </p>
                <h1 className="mt-1 text-xl font-semibold tracking-normal">
                  ETF Reference
                </h1>
              </div>
              <Link
                href="/"
                className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--muted)] hover:bg-[var(--wash)]"
              >
                Dashboard
              </Link>
            </div>
            <form action="/etfs" className="mt-4 space-y-2">
              <label className="block text-xs font-semibold text-[var(--muted)]" htmlFor="q">
                Search ticker or name
              </label>
              <div className="flex gap-2">
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={query ?? ticker ?? ""}
                  className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                  placeholder="SPY, TIGER, KODEX"
                />
                <button
                  type="submit"
                  className="rounded-md bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--ink)]"
                >
                  Search
                </button>
              </div>
            </form>
          </section>

          <EtfMasterList
            masters={masters}
            selectedMasterId={holdings?.etfMaster?.id ?? selectedMasterId}
            query={query}
          />
        </aside>

        <section className="min-w-0 space-y-4">
          <EtfHoldingSummary holdings={holdings} searchQuery={searchQuery} />
          {holdings ? <GroupedHoldingsTable holdings={holdings} /> : null}
        </section>
      </div>
    </main>
  );
}

function EtfMasterList({
  masters,
  selectedMasterId,
  query,
}: {
  masters: ReadOnlyEtfMasterSearchResult[];
  selectedMasterId: string | null;
  query: string | null;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold tracking-normal">ETF Masters</h2>
        <p className="text-xs text-[var(--muted)]">{masters.length} shown</p>
      </div>
      <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1 sm:max-h-[560px]">
        {masters.length > 0 ? (
          masters.map((master) => (
            <Link
              key={master.id}
              href={etfMasterHref(master.id, query)}
              className={cn(
                "block rounded-md border px-3 py-2 text-sm transition",
                selectedMasterId === master.id
                  ? "border-[var(--faint)] bg-[var(--wash)]"
                  : "border-[var(--wash)] bg-white hover:bg-[var(--wash)]",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--ink)]">
                    {master.ticker}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    {master.name}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[11px] font-semibold text-[var(--muted)]">
                  <p>{master.market}</p>
                  {master.isUniversePick ? (
                    <p className="mt-1 rounded-sm bg-[var(--wash)] px-1.5 py-0.5 text-[var(--ink)]">
                      universe
                    </p>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 truncate text-xs text-[var(--faint)]">
                {[master.issuer, master.assetClass, master.categoryLabel]
                  .filter(Boolean)
                  .join(" / ") || "No classification"}
              </p>
            </Link>
          ))
        ) : (
          <p className="rounded-md bg-white px-3 py-2 text-sm text-[var(--muted)]">
            No ETF masters found.
          </p>
        )}
      </div>
      {masters.length >= 24 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Showing the first 24 matches. Refine search to narrow results.
        </p>
      ) : null}
    </section>
  );
}

function EtfHoldingSummary({
  holdings,
  searchQuery,
}: {
  holdings: ReadOnlyEtfHoldingsResult | null;
  searchQuery: string | null;
}) {
  if (!holdings) {
    return (
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-sm font-semibold text-[var(--muted)]">ETF Holdings</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-normal">
          Select an ETF
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          {searchQuery
            ? "No holdings are available for the current search."
            : "Search or select an ETF to inspect the latest grouped holdings."}
        </p>
      </section>
    );
  }

  const master = holdings.etfMaster;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--muted)]">
            {holdings.asOfDate.replaceAll("-", ".")}
          </p>
          <h2 className="mt-1 truncate text-2xl font-semibold tracking-normal">
            {master?.name ?? holdings.etfTicker}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {[holdings.etfTicker, master?.market, master?.currency]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <SummaryPill label="Raw rows" value={String(holdings.rawRowCount)} />
          <SummaryPill
            label="Grouped"
            value={String(holdings.groupedRowCount)}
          />
          <SummaryPill
            label="Duplicates"
            value={String(holdings.duplicateGroupCount)}
          />
        </div>
      </div>
      <p className="mt-4 rounded-md border border-[var(--brand-soft)] bg-[var(--wash)] px-3 py-2 text-xs font-medium text-[var(--warning)]">
        Read-only grouped view. These holdings are not connected to portfolio
        exposure, risk, recommendations, or snapshot writes.
      </p>
    </section>
  );
}

function GroupedHoldingsTable({
  holdings,
}: {
  holdings: ReadOnlyEtfHoldingsResult;
}) {
  const visibleRows = holdings.groupedHoldings.slice(0, 100);
  const hiddenCount = Math.max(holdings.groupedHoldings.length - visibleRows.length, 0);

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <div className="flex flex-col gap-2 border-b border-[var(--wash)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold tracking-normal">
          Latest grouped holdings
        </h2>
        <p className="text-sm text-[var(--muted)]">
          {visibleRows.length} of {holdings.groupedRowCount} groups
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--wash)] text-left text-xs font-semibold uppercase text-[var(--muted)]">
              <th className="px-4 py-3">Holding</th>
              <th className="px-3 py-3 text-right">Rank</th>
              <th className="px-3 py-3 text-right">Weight</th>
              <th className="px-3 py-3 text-right">Shares</th>
              <th className="px-3 py-3 text-right">Value</th>
              <th className="px-3 py-3">Sector</th>
              <th className="px-3 py-3">Currency</th>
              <th className="px-4 py-3">Raw</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((holding) => (
              <GroupedHoldingRow key={holding.identityKey} holding={holding} />
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? (
        <p className="border-t border-[var(--wash)] px-4 py-3 text-sm text-[var(--muted)]">
          {hiddenCount} additional groups are not rendered in this first read-only
          view.
        </p>
      ) : null}
    </section>
  );
}

function GroupedHoldingRow({ holding }: { holding: GroupedEtfHoldingRow }) {
  return (
    <tr className="border-t border-[var(--wash)] bg-white/70 align-top">
      <td className="px-4 py-3">
        <div className="max-w-[320px]">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-[var(--ink)]">
              {holding.holdingName}
            </p>
            {holding.hasDuplicates ? (
              <span className="shrink-0 rounded-sm bg-[var(--warning-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warning)]">
                raw {holding.rawRowCount}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs text-[var(--muted)]">
            {holding.holdingSymbol ?? "-"} / {textValue(holding.holdingMarket)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--faint)]">
            source {textValue(holding.source)}
          </p>
        </div>
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {holding.rank.value ?? "-"}
        {holding.rank.disagrees ? (
          <StatusBadge label="rank differs" tone="warn" />
        ) : null}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <GroupedNumericDisplay value={holding.weightPct} suffix="%" />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <GroupedNumericDisplay value={holding.shares} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        <GroupedNumericDisplay value={holding.marketValue} />
      </td>
      <td className="px-3 py-3">
        <GroupedTextDisplay value={holding.sector} />
      </td>
      <td className="px-3 py-3">
        <GroupedTextDisplay value={holding.currency} />
      </td>
      <td className="px-4 py-3">
        <RawRowsDetails holding={holding} />
      </td>
    </tr>
  );
}

function RawRowsDetails({ holding }: { holding: GroupedEtfHoldingRow }) {
  return (
    <details className="max-w-[320px] text-xs text-[var(--muted)]">
      <summary className="cursor-pointer font-semibold text-[var(--muted)]">
        {holding.rawRowCount} row{holding.rawRowCount === 1 ? "" : "s"}
      </summary>
      <div className="mt-2 space-y-2">
        {holding.rawRows.map((row) => (
          <div
            key={row.id}
            className="rounded-md border border-[var(--wash)] bg-[var(--surface)] p-2"
          >
            <p className="font-semibold text-[var(--ink)]">
              {row.source ?? "unknown source"}
            </p>
            <p className="mt-1">
              rank {row.rank ?? "-"} / weight {formatNullableNumber(row.weightPct)}%
            </p>
            <p>
              shares {formatNullableNumber(row.shares)} / value{" "}
              {formatNullableNumber(row.marketValue)}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white px-3 py-2">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function GroupedNumericDisplay({
  value,
  suffix = "",
}: {
  value: GroupedNumericValue;
  suffix?: string;
}) {
  if (value.status === "sum") {
    return (
      <span>
        {formatNumber(value.value)}
        {suffix}
      </span>
    );
  }

  return <StatusBadge label={value.status} tone="muted" />;
}

function GroupedTextDisplay({ value }: { value: GroupedTextValue }) {
  if (value.status === "single") return <span>{value.value}</span>;
  if (value.status === "empty") return <span>-</span>;
  return <StatusBadge label="mixed" tone="muted" />;
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "warn" | "muted";
}) {
  return (
    <span
      className={cn(
        "ml-1 inline-flex rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
        tone === "warn"
          ? "bg-[var(--warning-soft)] text-[var(--warning)]"
          : "bg-[var(--wash)] text-[var(--muted)]",
      )}
    >
      {label}
    </span>
  );
}

function textValue(value: GroupedTextValue) {
  if (value.status === "single") return value.value ?? "-";
  return value.status;
}

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value?.trim() || null;
}

function findMasterIdByTicker(
  masters: ReadOnlyEtfMasterSearchResult[],
  ticker: string | null,
) {
  const normalizedTicker = ticker?.trim().toUpperCase();
  if (!normalizedTicker) return null;
  return (
    masters.find((master) => master.ticker.toUpperCase() === normalizedTicker)
      ?.id ?? null
  );
}

function etfMasterHref(masterId: string, query: string | null) {
  const params = new URLSearchParams({ etfMasterId: masterId });
  if (query) params.set("q", query);
  return `/etfs?${params.toString()}`;
}

function formatNullableNumber(value: string | number | null) {
  if (value === null || value === "") return "-";
  return formatNumber(Number(value));
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 4,
  }).format(value);
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
