import type { TenantPortfolioSnapshotReadResult } from "@/lib/tenant-portfolio-snapshot-read-model";
import {
  formatPortfolioAccounts,
  formatPortfolioKrw,
  formatPortfolioPercent,
  formatPortfolioRuleVersions,
} from "@/lib/portfolio-snapshot-presentation";

type PortfolioSnapshotEvidence = Extract<
  TenantPortfolioSnapshotReadResult,
  { state: "ready" | "partial" }
>;

export function PortfolioSnapshotSummary({
  result,
}: {
  result: PortfolioSnapshotEvidence;
}) {
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EvidenceCard label="Snapshot date" value={result.snapshotDate} />
        <EvidenceCard label="Source" value={result.source} />
        <EvidenceCard
          label="Account coverage"
          value={`${result.coveredAccounts.length}/${result.expectedAccounts.length}`}
        />
        <EvidenceCard
          label="Rule version"
          value={formatPortfolioRuleVersions(result.ruleVersions)}
        />
      </div>

      {result.aggregate ? (
        <section className="mt-4 rounded-md border border-[var(--line)] bg-[var(--wash)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">
                {result.aggregate.evidenceKind === "complete_total"
                  ? "Complete owned-account total"
                  : "Available-account subtotal"}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Derived only from the named owned-account rows shown below; the
                stored account=all row is not an ownership authority.
              </p>
            </div>
            <span className="text-xs font-semibold text-[var(--muted)]">
              {result.aggregate.accountCount} contributing account
              {result.aggregate.accountCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryMetric
              label="Market value"
              value={formatPortfolioKrw(result.aggregate.totalMarketValue)}
            />
            <SummaryMetric
              label="Invested amount"
              value={formatPortfolioKrw(result.aggregate.investedAmount)}
            />
            <SummaryMetric
              label="Total P/L"
              value={formatPortfolioKrw(result.aggregate.totalPnl)}
            />
            <SummaryMetric
              label="Return"
              value={formatPortfolioPercent(result.aggregate.totalReturnPct)}
            />
          </div>
        </section>
      ) : null}

      {result.state === "partial" ? (
        <p className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
          Partial evidence only. Missing accounts: {formatPortfolioAccounts(result.missingAccounts)}.
          Excluded rows: {result.excludedSnapshotCount}. Incomplete core rows: {result.incompleteCoreSnapshotCount}.
          {result.hasMixedRuleVersions
            ? " Multiple rule versions are present."
            : ""} The subtotal remains visible, but must not be treated as a
          complete portfolio total.
        </p>
      ) : null}
    </>
  );
}

function EvidenceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold">{value}</p>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}
