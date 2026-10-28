import "server-only";
import { readRecoveredReturnCurve } from "@/db/queries/period-return-recovery";
import { loadNativeInvestmentBasis } from "@/db/queries/native-investment-basis";
import { investmentHoldingReturn } from "./investment-return";
import { getBetaHeatmapRead } from "./heatmap-read";
import { randomUUID } from "node:crypto";
import { canonicalBetaReadEpoch } from "./read-freshness";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";
import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { getBetaHistoryRead } from "./history-read";
import { getBetaTargetPolicyModel } from "./target-plan-read";
import { getBetaAdditionalContributionPreview } from "./target-plan-contribution";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { readBetaDomain } from "./read-service";
export async function getBetaDomainRead(
  params: Record<string, string | string[] | undefined>,
  options: { includeHeatmap?: boolean } = {},
) {
  const read = await readBetaDomain(params, {
    session: resolveCurrentTenantContext,
    scopes: getReadOnlyTenantPortfolioAnalysisScopeContext,
    dashboard: async (args) => {
      const basisPromise = loadNativeInvestmentBasis(args.tenantContext).then(
        (value) => ({ value }),
        () => ({ value: null }),
      );
      const dashboard = await getPortfolioDashboard(args);
      try {
        const basis = (await basisPromise).value;
        if (!basis) throw new Error("investment_basis_unavailable");
        return { ...dashboard, investmentReturn: investmentHoldingReturn(dashboard, basis) };
      } catch {
        return {
          ...dashboard,
          investmentReturn: {
            basis: "investment_assets_excluding_cash" as const,
            currency: "KRW" as const,
            costKrw: null,
            pnlKrw: null,
            returnPct: null,
            reason: "investment_read_unavailable",
          },
        };
      }
    },
    structure: getReadOnlyTenantPortfolioStructureForScope,
    targets: getBetaTargetPolicyModel,
    contribution: getBetaAdditionalContributionPreview,
    legacyPolicy: (args) =>
      args.scope.kind === "account"
        ? getReadOnlyTenantApprovedTargetPolicy({
            account: args.scope.accountCode,
            tenantContext: args.tenantContext,
          })
        : Promise.resolve({ status: "missing", policy: null }),
    history: async (args) => {
      const [history, recoveredReturn] = await Promise.all([
        getBetaHistoryRead(args),
        args.scope.kind === "account"
          ? readRecoveredReturnCurve(args.tenantContext, args.scope.accountId)
          : Promise.resolve(null),
      ]);
      return { ...history, recoveredReturn };
    },
    ...(options.includeHeatmap ? { heatmap: getBetaHeatmapRead } : {}),
  });
  return {
    ...read,
    readReceipt: randomUUID(),
    readEpoch: canonicalBetaReadEpoch(params._betaRead),
  };
}
