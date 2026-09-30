import "server-only";
import { getTenantSqlClient } from "@/db/tenant-client";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { eventLedgerEntries } from "@/db/schema";
import { projectNativeLegacyTrade } from "@/lib/native-legacy-trade-projection";

/** Read the revision-aware ledger, including archived holdings. Never rewrite
 * owner data to make an older reader understand a newly recorded transaction. */
export async function loadNativeLegacyTrades(tenant: TenantContext) {
  const result = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(`select e.id,e.account_id as "accountId",e.native_data as data,e.recorded_at as "recordedAt",
      a.code,a.name as "accountName",a.sort_order as "accountSortOrder",
      h.id as "assetId",h.name,h.ticker,h.legacy_base44_id as "legacyBase44Id"
      from effective_native_ledger_entries e
      join accounts a on a.id=e.account_id and a.canonical_owner_user_id=e.canonical_owner_user_id
      join assets h on h.id::text=e.native_data->'event'->>'assetId'
        and h.account_id=a.id and h.canonical_owner_user_id=e.canonical_owner_user_id
      where e.canonical_owner_user_id=$1::uuid and a.is_active
        and e.native_data->'event'->>'type' in ('buy','sell')
      order by e.recorded_at,e.native_sequence limit 10001`, [tenant.ownerUserId]),
  ], { readOnly: true });
  if (result[1].length > 10000) throw new Error("native_trade_history_too_large");
  return result[1].flatMap(row => {
    const projected = projectNativeLegacyTrade(row as Parameters<typeof projectNativeLegacyTrade>[0], {
      id: String(row.accountId), code: String(row.code),
      assets: [{ id: String(row.assetId), name: String(row.name), ticker: row.ticker as string | null, legacyBase44Id: row.legacyBase44Id as string | null }],
    });
    if (!projected) throw new Error("native_trade_projection_unavailable");
    const time = new Date(String(row.recordedAt));
    return [{ legacyBase44Id: null, canonicalOwnerUserId: tenant.ownerUserId,
      ruleVersion: "native_legacy_read_v1", brokerRecoveryBatchId: null, brokerRecoveryData: null,
      brokerRecoveryAssetId: null, nativeSequence: null, nativeOperationId: null,
      groupId: null, legacyGroupId: null, groupName: null, correctsEventId: null, legacyCorrectsEventId: null,
      source: "native_ledger_v1", description: null, isSample: false, base44CreatedAt: null, base44UpdatedAt: null,
      updatedAt: time, ...projected, recordedAt: time,
      beforeValue: JSON.stringify(projected.beforeValue), afterValue: JSON.stringify(projected.afterValue),
      accountName: String(row.accountName), accountSortOrder: Number(row.accountSortOrder),
    } as typeof eventLedgerEntries.$inferSelect & Pick<typeof projected, "nativeProjection" | "nativeCostBasisStatus" | "nativeRemainingCostKrw"> & { accountName: string; accountSortOrder: number }];
  });
}
