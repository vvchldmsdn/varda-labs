import assert from 'node:assert/strict';
import { it } from 'node:test';
import { reconcileBrokerCash } from '../scripts/lib/broker-cash-reconciliation.ts';

const row = (id, kind, amount, balance, date = '2026-01-05') => ({ id, kind, amount, balance, date, currency: 'USD', evidence: ['synthetic-statement'] });
function fixture() {
  return { currency: 'USD', expectedClosing: '25.20', rows: [
    row('a', 'deposit', '100', '110'),
    row('b', 'buy_settlement', '80.40', '29.60'),
    row('securities', 'security_delivery', '0', '0'),
    row('c', 'sell_settlement', '20.60', '50.20', '2026-01-06'),
    row('d', 'withdrawal', '25', '25.20', '2026-01-06'),
  ], links: [
    { rowId: 'b', tradeId: 'buy', ticker: 'TEST', tradeDate: '2026-01-02', side: 'buy', quantity: '0.2', confirmed: true, executionGross: { amount: '80', currency: 'USD' } },
    { rowId: 'c', tradeId: 'sell', ticker: 'TEST', tradeDate: '2026-01-05', side: 'sell', quantity: '0.05', confirmed: true },
  ] };
}
it('reconciles exact cash without treating deposits as return or securities delivery as zero cash', () => {
  const input = fixture(), before = structuredClone(input), result = reconcileBrokerCash(input);
  assert.equal(result.opening.amount, '10');
  assert.equal(result.opening.beforeDate, '2026-01-05');
  assert.equal(result.closing, '25.2');
  assert.equal(result.externalNet, '75');
  assert.equal(result.tradeNet, '-59.8');
  assert.equal(result.daily['2026-01-05'].closing, '29.6');
  assert.equal(result.securityRowsIgnored, 1);
  assert.equal(result.nativeReplayReady, false);
  assert.deepEqual(input, before);
});
it('keeps trade date distinct from cash date and does not classify unexplained charges', () => {
  const result = reconcileBrokerCash(fixture());
  assert.equal(result.matched[0].tradeDate, '2026-01-02');
  assert.equal(result.matched[0].settlementDate, '2026-01-05');
  assert.equal(result.matched[0].grossToNetDifference, '0.4');
  assert.equal(result.matched[0].chargeClassification, 'unconfirmed');
  assert.equal(result.matched[1].grossToNetDifference, null);
});
it('deduplicates explicitly identified overlapping rows and retains both evidence references', () => {
  const input = fixture();
  input.rows.push({ ...input.rows[1], evidence: ['overlapping-image'] });
  const result = reconcileBrokerCash(input);
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.cashRowCount, 4);
  assert.deepEqual(result.uniqueRows[1].evidence, ['synthetic-statement', 'overlapping-image']);
});
it('rejects conflicting copies instead of choosing one', () => {
  const input = fixture(); input.rows.push({ ...input.rows[1], amount: '80.41' });
  assert.throws(() => reconcileBrokerCash(input), /statement_duplicate_conflict/);
});
it('does not deduplicate distinct transactions with identical amounts', () => {
  const input = { currency: 'USD', expectedClosing: '20', links: [], rows: [row('first', 'deposit', '10', '10'), row('second', 'deposit', '10', '20')] };
  const result = reconcileBrokerCash(input);
  assert.equal(result.duplicateRows, 0); assert.equal(result.cashRowCount, 2);
});
for (const [name, mutate, error] of [
  ['missing row', input => input.rows.splice(1, 1), /statement_balance_break/],
  ['closing mismatch', input => input.expectedClosing = '25.21', /statement_closing_mismatch/],
  ['wrong order', input => input.rows.reverse(), /statement_order_invalid/],
  ['mixed currency', input => input.rows[0].currency = 'KRW', /mixed_statement_currency/],
  ['fractional cent', input => input.rows[0].amount = '100.001', /invalid_minor_unit/],
  ['unconfirmed link', input => input.links[0].confirmed = false, /trade_link_unconfirmed/],
  ['duplicate trade', input => input.links.push(input.links[0]), /trade_link_duplicate/],
  ['wrong side', input => input.links[0].side = 'sell', /trade_link_side_mismatch/],
  ['future trade', input => input.links[0].tradeDate = '2026-01-10', /settlement_precedes_trade/],
  ['invalid date', input => input.rows[0].date = '2026-02-30', /invalid_statement_date/],
  ['nonzero securities amount', input => input.rows[2].amount = '1', /invalid_statement_cash_leg/],
  ['missing evidence', input => input.rows[0].evidence = [], /statement_evidence_missing/],
]) it(`rejects ${name}`, () => { const input = fixture(); mutate(input); assert.throws(() => reconcileBrokerCash(input), error); });
it('does not turn original KRW display into USD execution or FX evidence', () => {
  const input = fixture(); delete input.links[0].executionGross;
  input.links[0].originalDisplay = { amount: '110000', currency: 'KRW' };
  const result = reconcileBrokerCash(input);
  assert.equal(result.matched[0].grossToNetDifference, null);
  assert.equal(result.matched[0].executionGross, undefined);
  assert.deepEqual(result.matched[0].originalDisplay, input.links[0].originalDisplay);
});
it('leaves unlinked trades visible even when cash reconciles', () => {
  const input = fixture(); input.links = [];
  assert.deepEqual(reconcileBrokerCash(input).unlinkedTradeRows, ['b', 'c']);
});
it('rejects a negative opening rather than inserting a balancing deposit', () => {
  const input = { currency: 'USD', expectedClosing: '10', links: [], rows: [row('a', 'deposit', '20', '10')] };
  assert.throws(() => reconcileBrokerCash(input), /statement_negative_opening/);
});
