import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '../auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '../../db/queries/portfolio-analysis-scopes';
import {getSharedPortfolioTargetPolicyModel,getSharedTargetServiceDate} from '../shared-backend/target-policy';
import {canonicalBetaReadEpoch} from './read-freshness';
import {readTargetEditor} from './target-editor-service';
import {targetEditorKey} from './target-editor-contract';
export async function getBetaTargetEditorRead(params:Record<string,string|string[]|undefined>){const read=await readTargetEditor(params,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,model:getSharedPortfolioTargetPolicyModel,serviceDate:getSharedTargetServiceDate});return {...read,queryKey:targetEditorKey(read.context),readReceipt:randomUUID(),readEpoch:canonicalBetaReadEpoch(params._betaRead),readAt:new Date().toISOString()};}
