import "server-only";
import { getSnapshotFxExposureType } from "./fx-exposure";
import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { db, sqlClient } from "@/db/client";
import { assets, assetPriceSnapshots, dailyPortfolioSnapshots, dailyPositionSnapshots, type DailyPortfolioSnapshot, type DailyPositionSnapshot } from "@/db/schema";
import { readNativeLedger } from "@/db/queries/native-portfolio-ledger";
import { buildHoldingsRevisionSnapshot, buildHoldingsRevisionAggregate } from "./holdings-revision-rebuild";
import { holdingsRevisionInvalidSql, holdingsRevisionValidSql } from "./holdings-revision-policy";
import { snapshotFence } from "./write-context";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { NativePortfolioState } from "@/lib/native-portfolio-ledger";
import { closeCalendarReferenceDateForAsset } from "./market-calendar";
import { admitSharedKisRawHistoricalPriceRows } from "@/lib/market-data/asset-price-consumer-admission";

/** A repair uses the original valuation instant and retained market evidence.
 * It never fetches a provider or changes holdings, cash, or the event ledger. */
export async function repairHoldingsSnapshotRevisions(tenant: TenantContext, snapshotDate: string, account: string, dryRun: boolean) {
  const portfolios = await db.select({ ...getTableColumns(dailyPortfolioSnapshots),
    originalToken: sql<string>`md5(to_jsonb(${dailyPortfolioSnapshots})::text)`,
  }).from(dailyPortfolioSnapshots).where(and(
    eq(dailyPortfolioSnapshots.canonicalOwnerUserId, tenant.ownerUserId),
    eq(dailyPortfolioSnapshots.snapshotDate, snapshotDate),
    eq(dailyPortfolioSnapshots.isSample, false),
    ...(account === "all" ? [] : [eq(dailyPortfolioSnapshots.account, account)]),
    sql.raw(`exists(select 1 from native_ledger_revisions revision where ${holdingsRevisionInvalidSql("daily_portfolio_snapshots")})`),
  ));
  let repaired = 0;
  for (const original of portfolios) {
    if (!original.accountId || original.account === "all") continue;
    const ledger = await readNativeLedger(tenant, original.accountId);
    if (!ledger.accountsComplete || !ledger.entriesComplete) return { status: "blocked" as const, reason: "revision_ledger_incomplete" };
    const storedAccount = ledger.accounts.find(row => row.id === original.accountId);
    const cutoff = original.cycleEndAt && new Date(original.cycleEndAt).getTime();
    if (!storedAccount?.state || !cutoff) return { status: "blocked" as const, reason: "revision_cutoff_missing" };
    const events = ledger.entries.filter(row => row.accountId === original.accountId).sort((a,b) => a.data.state.sequence-b.data.state.sequence);
    // A date-only fill has no asserted intraday order within its service day.
    if (events.some(row => "dateEvidence" in row.data.event && row.data.event.dateEvidence &&
      Math.abs(Date.parse(row.data.event.at)-cutoff) < 12*3600000)) {
      return { status: "blocked" as const, reason: "revision_intraday_order_unknown" };
    }
    const inclusive = original.description?.includes("valuation_policy=execution_collection_v1") === true;
    const state = events.filter(row => inclusive ? Date.parse(row.data.event.at) <= cutoff : Date.parse(row.data.event.at) < cutoff).at(-1)?.data.state;
    if (!state) return { status: "blocked" as const, reason: "revision_opening_missing" };
    const positions = await db.select({ ...getTableColumns(dailyPositionSnapshots),
      originalToken: sql<string>`md5(to_jsonb(${dailyPositionSnapshots})::text)`,
    }).from(dailyPositionSnapshots).where(and(
      eq(dailyPositionSnapshots.canonicalOwnerUserId, tenant.ownerUserId),
      eq(dailyPositionSnapshots.accountId, original.accountId), eq(dailyPositionSnapshots.snapshotDate, snapshotDate),
      eq(dailyPositionSnapshots.source, original.source!), eq(dailyPositionSnapshots.isSample, false),
    ));
    const revision = storedAccount.revision ?? 0;
    const positionTemplates = await historicalPositionTemplates(original, positions, state);
    const built = buildHoldingsRevisionSnapshot({ portfolio: original, positions, state, revision, positionTemplates });
    if (built.status !== "ready") return built;
    if (dryRun) return { status: "blocked" as const, reason: "snapshot_revision_repair_pending" };
    const { originalToken: ignoredToken, ...portfolio } = { ...built.portfolio, originalToken: original.originalToken };
    void ignoredToken;
    const values = built.positions.map(row => {
      const { originalToken: token, ...value } = row as typeof row & { originalToken?: string };
      void token; return value;
    });
    const statements = [
      db.delete(dailyPositionSnapshots).where(and(eq(dailyPositionSnapshots.canonicalOwnerUserId, tenant.ownerUserId),
        eq(dailyPositionSnapshots.accountId, original.accountId), eq(dailyPositionSnapshots.snapshotDate, snapshotDate), eq(dailyPositionSnapshots.source, original.source!))),
      ...(values.length ? [db.insert(dailyPositionSnapshots).values(values)] : []),
      db.update(dailyPortfolioSnapshots).set({ ...portfolio, updatedAt: new Date() }).where(and(
        eq(dailyPortfolioSnapshots.id, original.id), eq(dailyPortfolioSnapshots.canonicalOwnerUserId, tenant.ownerUserId))),
    ];
    const fence = snapshotFence.getStore();
    await sqlClient.transaction(tx => [
      tx.query("select set_config('lock_timeout','2s',true),set_config('app.trade_reliability_version','0059',true)"),
      tx.query("set local statement_timeout='15s'"),
      tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
      ...(fence ? [tx.query("select assert_daily_snapshot_fence($1::uuid,$2)", [fence.id,fence.generation])] : []),
      // Compare the full read rows and latest ledger revision under the same
      // owner lock as a trade. Failed or superseded attempts roll back together.
      tx.query(`select 1/(case when exists(select 1 from daily_portfolio_snapshots s join accounts a on a.id=s.account_id
        where s.id=$2::uuid and s.canonical_owner_user_id=$1::uuid and a.canonical_owner_user_id=$1::uuid and a.is_active
          and md5(to_jsonb(s)::text)=$3 and coalesce((select max(marker_sequence) from native_ledger_revisions r
            where r.account_id=a.id and r.canonical_owner_user_id=$1::uuid),0)=$4)
        and not exists(select 1 from daily_position_snapshots p full join jsonb_to_recordset($5::jsonb) e(id uuid,token text) on p.id=e.id
          where (p.canonical_owner_user_id=$1::uuid and p.account_id=$6::uuid and p.snapshot_date=$7::date and p.source=$8 or e.id is not null)
          and (p.id is null or e.id is null or md5(to_jsonb(p)::text)<>e.token)) then 1 else 0 end)`,
        [tenant.ownerUserId, original.id, original.originalToken, revision, JSON.stringify(positions.map(row=>({id:row.id,token:row.originalToken}))),original.accountId,snapshotDate,original.source]),
      tx.query(`insert into holdings_snapshot_repair_archive(canonical_owner_user_id,account_id,snapshot_date,revision,portfolio_id,portfolio,positions)
        select s.canonical_owner_user_id,s.account_id,s.snapshot_date,$3,s.id,to_jsonb(s),
          coalesce((select jsonb_agg(to_jsonb(p)) from daily_position_snapshots p where p.canonical_owner_user_id=s.canonical_owner_user_id
            and p.account_id=s.account_id and p.snapshot_date=s.snapshot_date and p.source=s.source),'[]'::jsonb)
        from daily_portfolio_snapshots s where s.id=$2::uuid and s.canonical_owner_user_id=$1::uuid`, [tenant.ownerUserId,original.id,revision]),
      ...statements.map(statement => { const query=statement.toSQL(); return tx.query(query.sql,query.params); }),
    ], { isolationLevel: "ReadCommitted" });
    repaired++;
  }
  const aggregate = await repairAggregate(tenant, snapshotDate, dryRun);
  if (aggregate.status === "blocked" && account === "all") return aggregate;
  return { status: "ready" as const, repaired };
}

async function historicalPositionTemplates(original: DailyPortfolioSnapshot, positions: DailyPositionSnapshot[], state: NativePortfolioState) {
  const templates: DailyPositionSnapshot[] = [];
  for (const holding of state.positions) {
    if (Number(holding.quantity) <= 0 || positions.some(row => row.assetId === holding.assetId)) continue;
    const [asset] = await db.select().from(assets).where(and(eq(assets.id,holding.assetId),
      eq(assets.accountId,original.accountId!),eq(assets.canonicalOwnerUserId,original.canonicalOwnerUserId!)));
    if (!asset?.ticker || !["us","korea"].includes(asset.market ?? "") || asset.currency!==holding.currency) continue;
    const date=closeCalendarReferenceDateForAsset(asset,original.snapshotDate);
    if(!date)continue;
    const candidates=await db.select().from(assetPriceSnapshots).where(and(eq(assetPriceSnapshots.ticker,asset.ticker),
      eq(assetPriceSnapshots.market,asset.market!),eq(assetPriceSnapshots.currency,asset.currency!),eq(assetPriceSnapshots.priceDate,date),
      eq(assetPriceSnapshots.isSample,false),sql`${assetPriceSnapshots.source} like 'kis%'`,sql`${assetPriceSnapshots.closePrice}>0`,
      sql`${assetPriceSnapshots.providerSymbol} is not null`,sql`${assetPriceSnapshots.providerExchange} is not null`));
    // One unambiguous raw close from the exact original market session. An
    // adjusted close, current quote, or adjacent date cannot stand in for it.
    const admitted=admitSharedKisRawHistoricalPriceRows(candidates).rows;
    if(!admitted.length||new Set(admitted.map(row=>`${row.closePrice}:${row.providerSymbol}:${row.providerExchange}`)).size!==1)continue;
    const price=admitted[0];
    // All nullable columns start unknown; the required columns are set below.
    const blank=Object.fromEntries(Object.keys(getTableColumns(dailyPositionSnapshots)).map(key=>[key,null])) as unknown as DailyPositionSnapshot;
    templates.push({...blank,id:randomUUID(),canonicalOwnerUserId:original.canonicalOwnerUserId,accountId:original.accountId,
      account:original.account,snapshotDate:original.snapshotDate,source:original.source,assetId:asset.id,assetName:asset.name,
      ticker:asset.ticker,market:asset.market,currency:asset.currency,assetType:asset.assetType,category:asset.category,
      sourceType:"listed",exposureType:getSnapshotFxExposureType(asset),priceSource:price.source,priceBasis:"official_close",priceDate:date,referenceDate:date,
      unitPrice:price.closePrice,currentPrice:price.closePrice,closePrice:price.closePrice,
      quantity:"0",totalQuantity:"0",fractionalKrwValue:"0",fractionalAvgCost:"0",belowMa:false,isSample:false,
      fxRate:asset.currency==="KRW"?"1":original.usdKrw??original.fxRate,fxReferenceDate:positions[0]?.fxReferenceDate??null,
      cycleStartAt:original.cycleStartAt,cycleEndAt:original.cycleEndAt,capturedAt:original.capturedAt,
      createdAt:new Date(),updatedAt:new Date(),description:`revision_price_basis=exact_official_close; price_reference_date=${date}`});
  }
  return templates;
}

async function repairAggregate(tenant: TenantContext, snapshotDate: string, dryRun: boolean) {
  const original = (await db.select({ ...getTableColumns(dailyPortfolioSnapshots),
    originalToken: sql<string>`md5(to_jsonb(${dailyPortfolioSnapshots})::text)`,
  }).from(dailyPortfolioSnapshots).where(and(eq(dailyPortfolioSnapshots.canonicalOwnerUserId, tenant.ownerUserId),
    eq(dailyPortfolioSnapshots.snapshotDate,snapshotDate),eq(dailyPortfolioSnapshots.account,"all"),
    sql.raw(`exists(select 1 from native_ledger_revisions revision where ${holdingsRevisionInvalidSql("daily_portfolio_snapshots")})`))))[0];
  if (!original) return {status:"ready" as const};
  const members = await db.select({ ...getTableColumns(dailyPortfolioSnapshots),
    originalToken: sql<string>`md5(to_jsonb(${dailyPortfolioSnapshots})::text)`,
  }).from(dailyPortfolioSnapshots).where(and(eq(dailyPortfolioSnapshots.canonicalOwnerUserId,tenant.ownerUserId),
    eq(dailyPortfolioSnapshots.snapshotDate,snapshotDate),eq(dailyPortfolioSnapshots.source,original.source!),
    sql`${dailyPortfolioSnapshots.accountId} is not null`,sql.raw(holdingsRevisionValidSql("daily_portfolio_snapshots"))));
  // Account marker sequences are independent. max(sequence) can repeat when a
  // different account is corrected; use the monotonic owner revision count for
  // aggregate archive generations instead.
  const revisions=await sqlClient.query(`select count(*)::int as revision from native_ledger_revisions where canonical_owner_user_id=$1::uuid`,[tenant.ownerUserId]);
  const revision=Number(revisions[0]?.revision??0);
  const built=buildHoldingsRevisionAggregate(original,members,revision);
  if(built.status!=="ready")return built;
  if(dryRun)return {status:"blocked" as const,reason:"snapshot_revision_repair_pending"};
  const {originalToken: token,...value}={...built.portfolio,originalToken:original.originalToken};void token;
  const statement=db.update(dailyPortfolioSnapshots).set({...value,updatedAt:new Date()})
    .where(and(eq(dailyPortfolioSnapshots.id,original.id),eq(dailyPortfolioSnapshots.canonicalOwnerUserId,tenant.ownerUserId))).toSQL();
  const fence=snapshotFence.getStore();
  await sqlClient.transaction(tx=>[
    tx.query("select set_config('lock_timeout','2s',true),set_config('app.trade_reliability_version','0059',true)"),
    tx.query("set local statement_timeout='15s'"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))",[`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    ...(fence?[tx.query("select assert_daily_snapshot_fence($1::uuid,$2)",[fence.id,fence.generation])]:[]),
    tx.query(`select 1/(case when exists(select 1 from daily_portfolio_snapshots s where s.id=$2::uuid and s.canonical_owner_user_id=$1::uuid and md5(to_jsonb(s)::text)=$3)
      and not exists(select 1 from jsonb_to_recordset($4::jsonb) e(id uuid,token text) left join daily_portfolio_snapshots s on s.id=e.id
        where s.id is null or s.canonical_owner_user_id<>$1::uuid or md5(to_jsonb(s)::text)<>e.token or not (${holdingsRevisionValidSql("s")}))
      then 1 else 0 end)`,[tenant.ownerUserId,original.id,original.originalToken,JSON.stringify(members.map(row=>({id:row.id,token:row.originalToken})))]),
    tx.query(`insert into holdings_snapshot_repair_archive(canonical_owner_user_id,account_id,snapshot_date,revision,portfolio_id,portfolio,positions)
      select s.canonical_owner_user_id,null,s.snapshot_date,$3,s.id,to_jsonb(s),'[]'::jsonb from daily_portfolio_snapshots s
      where s.id=$2::uuid and s.canonical_owner_user_id=$1::uuid`,[tenant.ownerUserId,original.id,revision]),
    tx.query(statement.sql,statement.params),
  ],{isolationLevel:"ReadCommitted"});
  return {status:"ready" as const};
}
