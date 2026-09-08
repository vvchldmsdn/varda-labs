import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('owner simulation returns main output without evaluating hidden analysis and evaluates each requested detail once', async () => {
 const calls={candidate:0,walk:0,history:0};
 const portKey='__simulationDeferredTestPorts';
 const ports={
  '@/db/queries/portfolio-structure':{getReadOnlyTenantPortfolioStructure:async()=>({selectedAccount:'all'}),getReadOnlyTenantPortfolioStructureForScope:async()=>({selectedAccount:'all'})},
  '@/db/queries/simulation-owner-private-history':{getLatestCommonPrivateOwnerRawServiceDate:async()=>null,getReadOnlyPrivateOwnerRawHistoryValidationBatch:async()=>null},
  '@/lib/simulation-owner-input-candidate':{buildSimulationOwnerInputCandidate:()=>({account:'all',selection:null})},
  '@/lib/simulation-owner-input-preflight':{buildSimulationOwnerInputPreflightModel:()=>({status:'unavailable'})},
  '@/lib/simulation-owner-research-execution':{buildSimulationOwnerResearchExecution:()=>({status:'unavailable',executionWeights:[]}),resolveSimulationOwnerExecutionEndSelection:()=>({status:'unavailable'}),SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY:{samplePathCount:12}},
  '@/lib/simulation-owner-candidate-comparison':{buildSimulationOwnerCandidateComparison:()=>({marker:++calls.candidate})},
  '@/lib/simulation-owner-walk-forward-validation':{buildSimulationOwnerWalkForwardValidation:()=>({marker:++calls.walk})},
  '@/lib/simulation-owner-historical-outcome-validation':{buildSimulationOwnerHistoricalOutcomeValidation:()=>({marker:++calls.history})},
 };
 globalThis[portKey]=ports;
 const root=new URL('../',import.meta.url);
 const hooks=registerHooks({resolve(specifier,ctx,next){
  if(specifier==='server-only')return {url:'data:text/javascript,export {};',shortCircuit:true};
  if(ports[specifier])return {url:'data:text/javascript,'+encodeURIComponent(Object.keys(ports[specifier]).map(k=>`export const ${k}=globalThis[${JSON.stringify(portKey)}][${JSON.stringify(specifier)}][${JSON.stringify(k)}];`).join('\n')),shortCircuit:true};
  if(specifier.startsWith('@/'))return next(new URL(`src/${specifier.slice(2)}.ts`,root).href,ctx);
  return next(specifier,ctx);
 }});
 try {
  const {getReadOnlyTenantSimulationOwnerResearch}=await import('../src/db/queries/simulation-owner-research.ts?deferred-regression');
  const result=await getReadOnlyTenantSimulationOwnerResearch({tenantContext:{ownerUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}});
  assert.equal(result.execution.status,'unavailable');
  assert.deepEqual(calls,{candidate:0,walk:0,history:0});
  const candidate=result.candidateComparison;
  assert.deepEqual(calls,{candidate:1,walk:0,history:0});
  assert.equal(result.candidateComparison,candidate);
  const history=result.historicalValidation;
  assert.equal(result.historicalValidation,history);
  assert.deepEqual(calls,{candidate:1,walk:0,history:1});
  const walk=result.walkForwardValidation;
  assert.equal(result.walkForwardValidation,walk);
  assert.deepEqual(calls,{candidate:1,walk:1,history:1});
 } finally {hooks.deregister();delete globalThis[portKey];}
});
