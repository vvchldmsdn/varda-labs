import "server-only";
import { readOriginalCurrentValue } from "./server-current-value";
import { readRecoveredReturnCurve } from "@/db/queries/period-return-recovery";
import { getBetaHeatmapRead } from "./heatmap-read";
import { randomUUID } from "node:crypto";
import { canonicalBetaReadEpoch } from "./read-freshness";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";
import { getBetaHistoryRead } from "./history-read";
import { createBetaInitialTargetReadPorts } from "./target-plan-read";
import { getBetaAdditionalContributionPreview } from "./target-plan-contribution";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { readBetaDomain } from "./read-service";
import { displayBindingForScopes } from "./display-session";
export async function getBetaDomainRead(
  params: Record<string, string | string[] | undefined>,
  options: { includeHeatmap?: boolean; includeCurrentValue?: boolean; historyWindow?: "recent" } = {},
) {
  let displayBinding: string | undefined;
  const initialTargetReads = createBetaInitialTargetReadPorts();
  const read = await readBetaDomain(params, {
    session: resolveCurrentTenantContext,
    scopes: async args => {
      const scopes = await getReadOnlyTenantPortfolioAnalysisScopeContext(args);
      if (scopes.state === "ready") displayBinding = displayBindingForScopes(args.tenantContext, scopes.catalog);
      return scopes;
    },
    dashboard: args => getPortfolioDashboard({ ...args, includeInvestmentReturn: true }),
    structure: initialTargetReads.structure,
    targets: initialTargetReads.targets,
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
        getBetaHistoryRead({ ...args, historyWindow: options.historyWindow }),
        args.scope.kind === "account"
          ? readRecoveredReturnCurve(args.tenantContext, args.scope.accountId, true)
          : Promise.resolve(null),
      ]);
      return { ...history, recoveredReturn };
    },
    ...(options.includeHeatmap ? { heatmap: getBetaHeatmapRead } : {}),
    ...(options.includeCurrentValue ? { currentValue: readOriginalCurrentValue } : {}),
  });
  return {
    ...read,
    historyWindow: options.historyWindow,
    displayBinding,
    readReceipt: randomUUID(),
    readEpoch: canonicalBetaReadEpoch(params._betaRead),
  };
}
