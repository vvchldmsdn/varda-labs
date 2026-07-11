import { createHash } from "node:crypto";

import {
  TenantWritePolicyError,
  prepareMigrationOwnerContext,
} from "../../src/lib/tenant-write-context.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function prepareCanonicalMigrationShadowOwner({
  canonicalOwnerId,
  approveProvisioningOwner,
  legacyOwnerUserId = null,
  appUser,
}) {
  const blockers = [];
  let context = null;

  if (appUser === null) {
    blockers.push("canonical_owner_not_found");
  } else if (appUser.role !== "user") {
    blockers.push("canonical_owner_role_not_allowed");
  } else {
    try {
      context = prepareMigrationOwnerContext({
        mode: "shadow",
        legacyOwnerUserId,
        canonicalOwnerUserId: canonicalOwnerId,
        canonicalOwnerStatus: appUser.status,
        canonicalOwnerVerified: true,
        provisioningOwnerApproved: approveProvisioningOwner,
      });
    } catch (error) {
      if (!(error instanceof TenantWritePolicyError)) throw error;
      blockers.push(`canonical_owner_context_${error.code}`);
    }
  }

  return Object.freeze({
    context,
    blockers: Object.freeze(blockers),
  });
}

export function classifyCanonicalOwnerAction({
  exists,
  existingCanonicalOwnerId,
  canonicalOwnerId,
  blocked = false,
}) {
  if (blocked) return "block";
  if (!exists) return "insert";
  if (existingCanonicalOwnerId === null) return "update";
  if (existingCanonicalOwnerId === canonicalOwnerId) return "skip";
  return "block";
}

export function summarizeCanonicalOwnerActions(actions) {
  const counts = { insert: 0, update: 0, skip: 0, block: 0 };
  for (const action of actions) counts[action] += 1;
  return Object.freeze(counts);
}

export function shadowFingerprint(value) {
  return `sha256:${createHash("sha256")
    .update(stableStringify(value))
    .digest("hex")
    .slice(0, 16)}`;
}

function stableStringify(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
