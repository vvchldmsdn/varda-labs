import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';
const [collection] = await importWithPorts(['src/lib/holding-analysis-collection.ts'], {});
test('history collection distinguishes absent jobs, active work, failures, protected conflicts and completion',()=>{
  for(const [states,total,expected] of [[[],2,'none'],[['done'],2,'none'],[['failed','pending'],2,'pending'],[['failed','running'],2,'running'],[['failed','done'],2,'failed'],[['blocked','done'],2,'blocked'],[['done','done'],2,'done']]){
    assert.equal(collection.collectionProgress(states,total).state,expected);
  }
  const request=collection.holdingHistoryRequest({ticker:'VOO',market:'us',currency:'USD'},'2026-10-27');
  assert.equal(request.kind,'history'); assert.equal(request.ticker,'VOO');
  assert.equal((Date.parse(request.endDate)-Date.parse(request.startDate))/86400000,399);
});
test('collection status never reads shared jobs for a foreign or inaccessible holding',async()=>{
  let readJobs=0;
  const [progress]=await importWithPorts(['src/lib/holding-analysis-data-progress.ts'],{
    '@/db/client':{sqlClient:{query:async()=>{readJobs++;return [];}}},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:'owner'}})},
    '@/db/queries/holding-analysis-data-readiness':{getReadOnlyTenantHoldingAnalysisPreparationTarget:async()=>null,getReadOnlyTenantHoldingAnalysisDataReadiness:async()=>{throw Error('not reached');}},
  });
  assert.equal(await progress.readSessionHoldingAnalysisProgress('11111111-1111-4111-8111-111111111111'),null);
  assert.equal(readJobs,0);
});
