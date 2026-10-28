import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { SAVE_EFFECT_SQL, LINK_EFFECT_SQL } from '../src/db/contribution-effect-sql.ts';

test('actual storage SQL rejects stale basis, duplicate attribution and revision races', async () => {
  const db = new PGlite();
  const owner='11111111-1111-4111-8111-111111111111', account='22222222-2222-4222-8222-222222222222', one='33333333-3333-4333-8333-333333333333', two='44444444-4444-4444-8444-444444444444', trade='55555555-5555-4555-8555-555555555555';
  const policy={revision:1,universeHash:'u',vectorHash:'v',version:'v1'};
  try {
    await db.exec(`create role varda_tenant_app;create table app_users(id uuid primary key);create table accounts(id uuid primary key,canonical_owner_user_id uuid,is_active boolean,native_state jsonb);create function investment_plan_tenant_active() returns boolean language sql as 'select true';
    create table portfolio_target_policy_revisions(lifecycle_status text,scope_kind text,scope_account_id uuid,approval_revision int,universe_hash text,vector_hash text,policy_version text);
    create table effective_native_ledger_entries(id uuid,canonical_owner_user_id uuid,account_id uuid);
    create table native_ledger_revisions(account_id uuid,canonical_owner_user_id uuid,marker_sequence int);
    create table assets(id uuid,account_id uuid,canonical_owner_user_id uuid,quantity numeric,currency text,archived_at timestamptz,name text,ticker text,market text,asset_type text);
    grant select on accounts,portfolio_target_policy_revisions,effective_native_ledger_entries,native_ledger_revisions,assets to varda_tenant_app;`);
    await db.exec(readFileSync('drizzle/0064_contribution_effects.sql','utf8'));
    await db.query('insert into app_users values($1)',[owner]);
    await db.query('insert into accounts values($1,$2,true,$3)',[account,owner,JSON.stringify({sequence:7})]);
    await db.query("insert into portfolio_target_policy_revisions values('approved','account',$1,1,'u','v','v1')",[account]);
    await db.query('insert into effective_native_ledger_entries values($1,$2,$3)',[trade,owner,account]);
    await db.exec('set role varda_tenant_app');await db.query("select set_config('app.current_user_id',$1,false)",[owner]);
    const save=(id,sequence=7,p=policy,guard={revision:0,assets:[]})=>db.query(SAVE_EFFECT_SQL,[owner,id,account,JSON.stringify({version:'contribution_effect_v1',accountId:account}),JSON.stringify({[account]:sequence}),JSON.stringify(p),JSON.stringify(guard)]);
    assert.equal((await save(one,6)).rows.length,0);
    assert.equal((await save(one,7,{...policy,revision:2})).rows.length,0);
    assert.equal((await save(one,7,policy,{revision:1,assets:[]})).rows.length,0);
    assert.equal((await save(one,7,policy,{revision:0,assets:[{id:trade}]})).rows.length,0);
    assert.equal((await save(one)).rows.length,1);
    assert.equal((await save(one)).rows.length,0);
    assert.equal((await save(two)).rows.length,1);
    const link=(id,revision,ids)=>db.query(LINK_EFFECT_SQL,[owner,id,account,JSON.stringify(ids),revision]);
    assert.equal((await link(one,0,[trade])).rows.length,1);
    assert.equal((await link(one,0,[])).rows.length,0);
    assert.equal((await link(two,0,[trade])).rows.length,0);
    assert.equal((await link(one,1,[])).rows.length,1);
    assert.equal((await link(two,0,[trade])).rows.length,1);
    assert.equal((await link(one,2,[one])).rows.length,0);
    await db.exec('reset role');await db.query('update accounts set native_state=null where id=$1',[account]);await db.exec('set role varda_tenant_app');
    assert.equal((await save(trade,7)).rows.length,0);
    assert.equal((await save(trade,-1)).rows.length,1);
  } finally { await db.close(); }
});
