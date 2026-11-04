import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPublicUserAllocationWorkspaces, compareUserAllocation as compareAllocation, nativeUserAllocationBasis, PUBLIC_ALLOCATION_WORKSPACE_PREFIX, publicUserAllocationBasis, publicUserAllocationIdentity, readUserAllocationWorkspace, USER_ALLOCATION_WORKSPACE_TTL } from '../src/lib/user-allocation-comparison.ts';
import { contributionComparisonPreview } from '../src/lib/contribution-comparison-preview.ts';
import { calculatePlan, createPlanDraft, PLAN_STORAGE_KEY } from '../src/lib/investment-plan.ts';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compareUserAllocation = (basis, ...args) => compareAllocation(nativeUserAllocationBasis(basis), ...args);

function basis() {
  const source = contributionComparisonPreview();
  return { ...source, rows: source.rows.slice(0, 2).map((row, index) => ({ ...row, allocationKey: index ? 'b' : 'a', currentValueKrw: index ? 4_000_000 : 6_000_000, targetWeightBps: 5000, buyable: true })) };
}
function ready(result) { assert.equal(result.status, 'ready', JSON.stringify(result)); return result; }
test('user allocation keeps the remaining gap: 60:40 plus 100 to B is 54.5:45.5, not target achieved', () => {
  const result = ready(compareUserAllocation(basis(), '1000000', 'KRW', { a: '0', b: '1000000' }));
  assert.equal(result.remaining, 0);
  assert.ok(Math.abs(result.rows[0].afterPct - 600 / 11) < 1e-10);
  assert.ok(Math.abs(result.rows[1].gapPp + 50 / 11) < 1e-10);
  assert.equal(result.rows[0].currentPct, 60);
});
test('A and B share current values, budget and FX without mutating holdings or cost', () => {
  const source = basis(), before = structuredClone(source);
  const a = ready(compareUserAllocation(source, '1000000', 'KRW', { a: '600000', b: '400000' }));
  const b = ready(compareUserAllocation(source, '1000000', 'KRW', { b: '1000000' }));
  assert.equal(a.rows[0].afterPct, 60); assert.notEqual(a.rows[0].afterPct, b.rows[0].afterPct);
  assert.equal(a.budget, b.budget); assert.deepEqual(source, before);
  assert.equal('returnPct' in a, false); assert.equal('profit' in a, false);
});
test('unallocated budget stays separate from investment composition', () => {
  const result = ready(compareUserAllocation(basis(), '1000000', 'KRW', {}));
  assert.equal(result.remaining, 1000000); assert.deepEqual(result.rows.map(row => row.afterPct), [60, 40]);
});
test('USD cents conserve exactly and use the same evidenced exchange rate', () => {
  const source = basis(); source.usdKrw = 1350.5;
  const result = ready(compareUserAllocation(source, '0.30', 'USD', { a: '0.10', b: '0.20' }));
  assert.equal(result.allocated, 0.3); assert.equal(result.remaining, 0);
  assert.ok(Math.abs(result.rows[0].afterPct - (6_000_000 + 135.05) / (10_000_000 + 405.15) * 100) < 1e-10);
});
test('partial USD allocation retains exact residual cents', () => {
  const result = ready(compareUserAllocation(basis(), '0.30', 'USD', { a: '0.10' }));
  assert.equal(result.remaining, .2);
});
test('missing FX blocks USD funding without substituting a rate', () => {
  const source = basis(); source.usdKrw = null;
  assert.equal(compareUserAllocation(source, '1', 'USD', {}).reason, 'fx_missing');
  assert.equal(compareUserAllocation(source, '1', 'KRW', {}).status, 'ready');
});
test('over-budget, negative and unsupported money precision preserve a keyed validation result', () => {
  assert.equal(compareUserAllocation(basis(), '1', 'KRW', { a: '2' }).reason, 'over_budget');
  for (const text of ['-1', '0.01', 'bad', 'Infinity']) {
    const result = compareUserAllocation(basis(), '100', 'KRW', { a: text });
    assert.equal(result.reason, 'invalid_allocation'); assert.equal(result.key, 'a');
  }
});
test('unknown or duplicate holding IDs and unapproved target sum are rejected', () => {
  assert.equal(compareUserAllocation(basis(), '1', 'KRW', { unknown: '1' }).reason, 'invalid_basis');
  const source = basis(); source.rows[1].allocationKey = 'a';
  assert.equal(compareUserAllocation(source, '1', 'KRW', {}).reason, 'invalid_basis');
  source.rows[1].allocationKey = 'b'; source.rows[1].targetWeightBps = 4999;
  assert.equal(compareUserAllocation(source, '1', 'KRW', {}).reason, 'invalid_basis');
});
test('no price evidence is fabricated for nonbuyable rows or invalid current values', () => {
  const source = basis(); source.rows[0].buyable = false;
  assert.equal(compareUserAllocation(source, '100', 'KRW', { a: '1' }).reason, 'not_buyable');
  assert.equal(compareUserAllocation(source, '100', 'KRW', { b: '1' }).status, 'ready');
  source.rows[0].currentValueKrw = NaN;
  assert.equal(compareUserAllocation(source, '100', 'KRW', {}).reason, 'invalid_basis');
});
test('zero starting investment has unknown current weights, never a made-up zero return', () => {
  const source = basis(); source.rows.forEach(row => { row.currentValueKrw = 0; });
  const result = ready(compareUserAllocation(source, '1', 'KRW', { b: '1' }));
  assert.deepEqual(result.rows.map(row => row.currentPct), [null, null]);
  assert.deepEqual(result.rows.map(row => row.afterPct), [0, 100]);
});
test('draft restore preserves invalid input for correction but rejects stale or changed instruments', () => {
  const now = Date.now(), value = { savedAt: now, a: { a: '-1' }, b: { b: '0.896567' } }, raw = JSON.stringify(value);
  assert.deepEqual(readUserAllocationWorkspace(raw, ['a', 'b'], now), value);
  assert.equal(readUserAllocationWorkspace(raw, ['a'], now), null);
  assert.equal(readUserAllocationWorkspace(raw, ['a', 'b'], now + 86400001), null);
  assert.equal(readUserAllocationWorkspace('{', ['a'], now), null);
});

const publicPlan = currency => ({ version: 2, asOf: '2020-01-01T00:00:00.000Z', currency, amount: 100,
  rows: [{ name: 'A', value: 600, targetBps: 5000 }, { name: 'B', value: 400, targetBps: 5000 }] });

function storagePort(values, failure) {
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem(key) { if (failure === 'throw') throw new Error('blocked'); if (failure !== 'ignore') values.delete(key); } };
}

test('explicit guest cleanup deletes every public variant but preserves account drafts and other browser data', () => {
  const values = new Map([[`${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}personal:KRW`, 'one'], ['cairn:user-allocation:owner-account-KRW', 'private'],
    [`${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}personal:USD`, 'two'], [`${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}sample`, 'three'], ['unrelated', 'keep']]);
  assert.equal(clearPublicUserAllocationWorkspaces(storagePort(values)), true);
  assert.deepEqual([...values.entries()], [['cairn:user-allocation:owner-account-KRW', 'private'], ['unrelated', 'keep']]);
  assert.equal(clearPublicUserAllocationWorkspaces(storagePort(values)), true);
});

test('guest cleanup is bounded and never claims success after thrown or silently ignored deletion', () => {
  for (const failure of ['throw', 'ignore']) {
    const values = new Map([[`${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}one`, 'draft']]);
    assert.equal(clearPublicUserAllocationWorkspaces(storagePort(values, failure)), false); assert.equal(values.size, 1);
  }
  let reads = 0;
  assert.equal(clearPublicUserAllocationWorkspaces({ length: 1001, key() { reads++; }, removeItem() { throw new Error('unexpected'); } }), false);
  assert.equal(reads, 0);
  assert.equal(clearPublicUserAllocationWorkspaces({ get length() { throw new Error('denied'); } }), false);
});

for (const failure of ['none', 'local', 'session', 'silent-session']) test(`temporary-input deletion uses the actual clear button and handles ${failure} storage failure honestly`, async t => {
  const saved = createPlanDraft(publicPlan('KRW')), local = new Map([[PLAN_STORAGE_KEY, JSON.stringify(saved)]]);
  const session = new Map([[`${PUBLIC_ALLOCATION_WORKSPACE_PREFIX}personal`, 'draft'], ['cairn:user-allocation:private', 'keep']]);
  const previous = new Map(['localStorage', 'sessionStorage', 'location', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const globals = { localStorage: storagePort(local, failure === 'local' ? 'throw' : undefined), sessionStorage: storagePort(session, failure === 'session' ? 'throw' : failure === 'silent-session' ? 'ignore' : undefined),
    location: { protocol: 'https:' }, document: { cookie: '' }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {} };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let cursor = 0; const cells = [], effects = [];
  const [component] = await importUiWithPorts(['src/components/first-visit/plan-experience.tsx'], {
    react: {
      useState(initial) { const index = cursor++; cells[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [cells[index].value, value => { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value; }]; },
      useRef: () => ({ current: null }), useEffect: effect => { effects.push(effect); },
    },
    'next/navigation': { useRouter: () => ({ push() {}, replace() {} }) }, 'next/link': { default: () => null },
    '@/lib/first-visit-events': { trackFirstVisit() {} },
    '@/components/i18n/locale-provider': { useI18n: () => ({ locale: 'en', t: (_ko, en) => en }) },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const text = tree => tree == null ? '' : typeof tree !== 'object' ? String(tree) : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props?.children);
  const render = () => { cursor = 0; return component.PlanExperience({ personal: true }); };
  render(); effects[0](); let tree = render();
  assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === 'Asset 1 name')?.props.value, 'A');
  const clear = nodes(tree).find(node => node.type === 'button' && text(node) === 'Remove temporary inputs'); assert.ok(clear);
  clear.props.onClick(); tree = render();
  assert.equal(session.get('cairn:user-allocation:private'), 'keep');
  if (failure === 'none') {
    assert.equal(local.has(PLAN_STORAGE_KEY), false); assert.equal(session.size, 1);
    assert.match(text(tree), /temporary inputs were removed/i);
    assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === 'Asset 1 name')?.props.value, '');
  } else {
    assert.match(text(nodes(tree).find(node => node.props?.role === 'alert')), /could not all be removed/);
    assert.doesNotMatch(text(tree), /temporary inputs were removed/i);
    assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === 'Asset 1 name')?.props.value, 'A');
  }
});

test('public KRW and USD inputs use their actual currency without inventing FX or native holdings', () => {
  for (const currency of ['KRW', 'USD']) {
    const input = publicPlan(currency), before = structuredClone(input), model = publicUserAllocationBasis(input);
    assert.equal(model.baseCurrency, currency); assert.equal(model.usdKrw, null);
    assert.deepEqual(model.rows.map(row => row.currentValue), [600, 400]);
    assert.ok(model.rows.every(row => row.metadata.currency === currency && !Object.hasOwn(row, 'currentValueKrw')));
    const result = ready(compareAllocation(model, '100', currency, { 'plan:b': '100' }));
    assert.ok(Math.abs(result.rows[0].afterPct - 600 / 11) < 1e-10);
    assert.ok(Math.abs(result.rows[1].gapPp + 50 / 11) < 1e-10);
    assert.deepEqual(input, before);
  }
});

test('public dollar cents retain exact remaining money without a KRW conversion', () => {
  const model = publicUserAllocationBasis({ ...publicPlan('USD'), amount: .30 });
  const result = ready(compareAllocation(model, '0.30', 'USD', {}));
  assert.equal(result.remaining, .3);
});

test('public comparison uses the existing public plan limits and cannot bypass target validation', () => {
  const input = { ...publicPlan('KRW'), amount: 1_000_000_000_000 };
  assert.equal(calculatePlan(input).ok, true);
  assert.equal(compareAllocation(publicUserAllocationBasis(input), String(input.amount), 'KRW', {}).status, 'ready');
  const source = publicPlan('KRW'); source.rows[1].targetBps = 4000;
  assert.equal(publicUserAllocationBasis(source), null); assert.equal(publicUserAllocationIdentity(source), null);
  assert.equal(publicUserAllocationBasis({ ...publicPlan('USD'), amount: .001 }), null);
});

test('different funding and base currencies require evidenced FX rather than a one-to-one substitute', () => {
  const dollarModel = publicUserAllocationBasis(publicPlan('USD'));
  assert.equal(compareAllocation(dollarModel, '1350', 'KRW', { 'plan:b': '1350' }).reason, 'fx_missing');
  const converted = ready(compareAllocation({ ...dollarModel, usdKrw: 1350 }, '1350', 'KRW', { 'plan:b': '1350' }));
  assert.ok(Math.abs(converted.rows[1].afterPct - 401 / 1001 * 100) < 1e-10);
  const cents = ready(compareAllocation(dollarModel, '0.30', 'USD', { 'plan:a': '0.10', 'plan:b': '0.20' }));
  assert.equal(cents.allocated, .3); assert.equal(cents.remaining, 0);
});

test('public workspace identity isolates currency and changed inputs but is stable across serialized reloads', () => {
  const input = publicPlan('USD'), identity = publicUserAllocationIdentity(input);
  assert.equal(publicUserAllocationIdentity(JSON.parse(JSON.stringify(input))), identity);
  assert.notEqual(publicUserAllocationIdentity({ ...input, amount: 200 }), identity);
  assert.notEqual(publicUserAllocationIdentity(publicPlan('KRW')), identity);
  assert.notEqual(publicUserAllocationIdentity({ ...input, rows: [...input.rows].reverse() }), identity);
});

test('the public result connects the same A/B editor after valid targets and separates it from plan saving', async () => {
  const [component] = await importUiWithPorts(['src/components/first-visit/plan-results.tsx'], {
    '@/components/i18n/locale-provider': { useI18n: () => ({ locale: 'en', t: (_ko, en) => en }) },
  });
  const input = publicPlan('USD'), original = calculatePlan(input);
  const html = renderToStaticMarkup(createElement(component.PlanResults, { input }));
  assert.match(html, /Compare your own allocations/);
  assert.match(html, /A plan A allocation \(USD\)/);
  assert.match(html, /B plan B allocation \(USD\)/);
  assert.match(html, /Saving the plan saves the automatic allocation shown above/);
  assert.match(html, /\$100\.00/);
  assert.doesNotMatch(html, /KRW|fx_missing|exchange rate.*required|원/);
  assert.deepEqual(calculatePlan(input), original);
  const invalid = renderToStaticMarkup(createElement(component.PlanResults, { input: { ...input, rows: input.rows.map(row => ({ ...row, targetBps: 4000 })) } }));
  assert.doesNotMatch(invalid, /Compare your own allocations/);
});

async function editorHarness(t) {
  let cursor = 0, cells = [], effects = [], currentKey = null, frameId = 0;
  const frames = new Map(), timers = new Map(), storage = new Map();
  const previous = new Map(['window', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestAnimationFrame(callback) { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) { const id = ++frameId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  } });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
  function unmount() { cells.forEach(cell => cell.cleanup?.()); cells = []; effects = []; currentKey = null; }
  t.after(() => { unmount(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const [component] = await importUiWithPorts(['src/components/additional-contribution/user-allocation-comparison.tsx'], {
    react: {
      useId: () => 'allocation-test',
      useState(initial) { const index = cursor++; cells[index] ??= { value: initial }; return [cells[index].value, value => { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value; }]; },
      useRef(initial) { const index = cursor++; cells[index] ??= { current: initial }; return cells[index]; },
      useEffect(callback, deps) { const index = cursor++, previous = cells[index]; if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) { const cell = cells[index] = { ...previous, deps }; effects.push(() => { cell.cleanup?.(); cell.cleanup = callback(); }); } },
    },
    '@/components/i18n/locale-provider': { useI18n: () => ({ locale: 'en', t: (_ko, en) => en }) },
  });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  return { storage, timers, unmount,
    render(props) {
      const outer = component.UserAllocationComparison(props);
      if (currentKey !== outer.key) { unmount(); currentKey = outer.key; }
      cursor = 0;
      const tree = outer.type(outer.props);
      effects.splice(0).forEach(effect => effect());
      return { tree, key: outer.key, inputs: nodes(tree).filter(node => node.type === 'input'), alerts: nodes(tree).filter(node => node.props?.role === 'alert') };
    },
    frame() { for (const [key, callback] of [...frames]) { frames.delete(key); callback(); } },
    expire() { for (const [key, timer] of [...timers]) { timers.delete(key); timer.callback(); } },
  };
}

test('public A/B drafts survive leaving and returning for 24 hours, without account storage', async t => {
  const h = await editorHarness(t), input = publicPlan('USD'), props = { basis: publicUserAllocationBasis(input), amount: '100', currency: 'USD', scope: 'public-plan', publicIdentity: publicUserAllocationIdentity(input) };
  let view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '12.34' } });
  view = h.render(props); assert.equal(view.inputs[0].props.value, '12.34');
  assert.ok([...h.storage.keys()].every(key => key.startsWith('cairn:public-user-allocation:')));
  h.unmount(); view = h.render(props); assert.equal(view.inputs[0].props.value, '');
  h.frame(); assert.equal(h.render(props).inputs[0].props.value, '12.34');
  for (const [key, raw] of h.storage) h.storage.set(key, JSON.stringify({ ...JSON.parse(raw), savedAt: Date.now() - 86_400_001 }));
  h.unmount(); h.render(props); h.frame(); assert.equal(h.render(props).inputs[0].props.value, '');
  assert.equal(h.storage.size, 0);
});

test('an open workspace removes its expired storage without clearing the visible inputs or renewing on rerender', async t => {
  let now = Date.parse('2026-11-05T00:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const h = await editorHarness(t), input = publicPlan('USD'), props = { basis: publicUserAllocationBasis(input), amount: '100', currency: 'USD', scope: 'public-plan', publicIdentity: publicUserAllocationIdentity(input) };
  let view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '25' } });
  view = h.render(props); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, USER_ALLOCATION_WORKSPACE_TTL);
  const storedAt = JSON.parse([...h.storage.values()][0]).savedAt;
  now += 1000; h.render(props); assert.equal(JSON.parse([...h.storage.values()][0]).savedAt, storedAt);
  now += USER_ALLOCATION_WORKSPACE_TTL; h.expire();
  assert.equal(h.storage.size, 0); view = h.render(props); assert.equal(view.inputs[0].props.value, '25');
  view.inputs[0].props.onChange({ target: { value: '30' } }); h.render(props);
  assert.equal(JSON.parse([...h.storage.values()][0]).savedAt, now); assert.equal(h.timers.size, 1);
});

test('an expired older editor cannot remove a newer edit stored under the same identity', async t => {
  let now = Date.parse('2026-11-05T00:00:00.000Z'); t.mock.method(Date, 'now', () => now);
  const h = await editorHarness(t), props = { basis: basis(), amount: '100', currency: 'KRW', scope: 'account:a', ownerKey: 'owner-a' };
  const view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '25' } }); h.render(props);
  const [key, raw] = [...h.storage.entries()][0], newer = { ...JSON.parse(raw), savedAt: now + 5000, a: { a: '30' } };
  h.storage.set(key, JSON.stringify(newer)); now += USER_ALLOCATION_WORKSPACE_TTL; h.expire();
  assert.deepEqual(JSON.parse(h.storage.get(key)), newer);
});

test('native A/B drafts remain separated by owner, account and currency while current prices can update', async t => {
  const h = await editorHarness(t), props = { basis: basis(), amount: '100', currency: 'KRW', scope: 'account:a', ownerKey: 'owner-a' };
  let view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '10' } });
  for (const changed of [{ currency: 'USD' }, { scope: 'account:b' }, { ownerKey: 'owner-b' }]) {
    view = h.render({ ...props, ...changed }); assert.equal(view.inputs[0].props.value, ''); h.frame();
    assert.equal(h.render({ ...props, ...changed }).inputs[0].props.value, '');
  }
  h.render(props); h.frame(); view = h.render(props); assert.equal(view.inputs[0].props.value, '10');
  const updated = structuredClone(props); updated.basis.rows[0].currentValueKrw += 100;
  assert.equal(h.render(updated).inputs[0].props.value, '10');
  const publicInput = publicPlan('KRW');
  view = h.render({ basis: publicUserAllocationBasis(publicInput), amount: '100', currency: 'KRW', scope: 'public-plan', publicIdentity: publicUserAllocationIdentity(publicInput) });
  h.frame(); assert.equal(view.inputs[0].props.value, '');
});

test('a late draft restoration cannot overwrite typing made before the next animation frame', async t => {
  const h = await editorHarness(t), props = { basis: basis(), amount: '100', currency: 'KRW', scope: 'account:a', ownerKey: 'owner-a' };
  let view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '42' } });
  h.unmount(); view = h.render(props); view.inputs[0].props.onChange({ target: { value: '20' } });
  h.frame(); assert.equal(h.render(props).inputs[0].props.value, '20');
  assert.equal(JSON.parse([...h.storage.values()][0]).a.a, '20');
});

test('a restored nonbuyable allocation remains editable so its inline error can be corrected', async t => {
  const h = await editorHarness(t), props = { basis: basis(), amount: '100', currency: 'KRW', scope: 'account:a', ownerKey: 'owner-a' };
  let view = h.render(props); h.frame(); view.inputs[0].props.onChange({ target: { value: '10' } });
  props.basis.rows[0].buyable = false;
  h.unmount(); h.render(props); h.frame(); view = h.render(props);
  assert.equal(view.inputs[0].props.value, '10'); assert.equal(view.inputs[0].props['aria-invalid'], true);
  assert.notEqual(view.inputs[0].props.disabled, true); assert.ok(view.alerts.length > 0);
  view.inputs[0].props.onChange({ target: { value: '' } });
  view = h.render(props); assert.equal(view.inputs[0].props.value, ''); assert.equal(view.alerts.length, 0);
});
