import 'server-only';
import {randomUUID} from 'node:crypto';
import {resolveCurrentTenantContext} from '@/lib/auth/current-tenant-context';
import {getReadOnlyTenantPortfolioAnalysisScopeContext} from '@/db/queries/portfolio-analysis-scopes';
import {getReadOnlyTenantInvestmentLabAnalysisScopeEvidence} from '@/db/queries/investment-lab-scope-evidence';
import {getReadOnlyTenantInvestmentLabCounterfactualForScope} from '@/db/queries/investment-lab';
import {canonicalBetaReadEpoch} from './read-freshness';
import {readBetaLab} from './lab-service';
import type {LabParams} from './lab-contract';
export async function getBetaLabRead(p:LabParams){const readReceipt=randomUUID(),readEpoch=canonicalBetaReadEpoch(p._betaRead);const read=await readBetaLab(p,{session:resolveCurrentTenantContext,scopes:getReadOnlyTenantPortfolioAnalysisScopeContext,evidence:getReadOnlyTenantInvestmentLabAnalysisScopeEvidence,research:getReadOnlyTenantInvestmentLabCounterfactualForScope});return {...read,readReceipt,readEpoch,readAt:new Date().toISOString()};}
