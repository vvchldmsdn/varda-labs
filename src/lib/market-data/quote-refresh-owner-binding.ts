import "server-only";
import { createHash } from "node:crypto";
import type { TenantContext } from "@/lib/session-resolver-contract";

/** An opaque continuation marker; every request still checks the current owner. */
export function quoteRefreshOwnerBinding(tenant: TenantContext): string {
  return createHash("sha256")
    .update(JSON.stringify(["quote-refresh-v1", tenant.ownerUserId, tenant.role]))
    .digest("hex");
}
