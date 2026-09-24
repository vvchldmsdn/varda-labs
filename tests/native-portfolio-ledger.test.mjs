import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Decimal } from '../src/lib/money.ts';
import { fxFactor } from '../src/lib/currency-valuation.ts';
import { createNativePortfolioState, applyNativeEvent, nativeCostAmounts, resolveNativeTrade, nativeDateOnlyAt } from '../src/lib/native-portfolio-ledger.ts';

const at = '2026-09-01T00:00:00Z';
const later = '2026-09-02T00:00:00Z';
const lot = (amount = '1000') => ({ amount, currency: 'USD', at, source: 'test acquisition', remaining: { n: '1', d: '1' } });
function opening(overrides = {}) {
  const result = createNativePortfolioState({ accountId: 'account-one', at, cash: { KRW: '0', USD: '0' }, positions: [], ...overrides });
  assert.equal(result.ok, true, result.reason); return result.state;
}
function event(state, operation) {
  return { id: `event-${state.sequence + 1}`, sequence: state.sequence + 1, at: later, source: 'actual test execution', ...operation };
}
function run(state, operation) {
  const before = structuredClone(state), result = applyNativeEvent(state, event(state, operation));
  assert.deepEqual(state, before, 'the input state must never mutate');
  assert.equal(result.ok, true, result.reason); return result;
}
function reject(state, operation, reason) {
  const before = structuredClone(state), result = applyNativeEvent(state, event(state, operation));
  assert.equal(result.ok, false); if (reason) assert.equal(result.reason, reason);
  assert.deepEqual(state, before); return result;
}
function totalCost(lots) {
  return nativeCostAmounts(lots).reduce((sum, component) => sum.add(component.amount), Decimal.from(0));
}
function scenario() {
  let state = opening();
  const legs = [];
  let sale;
  for (const operation of [
    { type: 'deposit', amount: '2000', currency: 'USD' },
    { type: 'buy', assetId: 'actual-us-stock', quantity: '10', price: '100', currency: 'USD', fee: { amount: '2', currency: 'USD' } },
    { type: 'sell', assetId: 'actual-us-stock', quantity: '4', price: '110', currency: 'USD', fee: { amount: '1', currency: 'USD' } },
    { type: 'withdraw', amount: '200', currency: 'USD' },
  ]) {
    const result = run(state, operation); state = result.next; legs.push(...result.cashLegs);
    if (result.realized) sale = result.realized;
  }
  return { state, legs, sale };
}

it('reconciles deposit, buy, partial sale, fees and withdrawal to USD 1,897 and profit 97', () => {
  const { state, legs, sale } = scenario();
  assert.equal(state.cash.USD, '1237'); assert.equal(state.positions[0].quantity, '6');
  assert.equal(totalCost(state.positions[0].costLots).compare(600), 0);
  assert.deepEqual(state.positions[0].costLots[0].remaining, { n: '3', d: '5' });
  assert.equal(totalCost(sale.disposedCostLots).compare(400), 0);
  assert.equal(sale.proceeds.amount, '440');
  const value = Decimal.from(state.cash.USD).add(Decimal.from(state.positions[0].quantity).mul(110));
  const external = legs.filter(row => row.kind === 'external').reduce((sum, row) => sum.add(row.delta), Decimal.from(0));
  assert.equal(value.compare(1897), 0); assert.equal(external.compare(1800), 0); assert.equal(value.sub(external).compare(97), 0);
  assert.deepEqual(legs.filter(row => row.kind === 'fee').map(row => row.delta), ['-2', '-1']);
  assert.equal(Decimal.from(440).sub(400).add(660).sub(600).sub(3).compare(97), 0);
});

it('uses original-dated FX for external flows; reporting currency can reverse the gain', () => {
  const { state } = scenario();
  const fx = [
    { base: 'USD', quote: 'KRW', rate: '1400', observedAt: at, fetchedAt: at, source: 'test', kind: 'synthetic' },
    { base: 'USD', quote: 'KRW', rate: '1260', observedAt: later, fetchedAt: later, source: 'test', kind: 'synthetic' },
  ];
  const first = fxFactor('USD', 'KRW', at, fx, 0), last = fxFactor('USD', 'KRW', later, fx, 0);
  assert.equal(first.ok, true); assert.equal(last.ok, true);
  const nativeTotal = Decimal.from(state.cash.USD).add(660);
  const total = nativeTotal.mul(last.value);
  const external = Decimal.from(2000).mul(first.value).sub(Decimal.from(200).mul(last.value));
  assert.equal(total.compare(2390220), 0); assert.equal(external.compare(2548000), 0);
  assert.equal(total.sub(external).compare(-157780), 0);
  assert.equal(nativeTotal.sub(1800).compare(97), 0);
});

it('disposes all cost lots proportionally and preserves repeating fractions through JSON', () => {
  let state = opening({ cash: { KRW: '0', USD: '1000' } });
  state = run(state, { type: 'buy', assetId: 'a', quantity: '2', price: '100', currency: 'USD' }).next;
  state = run(state, { type: 'buy', assetId: 'a', quantity: '1', price: '200', currency: 'USD' }).next;
  const sold = run(state, { type: 'sell', assetId: 'a', quantity: '1', price: '150', currency: 'USD' });
  const restored = JSON.parse(JSON.stringify(sold.next));
  assert.deepEqual(restored.positions[0].costLots.map(row => row.remaining), [{ n: '2', d: '3' }, { n: '2', d: '3' }]);
  assert.equal(totalCost(restored.positions[0].costLots).compare(Decimal.from(800).div(3)), 0);
  assert.equal(totalCost(sold.realized.disposedCostLots).compare(Decimal.from(400).div(3)), 0);
  assert.equal(totalCost(restored.positions[0].costLots).add(totalCost(sold.realized.disposedCostLots)).compare(400), 0);
});

it('retains unknown cost through purchases and partial sales; full disposal ends the old basis', () => {
  let state = opening({ cash: { KRW: '0', USD: '1000' }, positions: [{ assetId: 'a', currency: 'USD', quantity: '2', costLots: null }] });
  state = run(state, { type: 'buy', assetId: 'a', currency: 'USD', quantity: '1', price: '100' }).next;
  assert.equal(state.positions[0].costLots, null);
  let sold = run(state, { type: 'sell', assetId: 'a', currency: 'USD', quantity: '1', price: '110' });
  assert.equal(sold.realized.disposedCostLots, null); assert.equal(sold.next.positions[0].costLots, null);
  sold = run(sold.next, { type: 'sell', assetId: 'a', currency: 'USD', quantity: '2', price: '110' });
  assert.deepEqual(sold.next.positions[0].costLots, []); assert.equal(sold.next.positions[0].quantity, '0');
  state = run(sold.next, { type: 'buy', assetId: 'a', currency: 'USD', quantity: '1', price: '105' }).next;
  assert.equal(totalCost(state.positions[0].costLots).compare(105), 0);
});

it('accepts explicit dated cost only for an unknown current basis without rewriting history', () => {
  const state = opening({ positions: [{ assetId: 'a', currency: 'USD', quantity: '10', costLots: null }] });
  const filled = run(state, { type: 'cost_basis', assetId: 'a', costLots: [lot()] });
  assert.equal(state.positions[0].costLots, null); assert.equal(filled.next.positions[0].costLots[0].at, at);
  assert.deepEqual(filled.cashLegs, []); assert.equal(filled.quantityDelta, null);
  reject(filled.next, { type: 'cost_basis', assetId: 'a', costLots: [lot('900')] }, 'cost_basis_already_known');
  reject(state, { type: 'cost_basis', assetId: 'a', costLots: [{ ...lot(), at: '2026-09-03T00:00:00Z' }] }, 'future_cost_evidence');
  reject(state, { type: 'cost_basis', assetId: 'a', costLots: [] }, 'invalid_cost_lots');
  reject(state, { type: 'cost_basis', assetId: 'a', costLots: null }, 'invalid_cost_lots');
});

it('applies explicit splits once to actual quantity and preserves exact costs', () => {
  const state = opening({ positions: [{ assetId: 'a', currency: 'USD', quantity: '6', costLots: [lot('600')] }] });
  const split = run(state, { type: 'split', assetId: 'a', ratio: { n: '2', d: '1' } });
  assert.equal(split.next.positions[0].quantity, '12'); assert.equal(split.quantityDelta.quantity, '6');
  assert.deepEqual(split.next.positions[0].costLots, state.positions[0].costLots); assert.deepEqual(split.cashLegs, []);
  reject(state, { type: 'split', assetId: 'a', ratio: { n: '1', d: '7' } });
  reject(state, { type: 'split', assetId: 'a', ratio: { n: '1', d: '1' } }, 'invalid_split_ratio');
});

it('uses both actual exchange legs and an independent fee without inventing FX or external flows', () => {
  const state = opening({ cash: { KRW: '0', USD: '200' } });
  const result = run(state, { type: 'exchange', debit: { amount: '100', currency: 'USD' }, credit: { amount: '140000', currency: 'KRW' }, fee: { amount: '100', currency: 'KRW' } });
  assert.deepEqual(result.next.cash, { KRW: '139900', USD: '100' });
  assert.deepEqual(result.cashLegs.map(row => row.kind), ['exchange', 'exchange', 'fee']);
  reject(state, { type: 'exchange', debit: { amount: '100', currency: 'USD' }, credit: { amount: '100', currency: 'USD' } }, 'exchange_requires_two_currencies');
  reject(state, { type: 'exchange', debit: { amount: '300', currency: 'USD' }, credit: { amount: '1', currency: 'KRW' } }, 'insufficient_cash');
});

it('pairs owned-account transfer legs without treating them as portfolio external capital', () => {
  const first = opening({ cash: { KRW: '0', USD: '300' } }), second = opening({ accountId: 'account-two' });
  const debit = run(first, { type: 'transfer', direction: 'out', amount: '200', currency: 'USD', transferId: 't', peerAccountId: second.accountId });
  const credit = run(second, { type: 'transfer', direction: 'in', amount: '200', currency: 'USD', transferId: 't', peerAccountId: first.accountId });
  assert.equal(Decimal.from(debit.next.cash.USD).add(credit.next.cash.USD).compare(300), 0);
  assert.deepEqual([...debit.cashLegs, ...credit.cashLegs].map(row => row.kind), ['transfer', 'transfer']);
  reject(first, { type: 'transfer', direction: 'out', amount: '200', currency: 'USD', transferId: 't', peerAccountId: first.accountId }, 'invalid_transfer');
});

it('records dividends and fees as cash changes without quantity or cost changes', () => {
  const state = opening({ positions: [{ assetId: 'a', currency: 'USD', quantity: '1', costLots: [lot('100')] }] });
  const dividend = run(state, { type: 'dividend', assetId: 'a', amount: '2.25', currency: 'USD' });
  const fee = run(dividend.next, { type: 'fee', amount: '0.15', currency: 'USD' });
  assert.equal(fee.next.cash.USD, '2.1'); assert.deepEqual(fee.next.positions, state.positions);
  assert.equal(dividend.cashLegs[0].kind, 'income'); assert.equal(fee.cashLegs[0].kind, 'fee');
});

it('rejects invalid sequence, dates, currency, settlement precision, cash and quantity atomically', () => {
  const state = opening({ cash: { KRW: '1000', USD: '1000' }, positions: [{ assetId: 'a', currency: 'USD', quantity: '1', costLots: [lot('100')] }] });
  const deposit = { type: 'deposit', amount: '1', currency: 'USD' };
  for (const sequence of [0, 2, 1.1, Number.MAX_SAFE_INTEGER + 1]) reject(state, { ...deposit, sequence }, 'event_sequence_mismatch');
  reject(state, { ...deposit, at: '2026-08-31T00:00:00Z' }, 'event_time_order_invalid');
  reject(state, { ...deposit, at: '2999-01-01T00:00:00Z' }, 'invalid_event_time');
  for (const invalidAt of ['2026-09-02', '2026-09-02T00:00:00', '2026-02-30T00:00:00Z']) reject(state, { ...deposit, at: invalidAt }, 'invalid_event_time');
  for (const amount of ['-1', 'NaN', 'Infinity', '1e3', '0', '0.001', '9007199254740992']) reject(state, { ...deposit, amount });
  reject(state, { ...deposit, currency: 'EUR' });
  reject(state, { type: 'withdraw', amount: '1000.01', currency: 'USD' }, 'insufficient_cash');
  const trade = { type: 'buy', assetId: 'a', currency: 'USD', quantity: '1', price: '100' };
  reject(state, { ...trade, quantity: '0.0000001' }, 'invalid_quantity');
  reject(state, { ...trade, quantity: '0.000001', price: '100' }, 'invalid_minor_unit');
  reject(state, { ...trade, currency: 'KRW' }, 'instrument_currency_mismatch');
  reject(state, { ...trade, type: 'sell', quantity: '2' }, 'insufficient_quantity');
  reject(state, { ...trade, fee: { amount: '1000', currency: 'USD' } }, 'insufficient_cash');
  reject(state, { type: 'made_up_event' }, 'unsupported_event');
});

it('requires explicit complete openings, unique positions and bounded valid cost evidence', () => {
  const input = { accountId: 'a', at, cash: { KRW: '0', USD: '0' }, positions: [{ assetId: 'x', currency: 'USD', quantity: '1', costLots: [lot()] }] };
  const before = structuredClone(input); assert.equal(createNativePortfolioState(input).ok, true); assert.deepEqual(input, before);
  for (const override of [
    { cash: { USD: '0' } }, { positions: [...input.positions, ...input.positions] },
    { positions: [{ ...input.positions[0], costLots: [] }] },
    { positions: [{ ...input.positions[0], quantity: '0' }] },
    { positions: [{ ...input.positions[0], costLots: [{ ...lot(), at: later }] }] },
    ...[{ n: '0', d: '1' }, { n: '2', d: '1' }, { n: '1', d: '0' }, { n: '1', d: '9'.repeat(101) }].map(remaining => ({ positions: [{ ...input.positions[0], costLots: [{ ...lot(), remaining }] }] })),
  ]) assert.equal(createNativePortfolioState({ ...input, ...override }).ok, false);
});


it('preserves a KRW fractional US execution without manufacturing USD cash or price', () => {
  const state = opening({ cash: { KRW: '500000', USD: '12.34' } });
  const result = run(state, { type: 'buy', assetId: 'fractional', currency: 'USD', quantity: '0.411494', settlement: { amount: '420000', currency: 'KRW' } });
  assert.deepEqual(result.next.cash, { KRW: '80000', USD: '12.34' });
  assert.equal(result.next.positions[0].quantity, '0.411494');
  assert.equal(result.execution.average, null);
  assert.equal(result.execution.executionUnitPrice, null);
  assert.equal(result.execution.fee, null);
  assert.deepEqual(result.next.positions[0].costLots[0], { amount: '420000', currency: 'KRW', at: later, source: 'actual test execution', remaining: { n: '1', d: '1' } });
  const sale = run(result.next, { type: 'sell', assetId: 'fractional', currency: 'USD', quantity: '0.411494', settlement: { amount: '410000', currency: 'KRW' }, fee: { amount: '0', currency: 'KRW' } });
  assert.equal(sale.next.positions[0].quantity, '0');
  assert.equal(sale.next.cash.USD, '12.34');
  assert.equal(sale.realized.proceeds.amount, '410000');
  assert.equal(sale.execution.fee.amount, '0');
});
for (const [quantity, amount, order, expected, currency] of [['42','1422.12','33.81','33.86','USD'], ['27','2900610','106500','107430','KRW'], ['7','606.69','86.68','86.67','USD']]) {
  it(`uses execution total instead of order reference (${quantity} shares)`, () => {
    const result = resolveNativeTrade({ type:'buy',assetId:'test',currency,quantity,settlement:{amount,currency},orderUnitPrice:{amount:order,currency} });
    assert.equal(Decimal.from(result.average.n).div(result.average.d).compare(expected),0);
    assert.equal(result.average.source,'derived_execution_average');
    assert.equal(result.settlement.amount,amount);
  });
}
it('rejects contradictory totals, fractional cents and excessive quantity precision', () => {
  const state=opening({cash:{KRW:'1000000',USD:'1000'}});
  reject(state,{type:'buy',assetId:'x',currency:'USD',quantity:'1',price:'100',settlement:{amount:'99',currency:'USD'}},'execution_evidence_conflict');
  reject(state,{type:'buy',assetId:'x',currency:'USD',quantity:'0.1234567',settlement:{amount:'10',currency:'USD'}},'invalid_quantity');
  assert.throws(()=>resolveNativeTrade({type:'buy',assetId:'x',currency:'USD',quantity:'1',settlement:{amount:'1.001',currency:'USD'}}));
});
it('preserves a date-only trade and its explicit service-day midpoint policy in the original cost', () => {
  const state=opening({cash:{KRW:'0',USD:'100'}});
  const dateEvidence={precision:'date_only',reportedDate:'2026-09-02',timeZone:'Asia/Seoul',policy:'service_day_midpoint'};
  const result=run(state,{type:'buy',assetId:'x',currency:'USD',quantity:'1',settlement:{amount:'10',currency:'USD'},at:nativeDateOnlyAt(dateEvidence.reportedDate),dateEvidence});
  assert.deepEqual(result.next.positions[0].costLots[0].dateEvidence,dateEvidence);
  reject(state,{type:'buy',assetId:'x',currency:'USD',quantity:'1',price:'10',at:later,dateEvidence},'invalid_trade_date');
});
