import 'server-only';
import {savedPlanSession} from '../shared-backend/saved-plan-session';
import {readNativeContributionContext} from '../../db/queries/native-contribution-context';
import {prepareContributionComparison} from '../contribution-comparison';
import {dataIssueLabel} from '../data-issue-presentation';
import {nativeUserAllocationBasis} from '../user-allocation-comparison';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {canonicalBetaReadEpoch} from './read-freshness';
import {readRemainingWorkspace,type RemainingKind} from './remaining-workspace-contract';
export async function getRemainingWorkspace(kind:RemainingKind,params:Record<string,string|string[]|undefined>){const result=await readRemainingWorkspace(kind,params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext});return {...result,readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead)};}

export async function getPlanWorkspace(params: Record<string,string|string[]|undefined>) {
  let session: ReturnType<typeof resolveCurrentTenantContext> | undefined;
  const read = await readRemainingWorkspace('plans', params, {
    session: () => session ??= resolveCurrentTenantContext(),
    scopes: getReadOnlyTenantPortfolioAnalysisScopeContext,
  });
  const envelope = {...read, readReceipt:randomUUID(), readEpoch:canonicalBetaReadEpoch(params._betaRead)};
  if (read.state !== 'ready' || !read.context.scope.startsWith('account:')) return {read:envelope};
  const owner = await session;
  if (!owner?.ok) return {read:envelope};
  const planOwner = await savedPlanSession();
  if (!planOwner.ok || planOwner.tenant.ownerUserId !== owner.tenantContext.ownerUserId) return {read:envelope,reason:'temporarily_unavailable'};
  try {
    const context = await readNativeContributionContext(owner.tenantContext, read.context.scope, 'KRW', true);
    const comparison = prepareContributionComparison(context);
    return {read:envelope, projectionOwner:planOwner.key, projection:comparison.status === 'ready' ? nativeUserAllocationBasis(comparison) : undefined,
      unavailableHoldings:context.status === 'blocked' ? context.unavailablePositions?.map(row => row.name+' · '+dataIssueLabel(row.reason)) : undefined,
      reason:comparison.status === 'blocked' ? comparison.reason : undefined};
  } catch {
    return {read:envelope, reason:'temporarily_unavailable'};
  }
}
