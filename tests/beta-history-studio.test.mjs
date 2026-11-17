import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { historyStudioIdentity, restoreHistoryStudioSelection } from '../src/lib/cairn-v2/history-studio-selection.ts';

const children = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(children) : [tree, ...children(tree.props?.children)];
const text = tree => tree == null ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
const Chart = () => null, Impact = () => null, Benchmark = () => null;
const context = { mode: 'domain', scope: 'account:one', currency: 'KRW', fixture: 'standard' };
const historyRead = { displayBinding: 'owner-one', readReceipt: 'read-one' };
const view = { totalKrw: null, history: [
  { date: '2026-10-01', valueKrw: 10000, exampleReturnPct: null },
  { date: '2026-10-30', valueKrw: 11000, exampleReturnPct: null },
  { date: '2026-11-15', valueKrw: 12000, exampleReturnPct: null },
], domain: { state: 'ready', valueState: 'unavailable', historyState: 'ready', historyReadStatus: 'unavailable' } };

async function harness() {
  const states = []; let at = 0;
  const prefs = { metric: 'value', period: '3M', historyDate: null, historyStudio: null,
    setHistoryStudio: next => { prefs.historyStudio = next; },
    setHistoryDate: date => { prefs.historyDate = date; },
    setMetric: metric => { prefs.metric = metric; }, setPeriod: period => { prefs.period = period; } };
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/history-studio.tsx'], {
    react: { useId: () => 'period-error', useState: initial => {
      const index = at++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    } },
    '@/components/i18n/locale-provider': { useI18n: () => ({ locale: 'ko', t: ko => ko }) },
    '@/lib/current-kst-date': { currentKstDate: () => '2026-11-15' },
    '@/components/cairn-v2/beta-provider': { useBetaPreferences: () => prefs },
    '@/components/cairn-v2/beta-charts': { HistoryChart: Chart, historyRows: source => source.history },
    '@/components/cairn-v2/period-attribution-panel': { PeriodAttributionPanel: Impact },
    '@/components/cairn-v2/history-benchmark': { HistoryBenchmark: Benchmark },
  });
  function render(props = {}) { at = 0; return ui.HistoryStudio({ view, context, historyRead, compact: true, ...props }); }
  const button = (tree, label) => children(tree).find(node => node.type === 'button' && text(node) === label);
  return { prefs, render, button };
}

test('history studio shares an exact month, date and mode between inline and expanded readers', async () => {
  const { render, button, prefs } = await harness();
  button(render(), '지난달').props.onClick();
  assert.deepEqual(prefs.historyStudio.range, { start: '2026-10-01', end: '2026-10-31' });
  prefs.historyDate = '2026-10-30';
  button(render(), '가격·환율').props.onClick();
  const impact = children(render({ compact: false })).find(node => node.type === Impact);
  assert.deepEqual(impact.props.range, prefs.historyStudio.range);
  assert.equal(impact.props.selectedDate, '2026-10-30');
  button(render(), '가상 비교').props.onClick();
  const benchmark = children(render({ compact: false })).find(node => node.type === Benchmark);
  assert.deepEqual(benchmark.props.range, impact.props.range);
  assert.equal(benchmark.props.binding, historyRead.displayBinding);
  benchmark.props.onRangeChange({ start: '2026-10-02', end: '2026-10-30' });
  assert.equal(prefs.historyStudio.preset, 'custom');
  assert.deepEqual(children(render()).find(node => node.type === Benchmark).props.range, { start: '2026-10-02', end: '2026-10-30' });
});

test('invalid custom dates keep the applied period and both draft inputs until corrected', async () => {
  const { render, button, prefs } = await harness();
  button(render(), '지난달').props.onClick();
  const before = prefs.historyStudio.range;
  button(render(), '직접 선택').props.onClick();
  const inputs = () => children(render()).filter(node => node.type === 'input' && node.props.type === 'date');
  inputs()[0].props.onChange({ target: { value: '2026-10-20' } });
  inputs()[1].props.onChange({ target: { value: '2026-10-01' } });
  children(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(prefs.historyStudio.range, before);
  assert.deepEqual(inputs().map(node => node.props.value), ['2026-10-20', '2026-10-01']);
  assert.match(text(render()), /종료일은 시작일 이후로/);
  inputs()[1].props.onChange({ target: { value: '2026-10-30' } });
  children(render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(prefs.historyStudio.range, { start: '2026-10-20', end: '2026-10-30' });
});

test('the suspended home never mounts a second impact or comparison reader behind its expanded dialog', async () => {
  const { render, button } = await harness();
  for (const label of ['가격·환율', '가상 비교']) {
    button(render(), label).props.onClick();
    assert.ok(children(render()).some(node => node.type === Impact || node.type === Benchmark));
    const suspended = render({ suspended: true });
    assert.ok(children(suspended).some(node => node.props?.['data-studio-suspended']));
    assert.ok(!children(suspended).some(node => node.type === Impact || node.type === Benchmark));
  }
});

test('changed owners reset the studio mode and denied/loading reads reveal no saved amount or new reader', async () => {
  const { render, button } = await harness();
  button(render(), '가상 비교').props.onClick();
  const changed = render({ historyRead: { displayBinding: 'owner-two', readReceipt: 'read-two' } });
  assert.equal(changed.props['data-mode'], 'value');
  for (const state of ['loading', 'unauthorized']) {
    const blockedView = { ...view, domain: { ...view.domain, state } };
    const blocked = render({ view: blockedView });
    assert.ok(!children(blocked).some(node => node.type === Impact || node.type === Benchmark));
    const valuation = render({ view: blockedView, historyRead: { displayBinding: 'owner-two' } });
    assert.doesNotMatch(text(valuation), /12,000/);
    assert.equal(children(valuation).find(node => 'data-studio-selected-date' in (node.props ?? {})).props['data-studio-selected-date'], undefined);
  }
});

test('an admitted older return remains the actual selected date even with a missing or newer calendar range', async () => {
  const { render, prefs } = await harness();
  const identity = historyStudioIdentity(context, historyRead.displayBinding);
  for (const current of [null, { identity, mode: 'compare', preset: 'thisMonth', range: { start: '2026-11-01', end: '2026-11-15' } }]) {
    prefs.historyStudio = restoreHistoryStudioSelection({ current, context, displayBinding: historyRead.displayBinding, date: '2026-10-30', metric: 'value' });
    prefs.historyDate = '2026-10-30';
    assert.deepEqual(prefs.historyStudio.range, { start: '2026-10-01', end: '2026-10-30' });
    assert.equal(prefs.historyStudio.preset, 'custom');
    const shown = children(render()).find(node => 'data-studio-selected-date' in (node.props ?? {}));
    assert.equal(shown.props['data-studio-selected-date'], '2026-10-30');
    assert.match(text(shown), /11,000/);
    assert.doesNotMatch(text(shown), /12,000/);
  }
  const range = { start: '2026-10-15', end: '2026-11-02' };
  const current = { identity, mode: 'impact', preset: 'custom', range };
  const restored = restoreHistoryStudioSelection({ current, context, displayBinding: historyRead.displayBinding, date: '2026-10-30', metric: 'value' });
  assert.equal(restored.range, range, 'an existing scoped range that contains the return date is preserved');
  const foreign = restoreHistoryStudioSelection({ current, context, displayBinding: 'different-owner', date: '2026-10-30', metric: 'value' });
  assert.notEqual(foreign.identity, identity);
  assert.notEqual(foreign.range, range, 'another display binding must not reuse prior studio preferences');
});

test('a validated history return opens record disclosures before focusing the preserved evidence link', async t => {
  const effects = [], states = []; let at = 0;
  const originalStudio = { identity: JSON.stringify([context.mode, context.scope, context.currency, historyRead.displayBinding]),
    mode: 'compare', preset: 'lastMonth', range: { start: '2026-10-01', end: '2026-10-31' } };
  const preferences = { historyDate: '2026-10-30', period: 'ALL', metric: 'value', historyStudio: originalStudio,
    setHistoryDate() {}, setPeriod() {}, setMetric() {}, setHistoryStudio(next) { preferences.historyStudio = next; } };
  const query = new URLSearchParams({ _historyDate: preferences.historyDate, _historyPeriod: 'ALL', _historyMetric: 'value',
    _historyScope: context.scope, _historyCurrency: context.currency, _historyReturn: 'origin' });
  const calls = [], outer = { tagName: 'DETAILS', open: false, parentElement: null };
  const inner = { tagName: 'DIV', parentElement: outer };
  const target = { parentElement: inner, focus(options) { calls.push({ open: outer.open, options }); } };
  const summary = { parentElement: outer, focus(options) { calls.push({ summary: true, open: outer.open, options }); } };
  outer.querySelector = () => summary;
  let anchor = target;
  for (const [name, value] of Object.entries({ location: { hash: '#history-evidence' }, document: { getElementById: () => anchor, querySelector: () => outer } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/history-return-boundary.tsx'], {
    react: { useLayoutEffect: effect => { effects.push(effect); }, useState: initial => {
      const index = at++; if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = next; }];
    } },
    'next/navigation': { useSearchParams: () => query },
    '@/components/cairn-v2/beta-provider': { useBetaPreferences: () => preferences },
  });
  const render = current => { at = 0; effects.length = 0; return ui.HistoryReturnBoundary({ context, view: current, displayBinding: historyRead.displayBinding, children: 'restored' }); };
  render(view);
  for (const effect of effects) effect();
  assert.equal(calls.length, 0, 'must acknowledge the preserved selection before focusing');
  assert.deepEqual(preferences.historyStudio, { ...originalStudio, mode: 'value' }, 'a validated return synchronizes the studio mode while preserving its scoped range');
  render(view);
  assert.equal(render(view), 'restored');
  for (const effect of effects) effect();
  assert.deepEqual(calls, [{ open: true, options: { preventScroll: true } }]);
  outer.open = false; calls.length = 0;
  render({ ...view, domain: { ...view.domain, historyState: 'loading' } });
  for (const effect of effects) effect();
  assert.equal(outer.open, false);
  assert.equal(calls.length, 0, 'a pending history return must not reveal or focus old record content');
  preferences.historyStudio = originalStudio;
  query.set('_historyScope', 'account:other');
  render(view);
  for (const effect of effects) effect();
  assert.equal(preferences.historyStudio, originalStudio, 'an untrusted cross-scope return cannot change the studio mode');
  outer.open = false; calls.length = 0; anchor = null;
  for (const key of [...query.keys()]) query.delete(key);
  for (const [key, value] of Object.entries({ _historyViewPeriod: 'ALL', _historyViewMetric: 'value',
    _historyViewScope: context.scope, _historyViewCurrency: context.currency })) query.set(key, value);
  preferences.historyDate = null;
  preferences.historyStudio = { ...originalStudio, mode: 'value' };
  const empty = { ...view, history: [], domain: { ...view.domain, historyState: 'empty' } };
  render(empty);
  assert.equal(render(empty), 'restored');
  for (const effect of effects) effect();
  assert.deepEqual(calls, [{ summary: true, open: true, options: { preventScroll: true } }], 'date-free recovery reveals the record controls even when no dated evidence link exists');
});
