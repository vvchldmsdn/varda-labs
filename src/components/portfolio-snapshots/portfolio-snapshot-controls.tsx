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
    <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-[#dfe3d5] pt-6">
      <form
        action={basePath}
        className="flex flex-wrap items-end gap-2"
        method="get"
      >
        <input name="scope" type="hidden" value={scope.key} />
        <label className="grid gap-1 text-xs font-semibold text-[#5e685e]">
          Snapshot date
          <input
            className="h-10 rounded-md border border-[#cfd6c8] bg-white px-3 text-sm text-[#171916]"
            defaultValue={requestedSnapshotDate ?? resolvedSnapshotDate ?? ""}
            name="date"
            type="date"
          />
        </label>
        <button
          className="h-10 rounded-md bg-[#173f38] px-4 text-sm font-semibold text-white hover:bg-[#235249]"
          type="submit"
        >
          View date
        </button>
        <Link
          className="flex h-10 items-center rounded-md border border-[#cfd6c8] bg-white px-4 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
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
