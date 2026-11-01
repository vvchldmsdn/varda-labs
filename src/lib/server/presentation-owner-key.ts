import "server-only";
import { hash } from "node:crypto";
import type { TenantContext } from "../session-resolver-contract";

/** Stable client-state boundary without serializing the raw identity as a React key. */
export function presentationOwnerKey(tenant: TenantContext): string {
  return hash("sha256", `presentation-workspace:${tenant.ownerUserId}`);
}
