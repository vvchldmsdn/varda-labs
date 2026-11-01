import "server-only";
import { getTenantSqlClient } from "@/db/tenant-client";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { NATIVE_RECORD_ID, NATIVE_RECORD_LIMIT, projectNativeLedgerRecord, type NativeLedgerRecordsRead, type NativeRecordRow } from "@/lib/native-ledger-records";

/** Owner + account are applied before the cap. The effective view preserves corrections. */
const RECORDS_QUERY = `with owned as materialized (
  select a.id,a.name from accounts a where a.canonical_owner_user_id=$1::uuid and a.id=$2::uuid
), selected as materialized (
  select e.id,e.account_id as "accountId",e.native_sequence,e.native_data->'event' as event,
    h.name as "assetName",h.ticker
  from effective_native_ledger_entries e join owned a on a.id=e.account_id
  left join assets h on h.id::text=e.native_data->'event'->>'assetId'
    and h.canonical_owner_user_id=$1::uuid and h.account_id=$2::uuid
  where e.canonical_owner_user_id=$1::uuid and e.account_id=$2::uuid and e.native_data is not null
  order by e.native_sequence desc,e.id desc limit $3
), budget as (select coalesce(sum(octet_length(event::text)),0)<=2097152 as bounded from selected)
select (select row_to_json(owned) from owned) as account,budget.bounded,
  case when budget.bounded then (select coalesce(jsonb_agg(to_jsonb(selected) order by native_sequence desc,id desc),'[]'::jsonb) from selected)
  else '[]'::jsonb end as rows from budget`;

export async function readNativeLedgerRecords(tenant: TenantContext, accountId: string): Promise<NativeLedgerRecordsRead> {
  if (!NATIVE_RECORD_ID.test(tenant.ownerUserId) || !NATIVE_RECORD_ID.test(accountId)) return { state: "not_found", records: [], complete: false };
  try {
    const [, result] = await getTenantSqlClient().transaction(tx => [
      tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
      tx.query(RECORDS_QUERY, [tenant.ownerUserId, accountId, NATIVE_RECORD_LIMIT + 1]),
    ], { isolationLevel: "RepeatableRead", readOnly: true });
    const row = result[0];
    if (!row?.account) return { state: "not_found", records: [], complete: false };
    if (row.account.id !== accountId || typeof row.account.name !== "string" || row.bounded !== true || !Array.isArray(row.rows) || row.rows.length > NATIVE_RECORD_LIMIT + 1) return { state: "integrity_error", records: [], complete: false };
    const records = row.rows.slice(0, NATIVE_RECORD_LIMIT).map((value: NativeRecordRow) => projectNativeLedgerRecord(value, accountId));
    if (new Set(records.map(record => record.id)).size !== records.length) return { state: "integrity_error", records: [], complete: false };
    const hasMore = row.rows.length > NATIVE_RECORD_LIMIT;
    return { state: "ready", account: { id: accountId, name: row.account.name }, records, hasMore, complete: !hasMore, limit: NATIVE_RECORD_LIMIT };
  } catch { return { state: "unavailable", records: [], complete: false }; }
}
