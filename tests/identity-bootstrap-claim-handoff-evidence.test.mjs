import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createIdentityBootstrapClaimHandoffEvidence,
  createIdentityBootstrapClaimHandoffEvidencePort,
  IdentityBootstrapClaimHandoffEvidenceError,
} from "../scripts/lib/identity-bootstrap-claim-handoff-evidence.mjs";

const TARGET_SHA256 = `sha256:${"1".repeat(64)}`;
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"2".repeat(64)}`;
const INTENT_SHA256 = `sha256:${"3".repeat(64)}`;
const DATABASE_TARGET_SHA256 = `sha256:${"4".repeat(64)}`;
const RAW_CLAIM =
  "varda-bootstrap-claim-v1.must-not-cross-public-evidence";
const RECORDED_AT = "2026-08-01T12:00:00.000Z";
const EXPIRES_AT = "2026-08-01T12:10:00.000Z";

describe("identity bootstrap claim handoff evidence", () => {
  it("stores only public receipt evidence outside the repository", () => {
    withDirectories(({ repositoryRoot, evidenceDirectory }) => {
      const port = createIdentityBootstrapClaimHandoffEvidencePort({
        repositoryRoot,
        evidenceDirectory,
        now: () => new Date(RECORDED_AT),
      });

      const result = port.store({
        receipt: receipt({ rawClaim: RAW_CLAIM }),
        databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      });

      assert.deepEqual(result, {
        status: "stored",
        receiptId: INTENT_SHA256,
      });
      const stored = readFileSync(
        evidencePath(evidenceDirectory),
        "utf8",
      );
      assert.equal(stored.includes(RAW_CLAIM), false);
      assert.equal(stored.includes(repositoryRoot), false);
      assert.deepEqual(JSON.parse(stored), {
        policyId: "identity_bootstrap_claim_handoff_evidence_v1",
        state: "issued_not_presented",
        recordedAt: RECORDED_AT,
        expiresAt: EXPIRES_AT,
        databaseTargetFingerprint: DATABASE_TARGET_SHA256,
        claimBinding: claimBinding(),
      });
    });
  });

  it("rejects expired evidence before writing", () => {
    assert.throws(
      () =>
        createIdentityBootstrapClaimHandoffEvidence({
          receipt: receipt(),
          databaseTargetFingerprint: DATABASE_TARGET_SHA256,
          now: () => new Date(EXPIRES_AT),
        }),
      hasCode("receipt_expired"),
    );
  });

  it("does not invoke accessor-backed receipt input", () => {
    let accessorCalls = 0;
    const value = { claimBinding: claimBinding() };
    Object.defineProperty(value, "expiresAt", {
      get() {
        accessorCalls += 1;
        return EXPIRES_AT;
      },
    });

    assert.throws(
      () =>
        createIdentityBootstrapClaimHandoffEvidence({
          receipt: value,
          databaseTargetFingerprint: DATABASE_TARGET_SHA256,
          now: () => new Date(RECORDED_AT),
        }),
      hasCode("receipt_evidence_invalid"),
    );
    assert.equal(accessorCalls, 0);
  });

  it("ignores inherited toJSON pollution while serializing", () => {
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "toJSON",
    );
    let calls = 0;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        calls += 1;
        return { polluted: true };
      },
    });
    try {
      const snapshot =
        createIdentityBootstrapClaimHandoffEvidence({
          receipt: receipt(),
          databaseTargetFingerprint: DATABASE_TARGET_SHA256,
          now: () => new Date(RECORDED_AT),
        });
      const serialized = JSON.stringify(snapshot);

      assert.equal(calls, 0);
      assert.equal(JSON.parse(serialized).policyId,
        "identity_bootstrap_claim_handoff_evidence_v1");
    } finally {
      if (previous) {
        Object.defineProperty(
          Object.prototype,
          "toJSON",
          previous,
        );
      } else {
        delete Object.prototype.toJSON;
      }
    }
  });

  it("blocks repository-local destinations", () => {
    withDirectories(({ repositoryRoot }) => {
      const insideRepository = join(repositoryRoot, "operator-evidence");
      mkdirSync(insideRepository);

      assert.throws(
        () =>
          createIdentityBootstrapClaimHandoffEvidencePort({
            repositoryRoot,
            evidenceDirectory: insideRepository,
          }),
        hasCode("receipt_evidence_directory_invalid"),
      );
    });
  });

  it("never overwrites an existing receipt evidence file", () => {
    withDirectories(({ repositoryRoot, evidenceDirectory }) => {
      const path = evidencePath(evidenceDirectory);
      writeFileSync(path, "existing evidence\n", "utf8");
      const port = createIdentityBootstrapClaimHandoffEvidencePort({
        repositoryRoot,
        evidenceDirectory,
        now: () => new Date(RECORDED_AT),
      });

      assert.throws(
        () =>
          port.store({
            receipt: receipt(),
            databaseTargetFingerprint: DATABASE_TARGET_SHA256,
          }),
        hasCode("receipt_evidence_write_failed"),
      );
      assert.equal(readFileSync(path, "utf8"), "existing evidence\n");
    });
  });

  it("blocks receipt reuse in the same operator process", () => {
    withDirectories(({ repositoryRoot, evidenceDirectory }) => {
      const port = createIdentityBootstrapClaimHandoffEvidencePort({
        repositoryRoot,
        evidenceDirectory,
        now: () => new Date(RECORDED_AT),
      });
      const input = {
        receipt: receipt(),
        databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      };

      port.store(input);
      assert.throws(
        () => port.store(input),
        hasCode("receipt_evidence_reuse_blocked"),
      );
    });
  });
});

function receipt(extra = {}) {
  return {
    expiresAt: EXPIRES_AT,
    claimBinding: claimBinding(),
    ...extra,
  };
}

function claimBinding() {
  return {
    targetAppUserSha256: TARGET_SHA256,
    provider: "neon_auth",
    claimDigestVersion: "bootstrap_claim_sha256_v1",
    claimDigest: CLAIM_DIGEST,
    identityPairingIntentSha256: INTENT_SHA256,
  };
}

function evidencePath(evidenceDirectory) {
  return join(
    evidenceDirectory,
    `identity-bootstrap-claim-receipt-${"3".repeat(64)}.json`,
  );
}

function hasCode(code) {
  return (error) =>
    error instanceof IdentityBootstrapClaimHandoffEvidenceError &&
    error.code === code;
}

function withDirectories(run) {
  const root = mkdtempSync(join(tmpdir(), "varda-claim-evidence-"));
  const repositoryRoot = join(root, "repository");
  const evidenceDirectory = join(root, "operator-evidence");
  mkdirSync(repositoryRoot);
  mkdirSync(evidenceDirectory);
  try {
    run({ repositoryRoot, evidenceDirectory });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
