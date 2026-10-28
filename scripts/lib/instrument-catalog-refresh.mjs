export function catalogRefreshStatements(rows, verifiedAt) {
 const payload=JSON.stringify(rows), ids=JSON.stringify(rows.map(r=>r.isin));
 return [
  {sql:"select pg_advisory_xact_lock(110990,189300)",params:[]},
  // Fail closed on partial downloads or an unexpected shrink of an existing catalog.
  {sql:"select 1 / case when (select count(*) from instrument_catalog where source='kis_master' and is_active) <= $1::int / 0.8 then 1 else 0 end as batch_guard",params:[rows.length]},
  {sql:"update instrument_catalog set is_active=false,updated_at=now() where source='kis_master' and is_active and isin not in (select jsonb_array_elements_text($1::jsonb))",params:[ids]},
  {sql:`insert into instrument_catalog (isin,ticker,name,market,exchange,currency,asset_type,security_group,source,source_sha256,verified_at,is_active)
   select r.isin,r.ticker,r.name,r.market,r.exchange,r.currency,r."assetType",r."securityGroup",r.source,r."sourceSha256",$2::timestamptz,true
   from jsonb_to_recordset($1::jsonb) as r(isin text,ticker text,name text,market text,exchange text,currency text,"assetType" text,"securityGroup" text,source text,"sourceSha256" text)
   on conflict (isin) do update set ticker=excluded.ticker,name=excluded.name,market=excluded.market,exchange=excluded.exchange,currency=excluded.currency,asset_type=excluded.asset_type,security_group=excluded.security_group,source=excluded.source,source_sha256=excluded.source_sha256,verified_at=excluded.verified_at,is_active=true,updated_at=now()
   where instrument_catalog.source='kis_master'`,params:[payload,verifiedAt]},
  {sql:"select exchange,asset_type,count(*)::int as count from instrument_catalog where source='kis_master' and is_active group by exchange,asset_type order by exchange,asset_type",params:[]},
 ];
}
