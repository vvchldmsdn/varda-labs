import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
import { buildHistoryOverview } from "@/lib/history-overview";
import { HistoryTimeExplorer } from "./history-time-explorer";

export function HistoryDesignPreview({ scope }: { scope?: string | string[] }) {
  const data = buildHomeDesignPreview(scope);
  const model = buildHistoryOverview({
    rows: data.recentSnapshots.map((point) => ({
      snapshotDate: point.date,
      account: "all",
      source: "design_preview",
      rowKind: "stored" as const,
      derivedFromAccounts: [],
      cashValue: null,
      investedAmount: null,
      totalCost: null,
      totalMarketValue: point.totalMarketValue,
      totalPnl: point.totalPnl,
      totalReturnPct: point.totalReturnPct,
    })),
  });
  return (
    <main className="varda-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <PortfolioPrimaryNavigation
        activePath="/history"
        selectedScopeKey={data.selectedScope.key}
        generatedAt={data.generatedAt}
      />
      <div className="varda-content">
        <p className="mb-4 text-[11px] text-[var(--muted)]">
          디자인 미리보기 · 예시 데이터 · 실제 기록과 무관
        </p>
        <PortfolioAnalysisScopeTabs
          basePath="/history"
          query={{ preview: "design" }}
          scopes={data.analysisScopes}
          selectedScopeKey={data.selectedScope.key}
          variant="underline"
        />
        <HistoryTimeExplorer
          model={model}
          scopeLabel={data.selectedScope.label}
        />
      </div>
    </main>
  );
}
