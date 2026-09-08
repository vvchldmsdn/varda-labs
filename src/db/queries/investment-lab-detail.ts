import "server-only";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { InvestmentLabPanel } from "@/lib/investment-lab-panel";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { getReadOnlyTenantPortfolioStructureForScope } from "./portfolio-structure";
import { getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio } from "./investment-lab-etf-xray";
import { getReadOnlyTenantInvestmentLabStressReplay } from "./investment-lab-stress-replay";
import { buildInvestmentLabSmallAdjustmentModel } from "@/lib/investment-lab-small-adjustment";
import { applyInvestmentLabCurrentHoldingScope } from "@/lib/investment-lab-current-holding-scope";

export async function loadInvestmentLabDetail({ panel, tenantContext, selectedScope, scopeCatalog }: {
  panel: InvestmentLabPanel; tenantContext: TenantContext; selectedScope: PortfolioAnalysisScope; scopeCatalog: readonly PortfolioAnalysisScope[];
}): Promise<InvestmentLabDetailData> {
  const portfolioPromise = getReadOnlyTenantPortfolioStructureForScope({ scope: selectedScope, serviceDate: resolveSnapshotCycle(new Date()).snapshotDate, tenantContext });
  const unavailableSections: string[] = [];
  async function optional<T>(label: string, promise: Promise<T>) { try { return await promise; } catch { unavailableSections.push(label); return null; } }
  if (panel === "composition") {
    const [xray, stress] = await Promise.all([
      optional("ETF 구성", getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio(portfolioPromise)),
      optional("과거 충격", getReadOnlyTenantInvestmentLabStressReplay({ account: selectedScope.key, portfolioStructurePromise: portfolioPromise })),
    ]);
    return { panel, xray, stress, adjustment: null, unavailableSections };
  }
  const portfolio = await portfolioPromise;
  const adjustment = buildInvestmentLabSmallAdjustmentModel(applyInvestmentLabCurrentHoldingScope(portfolio).portfolio, portfolio.holdingRows.map((row) => row.account), new Map(scopeCatalog.flatMap((scope) => scope.kind === "account" ? [[scope.accountCode, scope.label] as const] : [])));
  return { panel, xray: null, stress: null, adjustment, unavailableSections };
}
export type InvestmentLabDetailData = {
  panel: InvestmentLabPanel;
  xray: Awaited<ReturnType<typeof getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio>> | null;
  stress: Awaited<ReturnType<typeof getReadOnlyTenantInvestmentLabStressReplay>> | null;
  adjustment: ReturnType<typeof buildInvestmentLabSmallAdjustmentModel> | null;
  unavailableSections: string[];
};
