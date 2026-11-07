import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {importWithPorts} from './helpers/import-with-ports.mjs';
import {importUiWithPorts} from './helpers/import-ui-with-ports.mjs';
import {originalCurrentComposition,originalCurrentValueSummary,originalLegacyValueView} from '../src/lib/cairn-v2/current-value-presentation.ts';
import {getFixtureView} from '../src/lib/cairn-v2/fixtures.ts';
const [{readBetaDomain},{blankDomainView,visibleDomainRead},{readBetaHome}]=await importWithPorts(['src/lib/cairn-v2/read-service.ts','src/lib/cairn-v2/read-contract.ts','src/lib/cairn-v2/home-read.ts'],{});

const at='2026-09-02T00:00:00Z',owner='owned-user',scope={kind:'all',key:'all',label:'All'};
const dashboard=()=>({generatedAt:at,totalValueKrw:999999,usdKrwRate:1400,holdings:[{id:'private-internal-id',name:'VOO',ticker:'VOO',account:'A',market:'us',currency:'USD',quantity:1,currentPrice:101,currentWeight:100,assetType:'etf',groupName:null,valueKrw:141400,priceAsOf:at,priceFetchedAt:at,priceSource:'stored'}],
  selectedScope:scope,analysisScopes:[scope],todayMovement:{contributionRows:[],exclusions:[],ready:false,returnPct:null,source:null,reason:null},todayChangeKrw:null,nonInvestmentAssets:[],nonInvestmentTotalKrw:0,dataHealth:{latestFxRateDate:'2026-09-02'}});
const evidence=(reporting='KRW')=>({ownerId:owner,reporting,asOf:at,current:{at,source:'owned_investments_current_only',scopeComplete:true,positions:[
  ...Array.from({length:15},(_,i)=>({id:`p${i}`,ownerId:owner,name:i===0?'VOO':`Holding ${i}`,ticker:i===0?'VOO':`T${i}`,kind:'holding',observation:{quantity:'1',price:'100',currency:'USD',at,priceObservedAt:'2026-09-01T20:00:00Z',priceFetchedAt:at,basis:'raw',source:'verified_quote'}})),
  {id:'gold',ownerId:owner,name:'Manual gold',observation:null,unsupportedReason:'manual_gold'},
  {id:'fraction',ownerId:owner,name:'Undated fraction',observation:null,unsupportedReason:'fractional_value_not_dated'},
]},history:[],trades:null,fx:[{base:'USD',quote:'KRW',rate:'1300',observedAt:at,fetchedAt:at,source:'verified_fx',kind:'spot'}],maxFxAgeMs:3*86400000,maxPriceAgeMs:10*86400000});
async function reader({native=true,input=evidence()}={}){
  const calls=[];
  const [module]=await importWithPorts(['src/lib/cairn-v2/server-current-value.ts'],{
    '@/db/queries/native-portfolio-ledger':{requiresNativePortfolioSurface:async(...args)=>{calls.push(['choice',...args]);return native;}},
    '@/db/queries/currency-tracked-portfolio':{getTrackedCurrencyEvidence:async(...args)=>{calls.push(['evidence',...args]);return input;}},
  });
  return {calls,read:currency=>module.readOriginalCurrentValue({tenantContext:{ownerUserId:owner},scope,currency,dashboard:dashboard()})};
}

test('beta current value uses the unchanged original native reader and report for both currencies',async()=>{
  for(const currency of ['KRW','USD']){
    const input=evidence(currency),r=await reader({input});const read=await r.read(currency);
    assert.equal(read.kind,'tracked');assert.equal(read.evidence,input);
    const call=r.calls[1];assert.equal(call[1].ownerUserId,owner);assert.equal(call[2],scope);assert.equal(call[3],currency);
    assert.deepEqual(call[4],{asOf:new Date(at),collect:false,investmentsOnly:true});
    const original=read.reports[currency].current,summary=originalCurrentValueSummary(read,currency);
    assert.equal(summary.amount,original.verifiedSubtotal);assert.equal(summary.asOf,original.at);
    assert.deepEqual(summary.coverage,{positions:17,valued:15,excludedPositions:2,scopeComplete:true,excludedWeightPct:null});
    assert.equal(original.total,null);assert.equal(original.positions[0].weightPct,null);
    assert.equal(original.positions[0].value,currency==='KRW'?'130000':'100');
    assert.equal(original.positions[0].priceObservedAt,input.current.positions[0].observation.priceObservedAt);
    assert.equal(original.positions[15].reason,'manual_gold');assert.equal(original.positions[16].reason,'fractional_value_not_dated');
  }
});

test('legacy KRW displays the existing dashboard values and USD follows the original native branch',async()=>{
  const r=await reader({native:false});const read=await r.read('KRW');
  assert.equal(read.kind,'legacy');assert.equal(r.calls.length,1);
  assert.equal(originalCurrentValueSummary(read,'KRW').amount,dashboard().totalValueKrw);
  assert.equal(originalCurrentValueSummary(read,'KRW').complete,true);
  assert.equal(read.data.holdings[0].valueKrw,dashboard().holdings[0].valueKrw);
  assert.equal(read.data.holdings[0].priceSource,'stored');assert.equal(JSON.stringify(read).includes('private-internal-id'),false);
  assert.equal(originalCurrentValueSummary(read,'USD').amount,null);
  const usd=await reader({native:false,input:evidence('USD')});assert.equal((await usd.read('USD')).kind,'tracked');assert.equal(usd.calls.length,2);
});

test('an ownership failure never includes rejected evidence in the beta presentation',async()=>{
  const input=evidence();input.current.positions[0].ownerId='another-owner';input.current.positions[0].name='private-other-name';
  const r=await reader({input}),read=await r.read('KRW');assert.deepEqual(read,{kind:'unavailable'});
  assert.equal(JSON.stringify(read).includes('private-other'),false);
});

const ports=currentValue=>({session:async()=>({ok:true,tenantContext:{ownerUserId:owner}}),scopes:async()=>({state:'ready',catalog:{scopes:[scope]},resolution:{state:'resolved',scope}}),
  dashboard:async()=>dashboard(),structure:async()=>({exclusions:[],dataHealth:{selectedAssetCount:1},usdKrwRate:1400,holdingRows:[],totalValueKrw:999999}),history:async()=>({selectedScope:scope,readStatus:'ready',portfolioRows:[]}),currentValue,now:()=>new Date(at)});
test('current presentation remains behind session, owned scope and stale-context masking',async()=>{
  let calls=0;const readPort=async()=>{calls++;return {kind:'legacy',data:dashboard()};};
  const p=ports(readPort),read=await readBetaDomain({mode:'domain'},p);assert.equal(calls,1);assert.equal(read.view.domain.currentValuePresentation.kind,'legacy');
  const changed=visibleDomainRead(read,{...read.context,scope:'account:other'});assert.equal(changed.domain.currentValuePresentation,undefined);
  assert.equal(blankDomainView('loading','pending').domain.currentValuePresentation,undefined);
  await readBetaDomain({mode:'domain'},{...p,session:async()=>({ok:false,failure:{httpStatus:401}})});assert.equal(calls,1);
  await readBetaDomain({mode:'domain'},{...p,scopes:async()=>({state:'ready',catalog:{scopes:[scope]},resolution:{state:'unresolved'}})});assert.equal(calls,1);
  const failed=await readBetaDomain({mode:'domain'},ports(async()=>{throw new Error('current_read_failed');}));
  assert.equal(failed.view.domain.currentValuePresentation.kind,'unavailable');assert.equal(originalCurrentValueSummary(failed.view.domain.currentValuePresentation,'KRW').amount,null);
});

test('home opts into the additional current presentation read',async()=>{
  let options;await readBetaHome({mode:'domain'},{domain:async(_params,value)=>{options=value;return {context:{mode:'domain'},view:blankDomainView('unavailable','pending')};},simulation:async()=>{throw new Error('unexpected_simulation');}});
  assert.deepEqual(options,{includeHeatmap:true,includeCurrentValue:true});
});

test('the beta current detail renders the original component output without adding trade or contribution controls',async()=>{
  const r=await reader(),read=await r.read('KRW');
  const [original,beta]=await importUiWithPorts(['src/components/currency-tracked-view.tsx','src/components/cairn-v2/original-value-detail.tsx'],{
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'en',t:(_ko,en)=>en??_ko})},
    '@/components/recovery/recovery-notice':{RecoveryNotice:()=>null},
    '@/components/quick-trade-actions':{QuickTradeActions:()=>{throw new Error('unexpected_trade_control');}},
    '@/components/native-contribution-planner':{NativeContributionPlanner:()=>{throw new Error('unexpected_contribution_control');}},
    '@/components/portfolio/portfolio-allocation-ring':{PortfolioAllocationRing:()=>null},
    '@/components/cairn-v2/value-detail':{ValueDetail:()=>null},
  });
  const props={evidence:read.evidence,reports:read.reports,surface:'structure',hideCurrencyControl:true,embedded:true};
  const originalMarkup=renderToStaticMarkup(createElement(original.CurrencyTrackedView,props));
  const betaMarkup=renderToStaticMarkup(createElement(beta.OriginalValueDetail,{read,view:blankDomainView('ready',''),context:{mode:'domain',scope:'all',currency:'KRW',fixture:'standard'}}));
  assert.equal(betaMarkup,originalMarkup);assert.match(betaMarkup,/15 of 17 holdings/);assert.match(betaMarkup,/2 excluded/);assert.match(betaMarkup,/1,950,000/);
  assert.doesNotMatch(betaMarkup,/<main|varda-main-content|Calculate allocation/);
});

test('legacy detail preserves the existing composition and cost presentation with original numeric fields',async()=>{
  const r=await reader({native:false}),read=await r.read('KRW'),context={mode:'domain',scope:'all',currency:'KRW',fixture:'standard'};
  read.data.investmentReturn={basis:'investment_assets_excluding_cash',currency:'KRW',costKrw:100000,pnlKrw:41400,returnPct:41.4,reason:null};
  const view={...getFixtureView(context),domain:{...blankDomainView('ready','').domain,valueState:'ready',currentValuePresentation:read}};
  const mapped=originalLegacyValueView(view,read);
  assert.equal(mapped.totalKrw,read.data.totalValueKrw);assert.equal(mapped.rows[0].valueKrw,read.data.holdings[0].valueKrw);assert.equal(mapped.rows[0].weightPct,read.data.holdings[0].currentWeight);
  assert.equal(mapped.domain.investmentReturn,read.data.investmentReturn);
  const [module]=await importUiWithPorts(['src/components/cairn-v2/original-value-detail.tsx'],{
    'next/link':{default:({children,href})=>createElement('a',{href},children)},
    '@/components/i18n/locale-provider':{useI18n:()=>({locale:'ko',t:ko=>ko})},
    '@/components/cairn-v2/beta-provider':{useBetaReadFreshness:()=>null},
    '@/components/currency-tracked-view':{CurrencyTrackedView:()=>null},
  });
  const html=renderToStaticMarkup(createElement(module.OriginalValueDetail,{read,view,context}));
  assert.match(html,/data-value-ribbon/);assert.match(html,/원가와 손익/);assert.match(html,/999,999/);assert.match(html,/141,400/);
  read.data.holdings.push({...read.data.holdings[0],name:'Unknown price',ticker:'MISSING',currentPrice:0,valueKrw:0,currentWeight:0});
  const partial=originalLegacyValueView(view,read);assert.equal(partial.domain.valueState,'partial');assert.equal(partial.totalKrw,null);assert.equal(partial.domain.knownSubtotalKrw,141400);
  assert.equal(partial.domain.excluded[0].reason,'missing_price');
  const summary=originalCurrentValueSummary(read,'KRW');assert.equal(summary.amount,141400);assert.equal(summary.complete,false);
  assert.deepEqual(summary.coverage,{positions:2,valued:1,excludedPositions:1});
  read.data.holdings=read.data.holdings.map(row=>({...row,currentPrice:0}));
  const missing=originalLegacyValueView(view,read);
  assert.equal(originalCurrentValueSummary(read,'KRW').amount,null);
  assert.equal(missing.domain.knownSubtotalKrw,null);assert.equal(missing.totalKrw,null);
  const missingHtml=renderToStaticMarkup(createElement(module.OriginalValueDetail,{read,view,context}));
  const hero=missingHtml.match(/data-value-hero="true">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(hero);assert.match(hero,/—/);assert.doesNotMatch(hero,/>0</);
});

test('legacy unnamed instrument occurrences keep distinct selection keys and their own partial weights',()=>{
  const common={name:'수동 자산',ticker:null,account:'A',market:'korea',currency:'KRW',quantity:1,currentPrice:100,currentWeight:0,assetType:'other',groupName:null,priceAsOf:at,priceFetchedAt:at,priceSource:'manual'};
  const read={kind:'legacy',data:{generatedAt:at,totalValueKrw:1399,usdKrwRate:1300,holdings:[{...common,valueKrw:300},{...common,valueKrw:100},{...common,name:'가격 미확인',valueKrw:999,currentPrice:0}]}};
  const view=blankDomainView('ready',''),composition=originalCurrentComposition(read,'KRW'),mapped=originalLegacyValueView(view,read);
  assert.deepEqual(mapped.rows.map(row=>row.key),composition.positions.filter(row=>row.value!==null).map(row=>row.key));
  assert.equal(new Set(mapped.rows.map(row=>row.key)).size,2);
  assert.deepEqual(mapped.rows.map(row=>row.weightPct),[75,25]);assert.equal(mapped.domain.knownSubtotalKrw,400);
});

test('the actual beta value card shows original partial coverage and never substitutes the structure total',async()=>{
  const r=await reader(),read=await r.read('KRW'),context={mode:'domain',scope:'all',currency:'KRW',fixture:'standard'};
  const view={...getFixtureView(context),domain:{...blankDomainView('ready','').domain,currentValuePresentation:read}};
  const empty=()=>null;
  let ringEntries;
  const [home]=await importUiWithPorts(['src/components/cairn-v2/beta-home.tsx'],{
    'next/dynamic':{default:()=>empty},
    '@/components/cairn-v2/use-beta-view':{useBetaView:()=>view},
    '@/components/cairn-v2/use-beta-context':{useBetaContext:initial=>[initial,()=>{}]},
    '@/components/cairn-v2/beta-provider':{useBetaPreferences:()=>({selected:'',setSelected:()=>{}})},
    '@/components/cairn-v2/beta-shell':{BetaShell:({children})=>createElement('div',null,children)},
    '@/components/cairn-v2/home-card':{HomeCard:({kind,children})=>createElement('section',{'data-beta-card':kind},children)},
    '@/components/cairn-v2/home-today':{HomeToday:empty},
    '@/components/cairn-v2/home-contribution':{ContributionHome:empty},
    '@/components/cairn-v2/target-drift-home':{TargetDriftHome:empty},
    '@/components/cairn-v2/holding-heatmap':{HoldingHeatmap:empty},
    '@/components/cairn-v2/home-simulation':{HomeSimulation:empty,HomeSimulationPending:empty},
    '@/components/cairn-v2/history-detail-controls':{MetricControls:empty,PeriodControls:empty},
    '@/components/cairn-v2/beta-charts':{HistoryChart:empty},
    '@/components/cairn-v2/portfolio-allocation-ring':{PortfolioAllocationRing:({entries})=>{ringEntries=entries;return null;}},
  });
  const markup=renderToStaticMarkup(createElement(home.BetaHome,{initialContext:context}));
  const card=markup.match(/<section data-beta-card="value">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(card);assert.match(card,/1,950,000/);assert.match(card,/보유 15\/17건/);assert.match(card,/제외 2건/);
  const composition=originalCurrentComposition(read,'KRW');
  assert.deepEqual(ringEntries.map(row=>row.key),composition.positions.filter(row=>row.value!==null).map(row=>row.key));
  assert.equal(ringEntries.length,15);assert.equal(ringEntries.some(row=>row.key==='gold'),false);
  assert.ok(Math.abs(ringEntries.reduce((sum,row)=>sum+row.weightPct,0)-100)<1e-9);
  assert.doesNotMatch(card,new RegExp(view.totalKrw.toLocaleString('ko-KR')));
  view.domain.currentValuePresentation={kind:'unavailable'};
  ringEntries=null;
  const unavailable=renderToStaticMarkup(createElement(home.BetaHome,{initialContext:context})).match(/<section data-beta-card="value">([\s\S]*?)<\/section>/)?.[1];
  assert.match(unavailable,/—/);assert.doesNotMatch(unavailable,/1,950,000/);
  assert.equal(ringEntries,null); // no legacy replacement ring is rendered while unavailable
  const legacy={kind:'legacy',data:dashboard()};legacy.data.holdings.push({...legacy.data.holdings[0],name:'Missing manual quote',currentPrice:0,valueKrw:0});
  view.domain.currentValuePresentation=legacy;
  const legacyCard=renderToStaticMarkup(createElement(home.BetaHome,{initialContext:context})).match(/<section data-beta-card="value">([\s\S]*?)<\/section>/)?.[1];
  assert.match(legacyCard,/141,400/);assert.match(legacyCard,/확인 가능한 소계/);assert.match(legacyCard,/보유 1\/2건/);assert.match(legacyCard,/제외 1건/);
});

test('beta structure keeps ring and treemap on current valuation and exposes every excluded holding',async()=>{
  const r=await reader(),read=await r.read('KRW'),context={mode:'domain',scope:'all',currency:'KRW',fixture:'standard'};
  const view={...getFixtureView(context),domain:{...blankDomainView('ready','').domain,currentValuePresentation:read}};
  let structureView='ring',entries;
  const empty=()=>null;
  const [ui]=await importUiWithPorts(['src/components/cairn-v2/beta-details.tsx'],{
    'next/link':{default:({children,href})=>createElement('a',{href},children)},
    '@/components/cairn-v2/beta-provider':{useBetaReadFreshness:()=>null,useBetaPreferences:()=>({selected:'',setSelected:()=>{},structureView,setStructureView:()=>{}})},
    '@/components/cairn-v2/planning-details':{ContributionDetail:empty,TargetDetail:empty,driftNumber:()=> '—',targetMessage:()=> '목표 설정 필요'},
    '@/components/cairn-v2/holding-heatmap':{HoldingHeatmap:empty},
    '@/components/cairn-v2/read-summary':{ReadSummary:empty},
    '@/components/cairn-v2/history-detail':{HistoryDetail:empty},
    '@/components/cairn-v2/history-detail-controls':{MetricControls:empty},
    '@/components/cairn-v2/reused/cairn-select':{CairnSelect:empty},
    '@/components/cairn-v2/portfolio-allocation-ring':{PortfolioAllocationRing:props=>{entries=props.entries;return null;}},
  });
  const render=()=>renderToStaticMarkup(createElement(ui.BetaDetail,{kind:'structure',view,context,workspace:true}));
  let html=render();assert.match(html,/1,950,000/);assert.match(html,/소계 내 비중/);assert.match(html,/제외된 보유 2건/);
  assert.match(html,/Manual gold/);assert.match(html,/Undated fraction/);assert.match(html,/소수점 보유분의 원본 가격과 평가 날짜/);
  assert.equal(entries.length,15);assert.equal(entries.some(row=>row.key==='gold'),false);
  assert.doesNotMatch(html,new RegExp(view.totalKrw.toLocaleString('ko-KR')));
  structureView='map';html=render();assert.match(html,/비중 지도 · 면적이 비중에 비례/);assert.match(html,/VOO 6\.67%/);
  structureView='ring';
  const observation=read.evidence.current.positions[0].observation;
  Object.assign(observation,{priceKind:'live',timestampBasis:'collection',priceFetchedAt:at});
  view.domain.currentValuePresentation=await r.read('KRW');
  html=render().replaceAll('<!-- -->','');assert.match(html,/시세 수집 시각 2026-09-02T00:00:00Z/);assert.doesNotMatch(html,/가격 관측 미제공/);
  Object.assign(observation,{priceKind:'close',timestampBasis:'daily_close',priceReferenceDate:'2026-09-01'});delete observation.priceObservedAt;
  view.domain.currentValuePresentation=await r.read('KRW');
  html=render().replaceAll('<!-- -->','');assert.match(html,/종가 기준일 2026-09-01/);assert.doesNotMatch(html,/가격 관측 미제공/);
  view.domain.currentValuePresentation={kind:'unavailable'};
  html=render();assert.match(html,/현재 평가를 불러오지 못했어요/);assert.doesNotMatch(html,/1,950,000|비중 지도/);
});

test('the independent beta structure page opts into the same current presentation read',async()=>{
  let options;
  const [page]=await importUiWithPorts(['src/app/beta/portfolio/structure/page.tsx'],{
    '@/lib/cairn-v2/server-access':{requireBetaFixtureAccess:async()=>{},prepareBetaPageParams:async params=>params},
    '@/lib/cairn-v2/server-read':{getBetaDomainRead:async(context,value)=>{options=value;return {context,view:blankDomainView('ready','')};}},
    '@/components/cairn-v2/beta-workspace':{BetaWorkspace:()=>null},
  });
  await page.default({searchParams:Promise.resolve({mode:'domain',scope:'all',currency:'KRW'})});
  assert.deepEqual(options,{includeCurrentValue:true});
});
