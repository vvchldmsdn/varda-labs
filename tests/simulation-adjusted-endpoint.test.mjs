import assert from 'node:assert/strict';import {it} from 'node:test';import {PGlite} from '@electric-sql/pglite';import {drizzle} from 'drizzle-orm/pglite';import {importWithPorts} from './helpers/import-with-ports.mjs';
it('actual research query keeps a complete adjusted endpoint when the new session has raw closes only',async()=>{
 const pg=new PGlite();try{await pg.exec(`create table asset_price_snapshots(market text,currency text,ticker text,date date,close_price numeric,source text,provider_symbol text,provider_exchange text,fetched_at timestamptz,is_sample boolean,adjusted_close_price numeric,adjusted_close_basis text,adjusted_close_provider text,adjusted_close_source text,adjusted_close_fetched_at timestamptz); create table fx_rates(date date,usdkrw numeric,status text,is_sample boolean);`);
 await pg.exec(`insert into asset_price_snapshots values('us','USD','AAA','2026-09-28',100,'kis_dailyprice:raw_v2','AAA','NAS',now(),false,99,'provider_adjusted_close_v1','kis','kis_dailyprice:adjusted_v1',now()),('us','USD','AAA','2026-09-29',101,'kis_dailyprice','AAA','NAS',now(),false,null,null,null,null,null);insert into fx_rates values('2026-09-29',1400,'ok',false);`);
 const [m]=await importWithPorts(['src/db/queries/simulation-owner-private-history.ts'],{'@/db/client':{db:drizzle(pg)}});const args={tenantContext:{ownerUserId:'owner'},selection:{status:'valid',instruments:[{instrumentKey:'us|USD|AAA',market:'us',currency:'USD',ticker:'AAA',classification:'listed_instrument',weightBps:10000}]}};
 assert.equal(await m.getLatestCommonPrivateOwnerRawServiceDate(args),'2026-09-29');
 await pg.exec(`update asset_price_snapshots set adjusted_close_price=100,adjusted_close_basis='provider_adjusted_close_v1',adjusted_close_provider='kis',adjusted_close_source='kis_dailyprice:adjusted_v1',adjusted_close_fetched_at=now() where date='2026-09-29'`);
 assert.equal(await m.getLatestCommonPrivateOwnerRawServiceDate(args),'2026-09-30');
 await pg.exec(`update asset_price_snapshots set provider_exchange='NYS' where date='2026-09-29'`);assert.equal(await m.getLatestCommonPrivateOwnerRawServiceDate(args),null,'provider splice stays blocked');
 }finally{await pg.close();}
});
