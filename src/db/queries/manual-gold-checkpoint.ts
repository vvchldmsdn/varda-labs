import "server-only";
import { and, desc, eq, lte } from "drizzle-orm";
import { dailyPositionSnapshots as positions } from "@/db/schema";
import { db } from "@/db/client";
import { brokerRecoverySnapshotPredicate } from "./broker-recovery-snapshot-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Latest record for this holding, independent of when other assets were saved.
 * Two rows are enough to reject ambiguity on the most recent date. */
export async function latestGoldCheckpoint(tenant: TenantContext, accountId: string, assetId: string, serviceDate: string) {
  const rows = await db.select({
    accountId:positions.accountId, assetId:positions.assetId, canonicalOwnerUserId:positions.canonicalOwnerUserId,
    snapshotDate:positions.snapshotDate, currency:positions.currency, isSample:positions.isSample,
    currentPrice:positions.currentPrice, quantity:positions.quantity, marketValueKrw:positions.marketValueKrw,
    priceSource:positions.priceSource, priceBasis:positions.priceBasis, source:positions.source, capturedAt:positions.capturedAt,
  }).from(positions).where(and(
    eq(positions.canonicalOwnerUserId, tenant.ownerUserId), eq(positions.accountId, accountId),
    eq(positions.assetId, assetId), eq(positions.isSample, false), lte(positions.snapshotDate, serviceDate),
    brokerRecoverySnapshotPredicate("daily_position_snapshots", [accountId]),
  )).orderBy(desc(positions.snapshotDate)).limit(2);
  return rows.filter(row => row.snapshotDate === rows[0].snapshotDate);
}
