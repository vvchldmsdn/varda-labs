import 'server-only';
import { randomUUID } from 'node:crypto';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '../../db/queries/portfolio-analysis-scopes';
import { getReadOnlyTenantAccountManagementModel } from '../../db/queries/account-management';
import { resolveCurrentTenantContext } from '../auth/current-tenant-context';
import { accountsKey } from './account-contract';
import { readBetaAccounts } from './account-service';
import { canonicalBetaReadEpoch } from './read-freshness';

export async function getBetaAccountRead(params: Record<string, string | string[] | undefined>) {
  const read = await readBetaAccounts(params, {
    session: resolveCurrentTenantContext,
    scopes: getReadOnlyTenantPortfolioAnalysisScopeContext,
    accounts: getReadOnlyTenantAccountManagementModel,
  });
  return {
    ...read,
    queryKey: accountsKey(read.context),
    readReceipt: randomUUID(),
    readEpoch: canonicalBetaReadEpoch(params._betaRead),
    readAt: new Date().toISOString(),
  };
}
