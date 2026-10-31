import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

const [flow, recovery] = await importWithPorts(['src/lib/contribution-journey.ts', 'src/lib/recovery-navigation.ts'], {});
const account = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const journey = {scope:`account:${account}`, amount:'237.75', currency:'USD', reportingCurrency:'KRW', beta:true, useCash:true, excludeSell:['one','two']};

test('plan continuation distinguishes reporting and funding currency and retains cash and sale conditions', () => {
  const url = new URL(flow.contributionJourneyHref('plan', journey),'https://test.invalid');
  assert.equal(url.searchParams.get('currency'),'KRW');
  assert.equal(url.searchParams.get('fundingCurrency'),'USD');
  assert.equal(url.searchParams.get('amount'),'237.75');
  assert.equal(url.searchParams.get('useCash'),'1');
  assert.deepEqual(url.searchParams.getAll('excludeSell'),['one','two']);
  const roundTrip = flow.contributionTargetsHref(journey, url.pathname+url.search);
  assert.equal(recovery.recoveryReturnHref(new URL(roundTrip,'https://test.invalid').hash),url.pathname+url.search);
});
test('buy-only comparison does not inherit planned sales or available cash', () => {
  const url = new URL(flow.contributionJourneyHref('compare',journey),'https://test.invalid');
  assert.equal(url.searchParams.get('currency'),'USD');
  assert.equal(url.searchParams.has('useCash'),false);
  assert.equal(url.searchParams.has('excludeSell'),false);
});
test('original and beta ledger paths select the account and buy form, and return to the exact saved effect', () => {
  for (const beta of [false,true]) {
    const state = {...journey,beta};
    const url = new URL(flow.contributionTradeHref(state,id),'https://test.invalid');
    assert.equal(url.pathname,`${beta?'/beta':''}/portfolio/ledger`);
    assert.equal(url.searchParams.get('accountId'),account);
    assert.equal(url.searchParams.get('action'),'buy');
    assert.equal(url.searchParams.has('effectId'),false);
    const back = recovery.recoveryReturnHref(url.hash);
    assert.equal(back,flow.contributionJourneyHref('tracking',state,id));
    assert.equal(new URL(back,'https://test.invalid').searchParams.get('effectId'),id);
    const afterSave = recovery.carryRecoveryFragment(url.pathname+url.search+'&_betaRead=next',url.hash);
    assert.equal(recovery.recoveryReturnHref(new URL(afterSave,'https://test.invalid').hash),back);
  }
});
test('comparison scenario survives target and market recovery without becoming stored evidence', () => {
  const draft={horizon:'90',price:'10',fx:'-5',overrides:{'asset:one':'2.5','asset:two':''}};
  const href=flow.contributionJourneyHref('compare',journey)+'&'+new URLSearchParams(flow.comparisonDraftQuery(draft));
  const returned=recovery.recoveryReturnHref(new URL(flow.contributionTargetsHref(journey,href),'https://test.invalid').hash);
  assert.deepEqual(flow.comparisonDraft(Object.fromEntries(new URL(returned,'https://test.invalid').searchParams)),draft);
});
test('invalid or repeated scenario hints cannot supply values or authorization', () => {
  assert.deepEqual(flow.comparisonDraft({horizon:['90','10'],pricePct:'NaN',fxPct:'Infinity',scenarioRows:'[["x","0"],["x","<script>"],["bad key","1"]]'}),{horizon:'30',price:'0',fx:'0',overrides:{x:'0'}});
  assert.equal(recovery.safeRecoveryUrl('/additional-contribution/tracking?effectId='+id+'&sessionKey=secret'),'/additional-contribution/tracking?effectId='+id);
  assert.equal(recovery.safeRecoveryUrl('https://untrusted.example/'),null);
});
test('saved USD amount is reconstructed exactly, never by rounding a different budget', () => {
  assert.equal(flow.savedEffectFundingAmount({funding:'USD',budget:1350013.5,basis:{usdKrw:1350}}),'1000.01');
  assert.equal(flow.savedEffectFundingAmount({funding:'USD',budget:1350013.51,basis:{usdKrw:1350}}),undefined);
  assert.equal(flow.savedEffectFundingAmount({funding:'USD',budget:100,basis:{usdKrw:null}}),undefined);
});

const element=(name)=>Object.assign(()=>null,{displayName:name});
async function trackingPage({scope='account:'+account,ready=true,readFail=false}={}) {
  const reads=[];
  const library=element('library');
  const [page]=await importUiWithPorts(['src/app/additional-contribution/tracking/page.tsx'],{
    'next/link':{default:element('link')}, 'next/navigation':{redirect:()=>{throw Error('redirect')}},
    '@/lib/auth/current-tenant-context':{resolveCurrentTenantContext:async()=>({ok:true,tenantContext:{ownerUserId:'owner'}})},
    '@/lib/auth/contribution-effect-session':{effectSession:async()=>({key:'owner-session'})},
    '@/db/queries/portfolio-analysis-scopes':{getReadOnlyTenantPortfolioAnalysisScopeContext:async()=>ready?{state:'ready',catalog:{scopes:[{key:'account:'+account,label:'Mine',kind:'account'}]}}:{state:'unavailable'}},
    '@/db/queries/contribution-effects':{readContributionEffects:async(tenant,accountId)=>{reads.push({tenant,accountId});if(readFail)throw Error('db unavailable');return [{id}]}},
    '@/components/additional-contribution/contribution-effect-tracking':{ContributionEffectLibrary:library},
    '@/components/additional-contribution/contribution-journey':{ContributionJourneyNav:element('nav')},
    '@/components/secondary-page-header':{SecondaryPageHeader:element('header')},
    '@/components/cairn-ui':{Status:element('status'),PageTitle:element('title')},
    '@/components/portfolio/portfolio-text':{PortfolioText:element('text')},
    '@/components/recovery/recovery-notice':{RecoveryNotice:element('recovery')},
  });
  const tree=await page.default({searchParams:Promise.resolve({scope,from:'beta',effectId:id})});
  function find(node){if(!node||typeof node!=='object')return null;if(node.type===library)return node;if(Array.isArray(node)){for(const n of node){const found=find(n);if(found)return found;}}return find(node.props?.children);}
  return {reads,library:find(tree)};
}
test('saved effects are readable without requesting a new calculation or target policy',async()=>{
  const result=await trackingPage();
  assert.equal(result.reads.length,1);assert.equal(result.reads[0].accountId,account);
  assert.equal(result.library.props.selectedId,id);assert.equal(result.library.props.tracking.items[0].id,id);
});
test('unknown account or failed scope admission never reads effect records',async()=>{
  for(const options of [{scope:'account:'+id},{ready:false}]){const result=await trackingPage(options);assert.equal(result.reads.length,0);assert.equal(result.library,null);}
});
test('failed saved-record query remains unavailable rather than a confirmed empty account',async()=>{
  const result=await trackingPage({readFail:true});assert.equal(result.library.props.tracking.unavailable,true);
});


test('original and beta design journeys stay in the read-only target preview and retain their return inputs', () => {
  for (const beta of [false, true]) {
    const state = { ...journey, beta, preview: true };
    const back = flow.contributionJourneyHref('compare', state) + '&horizon=90&pricePct=7';
    const target = new URL(flow.contributionTargetsHref(state, back), 'https://test.invalid');
    assert.equal(target.pathname, '/portfolio/targets');
    assert.equal(target.searchParams.get('preview'), 'design');
    assert.equal(target.searchParams.has('mode'), false);
    assert.equal(recovery.recoveryReturnHref(target.hash), back);
  }
  const live = new URL(flow.contributionTargetsHref(journey, flow.contributionJourneyHref('plan', journey)), 'https://test.invalid');
  assert.equal(live.pathname, '/beta/portfolio/targets');
  assert.equal(live.searchParams.get('mode'), 'domain');
  assert.equal(live.searchParams.has('preview'), false);
});

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('design journey controls never offer native plan writes while live controls retain them', async () => {
  const [ui] = await importUiWithPorts(['src/components/additional-contribution/contribution-journey.tsx'], {
    'next/link': { default: element('link') },
    '@/components/recovery/recovery-return': { RecoveryJourneyLink: element('link') },
    '@/components/i18n/locale-provider': { useI18n: () => ({ t: ko => ko }) },
  });
  const links = tree => nodes(tree).filter(node => typeof node.props?.href === 'string').map(node => new URL(node.props.href, 'https://test.invalid'));
  for (const beta of [false, true]) {
    const state = { ...journey, beta, preview: true };
    const next = links(ui.ContributionNextSteps({ journey: state }));
    assert.deepEqual(next.map(url => url.pathname), ['/additional-contribution/compare', '/additional-contribution/tracking']);
    assert.ok(next.every(url => url.searchParams.get('preview') === 'design'));
    for (const current of ['plan', 'compare', 'tracking']) {
      const navigation = links(ui.ContributionJourneyNav({ journey: state, current }));
      assert.ok(navigation.every(url => url.pathname !== '/additional-contribution/plan'));
      assert.ok(navigation.every(url => url.searchParams.get('preview') === 'design'));
    }
  }
  const live = links(ui.ContributionNextSteps({ journey }));
  assert.equal(live[0].pathname, '/additional-contribution/plan');
  assert.equal(live[0].searchParams.has('preview'), false);
});

async function planPage(preview) {
  const reads = [];
  const planner = element('planner');
  const [page] = await importUiWithPorts(['src/app/additional-contribution/plan/page.tsx'], {
    'next/navigation': { redirect: () => { throw Error('Unexpected redirect'); } },
    '@/lib/auth/contribution-effect-session': { effectSession: async () => { reads.push('session'); return { key: 'opaque-session', tenant: { ownerUserId: 'owner' } }; } },
    '@/db/queries/portfolio-analysis-scopes': { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => { reads.push('scope'); return { state: 'ready', resolution: { state: 'resolved' }, catalog: { scopes: [{ kind: 'account', key: 'account:' + account, label: 'Mine' }] } }; } },
    '@/components/portfolio-analysis-scope-boundary': { PortfolioAnalysisScopeBoundary: element('boundary') },
    '@/components/secondary-page-header': { SecondaryPageHeader: element('header') },
    '@/components/native-contribution-planner': { NativeContributionPlanner: planner },
    '@/components/cairn-ui': { PageTitle: element('title') },
    '@/components/portfolio/portfolio-text': { PortfolioText: element('text') },
  });
  const tree = await page.default({ searchParams: Promise.resolve({ scope: 'account:' + account, currency: 'KRW', from: 'beta', ...(preview ? { preview: 'design' } : {}) }) });
  return { reads, tree, planner: nodes(tree).find(node => node.type === planner) };
}

test('direct design plan URLs stop before session, portfolio reads or mounting the live planner', async () => {
  const result = await planPage(true);
  assert.deepEqual(result.reads, []);
  assert.equal(result.planner, undefined);
  assert.ok(nodes(result.tree).some(node => node.props?.role === 'status'));
});

test('ordinary plan URLs still admit the owner and mount an owner-bound live planner', async () => {
  const result = await planPage(false);
  assert.deepEqual(result.reads, ['session', 'scope']);
  assert.equal(result.planner.key, 'opaque-session:account:' + account + ':KRW');
  assert.equal(result.planner.props.scopeKey, 'account:' + account);
  assert.deepEqual(result.planner.props.accounts, [{ key: 'account:' + account, label: 'Mine' }]);
});
