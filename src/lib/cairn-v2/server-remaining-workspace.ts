import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {canonicalBetaReadEpoch} from './read-freshness';
import {readRemainingWorkspace,type RemainingKind} from './remaining-workspace-contract';
export async function getRemainingWorkspace(kind:RemainingKind,params:Record<string,string|string[]|undefined>){const result=await readRemainingWorkspace(kind,params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext});return {...result,readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead)};}
