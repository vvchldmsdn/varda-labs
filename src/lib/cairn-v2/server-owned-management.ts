import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {getSharedManagedHoldings} from '../shared-backend/holdings';
import {getSharedPortfolioGroupManagementModel,getSharedGroupServiceDate} from '../shared-backend/groups';
import {isAlignedBackendSourceSelected} from '../shared-backend/selection';
import {readOwnedManagement} from './owned-management-service';
import {ownedManagementKey,type ManagementKind} from './owned-management-contract';
import {canonicalBetaReadEpoch} from './read-freshness';
export async function getBetaOwnedManagementRead(kind:ManagementKind,params:Record<string,string|string[]|undefined>){const read=await readOwnedManagement(kind,params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,holdings:getSharedManagedHoldings,groups:getSharedPortfolioGroupManagementModel,serviceDate:getSharedGroupServiceDate,aligned:isAlignedBackendSourceSelected});return {...read,queryKey:ownedManagementKey(kind,read.context),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};}
