import assert from 'node:assert/strict';
import { before, after, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { importWithPorts } from './helpers/import-with-ports.mjs';

const pg=new PGlite();
const date='2026-08-16',cutoff='2026-08-15T22:04:00.000Z',captured='2026-08-15T22:05:00.000Z';
before(async()=>{
  await pg.exec('CREATE ROLE varda_tenant_app');
  const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
  for(const {tag} of entries)await pg.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));
  if(!entries.some(row=>row.tag==='0063_holdings_snapshot_revision_repair'))await pg.exec(readFileSync('drizzle/0063_holdings_snapshot_revision_repair.sql','utf8'));
  await pg.query("select set_trade_reliability_mode('compatible','Synthetic holdings repair tests')");
  await pg.query("select set_config('app.trade_reliability_version','0059',false)");
});
after(()=>pg.close());

async function fixture(){
  const owner=randomUUID(),other=randomUUID(),account=randomUUID(),asset=randomUUID(),portfolio=randomUUID(),position=randomUUID();
  const code=`test_${account.slice(0,8)}`;
  await pg.query("insert into app_users(id,status,role) values($1,'active','user'),($2,'active','user')",[owner,other]);
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Synthetic account','brokerage','KRW')",[account,owner,code]);
  await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,$4,'Synthetic stock','TEST','korea','KRW','stock',8,999)",[asset,owner,account,code]);
  await pg.query(`insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,snapshot_date,account,source,total_market_value,total_cost,num_assets,cycle_end_at,captured_at,description)
    values($1,$2,$3,$4,$5,'varda_manual_daily_snapshot',1000,800,1,$6,$7,'snapshot_status=complete; native_revision=0; expected_positions=1')`,[portfolio,owner,account,date,code,cutoff,captured]);
  await pg.query(`insert into daily_position_snapshots(id,canonical_owner_user_id,account_id,asset_id,snapshot_date,account,source,asset_name,ticker,market,currency,source_type,price_source,price_basis,quantity,total_quantity,unit_price,market_value_krw,cost_krw,cycle_end_at,captured_at)
    values($1,$2,$3,$4,$5,$6,'varda_manual_daily_snapshot','Synthetic stock','TEST','korea','KRW','listed','retained_fixture','cutoff',10,10,100,1000,800,$7,$8)`,[position,owner,account,asset,date,code,cutoff,captured]);
  const state={version:1,accountId:account,startedAt:'2026-08-01T00:00:00Z',at:'2026-08-15T20:00:00Z',sequence:1,cash:{KRW:'999999',USD:'0'},positions:[{assetId:asset,currency:'KRW',quantity:'8',costLots:[{amount:'640',currency:'KRW',at:'2026-08-01T00:00:00Z',source:'fixture',remaining:{n:'1',d:'1'}}]}]};
  const effective=[{accountId:account,data:{event:{type:'opening',at:state.startedAt},state:{...state,sequence:0,at:state.startedAt}}},{accountId:account,data:{event:{type:'sell',at:state.at},state}}];
  const revision=async(marker=1,affected=state.at)=>pg.query(`insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,recorded_at,reason,effective_entries)
    values($1,$2,$3,$4,$5,'2026-08-20T00:00:00Z','Synthetic correction',$6)`,[owner,account,randomUUID(),marker,affected,JSON.stringify(effective)]);
  await revision();
  const ledger={accountsComplete:true,entriesComplete:true,accounts:[{id:account,state,revision:1}],entries:effective};
  let beforeTransaction=null,failWrite=false,ledgerReads=0;
  const sqlClient={query:async(text,params=[]) => (await pg.query(text,params)).rows,transaction:async build=>{
    const commands=build({query:(text,params=[])=>({text,params})});
    if(beforeTransaction){const action=beforeTransaction;beforeTransaction=null;await action();}
    return pg.transaction(async tx=>{
      const results=[];
      for(const command of commands){
        if(failWrite&&/^update "daily_portfolio_snapshots"/.test(command.text))await tx.query('select 1/0');
        results.push((await tx.query(command.text,command.params)).rows);
      }
      return results;
    });
  }};
  const [repair]=await importWithPorts(['src/lib/snapshots/holdings-revision-repair.ts'],{
    '@/db/client':{db:drizzle(pg),sqlClient},
    '@/db/queries/native-portfolio-ledger':{readNativeLedger:async(tenant,id)=>{ledgerReads++;assert.equal(tenant.ownerUserId,owner);assert.equal(id,account);return ledger;}},
  });
  const read=async()=>({portfolio:(await pg.query('select to_jsonb(s) as row from daily_portfolio_snapshots s where id=$1',[portfolio])).rows[0].row,
    positions:(await pg.query('select to_jsonb(s) as row from daily_position_snapshots s where account_id=$1 order by id',[account])).rows.map(row=>row.row),
    archive:(await pg.query('select to_jsonb(s) as row from holdings_snapshot_repair_archive s where account_id=$1 order by revision',[account])).rows.map(row=>row.row)});
  return {owner,other,account,asset,code,portfolio,position,ledger,revision,read,run:(dryRun=false,tenant=owner)=>repair.repairHoldingsSnapshotRevisions({ownerUserId:tenant,role:'user'},date,code,dryRun),runAll:()=>repair.repairHoldingsSnapshotRevisions({ownerUserId:owner,role:'user'},date,'all',false),
    race:action=>{beforeTransaction=action;},fail:()=>{failWrite=true;},reads:()=>ledgerReads};
}

it('repairs retained historical holdings evidence once and archives exact before-images without changing financial source rows',async()=>{
  const f=await fixture(),before=await f.read();
  const originalAssets=(await pg.query('select to_jsonb(a) as row from assets a where id=$1',[f.asset])).rows;
  assert.deepEqual(await f.run(),{status:'ready',repaired:1});
  const saved=await f.read();
  assert.equal(saved.portfolio.total_market_value,800);assert.equal(saved.portfolio.total_cost,640);assert.equal(saved.portfolio.cash_value,0);
  assert.equal(saved.positions[0].quantity,8);assert.equal(saved.positions[0].unit_price,100);assert.equal(saved.positions[0].market_value_krw,800);
  assert.equal(saved.portfolio.cycle_end_at,before.portfolio.cycle_end_at);assert.equal(saved.portfolio.captured_at,before.portfolio.captured_at);
  assert.equal(saved.archive.length,1);assert.deepEqual(saved.archive[0].portfolio,before.portfolio);assert.deepEqual(saved.archive[0].positions,before.positions);
  assert.deepEqual((await pg.query('select to_jsonb(a) as row from assets a where id=$1',[f.asset])).rows,originalAssets);
  assert.deepEqual(await f.run(),{status:'ready',repaired:0});assert.deepEqual(await f.read(),saved);
});

async function addNewHistoricalHolding(f,withClose){
  const asset=randomUUID(),ticker=`N${asset.replaceAll('-','').slice(0,12).toUpperCase()}`;
  await pg.query("insert into assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price) values($1,$2,$3,$4,'New historical stock',$5,'korea','KRW','stock',2,999)",[asset,f.owner,f.account,f.code,ticker]);
  f.ledger.accounts[0].state.positions.push({assetId:asset,currency:'KRW',quantity:'2',costLots:[{amount:'80',currency:'KRW',at:'2026-08-01T00:00:00Z',source:'fixture',remaining:{n:'1',d:'1'}}]});
  if(withClose)await pg.query(`insert into asset_price_snapshots(date,ticker,market,currency,close_price,adjusted_close_price,source,provider_symbol,provider_exchange,fetched_at)
    values('2026-08-14',$1,'korea','KRW',50,40,'kis_domestic_periodic',$1,'KRX','2026-08-14T08:00:00Z')`,[ticker]);
  return asset;
}

it('reconstructs a missing historical holding only from its exact identity-backed KIS raw close',async()=>{
  const f=await fixture(),asset=await addNewHistoricalHolding(f,true);
  assert.deepEqual(await f.run(),{status:'ready',repaired:1});
  const saved=await f.read(),position=saved.positions.find(row=>row.asset_id===asset);
  assert.equal(saved.portfolio.total_market_value,900);assert.equal(saved.portfolio.total_cost,720);assert.equal(saved.portfolio.num_assets,2);
  assert.equal(position.quantity,2);assert.equal(position.unit_price,50);assert.equal(position.market_value_krw,100);
  assert.equal(position.price_date,'2026-08-14');assert.equal(position.price_source,'kis_domestic_periodic');
  assert.equal(position.price_basis,'official_close');assert.equal(position.cycle_end_at, saved.portfolio.cycle_end_at);
  assert.equal(Number((await pg.query('select current_price from assets where id=$1',[asset])).rows[0].current_price),999);
});

it('blocks missing historical price atomically instead of borrowing the current asset price',async()=>{
  const f=await fixture(),asset=await addNewHistoricalHolding(f,false),before=await f.read();
  assert.deepEqual(await f.run(),{status:'blocked',reason:'missing_revision_price_evidence',assetIds:[asset]});
  assert.deepEqual(await f.read(),before);
});

it('rejects raw historical rows without a valid collection receipt or provider symbol without altering snapshots',async()=>{
  for(const assignment of ['fetched_at=NULL',"provider_symbol='   '"]){
    const f=await fixture(),asset=await addNewHistoricalHolding(f,true);
    await pg.query(`update asset_price_snapshots set ${assignment} where ticker=(select ticker from assets where id=$1)`,[asset]);
    const before=await f.read();
    assert.deepEqual(await f.run(),{status:'blocked',reason:'missing_revision_price_evidence',assetIds:[asset]},assignment);
    assert.deepEqual(await f.read(),before,assignment);
  }
});

it('includes a reconstructed USD holding in dollar exposure using the original snapshot FX',async()=>{
  const f=await fixture(),asset=await addNewHistoricalHolding(f,true);
  f.ledger.accounts[0].state.positions.find(row=>row.assetId===asset).currency='USD';
  await pg.query("update assets set market='us',currency='USD' where id=$1",[asset]);
  await pg.query("update asset_price_snapshots set market='us',currency='USD',source='kis_overseas_dailyprice:NAS',provider_exchange='NAS' where ticker=(select ticker from assets where id=$1)",[asset]);
  await pg.query('update daily_portfolio_snapshots set usdkrw=1300,fx_rate=1300 where id=$1',[f.portfolio]);
  assert.deepEqual(await f.run(),{status:'ready',repaired:1});
  const saved=await f.read(),position=saved.positions.find(row=>row.asset_id===asset);
  assert.equal(position.quantity,2);assert.equal(position.unit_price,50);assert.equal(position.fx_rate,1300);
  assert.equal(position.market_value_krw,130000);assert.equal(position.exposure_type,'US_LISTED');
  assert.equal(saved.portfolio.total_market_value,130800);
  assert.equal(saved.portfolio.usd_exposure_pct,99.388379);assert.equal(saved.portfolio.us_weight,99.388379);
});

async function addAggregate(f,count){
  const id=randomUUID();
  await pg.query(`insert into daily_portfolio_snapshots(id,canonical_owner_user_id,snapshot_date,account,source,total_market_value,total_cost,num_assets,cycle_end_at,captured_at,updated_at,description)
    values($1,$2,$3,'all','varda_manual_daily_snapshot',1000,800,1,$4,$5,$5,$6)`,[id,f.owner,date,cutoff,captured,`snapshot_status=complete; accounts=${count}; native_revision=0`]);
  return {id,read:async()=>(await pg.query('select to_jsonb(s) as row from daily_portfolio_snapshots s where id=$1',[id])).rows[0].row,
    archives:async()=>(await pg.query('select portfolio,positions from holdings_snapshot_repair_archive where portfolio_id=$1',[id])).rows};
}

it('rebuilds and archives the all-account row after its complete account set is repaired',async()=>{
  const f=await fixture(),aggregate=await addAggregate(f,1),before=await aggregate.read();
  assert.deepEqual(await f.runAll(),{status:'ready',repaired:1});
  const saved=await aggregate.read();assert.equal(saved.total_market_value,800);assert.equal(saved.total_cost,640);
  assert.equal(saved.captured_at,before.captured_at);assert.equal(saved.cycle_end_at,before.cycle_end_at);
  assert.match(saved.description,/accounts=1/);assert.match(saved.description,/native_revision=1/);
  const archives=await aggregate.archives();assert.equal(archives.length,1);assert.deepEqual(archives[0].portfolio,before);assert.deepEqual(archives[0].positions,[]);
  assert.deepEqual(await f.runAll(),{status:'ready',repaired:0});assert.deepEqual(await aggregate.read(),saved);
});

it('retains the original all-account row when a required member is missing',async()=>{
  const f=await fixture(),aggregate=await addAggregate(f,2),before=await aggregate.read();
  const result=await f.runAll();assert.equal(result.status,'blocked');assert.equal(result.reason,'revision_aggregate_members_incomplete');
  assert.equal((await f.read()).portfolio.total_market_value,800,'The complete owned account repair can commit independently');
  assert.deepEqual(await aggregate.read(),before);assert.deepEqual(await aggregate.archives(),[]);
});

it('archives successive aggregate repairs when a different account revision does not change the owner maximum marker',async()=>{
  const f=await fixture(),peer=randomUUID(),peerPortfolio=randomUUID(),peerCode=`peer_${peer.slice(0,8)}`;
  await f.revision(10);f.ledger.accounts[0].revision=10;
  await pg.query("insert into accounts(id,canonical_owner_user_id,code,name,account_type,currency) values($1,$2,$3,'Synthetic second account','brokerage','KRW')",[peer,f.owner,peerCode]);
  await pg.query(`insert into daily_portfolio_snapshots(id,canonical_owner_user_id,account_id,snapshot_date,account,source,total_market_value,total_cost,num_assets,cycle_end_at,captured_at,description)
    values($1,$2,$3,$4,$5,'varda_manual_daily_snapshot',100,80,1,$6,$7,'snapshot_status=complete; native_revision=0')`,[peerPortfolio,f.owner,peer,date,peerCode,cutoff,captured]);
  const aggregate=await addAggregate(f,2);
  assert.deepEqual(await f.runAll(),{status:'ready',repaired:1});
  assert.equal((await aggregate.read()).total_market_value,900);
  // Another account has independently committed its repaired member snapshot.
  // Its first marker is lower than the first account's marker 10.
  await pg.query(`insert into native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,recorded_at,reason,effective_entries)
    values($1,$2,$3,1,'2026-08-15T20:00:00Z',clock_timestamp(),'Synthetic second-account correction',$4)`,[f.owner,peer,randomUUID(),JSON.stringify(f.ledger.entries.map(row=>({...row,accountId:peer,data:{...row.data,state:{...row.data.state,accountId:peer}}})))]);
  await pg.query("update daily_portfolio_snapshots set total_market_value=80,total_cost=64,description='snapshot_status=complete; native_revision=1' where id=$1",[peerPortfolio]);
  assert.deepEqual(await f.runAll(),{status:'ready',repaired:0});
  assert.equal((await aggregate.read()).total_market_value,880);
  assert.deepEqual((await pg.query('select revision from holdings_snapshot_repair_archive where portfolio_id=$1 order by revision',[aggregate.id])).rows.map(row=>row.revision),[2,3]);
  assert.equal((await pg.query('select max(marker_sequence)::int as marker from native_ledger_revisions where canonical_owner_user_id=$1',[f.owner])).rows[0].marker,10);
});

it('keeps another owner and dry-run entirely read-only',async()=>{
  const f=await fixture(),before=await f.read();
  assert.deepEqual(await f.run(false,f.other),{status:'ready',repaired:0});assert.equal(f.reads(),0);
  assert.deepEqual(await f.run(true),{status:'blocked',reason:'snapshot_revision_repair_pending'});
  assert.deepEqual(await f.read(),before);
});

it('rejects a revision committed after the repair read and preserves the original snapshot',async()=>{
  const f=await fixture(),before=await f.read();f.race(()=>f.revision(2));
  await assert.rejects(f.run(),/division by zero/);assert.deepEqual(await f.read(),before);
});

it('rejects a concurrently changed position instead of replacing its new evidence',async()=>{
  const f=await fixture();f.race(()=>pg.query('update daily_position_snapshots set unit_price=200 where id=$1',[f.position]));
  await assert.rejects(f.run(),/division by zero/);
  const after=await f.read();assert.equal(after.archive.length,0);assert.equal(after.portfolio.total_market_value,1000);
  assert.equal(after.positions[0].quantity,10);assert.equal(after.positions[0].unit_price,200);
});

it('rolls back archive, position replacement and portfolio change together after a write failure',async()=>{
  const f=await fixture(),before=await f.read();f.fail();
  await assert.rejects(f.run(),/division by zero/);assert.deepEqual(await f.read(),before);
});

it('keeps repair archives immutable and inaccessible to the ordinary tenant role',async()=>{
  const f=await fixture();await f.run();
  await assert.rejects(pg.query('update holdings_snapshot_repair_archive set revision=99 where account_id=$1',[f.account]),/snapshot_archive_immutable/);
  await assert.rejects(pg.query('delete from holdings_snapshot_repair_archive where account_id=$1',[f.account]),/snapshot_archive_immutable/);
  await assert.rejects(pg.transaction(async tx=>{await tx.exec('set local role varda_tenant_app');await tx.query('select * from holdings_snapshot_repair_archive');}),/permission denied/);
});

it('enqueues old saved dates at the actual delayed execution cutoff but excludes later trades and peer accounts',async()=>{
  const f=await fixture();
  // The saved date is intentionally much older than the three-day discovery window.
  assert.ok(Date.now()-Date.parse(date)>3*86400000);
  let rows=(await pg.query('select snapshot_date,stage,revision from daily_snapshot_work where account_id=$1',[f.account])).rows;
  assert.equal(rows.length,1);assert.equal(rows[0].snapshot_date.toISOString().slice(0,10),date);assert.equal(rows[0].stage,'legacy');assert.equal(rows[0].revision,1);
  // Nominal 07:00 is 22:00Z: actual execution was 22:04Z, so 22:03Z must enqueue.
  await f.revision(2,'2026-08-15T22:03:00Z');await f.revision(3,'2026-08-15T22:04:00Z');await f.revision(4,'2026-08-15T22:04:00.001Z');
  rows=(await pg.query('select revision from daily_snapshot_work where account_id=$1 order by revision',[f.account])).rows;
  assert.deepEqual(rows.map(row=>row.revision),[1,2,3]);
  assert.equal((await pg.query('select count(*)::int n from daily_snapshot_work where canonical_owner_user_id=$1',[f.other])).rows[0].n,0);
});
