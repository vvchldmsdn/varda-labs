import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { readClaimBinding } from "./one-user-bootstrap-binding.mjs";
import {
  attestOwnerScopedPathAccess,
} from "./operator-evidence-path-security.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY =
  Object.freeze({
    policyId: "identity_bootstrap_claim_handoff_evidence_v1",
    state: "issued_not_presented",
    persistence: "atomic_create_only_local_file",
    fileMode: 0o600,
    accessControl: "owner_scoped_platform_acl_attested",
    crashDurability: "not_claimed",
  });

export class IdentityBootstrapClaimHandoffEvidenceError extends Error {
  constructor(code) {
    super("Identity bootstrap claim handoff evidence failed");
    this.name = "IdentityBootstrapClaimHandoffEvidenceError";
    this.code = code;
  }
}

export function createIdentityBootstrapClaimHandoffEvidencePort({
  repositoryRoot,
  evidenceDirectory,
  now = () => new Date(),
  writeEvidence = writeAtomicCreateOnlyEvidence,
  attestPathAccess = attestOwnerScopedPathAccess,
} = {}) {
  if (
    typeof now !== "function" ||
    typeof writeEvidence !== "function" ||
    typeof attestPathAccess !== "function"
  ) {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_port_invalid",
    );
  }
  const directory = assertEvidenceDirectory({
    repositoryRoot,
    evidenceDirectory,
  });
  attestEvidencePathAccess({
    path: directory,
    pathType: "directory",
    attestPathAccess,
  });
  const storedReceiptIds = new Set();

  return Object.freeze({
    store({ receipt, databaseTargetFingerprint }) {
      const snapshot = createIdentityBootstrapClaimHandoffEvidence({
        receipt,
        databaseTargetFingerprint,
        now,
      });
      const receiptId = snapshot.claimBinding.identityPairingIntentSha256;
      if (storedReceiptIds.has(receiptId)) {
        throw new IdentityBootstrapClaimHandoffEvidenceError(
          "receipt_evidence_reuse_blocked",
        );
      }
      const evidenceFile = join(
        directory,
        `identity-bootstrap-claim-receipt-${receiptId.slice("sha256:".length)}.json`,
      );
      try {
        writeEvidence(evidenceFile, snapshot);
      } catch (error) {
        if (error instanceof IdentityBootstrapClaimHandoffEvidenceError) {
          throw error;
        }
        throw new IdentityBootstrapClaimHandoffEvidenceError(
          "receipt_evidence_write_failed",
        );
      }
      try {
        attestEvidencePathAccess({
          path: evidenceFile,
          pathType: "file",
          attestPathAccess,
        });
      } catch {
        try {
          unlinkSync(evidenceFile);
        } catch {
          // The receipt is public evidence; fail closed before claim reveal.
        }
        throw new IdentityBootstrapClaimHandoffEvidenceError(
          "receipt_evidence_access_control_invalid",
        );
      }
      storedReceiptIds.add(receiptId);
      return Object.freeze({
        status: "stored",
        receiptId,
      });
    },
  });
}

export function createIdentityBootstrapClaimHandoffEvidence({
  receipt,
  databaseTargetFingerprint,
  now = () => new Date(),
} = {}) {
  if (!SHA256_PATTERN.test(databaseTargetFingerprint)) {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "database_target_fingerprint_invalid",
    );
  }
  const expiresAt = readRequiredOwnString(
    receipt,
    "expiresAt",
    "receipt_evidence_invalid",
  );
  const expiryTime = Date.parse(expiresAt);
  if (
    !Number.isFinite(expiryTime) ||
    new Date(expiryTime).toISOString() !== expiresAt
  ) {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_invalid",
    );
  }
  let recordedAt;
  try {
    const current = now();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
      throw new Error("invalid clock");
    }
    recordedAt = current.toISOString();
    if (expiryTime <= current.getTime()) {
      throw new IdentityBootstrapClaimHandoffEvidenceError(
        "receipt_expired",
      );
    }
  } catch (error) {
    if (error instanceof IdentityBootstrapClaimHandoffEvidenceError) {
      throw error;
    }
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_clock_invalid",
    );
  }

  let claimBinding;
  try {
    claimBinding = readClaimBinding(
      readRequiredOwnObject(
        receipt,
        "claimBinding",
        "receipt_evidence_invalid",
      ),
    );
  } catch {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_invalid",
    );
  }

  const publicClaimBinding = createNullRecord({
    targetAppUserSha256: claimBinding.targetAppUserSha256,
    provider: claimBinding.provider,
    claimDigestVersion: claimBinding.claimDigestVersion,
    claimDigest: claimBinding.claimDigest,
    identityPairingIntentSha256:
      claimBinding.identityPairingIntentSha256,
  });
  return createNullRecord({
    policyId:
      IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY.policyId,
    state: IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY.state,
    recordedAt,
    expiresAt,
    databaseTargetFingerprint,
    claimBinding: publicClaimBinding,
  });
}

function writeAtomicCreateOnlyEvidence(evidenceFile, snapshot) {
  const temporaryFile = `${evidenceFile}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${JSON.stringify(snapshot)}\n`;
  let descriptor = null;
  let finalFileCreated = false;
  try {
    descriptor = openSync(
      temporaryFile,
      "wx",
      IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY.fileMode,
    );
    writeFileSync(descriptor, serialized, {
      encoding: "utf8",
    });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    linkSync(temporaryFile, evidenceFile);
    finalFileCreated = true;
    unlinkSync(temporaryFile);
    syncParentDirectoryWhenSupported(dirname(evidenceFile));
    if (readFileSync(evidenceFile, "utf8") !== serialized) {
      throw new Error("receipt evidence readback mismatch");
    }
  } catch {
    if (finalFileCreated) {
      try {
        unlinkSync(evidenceFile);
        syncParentDirectoryWhenSupported(dirname(evidenceFile));
      } catch {
        // Keep the original persistence failure authoritative.
      }
    }
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_write_failed",
    );
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Keep the original filesystem failure authoritative.
      }
    }
    try {
      unlinkSync(temporaryFile);
    } catch {
      // The temporary path is absent after a successful link.
    }
  }
}

function syncParentDirectoryWhenSupported(directory) {
  if (process.platform === "win32") return;
  let descriptor = null;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function attestEvidencePathAccess({
  path,
  pathType,
  attestPathAccess,
}) {
  try {
    attestPathAccess(path, pathType);
  } catch {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_access_control_invalid",
    );
  }
}

function assertEvidenceDirectory({ repositoryRoot, evidenceDirectory }) {
  if (
    typeof repositoryRoot !== "string" ||
    !isAbsolute(repositoryRoot) ||
    typeof evidenceDirectory !== "string" ||
    !isAbsolute(evidenceDirectory)
  ) {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_directory_invalid",
    );
  }
  try {
    const requestedDirectory = resolve(evidenceDirectory);
    const stat = lstatSync(requestedDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("invalid directory");
    }
    const root = realpathSync(resolve(repositoryRoot));
    const directory = realpathSync(requestedDirectory);
    const relativeToRoot = relative(root, directory);
    if (
      relativeToRoot === "" ||
      (!relativeToRoot.startsWith("..") &&
        !isAbsolute(relativeToRoot))
    ) {
      throw new Error("repository-local directory");
    }
    return directory;
  } catch {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_directory_invalid",
    );
  }
}

function createNullRecord(value) {
  return Object.freeze(
    Object.assign(Object.create(null), value),
  );
}

function readRequiredOwnObject(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (result === null || typeof result !== "object") {
    throw new IdentityBootstrapClaimHandoffEvidenceError(code);
  }
  return result;
}

function readRequiredOwnString(value, key, code) {
  const result = readOwnDataValue(value, key);
  if (typeof result !== "string") {
    throw new IdentityBootstrapClaimHandoffEvidenceError(code);
  }
  return result;
}

function readOwnDataValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}
