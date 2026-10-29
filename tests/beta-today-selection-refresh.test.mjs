import assert from 'node:assert/strict';
import { it } from 'node:test';
import { importUiWithPorts } from './helpers/import-ui-with-ports.mjs';

it('retains Today selection across quote reads while using fresh rows and guarding scope/access', async () => {
  let selection = null;
  const [ui] = await importUiWithPorts(['src/components/cairn-v2/today-detail.tsx'], {
    react: { useId: () => 'selection-test', useState: () => [selection, value => { selection = value; }] },
    'next/link': { default: () => null },
    '@/components/cairn-v2/beta-provider': { useBetaReadFreshness: () => null },
    '@/lib/cairn-v2/read-contract': { displayReadMoney: (_view, value) => String(value) },
    '@/lib/cairn-v2/read-display': { movementDisplay: () => ({ message: null }) },
  });
  const row = (key, changeKrw) => ({ key, name: key, ticker: key, accountLabel: 'QA', market: 'us', changeKrw, returnPct: 10, previousValueKrw: 100 });
  const context = { mode: 'domain', scope: 'account:qa', currency: 'KRW' };
  const view = { asOf: '2026-10-29T07:00:00Z', domain: { state: 'ready', moneyBasis: { dashboard: {} }, currentHoldingMovement: { rows: [row('AAA', 30), row('BBB', 10)], exclusions: [] } } };
  const elements = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)];
  const render = (v = view, c = context) => elements(ui.TodayDetail({ view: v, context: c }));
  const active = tree => tree.find(element => element.type === 'button' && element.props['aria-pressed'])?.props['aria-label'];
  render().find(element => element.type === 'button' && element.props['aria-label']?.startsWith('BBB ')).props.onClick();
  assert.match(active(render()), /^BBB /);
  const updated = { ...view, asOf: '2026-10-29T07:05:00Z', domain: { ...view.domain, currentHoldingMovement: { rows: [row('AAA', 80), row('BBB', 25)], exclusions: [] } } };
  assert.match(active(render(updated)), /^BBB .*25 KRW/, 'New observation must retain identity and display its new value');
  assert.match(active(render(updated, { ...context, scope: 'account:other' })), /^AAA /, 'Scope change must reset selection');
  assert.match(active(render(updated, { ...context, currency: 'USD' })), /^AAA /, 'Currency change must reset selection');
  const removed = { ...updated, domain: { ...updated.domain, currentHoldingMovement: { rows: [row('AAA', 80)], exclusions: [] } } };
  assert.match(active(render(removed)), /^AAA /, 'Removed holding must not reuse stale selected evidence');
  assert.equal(active(render({ ...updated, domain: { ...updated.domain, state: 'unauthorized' } })), undefined);
});
