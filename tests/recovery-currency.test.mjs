import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import React from 'react';
import { currencyRecoveryKind, parseNativeViewDraft } from '../src/lib/recovery-currency.ts';
import { trackedCurrencyFixture } from '../src/lib/currency-tracked-fixture.ts';
import { buildTrackedCurrencyPortfolio } from '../src/lib/currency-tracked-portfolio.ts';
import { currencyResearchFixture } from '../src/lib/currency-research-fixture.ts';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

const scope = 'account:11111111-1111-4111-8111-111111111111';
const walk = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];
const Notice = () => null;
const ports = {
  'next/navigation': { useRouter: () => ({ replace() {}, refresh() {} }) },
  '@/components/recovery/recovery-notice': { RecoveryNotice: Notice },
  '@/components/i18n/locale-provider': { useI18n: () => ({ locale: 'en', t: (ko, en) => en ?? ko }) },
  '@/components/quick-trade-actions': { QuickTradeActions: () => null },
  '@/components/native-contribution-planner': { NativeContributionPlanner: () => null },
  '@/components/portfolio/portfolio-allocation-ring': { PortfolioAllocationRing: () => null },
  react: { ...React, useState: value => [value, () => {}], useMemo: fn => fn(), useEffect() {}, useRef: () => ({ current: null }) },
};
const [{ CurrencyTrackedView }] = await importUiWithPorts(['src/components/currency-tracked-view.tsx'], ports);
function tracked({ fixture = false, missingPrice = false, mismatch = false } = {}) {
  const evidence = trackedCurrencyFixture(); evidence.history = [];
  if (!fixture) evidence.current.source = 'verified_native_test';
  if (missingPrice) evidence.current.positions[0].observation = null;
  if (mismatch) evidence.current.positions[0].ownerId = 'another-owner';
  const reports = Object.fromEntries(['KRW', 'USD'].map(reporting => [reporting, buildTrackedCurrencyPortfolio({ ...evidence, reporting })]));
  const initialView = parseNativeViewDraft([JSON.stringify({ version: 1, scope, view: 'history', currency: evidence.reporting, zone: 'UTC' })], scope, 'history', evidence.reporting);
  const tree = CurrencyTrackedView({ evidence, reports, surface: 'history', recoveryScope: scope, initialView });
  return { tree, notice: walk(tree).find(node => node.type === Notice), evidence };
}
describe('native recovery journeys', () => {
  it('opens real records for empty history and preserves the chosen display timezone without creating dated evidence', () => {
    const { tree, notice, evidence } = tracked();
    assert.equal(notice.props.kind, 'trades');
    assert.equal(notice.props.scope, scope);
    const draft = JSON.parse(notice.props.draft._nativeView);
    assert.equal(draft.zone, 'UTC'); assert.equal(draft.view, 'history');
    assert.match(notice.props.details, /does not create historical valuations/);
    assert.equal(walk(tree).find(node => node.props?.['aria-label'] === 'Display time zone').props.value, 'UTC');
    assert.equal(evidence.history.length, 0);
  });
  it('routes missing price evidence to preparation ahead of empty-history review', () => {
    assert.equal(tracked({ missingPrice: true }).notice.props.kind, 'market');
  });
  it('never exposes management actions from fixture or mixed-owner evidence', () => {
    assert.equal(tracked({ fixture: true }).notice, undefined);
    assert.equal(tracked({ mismatch: true }).notice, undefined);
  });
  it('classifies conflicts, prices, transactions and unsupported models without changing any evidence', () => {
    assert.equal(currencyRecoveryKind(['price_observation_conflict']), 'retry');
    assert.equal(currencyRecoveryKind(['fx_missing']), 'market');
    assert.equal(currencyRecoveryKind(['trade_evidence_missing']), 'trades');
    assert.equal(currencyRecoveryKind(['portfolio_scope_incomplete']), 'holdings');
    assert.equal(currencyRecoveryKind(['comparison_weights_invalid']), null);
    assert.equal(currencyRecoveryKind(['native_cash_component_not_supported']), null);
    assert.equal(currencyRecoveryKind(['unsupported_instrument']), null);
    assert.equal(currencyRecoveryKind(['owner_scope_mismatch', 'fx_missing']), null);
  });
});
describe('bounded display-only native return hints', () => {
  const base = { version: 1, scope, view: 'lab', currency: 'USD', fields: ['75', '25'], comparison: [.5, .5], instruments: ['VOO', 'QQQ'], scenarioId: 'QQQ', horizon: 126, step: 10 };
  const parse = value => parseNativeViewDraft([JSON.stringify(value)], scope, 'lab', 'USD');
  it('preserves user weights and selections but drops owners, transactions and computed results', () => {
    assert.deepEqual(parse({ ...base, ownerId: 'other', total: 99999, trades: [{ price: 1 }] }), base);
  });
  it('rejects duplicate, foreign-context and malformed hints', () => {
    assert.equal(parseNativeViewDraft([JSON.stringify(base), JSON.stringify(base)], scope, 'lab', 'USD'), null);
    for (const patch of [{ scope: 'all' }, { currency: 'KRW' }, { view: 'simulation' }, { version: 2 }]) assert.equal(parse({ ...base, ...patch }), null);
    assert.equal(parseNativeViewDraft(['null'], scope, 'lab', 'USD'), null);
    assert.equal(parseNativeViewDraft(['x'.repeat(12001)], scope, 'lab', 'USD'), null);
  });
  it('drops invalid display values instead of admitting them into a computation', () => {
    const draft = parse({ ...base, comparison: [1, 1], horizon: 999, step: -1, zone: 'not/a-zone', scenarioId: 'javascript:alert(1)' });
    for (const key of ['comparison', 'horizon', 'step', 'zone', 'scenarioId']) assert.equal(draft[key], undefined);
  });
});
it('owned research restores the local weight draft and selection while missing history remains blocked', async () => {
  const evidence = currencyResearchFixture();
  evidence.input = { ...evidence.input, version: 3, source: 'owned_native', ownerId: 'owned-test' };
  evidence.provenance = 'owned_native_history';
  const instruments = evidence.input.rows.map(row => row.instrumentId);
  const fields = instruments.map((_, i) => i === 0 ? '100' : '0');
  const comparison = instruments.map((_, i) => i === 0 ? 1 : 0);
  const initialView = { version: 1, scope, view: 'lab', currency: evidence.reportingCurrency, instruments, fields, comparison, selected: '1', scenarioId: instruments[1] };
  const result = { composition: { rows: [], complete: false }, issues: [{ code: 'history_missing' }], risk: null, lab: null, simulation: null, metadata: { sources: [], bases: [], policy: {} } };
  const initial = [];
  const navigations = [];
  let index = 0;
  const [module] = await importUiWithPorts(['src/components/currency-research-view.tsx'], { ...ports, 'next/link': { default: ({ children, ...props }) => ports.react.createElement('a', props, children) }, 'next/navigation': { useRouter: () => ({ replace: href => navigations.push(href), refresh: () => navigations.push('refresh') }) }, react: { ...ports.react, useState: value => { const at = index++; initial.push(value); return [at === 1 ? result : at === 2 ? false : value, () => {}]; } } });
  const boundary = module.CurrencyResearchView({ evidence, surface: 'lab', recoveryScope: scope, initialView });
  const tree = boundary.type(boundary.props), notice = walk(tree).find(node => node.type === Notice);
  assert.deepEqual(initial[4], comparison); assert.deepEqual(initial[5], fields);
  assert.equal(initial[6], '1'); assert.equal(initial[9], instruments[1]);
  assert.equal(notice.props.kind, 'market');
  assert.deepEqual(JSON.parse(notice.props.draft._nativeView).fields, fields);
  const previousLocation = globalThis.location;
  try {
    globalThis.location = new URL(`https://example.invalid/investment-lab?scope=${scope}`);
    notice.props.onRetry();
    const retry = new URL(navigations[0], 'https://example.invalid');
    assert.deepEqual(JSON.parse(retry.searchParams.get('_nativeView')).fields, fields);
    assert.equal(navigations.length, 1);
    globalThis.location = retry;
    notice.props.onRetry();
    assert.equal(navigations[1], 'refresh');
  } finally { if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; }
  // A repaired holding universe must not inherit another row's draft weight.
  index = 0; initial.length = 0;
  const next = module.CurrencyResearchView({ evidence, surface: 'lab', recoveryScope: scope, initialView: { ...initialView, instruments: [...instruments].reverse() } });
  next.type(next.props);
  assert.equal(initial[5], null);
});

it('routes the admitted native surface into scoped recovery without treating unsupported economic models as missing prices', async () => {
  const [{ CurrencyPortfolioSurfaceClient }] = await importUiWithPorts(['src/components/currency-portfolio-surface-client.tsx'], {
    ...ports,
    'next/navigation': { useSearchParams: () => new URLSearchParams({ scope }) },
    'next/link': { default: () => null },
    '@/components/app-navigation': { AppNavigation: () => null },
    '@/components/portfolio-analysis-scope-tabs': { PortfolioAnalysisScopeTabs: () => null },
    '@/components/currency-tracked-view': { CurrencyTrackedView: () => null },
    '@/components/currency-research-view': { CurrencyResearchView: () => null },
    '@/components/recovered-return-chart': { RecoveredReturnChart: () => null },
  });
  const props = { surface: 'simulation', scopes: [], selectedScope: { kind: 'account', key: scope, accountId: scope.slice(8) }, reporting: 'USD' };
  for (const reason of ['native_cash_component_not_supported', 'invalid_horizon', 'invalid_model']) {
    const tree = CurrencyPortfolioSurfaceClient({ ...props, economicUnsupported: true, researchUnavailableReason: reason });
    assert.equal(walk(tree).find(node => node.type === Notice), undefined);
  }
  const incomplete = CurrencyPortfolioSurfaceClient({ ...props, researchUnavailableReason: 'native_valuation_incomplete' });
  assert.equal(walk(incomplete).find(node => node.type === Notice).props.kind, 'holdings');
  const missing = CurrencyPortfolioSurfaceClient({ ...props, surface: 'history' });
  assert.equal(walk(missing).find(node => node.type === Notice).props.kind, 'holdings');
});
