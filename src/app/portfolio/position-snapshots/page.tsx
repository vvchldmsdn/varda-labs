import Link from "next/link";

import { PortfolioSnapshotControls } from "@/components/portfolio-snapshots/portfolio-snapshot-controls";
import {
  getReadOnlyTenantPositionSnapshots,
  type TenantPositionSnapshotQueryResult,
} from "@/db/queries/tenant-position-snapshots";
import { getReadOnlyTenantSnapshotScopeContext } from "@/db/queries/tenant-snapshot-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";
import { parseTenantPositionSnapshotDateQuery } from "@/lib/tenant-position-snapshot-read-model";
import { isTenantSnapshotScope } from "@/lib/tenant-snapshot-scope";

export const dynamic = "force-dynamic";

type TenantPositionSnapshotsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    date?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function TenantPositionSnapshotsPage({
  searchParams,
}: TenantPositionSnapshotsPageProps) {
  const [params, sessionResolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const requestedSnapshotDate = parseTenantPositionSnapshotDateQuery(
    params.date,
  );
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
      ? await getReadOnlyTenantPositionSnapshots({
          tenantContext: sessionResolution.tenantContext,
          scope: selectedScope,
          requestedSnapshotDate,
        })
      : null;

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-6xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              Owner-scoped position snapshots
            </h1>
            <p className="mt-2 text-sm text-[#687064]">
              Stored daily evidence authorized only through owned accounts
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PageLink href="/portfolio/accounts?account=all">
              Accounts
            </PageLink>
            <PageLink href="/portfolio/holdings?account=all">
              Holdings
            </PageLink>
            <PageLink href="/portfolio/portfolio-snapshots?account=all">
              Portfolio snapshots
            </PageLink>
            <PageLink href="/auth/session">Session evidence</PageLink>
          </div>
        </div>

        {selectedScope ? (
          <PortfolioSnapshotControls
            basePath="/portfolio/position-snapshots"
            requestedSnapshotDate={requestedSnapshotDate ?? undefined}
            resolvedSnapshotDate={
              isEvidenceResult(result) ? result.snapshotDate : undefined
            }
            scope={selectedScope}
            scopes={scopes}
          />
        ) : null}

        <p className="mt-5 text-sm font-semibold">
          {positionSnapshotReadEvidence({
            result,
            resolution: sessionResolution,
            invalidDate: requestedSnapshotDate === null,
            scopeReady: selectedScope !== null,
          })}
        </p>

        {isEvidenceResult(result) ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <EvidenceCard label="Snapshot date" value={result.snapshotDate} />
              <EvidenceCard label="Source" value={result.source} />
              <EvidenceCard
                label="Account coverage"
                value={`${result.coveredAccounts.length}/${result.expectedAccounts.length}`}
              />
              <EvidenceCard
                label="Asset links"
                value={`${result.linkedPositionCount} linked / ${result.historicalOnlyPositionCount} historical`}
              />
            </div>

            {result.state === "partial" ? (
              <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
                Partial evidence only. Missing accounts: {formatAccounts(result.missingAccounts)}.
                Excluded rows: {result.excludedPositionCount}. Do not use this
                view for portfolio totals or decision support.
              </p>
            ) : null}

            <div className="mt-4 overflow-x-auto rounded-md border border-[#dfe3d5] bg-white">
              <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead className="bg-[#eef2e8] text-xs text-[#5e685e]">
                  <tr>
                    <TableHeading>Position</TableHeading>
                    <TableHeading>Account</TableHeading>
                    <TableHeading>Market</TableHeading>
                    <TableHeading align="right">Quantity</TableHeading>
                    <TableHeading align="right">Stored price</TableHeading>
                    <TableHeading align="right">Value (KRW)</TableHeading>
                    <TableHeading align="right">Weight</TableHeading>
                    <TableHeading align="right">Target</TableHeading>
                    <TableHeading>Evidence</TableHeading>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e5e8df]">
                  {result.positions.map((position, index) => (
                    <tr
                      key={`${position.accountCode}:${position.assetLinkStatus}:${position.ticker ?? position.assetName}:${index}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold">{position.assetName}</p>
                        <p className="text-xs text-[#687064]">
                          {position.ticker ?? "No ticker"}
                          {position.assetType ? ` / ${position.assetType}` : ""}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{position.accountName}</p>
                        <p className="text-xs text-[#687064]">
                          {position.accountCode}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {position.market ?? "-"} / {position.currency ?? "-"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatDecimal(position.quantity)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <p>{formatDecimal(position.storedPrice)}</p>
                        <p className="text-xs text-[#687064]">
                          {position.storedPriceKind ?? "no price"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatKrw(position.marketValueKrw)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatPercent(position.currentWeight)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatPercent(position.targetWeight)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#687064]">
                        <p>{position.assetLinkStatus}</p>
                        <p>{position.priceSource ?? "No price source"}</p>
                        <p>{position.priceBasis ?? "No price basis"}</p>
                        <p>{position.belowMa ? "Below MA" : "Not below MA"}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
            Position evidence remains closed until the request, session,
            ownership relationship, and row integrity checks all pass.
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
      className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
    >
      {children}
    </Link>
  );
}

function EvidenceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold">{value}</p>
    </div>
  );
}

function TableHeading({
  align = "left",
  children,
}: {
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={`px-4 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function positionSnapshotReadEvidence({
  result,
  resolution,
  invalidDate,
  scopeReady,
}: {
  result: TenantPositionSnapshotQueryResult | null;
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
  if (result.state === "unavailable") return "Position snapshot read unavailable.";
  if (result.state === "integrity_error") return "Position snapshot read blocked.";
  if (result.state === "no_data") {
    return result.snapshotDate === null
      ? "No owned position snapshot evidence is available."
      : `No owned position snapshot evidence exists for ${result.snapshotDate}.`;
  }
  return `${result.positions.length} owned position snapshot${result.positions.length === 1 ? "" : "s"}`;
}

function isEvidenceResult(
  result: TenantPositionSnapshotQueryResult | null,
): result is Extract<TenantPositionSnapshotQueryResult, { state: "ready" | "partial" }> {
  return result?.state === "ready" || result?.state === "partial";
}

function formatAccounts(accounts: readonly string[]) {
  return accounts.length === 0 ? "none" : accounts.join(", ");
}

function formatDecimal(value: string | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(
    Number(value),
  );
}

function formatKrw(value: string | null) {
  if (value === null) return "-";
  return `₩${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(value))}`;
}

function formatPercent(value: string | null) {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value))}%`;
}
