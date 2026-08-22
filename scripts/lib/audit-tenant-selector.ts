import type { TenantContext } from "../../src/lib/session-resolver-contract.ts";

const OWNER_ARGUMENT_PREFIX = "--owner-user-id=";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseAuditOwnerUserId(args: readonly string[]) {
  if (args.length !== 1 || !args[0].startsWith(OWNER_ARGUMENT_PREFIX)) {
    throw new Error("Exactly one --owner-user-id=<uuid> argument is required.");
  }
  const ownerUserId = args[0].slice(OWNER_ARGUMENT_PREFIX.length).trim();
  if (!UUID_PATTERN.test(ownerUserId)) {
    throw new Error("The audit owner user id is invalid.");
  }
  return ownerUserId.toLowerCase();
}

export function buildAuditTenantContext(
  ownerUserId: string,
  rows: readonly Readonly<{ status: string; role: string }>[],
): TenantContext {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row?.status !== "active" ||
    (row.role !== "user" && row.role !== "admin")
  ) {
    throw new Error("The selected audit tenant is unavailable.");
  }
  return Object.freeze({ ownerUserId, role: row.role });
}
