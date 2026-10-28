import Link from "next/link";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import {
  buildPortfolioAnalysisScopeHref,
} from "@/lib/portfolio-analysis-scope";
import type { TenantSnapshotScope } from "@/lib/tenant-snapshot-scope";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput } from "@/components/cairn-ui";


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
      <CairnForm
        action={basePath}
        className="flex flex-wrap items-end gap-2"
        method="get"
      >
        <input name="scope" type="hidden" value={scope.key} />
        <CairnField className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          Snapshot date
          <CairnInput
            className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)]"
            defaultValue={requestedSnapshotDate ?? resolvedSnapshotDate ?? ""}
            name="date"
            type="date"
          />
        </CairnField>
        <CairnButton variant="primary"
          className="h-10 rounded-md bg-[var(--ink)] px-4 text-sm font-semibold text-white hover:bg-[var(--ink)]"
          type="submit"
        >
          View date
        </CairnButton>
        <Link
          className="flex h-10 items-center rounded-md border border-[var(--line)] bg-white px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          href={buildPortfolioAnalysisScopeHref(basePath, scope.key)}
        >
          Latest
        </Link>
      </CairnForm>
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
