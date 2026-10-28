import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {resolveCurrentTenantContext} from '@/lib/auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '@/db/queries/portfolio-analysis-scopes';
import {readBetaSimulation} from './simulation-service';
import {canonicalBetaReadEpoch} from './read-freshness';
import {getReadOnlyBetaTenantSimulationResearch} from './simulation-shared-research';
export async function getBetaSimulationRead(params:Record<string,string|string[]|undefined>) {
 const readReceipt=randomUUID(),readEpoch=canonicalBetaReadEpoch(params._betaRead);
 const common={session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext};
 const read=await readBetaSimulation(params,{...common,admission:'tenant_owned_shared_history',research:getReadOnlyBetaTenantSimulationResearch});
 // No shared/global result cache. Receipt binds this authorized request and its exact public result.
 return {...read,readReceipt,readEpoch,resultIdentity:read.model?createHash('sha256').update(JSON.stringify([readReceipt,readEpoch,read.context,read.model])).digest('hex'):undefined};
}
