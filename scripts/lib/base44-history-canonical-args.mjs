import path from "node:path";

import { isCanonicalUuid } from "./migration-canonical-owner-shadow.mjs";

export class HistoryImportArgumentError extends Error {
  constructor(code) {
    super("Base44 history import arguments are invalid");
    this.name = "HistoryImportArgumentError";
    this.code = code;
  }
}

export function parseBase44HistoryArgs(
  argv,
  {
    defaultDataDir = path.resolve(
      process.cwd(),
      "..",
      "gyeol-fin",
      "migration-data",
    ),
    legacyOwnerUserId = "base44-import",
  } = {},
) {
  const args = {
    dataDir: defaultDataDir,
    write: false,
    ownerUserId: legacyOwnerUserId,
    canonicalOwnerId: null,
    approveProvisioningOwner: false,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write" && !seen.has(arg)) {
      seen.add(arg);
      args.write = true;
      continue;
    }
    if (arg === "--approve-provisioning-owner" && !seen.has(arg)) {
      seen.add(arg);
      args.approveProvisioningOwner = true;
      continue;
    }
    if (
      ["--data-dir", "--owner-user-id", "--canonical-owner-id"].includes(
        arg,
      ) &&
      !seen.has(arg)
    ) {
      seen.add(arg);
      const value = argv[index + 1] ?? "";
      index += 1;
      if (arg === "--data-dir") args.dataDir = path.resolve(value);
      if (arg === "--owner-user-id") args.ownerUserId = value;
      if (arg === "--canonical-owner-id") {
        args.canonicalOwnerId = value.trim().toLowerCase();
      }
      continue;
    }
    throw new HistoryImportArgumentError("unsupported_or_duplicate_argument");
  }

  if (!args.ownerUserId.trim()) {
    throw new HistoryImportArgumentError("missing_legacy_owner_evidence");
  }
  if (
    args.canonicalOwnerId !== null &&
    !isCanonicalUuid(args.canonicalOwnerId)
  ) {
    throw new HistoryImportArgumentError("invalid_canonical_owner_id");
  }
  if (args.approveProvisioningOwner && args.canonicalOwnerId === null) {
    throw new HistoryImportArgumentError("approval_without_canonical_owner");
  }
  if (args.write && args.canonicalOwnerId !== null) {
    throw new HistoryImportArgumentError("canonical_owner_write_not_enabled");
  }

  return Object.freeze(args);
}
