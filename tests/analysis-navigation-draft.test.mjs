import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { importWithPorts } from './helpers/import-with-ports.mjs';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

const [journey, recovery, native, lab] = await importWithPorts(['src/lib/contribution-journey.ts', 'src/lib/recovery-navigation.ts', 'src/lib/native-research-draft.ts', 'src/lib/lab-period-draft.ts'], {});
const scope = 'account:11111111-1111-4111-8111-111111111111';
const scenario = { horizon: '90', price: '10', fx: '-5', overrides: { voo: '2.5' } };
const walk = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(walk)] : [];

test('comparison tracking, targets and back links retain exact inputs, without turning USD into beta KRW', () => {
  for (const beta of [false, true]) {
    const state = { scope, amount: '240.25', currency: 'USD', beta, comparison: { ...scenario, scope, currency: 'USD' } };
    const tracking = new URL(journey.contributionJourneyHref('tracking', state), 'https://test.invalid');
    const returned = journey.comparisonContinuation(Object.fromEntries(tracking.searchParams), scope, 'USD');
    assert.deepEqual(returned, state.comparison);
    const back = new URL(journey.contributionBackHref(state), tracking);
    assert.equal(back.searchParams.get('currency'), 'USD');
    assert.equal(back.searchParams.get('cashAmountKrw'), beta ? '1000000' : null);
    assert.equal(back.searchParams.get('amount'), beta ? null : '240.25');
    const compare = new URL(recovery.recoveryReturnHref(back.hash), tracking);
    assert.equal(compare.searchParams.get('amount'), '240.25');
    assert.deepEqual(journey.comparisonDraft(Object.fromEntries(compare.searchParams)), scenario);
    const targets = journey.contributionTargetsHref(state, compare.pathname + compare.search);
    const inherited = '#cairn-return=' + encodeURIComponent('/additional-contribution/compare?amount=1000000&currency=KRW');
    assert.equal(recovery.carryRecoveryFragment(targets, inherited), targets, 'latest explicit return must beat an inherited task');
    const management = recovery.carryRecoveryFragment('/portfolio/holdings?scope=' + scope, new URL(targets, tracking).hash);
    assert.equal(recovery.recoveryReturnHref(new URL(management, tracking).hash), compare.pathname + compare.search);
    for (const next of [{ ...state, scope: 'account:another' }, { ...state, currency: 'KRW' }]) {
      assert.equal(new URL(journey.contributionJourneyHref('compare', next), tracking).searchParams.has('scenarioRows'), false);
    }
  }
  const krw = new URL(journey.contributionBackHref({ scope, amount: '1234567', currency: 'KRW', beta: true }), 'https://test.invalid');
  assert.equal(krw.searchParams.get('cashAmountKrw'), '1234567');
});

test('native drafts preserve current edits across fresh evidence but reset row-indexed choices on universe changes', () => {
  const defaults = { version: 1, scope, view: 'lab', currency: 'USD', instruments: ['voo', 'qqq'], horizon: 126, step: 126, selected: '0', scenarioId: 'voo' };
  const saved = { ...defaults, fields: ['70', '30'], comparison: [.6, .4], selected: '1', scenarioId: 'qqq' };
  assert.deepEqual(native.nativeResearchDraft(saved, defaults, [30,126,252], ['voo','qqq']), saved);
  const reordered = native.nativeResearchDraft(saved, { ...defaults, instruments: ['qqq','voo'] }, [30,126,252], ['voo','qqq']);
  assert.equal(reordered.fields, undefined); assert.equal(reordered.comparison, undefined); assert.equal(reordered.selected, '0');
  for (const patch of [{ scope: 'all' }, { currency: 'KRW' }, { view: 'simulation' }]) {
    assert.deepEqual(native.nativeResearchDraft({ ...saved, ...patch }, defaults, [30,126,252], ['voo','qqq']), defaults);
  }
});

test('pending lab dates do not change applied dates and cannot cross scope, currency or a new applied window', () => {
  const expected = { version: 1, scope, currency: 'KRW', baseStart: '2026-08-01', baseEnd: '2026-09-01', start: '2026-08-01', end: '2026-09-01' };
  const pending = { ...expected, start: '2026-08-10', end: '' };
  assert.deepEqual(lab.readLabPeriodDraft([JSON.stringify(pending)], expected), pending);
  for (const patch of [{ scope: 'all' }, { currency: 'USD' }, { baseStart: '2026-08-10' }]) {
    assert.equal(lab.readLabPeriodDraft([JSON.stringify(pending)], { ...expected, ...patch }), null);
  }
  assert.equal(lab.readLabPeriodDraft([JSON.stringify(pending), JSON.stringify(pending)], expected), null);
});

test('actual navigation draft hook keeps edits on reload/back and refuses late writes into another account', async () => {
  let local;
  const [{ useNavigationDraft }] = await importUiWithPorts(['src/components/recovery/use-navigation-draft.ts'], {
    react: { ...React, useState: value => [local ?? value, value => { local = value; }], useMemo: fn => fn(), useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
  });
  const oldLocation = globalThis.location, oldWindow = globalThis.window;
  const path = '/additional-contribution/compare';
  const writes = [];
  try {
    globalThis.location = new URL(`https://test.invalid${path}?scope=${scope}&amount=1000000&currency=KRW`);
    globalThis.window = new EventTarget();
    window.history = { replaceState(_state, _title, href) { writes.push(href); globalThis.location = new URL(href, location); } };
    const initial = { amount: '1000000', currency: 'KRW', ...journey.comparisonDraft({}) };
    const options = { path, scope, initial, read: q => ({ amount: q.get('amount'), currency: q.get('currency'), ...journey.comparisonDraft(Object.fromEntries(q)) }), write: d => ({ amount: d.amount, currency: d.currency, ...journey.comparisonDraftQuery(d) }) };
    const edited = { amount: '240.25', currency: 'USD', ...scenario };
    useNavigationDraft(options)[1](edited);
    const currentEntry = location.href;
    local = undefined;
    assert.deepEqual(useNavigationDraft(options)[0], edited, 'a reload must read the edited URL, not old initial props');
    globalThis.location = new URL('https://test.invalid/additional-contribution/tracking?scope=' + scope);
    globalThis.location = new URL(currentEntry);
    assert.deepEqual(useNavigationDraft(options)[0], edited, 'back returns to the edited history entry');
    const tooLarge = { ...edited, amount: '7'.repeat(17000) };
    useNavigationDraft(options)[1](tooLarge);
    assert.deepEqual(useNavigationDraft(options)[0], tooLarge, 'a URL limit must not silently revert the local edit');
    assert.equal(useNavigationDraft(options)[2], true, 'the UI must disclose that navigation cannot preserve this draft');
    assert.equal(location.href, currentEntry);
    useNavigationDraft(options)[1](edited);
    assert.equal(useNavigationDraft(options)[2], false);
    assert.deepEqual(useNavigationDraft(options)[0], edited);
    const update = useNavigationDraft(options)[1];
    globalThis.location = new URL(`https://test.invalid${path}?scope=account:other&amount=10&currency=KRW`);
    update({ ...edited, amount: '999' });
    assert.equal(writes.length, 2); assert.equal(location.searchParams.get('amount'), '10');
    globalThis.location = new URL('https://test.invalid/portfolio/research?draft=saved-input');
    local = undefined;
    const standalone = { ...options, path: null };
    useNavigationDraft(standalone)[1](edited);
    assert.deepEqual(useNavigationDraft(standalone)[0], edited, 'standalone research retains its existing local edits');
    assert.equal(useNavigationDraft(standalone)[2], false);
    assert.equal(writes.length, 2, 'saved-input research must not write account continuation URLs');
  } finally {
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
});

test('current-task recovery returns to the lab even when an inherited comparison hash is present', async () => {
  const moves = [];
  const [{ RecoveryNotice }] = await importUiWithPorts(['src/components/recovery/recovery-notice.tsx'], {
    react: { ...React, useTransition: () => [false, action => action()] },
    'next/navigation': { useRouter: () => ({ push: href => moves.push(href), refresh() {} }) },
    '@/components/i18n/locale-provider': { useI18n: () => ({ t: ko => ko }) },
  });
  const previous = { location: globalThis.location, HTMLFormElement: globalThis.HTMLFormElement };
  try {
    globalThis.HTMLFormElement = class {};
    globalThis.location = new URL(`https://test.invalid/investment-lab?scope=${scope}&currency=USD#cairn-return=${encodeURIComponent('/additional-contribution/compare?amount=10&currency=KRW')}`);
    const tree = RecoveryNotice({ source: 'current', kind: 'market', scope, draft: { _nativeView: 'latest' } });
    walk(tree).find(node => typeof node.props?.onClick === 'function').props.onClick();
    const back = new URL(recovery.recoveryReturnHref(new URL(moves[0], location).hash), location);
    assert.equal(back.pathname, '/investment-lab'); assert.equal(back.searchParams.get('currency'), 'USD');
    assert.equal(back.searchParams.get('_nativeView'), 'latest'); assert.equal(back.searchParams.has('amount'), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
