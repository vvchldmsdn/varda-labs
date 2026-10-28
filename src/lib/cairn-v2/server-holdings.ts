import 'server-only';
import { randomUUID } from 'node:crypto';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '../../db/queries/portfolio-analysis-scopes';
import { getReadOnlyTenantHoldings } from '../../db/queries/tenant-holdings';
import { resolveCurrentTenantContext } from '../auth/current-tenant-context';
import { holdingsKey } from './holding-contract';
import { readBetaHoldings } from './holding-service';
import { canonicalBetaReadEpoch } from './read-freshness';

export async function getBetaHoldingRead(params: Record<string, string | string[] | undefined>) {
  const read = await readBetaHoldings(params, {
    session: resolveCurrentTenantContext,
    scopes: getReadOnlyTenantPortfolioAnalysisScopeContext,
    holdings: getReadOnlyTenantHoldings,
  });
  return {
    ...read,
    queryKey: holdingsKey(read.context),
    readReceipt: randomUUID(),
    readEpoch: canonicalBetaReadEpoch(params._betaRead),
    readAt: new Date().toISOString(),
  };
}
