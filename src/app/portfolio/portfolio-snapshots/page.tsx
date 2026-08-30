import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { PortfolioSnapshotControls } from "@/components/portfolio-snapshots/portfolio-snapshot-controls";
import { PortfolioSnapshotSummary } from "@/components/portfolio-snapshots/portfolio-snapshot-summary";
import { PortfolioSnapshotTable } from "@/components/portfolio-snapshots/portfolio-snapshot-table";
import {
  getReadOnlyTenantPortfolioSnapshots,
  type TenantPortfolioSnapshotQueryResult,
} from "@/db/queries/tenant-portfolio-snapshots";
import { getReadOnlyTenantSnapshotScopeContext } from "@/db/queries/tenant-snapshot-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";
import { parseTenantSnapshotDateQuery } from "@/lib/tenant-snapshot-date-query";
import { isTenantSnapshotScope } from "@/lib/tenant-snapshot-scope";

export const dynamic = "force-dynamic";

type TenantPortfolioSnapshotsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    date?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function TenantPortfolioSnapshotsPage({
  searchParams,
}: TenantPortfolioSnapshotsPageProps) {
  const [params, sessionResolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const requestedSnapshotDate = parseTenantSnapshotDateQuery(params.date);
  const scopeContext = sessionResolution.ok
    ? await getReadOnlyTenantSnapshotScopeContext({
        account: params.account,
        scope: params.scope,
        tenantContext: sessionResolution.tenantContext,
      })
    : null;
  const selectedScope =
    scopeContext?.state === "ready" &&
    scopeContext.resolution.state === "resolved" &&
    isTenantSnapshotScope(scopeContext.resolution.scope)
      ? scopeContext.resolution.scope
      : null;
  const scopes =
    scopeContext?.state === "ready"
      ? scopeContext.catalog.scopes.filter(isTenantSnapshotScope)
      : [];
  const result =
    requestedSnapshotDate !== null && sessionResolution.ok && selectedScope
      ? await getReadOnlyTenantPortfolioSnapshots({
          tenantContext: sessionResolution.tenantContext,
          scope: selectedScope,
          requestedSnapshotDate,
        })
      : null;
  const evidence = isEvidenceResult(result) ? result : null;

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-6xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              Owner-scoped portfolio snapshots
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Account-level daily totals authorized through owned accounts
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Related evidence">
            <PageLink href="/portfolio/accounts?account=all">Accounts</PageLink>
            <PageLink href="/portfolio/holdings?account=all">Holdings</PageLink>
            <PageLink href="/portfolio/position-snapshots?account=all">
              Positions
            </PageLink>
            <PageLink href="/auth/session">Session evidence</PageLink>
          </nav>
        </div>

        {selectedScope ? (
          <PortfolioSnapshotControls
            basePath="/portfolio/portfolio-snapshots"
            requestedSnapshotDate={requestedSnapshotDate ?? undefined}
            resolvedSnapshotDate={evidence?.snapshotDate}
            scope={selectedScope}
            scopes={scopes}
          />
        ) : null}

        <p className="mt-5 text-sm font-semibold">
          {portfolioSnapshotReadEvidence({
            result,
            resolution: sessionResolution,
            invalidDate: requestedSnapshotDate === null,
            scopeReady: selectedScope !== null,
          })}
        </p>

        {evidence ? (
          <>
            <PortfolioSnapshotSummary result={evidence} />
            <PortfolioSnapshotTable snapshots={evidence.snapshots} />
          </>
        ) : (
          <p className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
            Portfolio snapshot evidence remains closed until the request,
            session, ownership relationship, and row integrity checks all pass.
          </p>
        )}
      </section>
    </main>
  );
}

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
    >
      {children}
    </Link>
  );
}

function portfolioSnapshotReadEvidence({
  result,
  resolution,
  invalidDate,
  scopeReady,
}: {
  result: TenantPortfolioSnapshotQueryResult | null;
  resolution: SessionResolverResult;
  invalidDate: boolean;
  scopeReady: boolean;
}) {
  if (invalidDate) return "Invalid date; product data was not read.";
  if (resolution.ok && !scopeReady) {
    return "Snapshot account scope is unavailable; product data was not read.";
  }
  if (result === null) {
    return `${sessionResolutionEvidence(resolution)}; product data was not read.`;
  }
  if (result.state === "invalid_request") {
    return "Invalid snapshot request; product data was not read.";
  }
  if (result.state === "unavailable") return "Portfolio snapshot read unavailable.";
  if (result.state === "integrity_error") return "Portfolio snapshot read blocked.";
  if (result.state === "no_data") {
    return result.snapshotDate === null
      ? "No owned portfolio snapshot evidence is available."
      : `No owned portfolio snapshot evidence exists for ${result.snapshotDate}.`;
  }
  return `${result.snapshots.length} owned account snapshot${result.snapshots.length === 1 ? "" : "s"}`;
}

function isEvidenceResult(
  result: TenantPortfolioSnapshotQueryResult | null,
): result is Extract<TenantPortfolioSnapshotQueryResult, { state: "ready" | "partial" }> {
  return result?.state === "ready" || result?.state === "partial";
}
