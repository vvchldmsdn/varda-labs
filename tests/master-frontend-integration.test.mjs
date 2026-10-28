import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {assessSharedBackendRuntime} from '../src/lib/shared-backend/runtime-policy.ts';
import {admittedContributionCostBasisKrw} from '../src/lib/additional-contribution-cost-basis.ts';
import {onboardingCollectionVisible} from '../src/lib/cairn-v2/onboarding-presentation.ts';

test('beta collection guidance matches the canonical provider in integrated production',()=>{
 const runtime=assessSharedBackendRuntime({nodeEnv:'production'});
 assert.equal(onboardingCollectionVisible(true,runtime),true);
 assert.equal(onboardingCollectionVisible(false,runtime),false);
 assert.equal(onboardingCollectionVisible(true,{...runtime,mutations:false}),false);
 assert.equal(onboardingCollectionVisible(true,{...runtime,execution:'synthetic'}),false);
});

test('both contribution surfaces preserve unknown historical USD cost instead of converting it at current FX',()=>{
 assert.equal(admittedContributionCostBasisKrw({currency:'USD',costBasisKrw:1400000}),null);
 assert.equal(admittedContributionCostBasisKrw({currency:'KRW',costBasisKrw:1400000}),1400000);
 assert.equal(admittedContributionCostBasisKrw({currency:'KRW',costBasisKrw:null}),null);
 assert.equal(admittedContributionCostBasisKrw({currency:null,costBasisKrw:1400000}),null);
});

test('master production admits both frontends without deployment-only flags',()=>{
 const state=assessSharedBackendRuntime({nodeEnv:'production'});
 assert.equal(state.execution,'service');assert.equal(state.betaAccess,'service');assert.equal(state.reason,'integrated_service');
});
test('unified production never promotes readonly or fixture configurations',()=>{
 for(const extra of [{liveReadOnly:'1'},{enabled:'1'},{liveReadOnly:'invalid'}]){
  const state=assessSharedBackendRuntime({nodeEnv:'production',...extra});
  assert.equal(state.betaAccess,'closed');assert.equal(state.mutations,false);
 }
});
test('explicit invalid deployment selectors still fail closed',()=>{
 for(const extra of [{source:'unknown'},{runtime:'unknown'},{source:'candidate-736f',runtime:'unknown'}]){
  const state=assessSharedBackendRuntime({nodeEnv:'production',...extra});
  assert.equal(state.betaAccess,'closed');assert.equal(state.mutations,false);
 }
});
test('development without localhost fixture admission stays closed',()=>{
 assert.equal(assessSharedBackendRuntime({nodeEnv:'development'}).betaAccess,'closed');
});
test('beta remains subject to canonical tenant admission in the unified layout',()=>{
 const layout=readFileSync('src/app/beta/layout.tsx','utf8');
 assert.match(layout,/resolveCurrentTenantContext/);assert.match(layout,/if\(!resolution.ok\)/);
 const config=readFileSync('next.config.ts','utf8');
 assert.doesNotMatch(config,/assetPrefix.*beta-assets|destination.*varda-labs/);
});
