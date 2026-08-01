import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { readClaimBinding } from "./one-user-bootstrap-binding.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY =
  Object.freeze({
    policyId: "identity_bootstrap_claim_handoff_evidence_v1",
    state: "issued_not_presented",
    persistence: "atomic_create_only_local_file",
    fileMode: 0o600,
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
} = {}) {
  const directory = assertEvidenceDirectory({
    repositoryRoot,
    evidenceDirectory,
  });
  if (typeof now !== "function" || typeof writeEvidence !== "function") {
    throw new IdentityBootstrapClaimHandoffEvidenceError(
      "receipt_evidence_port_invalid",
    );
  }
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
  let descriptor = null;
  try {
    descriptor = openSync(
      temporaryFile,
      "wx",
      IDENTITY_BOOTSTRAP_CLAIM_HANDOFF_EVIDENCE_POLICY.fileMode,
    );
    writeFileSync(descriptor, `${JSON.stringify(snapshot)}\n`, {
      encoding: "utf8",
    });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    linkSync(temporaryFile, evidenceFile);
    unlinkSync(temporaryFile);
  } catch {
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
