import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {trackedInvestmentComposition} from '../src/lib/current-investment-composition.ts';
import {buildTrackedCurrencyPortfolio} from '../src/lib/currency-tracked-portfolio.ts';
import {originalCurrentComposition} from '../src/lib/cairn-v2/current-value-presentation.ts';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';

const at='2026-09-02T00:00:00Z';
const position=(id,ticker,quantity='1',price='100')=>({id,ownerId:'owner',kind:'holding',accountId:id==='voo-b'?'account-b':'account-a',name:ticker,market:'us',ticker,
  observation:{quantity,price,currency:'USD',at,priceObservedAt:at,priceFetchedAt:at,basis:'raw',source:'verified_quote'}});
const fixture=(reporting='KRW')=>({ownerId:'owner',reporting,asOf:at,current:{at,scopeComplete:true,source:'owned_investments_current_only',positions:[
  position('voo-a','VOO','0.896567'),position('voo-b','VOO'),position('msft','MSFT','2','200'),
  {id:'gold',ownerId:'owner',kind:'holding',name:'금현물',market:'korea',observation:null,unsupportedReason:'manual_gold'},
  {id:'fount',ownerId:'owner',kind:'holding',name:'Fount',observation:null,unsupportedReason:'unsupported_instrument'},
]},history:[],trades:null,fx:[{base:'USD',quote:'KRW',rate:'1300',observedAt:at,fetchedAt:at,source:'verified_fx',kind:'spot'}],maxFxAgeMs:86400000,maxPriceAgeMs:86400000});

test('partial allocation uses precisely the report values and explicitly labels its own denominator',()=>{
  for(const currency of ['KRW','USD']){
    const evidence=fixture(currency),report=buildTrackedCurrencyPortfolio(evidence),before=structuredClone(report);
    const composition=trackedInvestmentComposition(evidence,report);
    assert.equal(composition.amount,report.current.verifiedSubtotal);
    assert.equal(composition.reporting,currency);assert.equal(composition.weightBasis,'verified_subtotal');
    assert.deepEqual(composition.positions.map(row=>row.value),report.current.positions.map(row=>row.value));
    assert.deepEqual(composition.positions.filter(row=>row.reason).map(row=>[row.key,row.reason]),[['gold','manual_gold'],['fount','unsupported_instrument']]);
    assert.equal(composition.positions[0].value,currency==='KRW'?'116553.71':'89.6567');
    assert.equal(composition.positions[0].priceAsOf,at);
    assert.ok(Math.abs(composition.positions.reduce((sum,row)=>sum+(row.displayWeightPct??0),0)-100)<1e-9);
    assert.equal(composition.positions[3].displayWeightPct,null);
    assert.deepEqual(composition.counts,{positions:5,valued:3,excluded:2,instruments:2,unidentifiedPositions:2});
    assert.equal(report.current.total,null);assert.ok(report.current.positions.every(row=>row.weightPct===null));
    assert.deepEqual(report,before);assert.equal(evidence.current.positions[0].observation.quantity,'0.896567');
  }
});

test('a complete chart copies full portfolio weights without rewriting returns or prices',()=>{
  const evidence=fixture('USD');evidence.current.positions=evidence.current.positions.slice(0,3);
  const report=buildTrackedCurrencyPortfolio(evidence),composition=trackedInvestmentComposition(evidence,report);
  assert.equal(composition.complete,true);assert.equal(composition.weightBasis,'portfolio');
  assert.deepEqual(composition.positions.map(row=>row.displayWeightPct),report.current.positions.map(row=>row.weightPct));
  assert.equal(composition.counts.positions,3);assert.equal(composition.counts.instruments,2);
});

test('no admitted prices or FX produces no drawable allocation and does not turn missing values into zero',()=>{
  const evidence=fixture();evidence.fx=[];
  const report=buildTrackedCurrencyPortfolio(evidence),composition=trackedInvestmentComposition(evidence,report);
  assert.equal(composition.amount,null);assert.equal(composition.counts.valued,0);
  assert.ok(composition.positions.every(row=>row.value===null && row.displayWeightPct===null));
  assert.ok(composition.positions.slice(0,3).every(row=>/fx/.test(row.reason)));
  const usd=trackedInvestmentComposition({...evidence,reporting:'USD'},buildTrackedCurrencyPortfolio({...evidence,reporting:'USD'}));
  assert.equal(usd.counts.positions,composition.counts.positions);assert.equal(usd.counts.valued,3);
});

test('manual evidence is labelled only after admission and never makes an unsupported holding eligible',()=>{
  const evidence=fixture('USD');evidence.current.positions[0].observation.source='user_entered_onboarding';
  const composition=trackedInvestmentComposition(evidence,buildTrackedCurrencyPortfolio(evidence));
  assert.equal(composition.positions[0].manuallyEntered,true);assert.equal(composition.positions[1].manuallyEntered,false);
  assert.equal(composition.positions[3].value,null);assert.equal(composition.positions[4].value,null);
});

test('owner rejection and zero value stay distinct from a missing valuation',()=>{
  const evidence=fixture('USD');evidence.current.positions[0].ownerId='other';
  assert.equal(trackedInvestmentComposition(evidence,buildTrackedCurrencyPortfolio(evidence)),null);
  const zero=fixture('USD');zero.current.positions=[position('zero','VOO','0')];
  const result=trackedInvestmentComposition(zero,buildTrackedCurrencyPortfolio(zero));
  assert.equal(result.amount,'0');assert.equal(result.positions[0].value,'0');assert.equal(result.positions[0].displayWeightPct,null);
});

test('legacy charts retain manual source and unavailable rows, and count duplicate instruments separately from holdings',()=>{
  const holding={name:'VOO',ticker:'VOO',market:'us',currency:'USD',account:'A',quantity:0.896567,currentPrice:100,currentWeight:50,valueKrw:116553.71,priceAsOf:at,priceFetchedAt:at,priceSource:'manual'};
  const data={generatedAt:at,totalValueKrw:999999,usdKrwRate:1300,holdings:[holding,{...holding,account:'B',priceSource:'quote'},{...holding,name:'미확인',ticker:null,currentPrice:0,valueKrw:766891.58,currentWeight:0}]};
  const composition=originalCurrentComposition({kind:'legacy',data},'KRW');
  assert.equal(composition.amount,'233107.42');assert.equal(composition.counts.positions,3);assert.equal(composition.counts.instruments,1);
  assert.equal(composition.positions[0].manuallyEntered,true);assert.equal(composition.positions[2].value,null);
  assert.equal(composition.positions[0].displayWeightPct,50);assert.equal(composition.positions[1].displayWeightPct,50);
  assert.notEqual(composition.positions[0].key,composition.positions[1].key);
  assert.equal(originalCurrentComposition({kind:'legacy',data},'USD'),null);
});

test('native original structure displays investment evidence while keeping cash-inclusive research unchanged',async()=>{
  const investments=fixture('USD'),cashInclusive=structuredClone(investments);
  cashInclusive.current.source='owned_account_current';
  cashInclusive.current.positions.push({id:'cash',ownerId:'owner',kind:'cash',name:'Cash',observation:null,unsupportedReason:'cash_not_observed'});
  const reports=Object.fromEntries(['KRW','USD'].map(reporting=>[reporting,buildTrackedCurrencyPortfolio({...cashInclusive,reporting})]));
  const investmentReports=Object.fromEntries(['KRW','USD'].map(reporting=>[reporting,buildTrackedCurrencyPortfolio({...investments,reporting})]));
  let entries;
  const [ui]=await importUiWithPorts(['src/components/currency-tracked-view.tsx'],{
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'ko',t:ko=>ko})},
    '@/components/portfolio/portfolio-allocation-ring':{PortfolioAllocationRing:props=>{entries=props.entries;return null;}},
    '@/components/recovery/recovery-notice':{RecoveryNotice:()=>null},
    '@/components/quick-trade-actions':{QuickTradeActions:()=>null},
    '@/components/native-contribution-planner':{NativeContributionPlanner:()=>null},
  });
  const html=renderToStaticMarkup(createElement(ui.CurrencyTrackedView,{evidence:cashInclusive,investmentEvidence:investments,reports,investmentReports,surface:'structure',embedded:true}));
  assert.match(html,/보유 5건/);assert.match(html,/확인된 소계 내 비중/);assert.doesNotMatch(html,/현금 잔액 확인 필요/);
  assert.equal(entries.length,3);assert.equal(entries.some(row=>row.key==='cash'||row.key==='gold'||row.key==='fount'),false);
  assert.equal(reports.USD.current.coverage.positions,6);assert.equal(investmentReports.USD.current.coverage.positions,5);
});

test('the original structure route uses a single as-of for display and research without requesting price collection',async()=>{
  const tenant={ownerUserId:'owner'},scope={kind:'all',key:'all',label:'All'};
  const account=fixture(),investments=fixture(),calls=[];
  let researchEvidence;
  const [page]=await importUiWithPorts(['src/app/portfolio/structure/page.tsx'],{
    '@/lib/i18n/server':{localizedMetadata:async()=>({})},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:tenant})},
    '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>({state:'ready',catalog:{scopes:[scope]},resolution:{state:'resolved',scope}})},
    '@/db/queries/native-portfolio-ledger':{requiresNativePortfolioSurface:async()=>true},
    '@/db/queries/currency-tracked-portfolio':{getTrackedCurrencyEvidence:async(...args)=>{calls.push(args);return args[3].investmentsOnly?investments:account;}},
    '@/db/queries/currency-research':{getOwnedCurrencyResearchInput:async(_tenant,_scope,_currency,options)=>{researchEvidence=options.valuationEvidence;return {status:'blocked'};}},
    '@/db/queries/portfolio-risk':{getReadOnlyTenantPortfolioRiskForScope:async()=>{throw new Error('unexpected_legacy_risk');}},
    '@/db/queries/portfolio-target-policy':{getReadOnlyTenantPortfolioTargetPolicyModel:async()=>{throw new Error('unexpected_legacy_policy');}},
    '@/components/currency-portfolio-surface':{CurrencyPortfolioSurface:()=>null},
    '@/components/portfolio-analysis-scope-boundary':{PortfolioAnalysisScopeBoundary:()=>null},
    '@/components/portfolio-read-access-boundary':{PortfolioReadAccessBoundary:()=>null},
    '@/components/portfolio/portfolio-structure-view':{PortfolioStructureView:()=>null},
  });
  const result=await page.default({searchParams:Promise.resolve({scope:'all',currency:'USD'})});
  assert.equal(result.props.evidence,account);assert.equal(result.props.investmentEvidence,investments);
  assert.equal(researchEvidence,account);assert.equal(calls.length,2);
  assert.ok(calls.every(args=>args[0]===tenant && args[1]===scope && args[2]==='USD' && args[3].collect===false));
  assert.equal(calls[0][3].asOf,calls[1][3].asOf);assert.equal(calls[0][3].investmentsOnly,undefined);assert.equal(calls[1][3].investmentsOnly,true);
});
