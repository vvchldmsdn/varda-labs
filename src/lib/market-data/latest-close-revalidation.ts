import "server-only";
import { randomUUID } from "node:crypto";
import { sqlClient } from "@/db/client";
import { applyAssetPriceSnapshotRows } from "@/lib/market-data/asset-price-snapshot-repository";
import { withKisCollectionLease } from "@/lib/market-data/kis-refresh-lease";
import { latestCloseNeedsRevalidation, LATEST_CLOSE_REFRESH_POLICY } from "@/lib/market-data/latest-close-refresh-policy";
import type { CollectionJob } from "@/lib/market-data/collection-policy";
import type { MarketDataProvider, PriceLookupTarget } from "@/lib/market-data/providers/types";
import { closeCalendarReferenceDateForAsset, resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

type CloseTarget = Pick<CollectionJob, "ticker" | "market" | "currency">;

/** Reconcile provider revisions of the latest shared close, never personal snapshot history. */
export async function revalidateLatestClose({ target, provider, now = new Date() }: {
  target: CloseTarget;
  provider: MarketDataProvider;
  now?: Date;
}) {
  if (provider.name !== "kis") throw new Error("latest_close_requires_kis");
  return withKisCollectionLease(async () => {
    const priceDate = closeCalendarReferenceDateForAsset(target, resolveSnapshotCycle(now).snapshotDate);
    const instrumentKey = `${target.market}:${target.currency}:${target.ticker}`;
    const [evidence] = await sqlClient.query(`select
      (select fetched_at from asset_price_snapshots where market=$1 and currency=$2 and ticker=$3 and date=$4::text::date
       and is_sample=false and close_price>0 and source like 'kis_%' and adjusted_close_basis is null limit 1) as close_fetched_at,
      (select finished_at from market_data_sync_runs where job_type=$5 and status='completed' and source='kis'
       and metadata_json->>'instrumentKey'=$6 and metadata_json->>'priceDate'=$4
       and started_at >= $7::timestamptz order by started_at desc limit 1) as completed_at`,
    [target.market, target.currency, target.ticker, priceDate, LATEST_CLOSE_REFRESH_POLICY.jobType, instrumentKey,
      new Date(now.getTime() - LATEST_CLOSE_REFRESH_POLICY.freshnessMilliseconds).toISOString()]);
    if (!latestCloseNeedsRevalidation({ now, closeFetchedAt: evidence?.close_fetched_at ?? null, completedAt: evidence?.completed_at ?? null })) {
      return { state: "fresh" as const, priceDate };
    }

    const runId = randomUUID();
    const metadata = { instrumentKey, priceDate, policy: "latest_close_hourly_v1" };
    await sqlClient.query(`insert into market_data_sync_runs(id,job_type,mode,status,started_at,source,requested_count,metadata_json)
      values($1::uuid,$2,'close','running',$3::timestamptz,'kis',1,$4::jsonb)`,
    [runId, LATEST_CLOSE_REFRESH_POLICY.jobType, now.toISOString(), JSON.stringify(metadata)]);
    try {
      const lookup: PriceLookupTarget = { ...target, key: instrumentKey, authority: "explicit_instrument", accounts: [], assetIds: [], assetNames: [] };
      const result = await provider.fetchClosePrices([lookup], { mode: "close", priceDate, requestedAt: now, dryRun: false, fixture: false });
      const valid = result.rows.filter(row => row.status === "ok" && row.ticker === target.ticker && row.market === target.market
        && row.currency === target.currency && row.closePrice !== null && Number.isFinite(Number(row.closePrice)) && Number(row.closePrice) > 0);
      if (result.provider !== "kis" || valid.length !== 1 || valid[0].priceDate > priceDate) throw new Error("latest_close_provider_unavailable");
      const exact = valid.filter(row => row.priceDate === priceDate);
      // A provider can legitimately return an earlier actual close. Keep its original date;
      // do not promote it into the requested date or stamp an existing price as revalidated.
      const write = exact.length ? await applyAssetPriceSnapshotRows({ rows: exact, targets: [lookup], dryRun: false, writePolicy: "kis", allowWrite: true }) : null;
      if (write && (write.failedCount > 0 || write.conflictCount > 0)) throw new Error("latest_close_write_unavailable");
      const state = exact.length ? "revalidated" as const : "no_exact_close" as const;
      await sqlClient.query(`update market_data_sync_runs set status='completed',finished_at=clock_timestamp(),
        success_count=$2,failed_count=0,skipped_count=$3,metadata_json=$4::jsonb where id=$1::uuid`,
      [runId, exact.length, exact.length ? 0 : 1, JSON.stringify({ ...metadata, state, returnedPriceDate: valid[0].priceDate })]);
      return { state, priceDate };
    } catch (error) {
      await sqlClient.query(`update market_data_sync_runs set status='failed',finished_at=clock_timestamp(),failed_count=1,
        error='latest_close_revalidation_failed' where id=$1::uuid`, [runId]);
      throw error;
    }
  });
}
