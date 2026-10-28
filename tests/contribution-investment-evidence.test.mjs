import test from 'node:test';
import assert from 'node:assert/strict';
import { contributionInvestmentEvidence } from '../src/lib/contribution-investment-evidence.ts';
import { buildTrackedCurrencyPortfolio } from '../src/lib/currency-tracked-portfolio.ts';
const at='2026-10-27T00:00:00.000Z';
function fixture() {
  const asset={id:'holding',name:'Holding',quantity:'2',currency:'KRW',archived:false,ticker:'069500',market:'korea',assetType:'etf'};
  return {ledger:{accountsComplete:true,accounts:[{id:'account',name:'Account',active:true,revision:0,state:null,assets:[asset]}]},evidence:{ownerId:'owner',reporting:'KRW',asOf:at,maxFxAgeMs:86400000,maxPriceAgeMs:86400000,fx:[],trades:null,ledgerComplete:false,history:[],current:{at,source:'owned',scopeComplete:false,positions:[{id:'holding',ownerId:'owner',name:'Holding',observation:{quantity:'2',price:'100',currency:'KRW',at,priceObservedAt:at,source:'kis',basis:'raw'}},{id:'cash:unknown',ownerId:'owner',name:'Cash',kind:'cash',observation:null}]}}};
}
test('new-money comparison values owned holdings without inventing an opening cash balance',()=>{
  const {ledger,evidence}=fixture(), before=structuredClone(evidence);
  const result=contributionInvestmentEvidence(evidence,ledger,'account');
  assert.equal(buildTrackedCurrencyPortfolio(result.evidence).current.total,'200');
  assert.equal(result.evidence.ledgerComplete,false);
  assert.deepEqual(result.sequences,{account:-1});
  assert.deepEqual(evidence,before);
});
test('unsettled cash does not block a reconciled investment quantity',()=>{
  const {ledger,evidence}=fixture();ledger.accounts[0].state={at,sequence:2,positions:[{assetId:'holding',quantity:'2',currency:'KRW'}],unsettledTrades:[{assetId:'holding'}]};
  const result=contributionInvestmentEvidence(evidence,ledger,'account');
  assert.equal(buildTrackedCurrencyPortfolio(result.evidence).current.complete,true);
  assert.equal(result.sequences.account,2);
});
test('quantity changes and incomplete account enumeration still block',()=>{
  const {ledger,evidence}=fixture();ledger.accountsComplete=false;
  assert.equal(contributionInvestmentEvidence(evidence,ledger,'account'),null);
  ledger.accountsComplete=true;ledger.accounts[0].assets[0].quantity='3';
  assert.equal(contributionInvestmentEvidence(evidence,ledger,'account'),null);
});
test('native state and owned asset divergence cannot be hidden by cash exclusion',()=>{
  const {ledger,evidence}=fixture();ledger.accounts[0].state={at,sequence:2,positions:[{assetId:'holding',quantity:'3',currency:'KRW'}]};
  assert.equal(contributionInvestmentEvidence(evidence,ledger,'account'),null);
});
test('missing prices remain excluded evidence and cannot produce a complete comparison',()=>{
  const {ledger,evidence}=fixture();evidence.current.positions[0].observation=null;
  const result=contributionInvestmentEvidence(evidence,ledger,'account');
  assert.equal(result.evidence.current.positions.length,1);
  assert.equal(buildTrackedCurrencyPortfolio(result.evidence).current.complete,false);
});
test('missing holdings, duplicate IDs and foreign owners fail closed',()=>{
  for(const change of [e=>e.current.positions.shift(),e=>e.current.positions.push({...e.current.positions[0]}),e=>e.current.positions[0].ownerId='foreign']){
    const {ledger,evidence}=fixture();change(evidence);
    assert.equal(contributionInvestmentEvidence(evidence,ledger,'account'),null);
  }
});
