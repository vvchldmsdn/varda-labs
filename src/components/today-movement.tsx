import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DashboardAccount,
  DashboardData,
  DashboardHolding,
} from "@/lib/portfolio-dashboard";

const accountTabs: { code: DashboardAccount; label: string }[] = [
  { code: "brokerage", label: "Brokerage" },
  { code: "isa", label: "ISA" },
  { code: "irp", label: "IRP" },
  { code: "all", label: "All" },
];

export function TodayMovement({ data }: { data: DashboardData }) {
  const movement = data.todayMovement;
  const holdingById = new Map(data.holdings.map((holding) => [holding.id, holding]));

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
                Today Movement
              </h1>
              <p className="mt-2 text-sm text-[#687064]">
                Baseline {formatDate(data.latestSnapshotDate)} · USD/KRW{" "}
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
          <MetricCard label="Status" value={movement.ready ? "ready" : "not ready"} />
          <MetricCard label="Source" value={sourceLabel(movement.source)} />
          <MetricCard
            label="Today change"
            value={formatSignedKrw(movement.changeKrw)}
            tone={toneFor(movement.changeKrw)}
          />
          <MetricCard
            label="FX impact"
            value={formatSignedKrw(movement.fxChangeKrw)}
            tone={toneFor(movement.fxChangeKrw)}
          />
          <MetricCard
            label="Trade flow"
            value={formatSignedKrw(movement.tradeFlowKrw)}
            tone={toneFor(movement.tradeFlowKrw)}
          />
        </section>

        <section className="grid gap-3 lg:grid-cols-4">
          <MetricCard label="Previous value" value={formatKrw(movement.previousTotalKrw)} />
          <MetricCard label="Return" value={formatPct(movement.returnPct)} />
          <MetricCard
            label="Current coverage"
            value={formatPct(movement.coverage.currentCoveragePct)}
          />
          <MetricCard
            label="Snapshot coverage"
            value={formatPct(movement.coverage.snapshotCoveragePct)}
          />
        </section>

        {!movement.ready ? (
          <section className="rounded-lg border border-[#e2d5a8] bg-[#fffaf0] p-4 text-sm text-[#5d4b1b]">
            <p className="font-semibold">Reason: {reasonLabel(movement.reason)}</p>
          </section>
        ) : null}

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
                          <HoldingLabel holding={holding} />
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
}: {
  holding: DashboardHolding | null;
}) {
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
  if (source === "daily_position_snapshot") return "daily snapshot";
  if (source === "asset_price_snapshot") return "previous close";
  return "-";
}

function reasonLabel(reason: string | null) {
  if (!reason) return "-";
  return reason.replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return value.slice(0, 10).replaceAll("-", ".");
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

function toneFor(value: number | null) {
  if (value === null || !Number.isFinite(value) || value === 0) return "text-[#2e352f]";
  return value > 0 ? "text-[#087443]" : "text-[#b42318]";
}

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
