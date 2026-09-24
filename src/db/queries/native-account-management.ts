import "server-only";
import { getTenantSqlClient } from "@/db/tenant-client";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** Minimal owner/RLS read for choosing the correct editing surface. */
export async function readNativeManagementAccounts(tenant: TenantContext): Promise<{ id: string; code: string }[]> {
  const [, rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query("select id,code from accounts where canonical_owner_user_id=$1::uuid and is_active and native_state is not null order by id", [tenant.ownerUserId]),
  ], { readOnly: true });
  return rows as { id: string; code: string }[];
}
