import 'server-only';
import {simulationPriceFrontier} from '@/lib/shared-domain/market-data/kis-history-finalization';
import {getReadOnlyTenantPortfolioStructure,getReadOnlyTenantPortfolioStructureForScope} from '@/db/queries/portfolio-structure';
import {getLatestCommonTenantRawServiceDate,getReadOnlyTenantRawHistory} from '@/db/queries/tenant-simulation-history';
import {buildSimulationOwnerInputCandidate} from '@/lib/shared-domain/simulation-owner-input-candidate';
import {buildSimulationOwnerInputPreflightModel} from '@/lib/shared-domain/simulation-owner-input-preflight';
import {buildSimulationOwnerResearchExecution,resolveSimulationOwnerExecutionEndSelection} from '@/lib/shared-domain/simulation-owner-research-execution';
import {resolveSimulationResearchHorizon} from '@/lib/shared-domain/simulation-research-horizon';
import type {getReadOnlyTenantSimulationOwnerResearch} from '@/db/queries/simulation-owner-research';
import {buildPrivateOwnerRawHistory} from '@/lib/shared-domain/simulation-private-owner-raw-history';

// Align only stored-market-data admission with the existing shared service.
// The session/scope-authorized structure defines the universe; never a global
// active-owner catalog. No provider, path registration, storage, or page wrapper.
// Both frontends execute the same generated historical domain: adjusted calendar,
// 90 observations, fixed seed, 1,000 genuine paths. Tenant reads remain local.
export async function getReadOnlyBetaTenantSimulationResearch(options:Parameters<typeof getReadOnlyTenantSimulationOwnerResearch>[0]) {
 const portfolio=options.scope
  ?await getReadOnlyTenantPortfolioStructureForScope({scope:options.scope,serviceDate:options.serviceDate,tenantContext:options.tenantContext})
  :await getReadOnlyTenantPortfolioStructure({account:options.account,tenantContext:options.tenantContext});
 const candidate=options.scope?buildSimulationOwnerInputCandidate({scopeKey:options.scope.key,portfolio}):buildSimulationOwnerInputCandidate({account:portfolio.selectedAccount,portfolio});
 const latest=options.endServiceDate===undefined&&candidate.selection
  ?await getLatestCommonTenantRawServiceDate({selection:candidate.selection}):null;
 const endSelection=resolveSimulationOwnerExecutionEndSelection({suppliedValue:options.endServiceDate,latestCommonStoredServiceDate:latest});
 const history=candidate.selection&&endSelection.status==='valid'
  ?await getReadOnlyTenantRawHistory({selection:candidate.selection,endServiceDate:endSelection.endServiceDate,returnStepCount:90}):null;
 const inputPreflight=buildSimulationOwnerInputPreflightModel({candidate,historicalPreflight:history});
 const execution=buildSimulationOwnerResearchExecution({candidate,inputPreflight,endSelection,horizonSelection:resolveSimulationResearchHorizon(options.horizon),matrix:history?.matrix??null,includeDisplayPaths:true});
 return Object.freeze({inputPreflight,execution,
 priceFrontier:simulationPriceFrontier({endServiceDate:execution.source?.endServiceDate??null,
 hasUs:candidate.selection?.instruments.some(row=>row.market==='us'&&row.weightBps>0)??false,
 isLatest:endSelection.source==='latest_common_stored',now:options.now??new Date()}),
 historyRecovery:history&&'verifiedEndServiceDate' in history&&history.verifiedEndServiceDate?{requestedEndServiceDate:history.requestedEndServiceDate,verifiedEndServiceDate:history.verifiedEndServiceDate as string}:null,pricePolicy:history?.policy??buildPrivateOwnerRawHistory({requireAdjusted:true,requestedEndServiceDate:'',instruments:[],priceRows:[],fxRows:[]}).policy});
}
