import 'server-only';
import { randomUUID } from 'node:crypto';
import { getReadOnlyTenantAccountManagementModel, type AccountManagementModelResult } from '../../db/queries/account-management';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '../../db/queries/portfolio-analysis-scopes';
import { resolveCurrentTenantContext } from '../auth/current-tenant-context';
import { adaptAccountManagement } from './account-management-contract';
import { readBetaAccounts } from './account-service';
import { canonicalBetaReadEpoch } from './read-freshness';

export async function getBetaAccountManagementRead(params: Record<string, string | string[] | undefined>) {
  let source: AccountManagementModelResult | undefined;
  // Reuse the existing session/scope admission and one owner-wide query. No second
  // read, shadow account table, dashboard/provider call, or write on page open.
  const read = await readBetaAccounts(params, {
    session: resolveCurrentTenantContext,
    scopes: getReadOnlyTenantPortfolioAnalysisScopeContext,
    accounts: async args => {
      source = await getReadOnlyTenantAccountManagementModel(args);
      return source;
    },
  });
  return {
    ...adaptAccountManagement(read, source),
    readReceipt: randomUUID(), readEpoch: canonicalBetaReadEpoch(params._betaRead),
    readAt: new Date().toISOString(),
  };
}
