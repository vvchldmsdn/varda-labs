import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import {
  HISTORY_LANES,
  type HistoryLane,
} from "@/lib/history-balance";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";

import { historyLaneLabel } from "./history-format";

export function HistoryControls({
  lane,
  scopes,
  selectedScope,
}: {
  lane: HistoryLane;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  return (
    <div className="mt-4 space-y-3">
      <PortfolioAnalysisScopeTabs
        basePath="/history"
        query={{ lane }}
        scopes={scopes}
        selectedScopeKey={selectedScope.key}
      />
      <form
        action="/history"
        method="get"
        className="grid gap-3 sm:grid-cols-[220px_auto]"
      >
        <input type="hidden" name="scope" value={selectedScope.key} />
        <label className="grid gap-1 text-xs font-semibold text-[var(--muted)]">
          기록 구분
          <select
            name="lane"
            defaultValue={lane}
            className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            {HISTORY_LANES.map((option) => (
              <option key={option} value={option}>
                {historyLaneLabel(option)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--ink)]"
          >
            적용
          </button>
        </div>
      </form>
    </div>
  );
}
