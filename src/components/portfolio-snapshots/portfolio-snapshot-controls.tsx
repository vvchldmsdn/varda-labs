import Link from "next/link";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import {
  buildPortfolioAnalysisScopeHref,
} from "@/lib/portfolio-analysis-scope";
import type { TenantSnapshotScope } from "@/lib/tenant-snapshot-scope";

export function PortfolioSnapshotControls({
  basePath,
  scope,
  scopes,
  requestedSnapshotDate,
  resolvedSnapshotDate,
}: {
  basePath: string;
  scope: TenantSnapshotScope;
  scopes: readonly TenantSnapshotScope[];
  requestedSnapshotDate?: string;
  resolvedSnapshotDate?: string;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--line)] pt-6">
      <form
        action={basePath}
        className="flex flex-wrap items-end gap-2"
        method="get"
      >
        <input name="scope" type="hidden" value={scope.key} />
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          Snapshot date
          <input
            className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)]"
            defaultValue={requestedSnapshotDate ?? resolvedSnapshotDate ?? ""}
            name="date"
            type="date"
          />
        </label>
        <button
          className="h-10 rounded-md bg-[var(--ink)] px-4 text-sm font-semibold text-white hover:bg-[var(--ink)]"
          type="submit"
        >
          View date
        </button>
        <Link
          className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          href={buildPortfolioAnalysisScopeHref(basePath, scope.key)}
        >
          Latest
        </Link>
      </form>
      <PortfolioAnalysisScopeTabs
        basePath={basePath}
        query={
          requestedSnapshotDate ? { date: requestedSnapshotDate } : undefined
        }
        scopes={scopes}
        selectedScopeKey={scope.key}
      />
    </div>
  );
}
