import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY,
  validateSimulationCuratedApprovedVectorRecordV2,
} from "../src/lib/simulation-curated-approved-vector-record.ts";
import { createSimulationScenarioVectorHashV2 } from "../src/lib/simulation-scenario-vector-hash-v2.ts";
import {
  SYNTHETIC_APPROVED_VECTOR_OTHER_OWNER_ID,
  SYNTHETIC_APPROVED_VECTOR_OWNER_ID,
  SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
  createSyntheticCuratedApprovedVectorRecordV2,
} from "./fixtures/simulation-curated-approved-vector-record.mjs";

describe("Simulation curated approved-vector v2 record validator", () => {
  it("projects a valid current v2 approval to minimized immutable evidence", () => {
    const input = createSyntheticCuratedApprovedVectorRecordV2();
    const result = validateSimulationCuratedApprovedVectorRecordV2(input);

    assert.equal(result.status, "validated");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.blocker, null);
    assert.deepEqual(Object.keys(result.evidence).sort(), [
      "approvalRevision",
      "canonicalVector",
      "gate0ApprovalCommit",
      "portfolioPathPolicyId",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVectorHashVersion",
      "scenarioVersion",
    ]);
    assert.deepEqual(result.evidence.canonicalVector, [
      { market: "korea", currency: "KRW", ticker: "069500", weightBps: 5_000 },
      { market: "us", currency: "USD", ticker: "QQQ", weightBps: 5_000 },
    ]);
    assert.equal(result.evidence.approvalRevision, 1);

    const serialized = JSON.stringify(result);
    for (const forbidden of [
      SYNTHETIC_APPROVED_VECTOR_OWNER_ID,
      SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
      "lifecycleEvents",
      "approvedAt",
      "terminalAt",
      "approvalRevisionId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.evidence), true);
    assert.equal(Object.isFrozen(result.evidence.canonicalVector), true);
    assert.equal(Object.isFrozen(result.evidence.canonicalVector[0]), true);
  });

  it("fails closed on owner and selector mismatches", () => {
    const wrongOwner = createSyntheticCuratedApprovedVectorRecordV2();
    wrongOwner.expectedOwnerUserId = SYNTHETIC_APPROVED_VECTOR_OTHER_OWNER_ID;
    assertBlocked(wrongOwner, "approval_owner_mismatch");

    const wrongSelector = createSyntheticCuratedApprovedVectorRecordV2();
    wrongSelector.selector.scenarioVersion = "v2";
    assertBlocked(wrongSelector, "approval_selector_mismatch");

    const invalidOwner = createSyntheticCuratedApprovedVectorRecordV2();
    invalidOwner.expectedOwnerUserId = "not-an-owner";
    assertBlocked(invalidOwner, "expected_owner_invalid");

    const invalidSelector = createSyntheticCuratedApprovedVectorRecordV2();
    invalidSelector.selector.scenarioId = " invalid ";
    assertBlocked(invalidSelector, "scenario_selector_invalid");
  });

  it("rejects policy, Gate 0, and hash-version drift before hash comparison", () => {
    const policy = createSyntheticCuratedApprovedVectorRecordV2();
    policy.record.portfolioPathPolicyId = "other-policy";
    assertBlocked(policy, "approval_policy_mismatch");

    const gate = createSyntheticCuratedApprovedVectorRecordV2();
    gate.record.gate0ApprovalCommit = "0".repeat(40);
    assertBlocked(gate, "approval_policy_mismatch");

    for (const version of [undefined, "simulation_scenario_vector_hash_v1"] ) {
      const input = createSyntheticCuratedApprovedVectorRecordV2();
      if (version === undefined) {
        delete input.record.scenarioVectorHashVersion;
      } else {
        input.record.scenarioVectorHashVersion = version;
      }
      assertBlocked(input, "scenario_vector_hash_version_mismatch");
    }
  });

  it("validates revision, current lifecycle, and the single approval audit event", () => {
    const invalidRevision = createSyntheticCuratedApprovedVectorRecordV2();
    invalidRevision.record.approvalRevision = 0;
    assertBlocked(invalidRevision, "approval_revision_invalid");

    const terminal = createSyntheticCuratedApprovedVectorRecordV2();
    terminal.record.lifecycleStatus = "revoked";
    terminal.record.terminalAt = "2026-07-13T12:01:00.000Z";
    assertBlocked(terminal, "approval_lifecycle_invalid");

    const invalidDate = createSyntheticCuratedApprovedVectorRecordV2();
    invalidDate.record.approvedAt = "2026-07-13 12:00:00";
    assertBlocked(invalidDate, "approval_lifecycle_invalid");

    const wrongEventRevision = createSyntheticCuratedApprovedVectorRecordV2();
    wrongEventRevision.record.lifecycleEvents[0].approvalRevisionId =
      "22222222-2222-4222-8222-222222222222";
    assertBlocked(wrongEventRevision, "approval_audit_invalid");

    const wrongAuditVersion = createSyntheticCuratedApprovedVectorRecordV2();
    wrongAuditVersion.record.lifecycleEvents[0].auditVersion = "audit-v2";
    assertBlocked(wrongAuditVersion, "approval_audit_invalid");

    const mismatchedInstant = createSyntheticCuratedApprovedVectorRecordV2();
    mismatchedInstant.record.lifecycleEvents[0].transitionedAt =
      "2026-07-13T12:00:01.000Z";
    assertBlocked(mismatchedInstant, "approval_audit_invalid");
  });

  it("rejects malformed, unlinked, noncanonical, duplicate, and wrong-total vectors", () => {
    const empty = createSyntheticCuratedApprovedVectorRecordV2();
    empty.record.vectorRows = [];
    assertBlocked(empty, "scenario_vector_invalid");

    const unlinked = createSyntheticCuratedApprovedVectorRecordV2();
    unlinked.record.vectorRows[0].approvalRevisionId =
      "22222222-2222-4222-8222-222222222222";
    assertBlocked(unlinked, "scenario_vector_invalid");

    const outOfOrder = createSyntheticCuratedApprovedVectorRecordV2();
    outOfOrder.record.vectorRows.reverse();
    assertBlocked(outOfOrder, "scenario_vector_invalid");

    const duplicate = createSyntheticCuratedApprovedVectorRecordV2();
    duplicate.record.vectorRows[1] = {
      ...duplicate.record.vectorRows[0],
      weightBps: 5_000,
    };
    assertBlocked(duplicate, "scenario_vector_invalid");

    const wrongTotal = createSyntheticCuratedApprovedVectorRecordV2();
    wrongTotal.record.vectorRows[1].weightBps = 4_999;
    assertBlocked(wrongTotal, "scenario_vector_invalid");

    const tooMany = createSyntheticCuratedApprovedVectorRecordV2();
    tooMany.record.vectorRows = Array.from({ length: 65 }, (_, index) => ({
      approvalRevisionId: SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
      market: "us",
      currency: "USD",
      ticker: `T${String(index).padStart(2, "0")}`,
      weightBps: index === 0 ? 10_000 : 0,
    }));
    assertBlocked(tooMany, "scenario_vector_invalid");
  });

  it("preserves explicit zero-bps rows and detects digest mismatch", () => {
    const zeroRow = createSyntheticCuratedApprovedVectorRecordV2({
      vector: [
        { market: "korea", currency: "KRW", ticker: "069500", weightBps: 10_000 },
        { market: "us", currency: "USD", ticker: "QQQ", weightBps: 0 },
      ],
    });
    const valid = validateSimulationCuratedApprovedVectorRecordV2(zeroRow);
    assert.equal(valid.status, "validated");
    assert.equal(valid.evidence.canonicalVector.length, 2);
    assert.equal(valid.evidence.canonicalVector[1].weightBps, 0);

    const mismatch = createSyntheticCuratedApprovedVectorRecordV2();
    mismatch.record.scenarioVectorHash = `sha256:${"f".repeat(64)}`;
    assertBlocked(mismatch, "scenario_vector_hash_mismatch");
  });

  it("rejects extra fields and accessors without invoking caller code", () => {
    const extra = createSyntheticCuratedApprovedVectorRecordV2();
    extra.record.internalNote = "must-not-be-accepted";
    assertBlocked(extra, "invalid_input_shape");

    const accessor = createSyntheticCuratedApprovedVectorRecordV2();
    let calls = 0;
    Object.defineProperty(accessor.record, "ownerUserId", {
      enumerable: true,
      configurable: true,
      get() {
        calls += 1;
        return SYNTHETIC_APPROVED_VECTOR_OWNER_ID;
      },
    });
    assertBlocked(accessor, "invalid_input_shape");
    assert.equal(calls, 0);

    const trapped = createSyntheticCuratedApprovedVectorRecordV2();
    trapped.record = new Proxy(trapped.record, {
      ownKeys() {
        throw new Error("synthetic trap failure");
      },
    });
    assertBlocked(trapped, "invalid_input_shape");
  });

  it("pins the v2 public helper and keeps the validator free of I/O", () => {
    const hash = createSimulationScenarioVectorHashV2({
      scenarioId: "policy-pin",
      scenarioVersion: "v1",
      vector: [
        { market: "us", currency: "USD", ticker: "QQQ", weightBps: 10_000 },
      ],
    });
    assert.equal(hash.status, "hashable");
    assert.equal(
      hash.hashVersion,
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.scenarioVectorHashVersion,
    );
    assert.equal(
      hash.portfolioPathPolicyId,
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.portfolioPathPolicyId,
    );
    assert.equal(
      hash.gate0ApprovalCommit,
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.gate0ApprovalCommit,
    );
    assert.equal(
      SIMULATION_CURATED_APPROVED_VECTOR_RECORD_V2_POLICY.repositoryAccess,
      "forbidden_in_pure_validator",
    );

    const sourceExpectations = [
      ["src/lib/simulation-curated-approved-vector-record-policy.ts", []],
      [
        "src/lib/simulation-curated-approved-vector-record-types.ts",
        ["./simulation-scenario-vector-hash-v2.ts"],
      ],
      ["src/lib/simulation-curated-approved-vector-record-snapshot.ts", []],
      [
        "src/lib/simulation-curated-approved-vector-record-validation.ts",
        [
          "./simulation-curated-approved-vector-record-policy.ts",
          "./simulation-curated-approved-vector-record-snapshot.ts",
          "./simulation-curated-approved-vector-record-types.ts",
          "./simulation-scenario-vector-hash-v2.ts",
        ],
      ],
      [
        "src/lib/simulation-curated-approved-vector-record.ts",
        [
          "./simulation-curated-approved-vector-record-policy.ts",
          "./simulation-curated-approved-vector-record-types.ts",
          "./simulation-curated-approved-vector-record-validation.ts",
        ],
      ],
    ];
    const forbidden = [
      /@\/db|src\/db|drizzle|neon|postgres|next\/|server-only/i,
      /DATABASE_URL|process\.env|Deno\.env/i,
      /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b/,
      /node:(?:fs|http|https|net|tls|dns|child_process|worker_threads)/,
      /\bimport\s*\(|\brequire\s*\(|\bconsole\.\w+\s*\(/,
    ];

    for (const [path, expectedImports] of sourceExpectations) {
      const source = readFileSync(path, "utf8");
      assert.deepEqual(extractStaticModuleSpecifiers(source), expectedImports, path);
      for (const pattern of forbidden) {
        assert.doesNotMatch(source, pattern, `${path}: ${pattern}`);
      }
    }
  });
});

function assertBlocked(input, reason) {
  const result = validateSimulationCuratedApprovedVectorRecordV2(input);
  assert.equal(result.status, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.evidence, null);
  assert.deepEqual(result.blocker, { reason });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blocker), true);
}

function extractStaticModuleSpecifiers(source) {
  return [
    ...new Set(
      [...source.matchAll(/\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map(
        (match) => match[1] ?? match[2],
      ),
    ),
  ];
}
