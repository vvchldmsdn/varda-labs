import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '@/lib/auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '@/db/queries/portfolio-analysis-scopes';
import {getReadOnlyTenantPortfolioStructureForScope} from '@/db/queries/portfolio-structure';
import {getReadOnlyTenantPortfolioRiskForScope} from '@/db/queries/portfolio-risk';
import {readBetaAnalysis} from './analysis-service';
import {canonicalBetaReadEpoch} from './read-freshness';
export async function getBetaAnalysisRead(params:Record<string,string|string[]|undefined>) {
 const read=await readBetaAnalysis(params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,structure:getReadOnlyTenantPortfolioStructureForScope,risk:getReadOnlyTenantPortfolioRiskForScope});
 return {...read,readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead)};
}
