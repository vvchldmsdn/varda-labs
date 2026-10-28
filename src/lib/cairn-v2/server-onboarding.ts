import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {getSharedHoldingOnboardingOptions} from '../shared-backend/holding-onboarding';
import {isAlignedBackendSourceSelected} from '../shared-backend/selection';
import {readHoldingOnboarding} from './onboarding-service';
import {onboardingKey} from './onboarding-contract';
import {canonicalBetaReadEpoch} from './read-freshness';
export async function getBetaHoldingOnboardingRead(params:Record<string,string|string[]|undefined>){const read=await readHoldingOnboarding(params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,options:getSharedHoldingOnboardingOptions,aligned:isAlignedBackendSourceSelected});return {...read,queryKey:onboardingKey(read.context),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};}
