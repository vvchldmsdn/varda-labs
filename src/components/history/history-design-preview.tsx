import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
import { buildHistoryOverview } from "@/lib/history-overview";
import { HistoryTimeExplorer } from "./history-time-explorer";
import styles from "./history-modern.module.css";

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
    <main className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]">
      <PortfolioPrimaryNavigation
        activePath="/history"
        selectedScopeKey={data.selectedScope.key}
        generatedAt={data.generatedAt}
      />
      <div className={`varda-content varda-presentation-content varda-stage-content ${styles.page}`}>
        <header className={styles.header}>
          <div>
            <h1 className="varda-page-title">히스토리</h1>

          </div>
          <PortfolioAnalysisScopeTabs
          basePath="/history"
          query={{ preview: "design" }}
          scopes={data.analysisScopes}
          selectedScopeKey={data.selectedScope.key}
          variant="underline"
          />
        </header>
        <div className={styles.explorerSlot}>
          <HistoryTimeExplorer
            model={model}
            scopeLabel={data.selectedScope.label}
          />
        </div>
      </div>
    </main>
  );
}
