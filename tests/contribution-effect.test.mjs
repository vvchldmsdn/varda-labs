import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { evaluateContributionEffect, eligibleEffectTrade } from '../src/lib/contribution-effect.ts';
import { contributionEffectPreview } from '../src/lib/contribution-effect-preview.ts';

function fixture() {
  const at = '2026-10-01T00:00:00Z', asOf = '2026-10-20T00:00:00Z';
  const quotes = [{ key: 'a', assetId: 'a', price: '100', currency: 'KRW', source: 'test', basis: 'raw', at }];
  const comparison = { budget: 1000, funding: 'KRW', basis: { asOf: at, usdKrw: 1300, rows: [{ allocationKey: 'a', metadata: { currency: 'KRW' } }] }, ratio: { amounts: { a: 1000 }, cash: 0 }, aligned: { amounts: { a: 1000 }, cash: 0 }, adjusted: { amounts: { a: 500 }, cash: 500 } };
  const saved = { id: 's', createdAt: at, revision: 0, tradeIds: ['buy'], document: { version: 'contribution_effect_v1', accountId: 'account', capturedAt: at, comparison, quotes } };
  const market = { asOf, quotes: quotes.map(q => ({ ...q, at: asOf })), fx: [], complete: true, maxFxAgeMs: 3 * 86400000 };
  const trades = [{ id: 'buy', accountId: 'account', assetId: 'a', type: 'buy', at: '2026-10-02T00:00:00Z', quantity: '5', price: '100', currency: 'KRW' }];
  return { saved, market, trades };
}
test('unchanged prices: a purchase is principal, never profit', () => {
  const { saved, market, trades } = fixture(), result = evaluateContributionEffect(saved, market, trades);
  assert.equal(result.status, 'ready'); assert.equal(result.gap, 0);
  assert.equal(result.actual.status, 'ready'); assert.equal(result.actual.profit, 0);
  assert.equal(result.actual.total, 1000); assert.equal(result.actual.remainingBudgetValue, 500);
});
test('down/up markets count withheld budget, never promise an advantage', () => {
  const { saved, market, trades } = fixture();
  for (const [price, gap, profit] of [['80',100,-100],['120',-100,100]]) {
    market.quotes[0].price = price;
    const r = evaluateContributionEffect(saved, market, trades);
    assert.equal(r.gap, gap); assert.equal(r.actual.profit, profit);
    assert.equal(r.gap, r.alignmentEffect + r.adjustmentEffect);
  }
});
test('explicit links only; cancelled trades and foreign accounts cannot be attributed', () => {
  const f = fixture(); f.saved.tradeIds = [];
  assert.equal(evaluateContributionEffect(f.saved, f.market, f.trades).actual.reason, 'trades_not_linked');
  f.saved.tradeIds = ['missing']; assert.equal(evaluateContributionEffect(f.saved, f.market, f.trades).actual.reason, 'trade_unavailable');
  assert.equal(eligibleEffectTrade(f.saved.document, { ...f.trades[0], accountId: 'other' }), false);
  assert.equal(eligibleEffectTrade(f.saved.document, { ...f.trades[0], at: '2026-09-30T00:00:00Z' }), false);
  assert.equal(eligibleEffectTrade(f.saved.document, { ...f.trades[0], at: f.saved.createdAt, dateOnly: true }), false);
});
test('sale/split cannot turn removed shares into losses or keep a fictional holding', () => {
  const f = fixture(), disposal = { ...f.trades[0], id: 'sale', type: 'sell', at: '2026-10-03T00:00:00Z' };
  assert.equal(evaluateContributionEffect(f.saved, f.market, [...f.trades, disposal]).actual.reason, 'subsequent_disposal');
  assert.equal(evaluateContributionEffect(f.saved, f.market, [{ ...disposal, type: 'split' }]).reason, 'split_requires_rebase');
});
test('partial fills retain budget; duplicate and over-budget links fail closed', () => {
  const f = fixture(); f.trades[0].quantity = '0.123456';
  const r = evaluateContributionEffect(f.saved, f.market, f.trades); assert.equal(r.actual.total,1000); assert.equal(r.actual.profit,0);
  f.saved.tradeIds.push('buy'); assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).actual.reason,'duplicate_trade');
  f.saved.tradeIds=['buy'];f.trades[0].quantity='11';assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).actual.reason,'budget_exceeded');
});
test('missing, stale, future and conflicting prices are not filled with zero', () => {
  const f=fixture();
  assert.equal(evaluateContributionEffect(f.saved,{...f.market,quotes:[]},f.trades).reason,'quote_unavailable');
  assert.equal(evaluateContributionEffect(f.saved,{...f.market,quotes:f.saved.document.quotes},f.trades).reason,'quote_unavailable');
  assert.equal(evaluateContributionEffect(f.saved,{...f.market,quotes:[{...f.market.quotes[0],at:'2026-10-21T00:00:00Z'}]},f.trades).reason,'quote_unavailable');
  assert.equal(evaluateContributionEffect(f.saved,{...f.market,quotes:[...f.market.quotes,...f.market.quotes]},f.trades).reason,'quote_conflict');
});
test('malformed and future snapshot evidence is blocked', () => {
 const f=fixture();f.market.quotes[0].at='invalid';assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).reason,'quote_unavailable');
 f.saved.document.comparison.basis.asOf='2026-10-30T00:00:00Z';assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).reason,'invalid_snapshot');
});

test('USD cash and investments share FX; absent execution FX stays unverified', () => {
  const f=fixture();f.saved.document.comparison.budget=1300;f.saved.document.comparison.funding='USD';
  for(const key of ['ratio','aligned','adjusted']) f.saved.document.comparison[key]={amounts:{a:650},cash:650};
  f.saved.document.quotes[0].currency='USD';f.saved.document.quotes[0].price='1';
  f.market.quotes[0]={...f.saved.document.quotes[0],at:f.market.asOf};
  f.trades[0]={...f.trades[0],currency:'USD',price:'1',quantity:'0.5'};
  const fx=at=>({base:'USD',quote:'KRW',rate:'1430',observedAt:at,fetchedAt:at,source:'test',kind:'spot'});
  f.market.fx=[fx(f.market.asOf)];
  let r=evaluateContributionEffect(f.saved,f.market,f.trades);assert.equal(r.ratio,1430);assert.equal(r.gap,0);
  assert.notEqual(r.actual?.status,'ready');
  f.market.fx.push(fx(f.trades[0].at));r=evaluateContributionEffect(f.saved,f.market,f.trades);assert.equal(r.actual.total,1430);assert.equal(r.actual.profit,130);
  f.trades[0].dateOnly=true;assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).actual.reason,'execution_fx_missing');
  f.market.fx=f.market.fx.map(row=>({...row,kind:'daily_reference'}));assert.equal(evaluateContributionEffect(f.saved,f.market,f.trades).actual.status,'ready');
});
test('preview uses the real evaluator and keeps the frozen snapshot unchanged', () => {
  const p=contributionEffectPreview();assert.equal(p.result.status,'ready');assert.equal(p.result.actual.status,'ready');assert.equal(p.result.gap,56800);
  const f=fixture(), before=JSON.stringify(f.saved);evaluateContributionEffect(f.saved,f.market,f.trades);assert.equal(JSON.stringify(f.saved),before);
});
test('tracking migration enforces tenant and account ownership with RLS', async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role varda_tenant_app; create table app_users(id uuid primary key);create table accounts(id uuid primary key,canonical_owner_user_id uuid,is_active boolean);create function investment_plan_tenant_active() returns boolean language sql as 'select true';grant select on accounts to varda_tenant_app;`);
    await db.exec(readFileSync('drizzle/0064_contribution_effects.sql','utf8'));
    const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
    await db.exec(`insert into app_users values('${a}'),('${b}');insert into accounts values('${a}','${a}',true),('${b}','${b}',true);set role varda_tenant_app;select set_config('app.current_user_id','${a}',false);`);
    const doc=id=>JSON.stringify({version:'contribution_effect_v1',accountId:id});
    await db.query('insert into contribution_effects(owner_user_id,id,account_id,document) values($1,$1,$1,$2)',[a,doc(a)]);
    await assert.rejects(db.query('insert into contribution_effects(owner_user_id,id,account_id,document) values($1,$2,$2,$3)',[a,b,doc(b)]),/row-level security/);
    await assert.rejects(db.query('update contribution_effects set document=document || $1::jsonb', [JSON.stringify({changed:true})]),/immutable/);
    await db.query('update contribution_effects set trade_ids=$1::jsonb,revision=revision+1',[JSON.stringify([b])]);
    await db.query("select set_config('app.current_user_id',$1,false)",[b]);
    assert.equal((await db.query('select * from contribution_effects')).rows.length,0);
    assert.equal((await db.query('update contribution_effects set revision=revision+1 returning id')).rows.length,0);
  } finally { await db.close(); }
});
