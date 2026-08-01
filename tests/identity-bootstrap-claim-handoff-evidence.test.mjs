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
import {
  assertOwnerScopedPathSecurity,
} from "../scripts/lib/operator-evidence-path-security.mjs";

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
        attestPathAccess: allowPathAccess,
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
            attestPathAccess: allowPathAccess,
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
        attestPathAccess: allowPathAccess,
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
        attestPathAccess: allowPathAccess,
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

  it("requires an owner-scoped Windows directory ACL", () => {
    const currentUserId = "S-1-5-21-1-2-3-1001";
    const base = {
      platform: "win32",
      currentUserId,
      ownerId: currentUserId,
      accessRulesProtected: true,
      allowPrincipalIds: [
        currentUserId,
        "S-1-5-18",
        "S-1-5-32-544",
      ],
    };

    assert.doesNotThrow(() =>
      assertOwnerScopedPathSecurity(
        base,
        "directory",
      ));
    for (const security of [
      { ...base, ownerId: "S-1-5-21-9-9-9-1002" },
      { ...base, accessRulesProtected: false },
      {
        ...base,
        allowPrincipalIds: [
          ...base.allowPrincipalIds,
          "S-1-5-32-545",
        ],
      },
    ]) {
      assert.throws(
        () =>
          assertOwnerScopedPathSecurity(
            security,
            "directory",
          ),
        /operator evidence path security invalid/,
      );
    }
  });

  it("requires exact owner-only POSIX modes", () => {
    const base = {
      platform: "posix",
      currentUserId: "1000",
      ownerId: "1000",
    };
    assert.doesNotThrow(() =>
      assertOwnerScopedPathSecurity(
        { ...base, mode: 0o700 },
        "directory",
      ));
    assert.doesNotThrow(() =>
      assertOwnerScopedPathSecurity(
        { ...base, mode: 0o600 },
        "file",
      ));
    assert.throws(
      () =>
        assertOwnerScopedPathSecurity(
          { ...base, mode: 0o755 },
          "directory",
        ),
      /operator evidence path security invalid/,
    );
  });

  it("checks directory access before writing and file access after", () => {
    withDirectories(({ repositoryRoot, evidenceDirectory }) => {
      const checks = [];
      const port = createIdentityBootstrapClaimHandoffEvidencePort({
        repositoryRoot,
        evidenceDirectory,
        now: () => new Date(RECORDED_AT),
        attestPathAccess(path, pathType) {
          checks.push({ path, pathType });
        },
      });

      port.store({
        receipt: receipt(),
        databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      });

      assert.deepEqual(checks, [
        { path: evidenceDirectory, pathType: "directory" },
        { path: evidencePath(evidenceDirectory), pathType: "file" },
      ]);
    });
  });

  it("removes newly written evidence and fails before handoff when file ACL is broad", () => {
    withDirectories(({ repositoryRoot, evidenceDirectory }) => {
      const port = createIdentityBootstrapClaimHandoffEvidencePort({
        repositoryRoot,
        evidenceDirectory,
        now: () => new Date(RECORDED_AT),
        attestPathAccess(_path, pathType) {
          if (pathType === "file") {
            throw new Error("broad ACL");
          }
        },
      });

      assert.throws(
        () =>
          port.store({
            receipt: receipt(),
            databaseTargetFingerprint: DATABASE_TARGET_SHA256,
          }),
        hasCode("receipt_evidence_access_control_invalid"),
      );
      assert.equal(
        readFileIfPresent(evidencePath(evidenceDirectory)),
        null,
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

function allowPathAccess() {}

function readFileIfPresent(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
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
