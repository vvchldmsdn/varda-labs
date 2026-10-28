import assert from 'node:assert/strict';
import {test} from 'node:test';
import {importWithPorts} from './helpers/import-with-ports.mjs';

const [api]=await importWithPorts(['src/lib/cairn-v2/onboarding-service.ts'],{});
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account='11111111-1111-4111-8111-111111111111';
const legacy='22222222-2222-4222-8222-222222222222';
const params={mode:'domain',scope:'all',currency:'KRW'};
function fixture(patch={}){
 const calls=[],scope={kind:'all',key:'all',label:'All'};
 const ports={
  session:async()=>({ok:true,tenantContext:{ownerUserId:owner,role:'user'}}),
  scopes:async()=>({state:'ready',catalog:{scopes:[scope]},resolution:{state:'resolved',scope}}),
  aligned:async()=>true,
  options:async tenant=>{calls.push(['options',tenant.ownerUserId]);return {state:'ready',accounts:[account,legacy].map((id,i)=>({id,code:String(i),name:'Synthetic',accountType:'investment'})),portfolioGroups:[]};},
  nativeAccounts:async tenant=>{calls.push(['native',tenant.ownerUserId]);return [{id:account,code:'0'},{id:'foreign-account',code:'private'}];},
  ...patch,
 };
 return {ports,calls};
}
test('beta onboarding passes only owned native accounts to the common form',async()=>{
 const {ports,calls}=fixture(),read=await api.readHoldingOnboarding(params,ports);
 assert.equal(read.state,'ready');assert.deepEqual(read.nativeAccountIds,[account]);
 assert.deepEqual(read.options.accounts.map(row=>row.id),[account,legacy]);
 assert.deepEqual(calls,[['options',owner],['native',owner]]);
 assert.equal(JSON.stringify(read).includes('foreign-account'),false);
});
test('native admission read failure cannot expose a legacy registration form',async()=>{
 const {ports}=fixture({nativeAccounts:async()=>{throw Error('unavailable');}});
 const read=await api.readHoldingOnboarding(params,ports);
 assert.equal(read.state,'unavailable');assert.equal(read.options,null);assert.deepEqual(read.nativeAccountIds,[]);
});
test('unauthorized beta scope never reads onboarding or native account data',async()=>{
 const {ports,calls}=fixture({scopes:async()=>({state:'ready',catalog:{scopes:[]},resolution:{state:'blocked'}})});
 assert.equal((await api.readHoldingOnboarding(params,ports)).state,'unauthorized');assert.deepEqual(calls,[]);
});
test('legacy-only portfolios retain photo onboarding availability',async()=>{
 const {ports}=fixture({nativeAccounts:async()=>[]}),read=await api.readHoldingOnboarding(params,ports);
 assert.equal(read.state,'ready');assert.equal(read.options.accounts.length,2);assert.deepEqual(read.nativeAccountIds,[]);
});
