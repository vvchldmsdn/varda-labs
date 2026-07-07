import Link from "next/link";
import type { ReactNode } from "react";

import {
  getReadOnlyMarketContext,
  type ReadOnlyMarketBenchmark,
  type ReadOnlyMarketFactor,
  type ReadOnlyMarketFactorFamily,
  type ReadOnlyMarketRegime,
} from "@/db/queries/market-context";
import type { MarketRegimeDuplicateGroup } from "@/lib/market-context";

export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const marketContext = await getReadOnlyMarketContext();

  return (
    <main className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">
                Varda Labs
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                Market Context
              </h1>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <Link
                href="/"
                className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#4d574b] hover:bg-[#eef2e8]"
              >
                Dashboard
              </Link>
              <Link
                href="/etfs"
                className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#4d574b] hover:bg-[#eef2e8]"
              >
                ETF Reference
              </Link>
            </nav>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <SummaryCell
              label="Benchmarks"
              value={`${marketContext.benchmarks.length}/${marketContext.requestedBenchmarkTickers.length}`}
              detail={marketContext.requestedBenchmarkTickers.join(", ")}
            />
            <SummaryCell
              label="Regime accounts"
              value={String(marketContext.regimes.length)}
              detail={`${marketContext.regimeDuplicateGroupCount} duplicate date/account groups`}
            />
            <SummaryCell
              label="Global factors"
              value={String(
                marketContext.factorFamilies.reduce(
                  (sum, family) => sum + family.factors.length,
                  0,
                ),
              )}
              detail={`${marketContext.factorFamilies.length} families`}
            />
          </div>
        </header>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader title="Benchmarks" detail="latest row per ticker" />
          <BenchmarkTable benchmarks={marketContext.benchmarks} />
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader
            title="Market Regime"
            detail="latest row per account with duplicate context"
          />
          <MarketRegimeTable regimes={marketContext.regimes} />
          <DuplicateGroups groups={marketContext.regimeDuplicateGroups} />
        </section>

        <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <SectionHeader
            title="Global Factors"
            detail="latest row per factor key, grouped by family"
          />
          <GlobalFactorFamilies families={marketContext.factorFamilies} />
        </section>
      </div>
    </main>
  );
}

function SummaryCell({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e1e6dc] bg-white px-3 py-2">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">{value}</p>
      <p className="mt-1 text-xs text-[#687064]">{detail}</p>
    </div>
  );
}

function SectionHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <p className="text-xs font-semibold text-[#687064]">{detail}</p>
    </div>
  );
}

function BenchmarkTable({
  benchmarks,
}: {
  benchmarks: ReadOnlyMarketBenchmark[];
}) {
  if (benchmarks.length === 0) {
    return <EmptyTableMessage>No benchmark rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[760px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Ticker</TableHeader>
            <TableHeader>Name</TableHeader>
            <TableHeader>Date</TableHeader>
            <TableHeader>Source</TableHeader>
            <TableHeader>Currency</TableHeader>
            <TableHeader align="right">Close</TableHeader>
            <TableHeader align="right">Normalized</TableHeader>
            <TableHeader align="right">FX</TableHeader>
          </tr>
        </thead>
        <tbody>
          {benchmarks.map((benchmark) => (
            <tr key={benchmark.ticker} className="border-t border-[#e1e6dc]">
              <TableCell strong>{benchmark.ticker}</TableCell>
              <TableCell>{benchmark.name}</TableCell>
              <TableCell>{benchmark.date}</TableCell>
              <TableCell>{benchmark.source ?? "n/a"}</TableCell>
              <TableCell>{benchmark.currency}</TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.closePrice, 2)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.normalizedIndexValue, 2)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(benchmark.fxRate, 2)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketRegimeTable({ regimes }: { regimes: ReadOnlyMarketRegime[] }) {
  if (regimes.length === 0) {
    return <EmptyTableMessage>No market regime rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Account</TableHeader>
            <TableHeader>Date</TableHeader>
            <TableHeader>Label</TableHeader>
            <TableHeader>Drivers</TableHeader>
            <TableHeader align="right">Regime</TableHeader>
            <TableHeader align="right">Macro</TableHeader>
            <TableHeader align="right">Sentiment</TableHeader>
            <TableHeader align="right">Correlation</TableHeader>
            <TableHeader align="right">ENB</TableHeader>
            <TableHeader align="right">Volatility</TableHeader>
            <TableHeader>Duplicate</TableHeader>
          </tr>
        </thead>
        <tbody>
          {regimes.map((regime) => (
            <tr key={regime.account} className="border-t border-[#e1e6dc]">
              <TableCell strong>{regime.account}</TableCell>
              <TableCell>{regime.date}</TableCell>
              <TableCell>{regime.label}</TableCell>
              <TableCell>{regime.driverKeys.join(", ") || "n/a"}</TableCell>
              <TableCell align="right">
                {formatDecimal(regime.regimeScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.macroStressScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.newsSentimentScore, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(regime.avgCorrelation, 3)}
              </TableCell>
              <TableCell align="right">{formatDecimal(regime.enb, 3)}</TableCell>
              <TableCell align="right">
                {formatDecimal(regime.portfolioVolatility, 3)}
              </TableCell>
              <TableCell>
                {regime.duplicateRowCount > 1
                  ? `${regime.duplicateRowCount} rows`
                  : "none"}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DuplicateGroups({ groups }: { groups: MarketRegimeDuplicateGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[#687064]">
        No duplicate market regime date/account groups.
      </p>
    );
  }

  return (
    <details className="mt-3 rounded-md border border-[#e1e6dc] bg-white px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-[#4d574b]">
        Duplicate regime groups ({groups.length})
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-[520px] w-full text-left text-xs">
          <thead className="uppercase text-[#687064]">
            <tr>
              <TableHeader>Date</TableHeader>
              <TableHeader>Account</TableHeader>
              <TableHeader align="right">Rows</TableHeader>
              <TableHeader>Selected legacy id</TableHeader>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr
                key={`${group.date}-${group.account}`}
                className="border-t border-[#e1e6dc]"
              >
                <TableCell>{group.date}</TableCell>
                <TableCell>{group.account}</TableCell>
                <TableCell align="right">{group.rowCount}</TableCell>
                <TableCell>{group.selectedLegacyBase44Id ?? "n/a"}</TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function GlobalFactorFamilies({
  families,
}: {
  families: ReadOnlyMarketFactorFamily[];
}) {
  if (families.length === 0) {
    return <EmptyTableMessage>No global market factor rows found.</EmptyTableMessage>;
  }

  return (
    <div className="mt-3 space-y-4">
      {families.map((family) => (
        <div
          key={family.family}
          className="rounded-md border border-[#e1e6dc] bg-white p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold tracking-normal">
              {family.family}
            </h3>
            <p className="text-xs font-semibold text-[#687064]">
              {family.factors.length} factors
            </p>
          </div>
          <GlobalFactorsTable factors={family.factors} />
        </div>
      ))}
    </div>
  );
}

function GlobalFactorsTable({ factors }: { factors: ReadOnlyMarketFactor[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Factor</TableHeader>
            <TableHeader>Name</TableHeader>
            <TableHeader>Date</TableHeader>
            <TableHeader>Freq</TableHeader>
            <TableHeader>Source</TableHeader>
            <TableHeader>Region</TableHeader>
            <TableHeader>Currency</TableHeader>
            <TableHeader align="right">Value</TableHeader>
            <TableHeader align="right">Prev</TableHeader>
            <TableHeader align="right">Change</TableHeader>
            <TableHeader align="right">1Y pctile</TableHeader>
            <TableHeader align="right">Vol 20D</TableHeader>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => (
            <tr key={factor.key} className="border-t border-[#e1e6dc]">
              <TableCell strong>{factor.key}</TableCell>
              <TableCell>{factor.name}</TableCell>
              <TableCell>{factor.date}</TableCell>
              <TableCell>{factor.frequency}</TableCell>
              <TableCell>{factor.source}</TableCell>
              <TableCell>{factor.region}</TableCell>
              <TableCell>{factor.relatedCurrency}</TableCell>
              <TableCell align="right">{formatDecimal(factor.value, 4)}</TableCell>
              <TableCell align="right">
                {formatDecimal(factor.prevValue, 4)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.changePct, 4)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.percentile1y, 3)}
              </TableCell>
              <TableCell align="right">
                {formatDecimal(factor.volatility20dPct, 3)}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyTableMessage({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[#687064]">
      {children}
    </p>
  );
}

function TableHeader({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={cn(
        "border-b border-[#dfe3d5] px-2 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  strong = false,
  align = "left",
}: {
  children: ReactNode;
  strong?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      className={cn(
        "border-b border-[#eef1e8] px-2 py-2 align-top",
        strong ? "font-semibold text-[#171916]" : "text-[#4d574b]",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

function formatDecimal(value: string | null, maximumFractionDigits: number) {
  if (value === null) return "n/a";

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(numericValue);
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}
