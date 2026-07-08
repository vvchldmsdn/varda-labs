import Link from "next/link";
import type { ReactNode } from "react";

import {
  getAdminMarketSyncStatus,
  type AdminMarketSyncRun,
  type KisCooldownStatus,
} from "@/db/queries/admin-market-sync-status";
import type {
  AdminSyncTarget,
  CloseCoverageTarget,
} from "@/lib/admin-market-sync-status";

export const dynamic = "force-dynamic";

export default async function AdminMarketSyncPage() {
  const status = await getAdminMarketSyncStatus();

  return (
    <main className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4 px-4 py-4">
        <header className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[#687064]">
                Varda Labs Admin
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                Market Sync Status
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-[#4d574b]">
                Status-only console. This page reads stored database state and
                does not call providers, dry-run routes, or write routes.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/market">Market Context</NavLink>
              <NavLink href="/history">History</NavLink>
            </nav>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <SummaryCell
              label="Service date"
              value={status.cycle.snapshotDate}
              detail={`window ${formatDateTime(status.cycle.liveWindowStartAt)}`}
            />
            <SummaryCell
              label="Live price"
              value={`${status.livePrice.freshCount}/${status.livePrice.targetCount}`}
              detail={`${status.livePrice.staleOrMissingCount} stale or missing`}
            />
            <SummaryCell
              label="Close coverage"
              value={`${status.closeCoverage.coveredCount}/${status.closeCoverage.targetCount}`}
              detail={`${status.closeCoverage.staleOrMissingCount} gaps`}
            />
            <SummaryCell
              label="USD/KRW"
              value={formatDecimal(status.fx.usdKrw, 2)}
              detail={status.fx.latestRateDate ?? "missing"}
            />
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel
            title="Live Price Metadata"
            detail="assets.current_price freshness, DB only"
          >
            <MetricGrid>
              <Metric label="Targets" value={status.livePrice.targetCount} />
              <Metric label="Fresh" value={status.livePrice.freshCount} />
              <Metric
                label="Coverage"
                value={formatPercent(
                  status.livePrice.freshCount,
                  status.livePrice.targetCount,
                )}
              />
              <Metric
                label="Latest price time"
                value={formatDateTime(status.livePrice.latestPriceTimestamp)}
              />
            </MetricGrid>
            <TargetList
              title="Stale or missing live targets"
              targets={status.livePrice.staleOrMissingTargets}
            />
          </Panel>

          <Panel
            title="Close Coverage"
            detail="asset_price_snapshots latest stored rows"
          >
            <MetricGrid>
              <Metric label="Targets" value={status.closeCoverage.targetCount} />
              <Metric label="Covered" value={status.closeCoverage.coveredCount} />
              <Metric
                label="Coverage"
                value={formatPercent(
                  status.closeCoverage.coveredCount,
                  status.closeCoverage.targetCount,
                )}
              />
              <Metric
                label="Latest close"
                value={status.closeCoverage.latestCloseDate ?? "missing"}
              />
            </MetricGrid>
            <CloseGapList gaps={status.closeCoverage.gaps} />
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel title="FX Status" detail="fx_rates latest stored row">
            <MetricGrid>
              <Metric label="Rate date" value={status.fx.latestRateDate ?? "-"} />
              <Metric label="USD/KRW" value={formatDecimal(status.fx.usdKrw, 6)} />
              <Metric label="Source" value={status.fx.source ?? "-"} />
              <Metric label="Freshness" value={status.fx.freshness} />
            </MetricGrid>
            <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-[#4d574b]">
              FX dry-run is not called by this page. Use the stored row above to
              judge whether a separate reviewed FX refresh is needed.
            </p>
          </Panel>

          <Panel title="Snapshot Evidence" detail="daily snapshot row presence">
            <MetricGrid>
              <Metric
                label="Position rows"
                value={status.snapshots.currentPositionRows}
              />
              <Metric
                label="Portfolio rows"
                value={status.snapshots.currentPortfolioRows}
              />
              <Metric
                label="Latest positions"
                value={status.snapshots.latestPositionSnapshotDate ?? "-"}
              />
              <Metric
                label="Latest portfolio"
                value={status.snapshots.latestPortfolioSnapshotDate ?? "-"}
              />
            </MetricGrid>
            <AccountCounts
              title="Current position rows by account"
              counts={status.snapshots.currentPositionRowsByAccount}
            />
            <AccountCounts
              title="Current portfolio rows by account"
              counts={status.snapshots.currentPortfolioRowsByAccount}
            />
          </Panel>
        </section>

        <section className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <Panel title="KIS Cooldown" detail="market_data_sync_runs SELECT">
            <CooldownBlock cooldown={status.cooldowns.live} />
            <CooldownBlock cooldown={status.cooldowns.close} />
          </Panel>

          <Panel title="Recent Sync Runs" detail="latest stored run metadata">
            <RecentRunsTable runs={status.recentRuns} />
          </Panel>
        </section>

        <Panel title="Manual Boundary" detail="copy parameters only">
          <div className="grid gap-3 lg:grid-cols-3">
            <RunbookCard
              title="Live price check"
              lines={["mode=live", "provider=kis", "dryRun=true", "limit <= 5"]}
            />
            <RunbookCard
              title="FX check"
              lines={["provider=er-api-open", "dryRun=true", "review plannedWrite"]}
            />
            <RunbookCard
              title="Snapshot check"
              lines={["dryRun=true", "review closeSyncPlan", "no partial writes"]}
            />
          </div>
        </Panel>
      </div>
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[#d7ddcf] bg-white px-3 py-2 text-[#4d574b] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
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

function Panel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
        <p className="text-xs font-semibold text-[#687064]">{detail}</p>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2">{children}</div>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-[#e1e6dc] bg-white px-3 py-2">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#171916]">{value}</p>
    </div>
  );
}

function TargetList({
  title,
  targets,
}: {
  title: string;
  targets: AdminSyncTarget[];
}) {
  const visibleTargets = targets.slice(0, 10);

  return (
    <div className="mt-3 rounded-md border border-[#e1e6dc] bg-white p-3">
      <p className="text-sm font-semibold">{title}</p>
      {visibleTargets.length === 0 ? (
        <p className="mt-2 text-sm text-[#687064]">No gaps.</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {visibleTargets.map((target) => (
            <li key={`${target.account}-${target.ticker}`}>
              <span className="font-semibold">{target.ticker}</span>
              <span className="text-[#687064]">
                {" "}
                {target.name} - {target.account} - {target.market}
              </span>
            </li>
          ))}
        </ul>
      )}
      {targets.length > visibleTargets.length ? (
        <p className="mt-2 text-xs text-[#687064]">
          +{targets.length - visibleTargets.length} more
        </p>
      ) : null}
    </div>
  );
}

function CloseGapList({ gaps }: { gaps: CloseCoverageTarget[] }) {
  const visibleGaps = gaps.slice(0, 10);

  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-[#e1e6dc] bg-white">
      {visibleGaps.length === 0 ? (
        <p className="px-3 py-2 text-sm text-[#687064]">No close gaps.</p>
      ) : (
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead className="text-xs uppercase text-[#687064]">
            <tr>
              <TableHeader>Ticker</TableHeader>
              <TableHeader>Account</TableHeader>
              <TableHeader>Expected</TableHeader>
              <TableHeader>Selected</TableHeader>
              <TableHeader>Source</TableHeader>
              <TableHeader>Status</TableHeader>
            </tr>
          </thead>
          <tbody>
            {visibleGaps.map((gap) => (
              <tr
                key={`${gap.account}-${gap.ticker}`}
                className="border-t border-[#e1e6dc]"
              >
                <TableCell strong>{gap.ticker}</TableCell>
                <TableCell>{gap.account}</TableCell>
                <TableCell>{gap.expectedCloseDate}</TableCell>
                <TableCell>{gap.selectedCloseDate ?? "-"}</TableCell>
                <TableCell>{gap.source ?? "-"}</TableCell>
                <TableCell>{gap.status}</TableCell>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {gaps.length > visibleGaps.length ? (
        <p className="px-3 py-2 text-xs text-[#687064]">
          +{gaps.length - visibleGaps.length} more
        </p>
      ) : null}
    </div>
  );
}

function AccountCounts({
  title,
  counts,
}: {
  title: string;
  counts: Record<string, number>;
}) {
  const entries = Object.entries(counts);

  return (
    <div className="mt-3 rounded-md border border-[#e1e6dc] bg-white p-3">
      <p className="text-sm font-semibold">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-[#687064]">No rows for current cycle.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {entries.map(([account, count]) => (
            <span
              key={account}
              className="rounded-md bg-[#eef2e8] px-2 py-1 font-semibold text-[#33423c]"
            >
              {account}: {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CooldownBlock({ cooldown }: { cooldown: KisCooldownStatus }) {
  return (
    <div className="mb-3 rounded-md border border-[#e1e6dc] bg-white p-3 last:mb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold uppercase">{cooldown.mode}</p>
        <StatusBadge active={cooldown.active}>
          {cooldown.active ? "cooldown" : "ready"}
        </StatusBadge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#687064]">
        <dt>retry</dt>
        <dd className="text-right font-semibold text-[#171916]">
          {cooldown.retryAfterSeconds}s
        </dd>
        <dt>last status</dt>
        <dd className="text-right font-semibold text-[#171916]">
          {cooldown.lastRunStatus ?? "-"}
        </dd>
        <dt>last start</dt>
        <dd className="text-right font-semibold text-[#171916]">
          {formatDateTime(cooldown.lastRunStartedAt)}
        </dd>
      </dl>
    </div>
  );
}

function StatusBadge({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={[
        "rounded-md px-2 py-1 text-xs font-semibold",
        active
          ? "bg-[#fff2ce] text-[#7a5200]"
          : "bg-[#e8f3e8] text-[#176335]",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function RecentRunsTable({ runs }: { runs: AdminMarketSyncRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-[#687064]">No sync runs found.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[#e1e6dc] bg-white">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
        <thead className="text-xs uppercase text-[#687064]">
          <tr>
            <TableHeader>Started</TableHeader>
            <TableHeader>Job</TableHeader>
            <TableHeader>Mode</TableHeader>
            <TableHeader>Source</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader align="right">Requested</TableHeader>
            <TableHeader align="right">Success</TableHeader>
            <TableHeader align="right">Failed</TableHeader>
            <TableHeader align="right">Skipped</TableHeader>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t border-[#e1e6dc]">
              <TableCell strong>{formatDateTime(run.startedAt)}</TableCell>
              <TableCell>{run.jobType}</TableCell>
              <TableCell>{run.mode ?? "-"}</TableCell>
              <TableCell>{run.source ?? "-"}</TableCell>
              <TableCell>{run.status}</TableCell>
              <TableCell align="right">{formatCount(run.requestedCount)}</TableCell>
              <TableCell align="right">{formatCount(run.successCount)}</TableCell>
              <TableCell align="right">{formatCount(run.failedCount)}</TableCell>
              <TableCell align="right">{formatCount(run.skippedCount)}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunbookCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-md border border-[#e1e6dc] bg-white p-3">
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-2 space-y-1 text-sm text-[#4d574b]">
        {lines.map((line) => (
          <li key={line}>
            <code className="rounded bg-[#eef2e8] px-1 py-0.5">{line}</code>
          </li>
        ))}
      </ul>
    </div>
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
      className={[
        "border-b border-[#dfe3d5] px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </th>
  );
}

function TableCell({
  children,
  align = "left",
  strong = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  strong?: boolean;
}) {
  return (
    <td
      className={[
        "border-b border-[#edf0e8] px-3 py-2 align-top",
        align === "right" ? "text-right" : "text-left",
        strong ? "font-semibold" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return "-";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatDecimal(value: string | null, fractionDigits: number) {
  const numberValue = value === null ? null : Number(value);
  if (numberValue === null || !Number.isFinite(numberValue)) return "-";
  return numberValue.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatCount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("en-US");
}
