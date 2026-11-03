import assert from 'node:assert/strict';
import { it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { trackedCurrencyFixture } from '../src/lib/currency-tracked-fixture.ts';
import { buildTrackedCurrencyPortfolio } from '../src/lib/currency-tracked-portfolio.ts';

const accountId = '11111111-1111-4111-8111-111111111111';
const otherAccount = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';
const scope = `account:${accountId}`;
const origin = 'https://test.invalid';
const link = ({ href, children, ...props }) => { delete props.prefetch; return React.createElement('a', { ...props, href }, children); };
const i18n = { useI18n: () => ({ locale: 'ko', t: ko => ko }) };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const content = node => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(content).join('') : content(node.props?.children);
function stateHooks() {
  const state = []; let index = 0;
  return { begin() { index = 0; }, react: { useMemo: fn => fn(), useState: initial => {
    const at = index++;
    if (!(at in state)) state[at] = typeof initial === 'function' ? initial() : initial;
    return [state[at], value => { state[at] = typeof value === 'function' ? value(state[at]) : value; }];
  } } };
}
const [intent, history, recovery] = await importWithPorts(['src/lib/trade-record-intent.ts', 'src/lib/cairn-v2/read-presentation.ts', 'src/lib/recovery-navigation.ts'], {});

it('recovery retains a canonical holding only for ledger routes and keeps supported reporting currencies separate from KRW-only editors', () => {
  for (const beta of [false, true]) {
    const source = `${beta ? '/beta' : ''}/portfolio/ledger?accountId=${accountId}&assetId=${assetId}&action=sell&currency=USD`;
    const destination = recovery.recoveryDestination('trades', scope, beta, 'USD');
    assert.equal(new URL(destination, origin).searchParams.get('currency'), 'USD');
    const href = recovery.recoveryHref(destination, source);
    assert.equal(recovery.recoveryReturnHref(new URL(href, origin).hash), source);
    for (const kind of ['targets', 'history', 'market']) assert.equal(new URL(recovery.recoveryDestination(kind, scope, beta, 'USD'), origin).searchParams.get('currency'), 'KRW');
  }
  for (const path of [`/history?assetId=${assetId}`, '/portfolio/ledger?assetId=invalid', `/portfolio/ledger?assetId=${assetId}&assetId=${assetId}`]) {
    assert.equal(new URL(recovery.safeRecoveryUrl(path), origin).searchParams.has('assetId'), false);
  }
});

it('a USD recovery action opens a USD ledger and returns to the same original currency', async t => {
  const pushed = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const previousForm = Object.getOwnPropertyDescriptor(globalThis, 'HTMLFormElement');
  Object.defineProperty(globalThis, 'location', { value: new URL(`/beta?mode=domain&scope=${scope}&currency=USD`, origin), configurable: true });
  Object.defineProperty(globalThis, 'HTMLFormElement', { value: class {}, configurable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'location', previous); else delete globalThis.location; });
  t.after(() => { if (previousForm) Object.defineProperty(globalThis, 'HTMLFormElement', previousForm); else delete globalThis.HTMLFormElement; });
  const [ui] = await importUiWithPorts(['src/components/recovery/recovery-notice.tsx'], {
    'next/navigation': { useRouter: () => ({ push: href => pushed.push(href) }) },
    '@/components/i18n/locale-provider': i18n,
    react: { useTransition: () => [false, fn => fn()] },
  });
  nodes(ui.RecoveryNotice({ kind: 'cash', scope, beta: true })).find(node => node.type === 'button' && node.props?.onClick).props.onClick();
  const destination = new URL(pushed[0], origin);
  assert.equal(destination.pathname, '/beta/portfolio/ledger');
  assert.equal(destination.searchParams.get('currency'), 'USD');
  assert.equal(new URL(recovery.recoveryReturnHref(destination.hash), origin).searchParams.get('currency'), 'USD');
});

it('photo-import round trips preserve exact account, holding, action and reporting currency without authorizing foreign accounts', () => {
  const hint = { accountId, assetId, action: 'sell' };
  const photo = new URL(intent.tradePhotoImportHref(hint, 'USD'), origin);
  const parsed = intent.normalizeTradeRecordHint(Object.fromEntries(photo.searchParams));
  const selection = intent.resolveTradeRecordSelection([{ id: otherAccount, assets: [] }, { id: accountId, assets: [{ id: assetId }] }], parsed);
  const manual = new URL(intent.tradeRecordHref(selection, photo.searchParams.get('currency')), origin);
  assert.equal(photo.pathname, '/portfolio/trades/import');
  assert.equal(manual.pathname, '/portfolio/ledger');
  assert.deepEqual(Object.fromEntries(manual.searchParams), { ...hint, currency: 'USD' });
  assert.equal(intent.resolveTradeRecordSelection([{ id: otherAccount, assets: [] }], hint).accountId, '');
  assert.equal(intent.normalizeTradeRecordHint({ accountId: [accountId, otherAccount] }).accountId, undefined);
});

it('photo-import page carries navigation hints into its UI and its sign-in continuation', async () => {
  let authenticated = true;
  const Photo = () => null;
  const initial = { accounts: [{ id: accountId, assets: [{ id: assetId }] }] };
  const [page] = await importUiWithPorts(['src/app/portfolio/trades/import/page.tsx'], {
    'next/navigation': { redirect: href => { throw new Error(href); } },
    '@/db/queries/trade-photo-import-context': { readTradePhotoImportContext: async () => authenticated ? initial : null },
    '@/components/secondary-page-header': { SecondaryPageHeader: () => null },
    '@/components/trade-import/trade-photo-import': { TradePhotoImport: Photo },
  });
  const params = { accountId, assetId, action: 'buy', currency: 'USD' };
  const tree = await page.default({ searchParams: Promise.resolve(params) });
  const props = nodes(tree).find(node => node.type === Photo).props;
  assert.deepEqual(props.initialSelection, { accountId, assetId, action: 'buy' });
  assert.equal(props.reportingCurrency, 'USD');
  authenticated = false;
  await assert.rejects(page.default({ searchParams: Promise.resolve(params) }), error => {
    const signIn = new URL(error.message, origin);
    assert.equal(signIn.searchParams.get('returnTo'), intent.tradePhotoImportHref(params, 'USD'));
    return true;
  });
});

it('manual entry from photo import keeps the selected holding when more than one account exists', async () => {
  const [ui] = await importUiWithPorts(['src/components/trade-import/trade-photo-import.tsx'], {
    'next/link': { default: link }, 'next/dynamic': { default: () => () => null },
    '@/components/i18n/locale-provider': i18n,
  });
  const html = renderToStaticMarkup(React.createElement(ui.TradePhotoImport, {
    initial: { sessionKey: 'synthetic-session', accounts: [{ id: otherAccount, assets: [] }, { id: accountId, assets: [{ id: assetId }] }], entries: [] },
    initialSelection: { accountId, assetId, action: 'sell' }, reportingCurrency: 'USD',
  }));
  const href = html.match(/href="([^"]+)"[^>]*>직접 입력/)[1].replaceAll('&amp;', '&');
  assert.deepEqual(Object.fromEntries(new URL(href, origin).searchParams), { accountId, assetId, action: 'sell', currency: 'USD' });
});

it('currency valuation opens its account ledger in the same reporting currency', async () => {
  const [ui] = await importUiWithPorts(['src/components/currency-portfolio-surface-client.tsx'], {
    'next/link': { default: link },
    'next/navigation': { useSearchParams: () => new URLSearchParams({ scope, currency: 'USD' }) },
    '@/components/i18n/locale-provider': i18n,
    '@/components/app-navigation': { AppNavigation: () => null },
    '@/components/portfolio-analysis-scope-tabs': { PortfolioAnalysisScopeTabs: () => null },
    '@/components/currency-tracked-view': { CurrencyTrackedView: () => null },
    '@/components/currency-research-view': { CurrencyResearchView: () => null },
    '@/components/recovered-return-chart': { RecoveredReturnChart: () => null },
    '@/components/recovery/recovery-notice': { RecoveryNotice: () => null },
  });
  const tree = ui.CurrencyPortfolioSurfaceClient({ surface: 'home', reporting: 'USD', scopes: [], selectedScope: { kind: 'account', key: scope, accountId } });
  const destination = nodes(tree).find(node => typeof node.props?.href === 'string' && node.props.href.startsWith('/portfolio/ledger'));
  assert.deepEqual(Object.fromEntries(new URL(destination.props.href, origin).searchParams), { accountId, currency: 'USD' });
});

it('common home and currency-valuation links retain a ledger account and the active account overrides the entry hint', async () => {
  let query = new URLSearchParams({ accountId, currency: 'USD' });
  const [ui] = await importUiWithPorts(['src/components/app-navigation.tsx'], {
    'next/link': { default: link, useLinkStatus: () => ({ pending: false }) },
    'next/navigation': { usePathname: () => '/portfolio/ledger', useSearchParams: () => query },
    '@/components/i18n/locale-provider': i18n,
    '@/components/i18n/language-switch': { LanguageSwitch: () => null },
    '@/components/home/portfolio-refresh-button': { PortfolioRefreshButton: () => null },
    '@/components/reporting-currency-switch': { ReportingCurrencySwitch: () => null, REPORTING_ROUTES: ['/', '/portfolio/reporting'] },
    react: { useRef: () => ({ current: null }), useSyncExternalStore: (_subscribe, _snapshot, server) => server() },
  });
  for (const selectedScopeKey of [undefined, `account:${otherAccount}`]) {
    const links = nodes(ui.AppNavigation({ selectedScopeKey })).filter(node => typeof node.props?.href === 'string' && node.props.href.startsWith('/'));
    for (const path of ['/', '/portfolio/reporting']) {
      const destinations = links.map(node => new URL(node.props.href, origin)).filter(url => url.pathname === path);
      assert.ok(destinations.length > 0);
      assert.ok(destinations.every(url => url.searchParams.get('scope') === (selectedScopeKey ?? scope)));
      assert.ok(destinations.every(url => url.searchParams.get('currency') === 'USD'));
    }
  }
  query = new URLSearchParams({ accountId: 'invalid', currency: 'USD' });
  const home = nodes(ui.AppNavigation({})).find(node => node.props?.href?.startsWith('/?'));
  assert.equal(new URL(home.props.href, origin).searchParams.has('scope'), false);
});

it('unavailable return history retains period and metric controls so the user can return to current valuation', async () => {
  let metric = 'return', period = '1M';
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/history-detail.tsx'], {
    'next/link': { default: link },
    '@/components/cairn-v2/beta-provider': { useBetaPreferences: () => ({ metric, period, historyDate: null, setPeriod: value => { period = value; }, setMetric: value => { metric = value; }, setHistoryDate() {} }), useBetaReadFreshness: () => null, useBetaExistingCrudAvailable: () => false },
    '@/components/cairn-v2/beta-charts': { HistoryChart: () => null, historyRows: history.historyRows },
    '@/components/cairn-v2/reused/cairn-select': { CairnSelect: () => null },
    '@/components/recovery/recovery-notice': { RecoveryNotice: () => null },
  });
  const view = { history: [], totalKrw: 100, domain: { state: 'ready', valueState: 'ready', historyState: 'unavailable', historyReadStatus: 'unavailable', historyDisplayCurrency: 'KRW', refreshedAt: '2026-11-03T01:00:00Z' } };
  const render = () => renderToStaticMarkup(React.createElement(ui.HistoryDetail, { view, context: { currency: 'KRW', scope, fixture: 'standard', mode: 'domain' } }));
  for (const state of ['unavailable', 'empty', 'loading', 'unauthorized']) {
    view.domain.historyState = state;
    const html = render();
    assert.match(html, /히스토리 보기/);
    assert.match(html, /히스토리 기간/);
    assert.match(html, /1개월/);
    assert.doesNotMatch(html, /data-history-selected-value/);
  }
  metric = 'value';
  view.domain.historyState = 'unavailable';
  assert.match(render(), /data-history-selected-value/);
  assert.equal(view.history.length, 0, 'the current-value display does not manufacture saved history');
});

it('read-only return banners do not instruct users to save on the current home page', async () => {
  const [ui] = await importUiWithPorts(['src/components/recovery/recovery-return.tsx'], {
    'next/link': { default: link },
    'next/navigation': { usePathname: () => '/beta', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() {} }) },
    '@/components/i18n/locale-provider': i18n,
    react: { useSyncExternalStore: () => '#cairn-return=' + encodeURIComponent('/additional-contribution/compare?scope=all&currency=USD&amount=237.75') },
  });
  const html = renderToStaticMarkup(React.createElement(ui.RecoveryReturn));
  assert.match(html, /입력 유지하고 돌아가기/);
  assert.doesNotMatch(html, /먼저 저장/);
});

it('currency changes keep the exact selected holding while displaying the newly requested currency', async () => {
  const h = stateHooks(), Ring = () => null;
  const [ui] = await importUiWithPorts(['src/components/currency-tracked-view.tsx'], {
    react: h.react, '@/components/i18n/locale-provider': i18n,
    '@/components/portfolio/portfolio-allocation-ring': { PortfolioAllocationRing: Ring },
    '@/components/quick-trade-actions': { QuickTradeActions: () => null },
    '@/components/native-contribution-planner': { NativeContributionPlanner: () => null },
    '@/components/recovery/recovery-notice': { RecoveryNotice: () => null },
  });
  const evidence = trackedCurrencyFixture();
  evidence.current.positions = [
    { ...evidence.current.positions[0], id: otherAccount, ticker: 'SAME' },
    { ...evidence.current.positions[0], id: assetId, ticker: 'SAME' },
  ];
  evidence.history = [];
  const reports = Object.fromEntries(['KRW', 'USD'].map(reporting => [reporting, buildTrackedCurrencyPortfolio({ ...evidence, reporting })]));
  const render = reporting => { h.begin(); return ui.CurrencyTrackedView({ evidence: { ...evidence, reporting }, reports, surface: 'structure', hideCurrencyControl: true }); };
  nodes(render('KRW')).find(node => node.type === Ring).props.onSelect(assetId);
  for (const reporting of ['USD', 'KRW', 'USD']) {
    const tree = render(reporting);
    assert.equal(nodes(tree).find(node => node.type === Ring).props.selectedKey, assetId);
    assert.ok(content(nodes(tree).find(node => node.type === 'header')).includes(`· ${reporting}`));
  }
});

it('currency surfaces retain component identity only within the same owner and scope', async () => {
  const Tracked = () => null;
  const [ui] = await importUiWithPorts(['src/components/currency-portfolio-surface-client.tsx'], {
    'next/link': { default: link }, 'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@/components/i18n/locale-provider': i18n,
    '@/components/app-navigation': { AppNavigation: () => null },
    '@/components/portfolio-analysis-scope-tabs': { PortfolioAnalysisScopeTabs: () => null },
    '@/components/currency-tracked-view': { CurrencyTrackedView: Tracked },
    '@/components/currency-research-view': { CurrencyResearchView: () => null },
    '@/components/recovered-return-chart': { RecoveredReturnChart: () => null },
    '@/components/recovery/recovery-notice': { RecoveryNotice: () => null },
  });
  const key = (currency, selected = scope, ownerId = 'owned-fixture') => nodes(ui.CurrencyPortfolioSurfaceClient({
    surface: 'structure', evidence: { ...trackedCurrencyFixture(), ownerId, reporting: currency }, reports: {}, scopes: [], selectedScope: { kind: 'account', key: selected, accountId },
  })).find(node => node.type === Tracked).key;
  assert.equal(key('KRW'), key('USD'));
  assert.notEqual(key('KRW'), key('USD', `account:${otherAccount}`));
  assert.notEqual(key('KRW'), key('USD', scope, 'other-owner'));
});

it('currency navigation carries only validated valuation selection hints into the new currency', async () => {
  const [ui, drafts] = await importUiWithPorts(['src/components/reporting-currency-switch.tsx', 'src/lib/recovery-currency.ts'], {
    'next/navigation': { usePathname() {}, useRouter() {}, useSearchParams() {} }, '@/components/i18n/locale-provider': i18n,
  });
  const saved = { version: 1, scope, view: 'structure', currency: 'KRW', selected: assetId, zone: 'America/New_York', fields: ['1000'], comparison: [1] };
  const query = new URLSearchParams({ scope, currency: 'KRW', _nativeView: JSON.stringify(saved), amount: '1000' });
  const result = new URL(ui.reportingCurrencyHref('/portfolio/structure', query.toString(), 'USD'), origin);
  assert.deepEqual(drafts.parseNativeViewDraft(result.searchParams.getAll('_nativeView'), scope, 'structure', 'USD'), { version: 1, scope, view: 'structure', currency: 'USD', zone: saved.zone, selected: assetId });
  assert.equal(result.searchParams.has('amount'), false);
  query.set('scope', `account:${otherAccount}`);
  const other = new URL(ui.reportingCurrencyHref('/portfolio/structure', query.toString(), 'USD'), origin);
  assert.equal(drafts.parseNativeViewDraft(other.searchParams.getAll('_nativeView'), `account:${otherAccount}`, 'structure', 'USD'), null);
});

it('the dedicated reporting route retains holding identity across currency changes and accepts only its own view hint', async () => {
  const Tracked = () => null, tenant = { ownerUserId: 'fixture-owner' };
  const selectedScope = { key: scope, kind: 'account', accountId };
  const [page] = await importUiWithPorts(['src/app/portfolio/reporting/page.tsx'], {
    'next/navigation': { redirect() { throw new Error('unexpected redirect'); } },
    '@/lib/auth/current-tenant-context': { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: tenant }) },
    '@/db/queries/portfolio-analysis-scopes': { getReadOnlyTenantPortfolioAnalysisScopeContext: async ({ tenantContext }) => { assert.equal(tenantContext, tenant); return { state: 'ready', resolution: { state: 'resolved', scope: selectedScope } }; } },
    '@/db/queries/currency-tracked-portfolio': { getTrackedCurrencyEvidence: async (owner, selected, reporting) => { assert.equal(owner, tenant); assert.equal(selected, selectedScope); return { ...trackedCurrencyFixture(), reporting }; } },
    '@/components/portfolio-analysis-scope-boundary': { PortfolioAnalysisScopeBoundary: () => null },
    '@/components/secondary-page-header': { SecondaryPageHeader: () => null },
    '@/components/currency-tracked-view': { CurrencyTrackedView: Tracked },
    '@/lib/server/currency-tracked-reports': { buildTrackedCurrencyReports: () => ({}) },
  });
  const render = async (currency, draftScope = scope) => nodes(await page.default({ searchParams: Promise.resolve({ currency, scope,
    _nativeView: JSON.stringify({ version: 1, scope: draftScope, view: 'reporting', currency, selected: assetId }),
  }) })).find(node => node.type === Tracked);
  const krw = await render('KRW'), usd = await render('USD');
  assert.equal(krw.key, usd.key);
  assert.equal(usd.props.initialView.selected, assetId);
  assert.equal((await render('USD', `account:${otherAccount}`)).props.initialView, null);
});

it('original empty and failed history keeps controls and retry settings without claiming a load failure is a missing first record', async () => {
  const h = stateHooks(), Recovery = () => null;
  const [ui] = await importUiWithPorts(['src/components/history/history-time-explorer.tsx'], {
    react: h.react, '@/components/i18n/locale-provider': i18n,
    '@/components/recovery/recovery-notice': { RecoveryNotice: Recovery },
  });
  const props = { model: { status: 'no_data', points: [] }, scopeLabel: 'Synthetic scope', recovery: { scope, readFailed: true, valuationIncomplete: false }, initialSelection: { period: '30D' } };
  const render = () => { h.begin(); return ui.HistoryTimeExplorer(props); };
  let tree = render();
  const html = renderToStaticMarkup(tree);
  assert.match(html, /그래프 지표/); assert.match(html, /조회 기간/); assert.match(html, /기록을 불러오지 못했어요/);
  assert.doesNotMatch(html, /첫 평가를 저장/);
  const ranges = nodes(tree).filter(node => node.type === 'button' && node.props['aria-pressed'] !== undefined);
  assert.equal(ranges.length, 4);
  ranges.at(-1).props.onClick();
  tree = render();
  assert.deepEqual(nodes(tree).find(node => node.type === Recovery).props.draft, { metric: 'value', period: 'ALL' });
  props.recovery.readFailed = false;
  assert.match(renderToStaticMarkup(render()), /아직 탐색할 기록이 없습니다/);
  assert.deepEqual(props.model.points, []);
});
