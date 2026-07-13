import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY,
  resolveSimulationScenarioVectorApproval,
} from "../src/lib/simulation-scenario-vector-resolver.ts";
import {
  SYNTHETIC_RESOLVER_OWNER_A,
  SYNTHETIC_RESOLVER_OWNER_B,
  syntheticScenarioVectorResolverInput,
} from "./fixtures/simulation-scenario-vector-resolver.mjs";

describe("Simulation scenario vector approval resolver", () => {
  it("resolves a synthetic owner-scoped approved record to minimized evidence", () => {
    const input = syntheticScenarioVectorResolverInput();
    input.repositoryResult.record.internalNote = "must-not-project";
    const result = resolveSimulationScenarioVectorApproval(input);

    assert.equal(result.resolutionStatus, "resolved");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.blocker, null);
    assert.deepEqual(Object.keys(result).sort(), [
      "blocker",
      "evidence",
      "resolutionStatus",
      "runtimeTrustStatus",
    ]);
    assert.deepEqual(Object.keys(result.evidence).sort(), [
      "canonicalVector",
      "gate0ApprovalCommit",
      "portfolioPathPolicyId",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVectorHashVersion",
      "scenarioVersion",
    ]);
    assert.deepEqual(result.evidence.canonicalVector, [
      {
        market: "alpha",
        currency: "KRW",
        ticker: "SYN_A",
        weightBps: 6_000,
      },
      {
        market: "omega",
        currency: "USD",
        ticker: "SYN_B",
        weightBps: 4_000,
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      SYNTHETIC_RESOLVER_OWNER_A,
      "approvalRevision",
      "approvedAt",
      "lifecycleStatus",
      "auditEnvelope",
      "auditStatus",
      "repositoryResult",
      "must-not-project",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.evidence), true);
    assert.equal(Object.isFrozen(result.evidence.canonicalVector), true);
    assert.equal(Object.isFrozen(result.evidence.canonicalVector[0]), true);
  });

  it("maps every non-loaded normalized repository outcome to one blocker", () => {
    const cases = [
      ["not_found", "scenario_not_found"],
      ["not_current", "scenario_not_current"],
      ["unavailable", "repository_unavailable"],
      ["collision", "approval_collision"],
    ];

    for (const [state, reason] of cases) {
      const input = syntheticScenarioVectorResolverInput();
      input.repositoryResult = { state };
      assertBlocked(resolveSimulationScenarioVectorApproval(input), reason);
    }
  });

  it("uses not_requested to prove prerequisite lookup coherence", () => {
    const invalidTenant = syntheticScenarioVectorResolverInput();
    invalidTenant.tenantContext = null;
    invalidTenant.repositoryResult = { state: "not_requested" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalidTenant),
      "tenant_context_invalid",
    );

    const invalidSelector = syntheticScenarioVectorResolverInput();
    invalidSelector.selector = null;
    invalidSelector.repositoryResult = { state: "not_requested" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalidSelector),
      "scenario_selector_invalid",
    );

    const bothInvalid = syntheticScenarioVectorResolverInput();
    bothInvalid.tenantContext = null;
    bothInvalid.selector = null;
    bothInvalid.repositoryResult = { state: "not_requested" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(bothInvalid),
      "tenant_context_invalid",
    );

    const validPrerequisites = syntheticScenarioVectorResolverInput();
    validPrerequisites.repositoryResult = { state: "not_requested" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(validPrerequisites),
      "resolver_state_invalid",
    );
  });

  it("rejects any requested repository state after a malformed prerequisite", () => {
    const invalidTenant = syntheticScenarioVectorResolverInput();
    invalidTenant.tenantContext.ownerUserId = "not-a-uuid";
    invalidTenant.repositoryResult = { state: "not_found" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalidTenant),
      "resolver_state_invalid",
    );

    const invalidSelector = syntheticScenarioVectorResolverInput();
    invalidSelector.selector.scenarioId = " invalid ";
    invalidSelector.repositoryResult = { state: "unavailable" };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalidSelector),
      "resolver_state_invalid",
    );
  });

  it("rejects malformed normalized repository port shapes", () => {
    const variants = [
      { state: "unknown" },
      { state: "not_found", record: {} },
      { state: "not_requested", auditStatus: "verified" },
      { state: "loaded", auditStatus: "verified" },
      { state: "loaded", record: {}, auditStatus: "unknown" },
      null,
    ];

    for (const repositoryResult of variants) {
      const input = syntheticScenarioVectorResolverInput();
      input.repositoryResult = repositoryResult;
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "resolver_state_invalid",
      );
    }

    const invalidSelector = syntheticScenarioVectorResolverInput();
    invalidSelector.selector = null;
    invalidSelector.repositoryResult = {
      state: "not_requested",
      record: {},
    };
    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalidSelector),
      "resolver_state_invalid",
    );
  });

  it("validates only the exact minimal TenantContext shape", () => {
    const variants = [
      null,
      { ownerUserId: "not-a-uuid", role: "user" },
      { ownerUserId: SYNTHETIC_RESOLVER_OWNER_A, role: "unknown" },
      {
        ownerUserId: SYNTHETIC_RESOLVER_OWNER_A,
        role: "user",
        providerSubject: "forbidden-extra",
      },
    ];

    for (const tenantContext of variants) {
      const input = syntheticScenarioVectorResolverInput();
      input.tenantContext = tenantContext;
      input.repositoryResult = { state: "not_requested" };
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "tenant_context_invalid",
      );
    }
  });

  it("validates canonical selectors without coercion, trimming, or defaults", () => {
    const variants = [
      null,
      { scenarioId: "", scenarioVersion: "v1" },
      { scenarioId: " synthetic ", scenarioVersion: "v1" },
      { scenarioId: 1, scenarioVersion: "v1" },
      {
        scenarioId: "synthetic-resolver",
        scenarioVersion: "v1",
        latest: true,
      },
    ];

    for (const selector of variants) {
      const input = syntheticScenarioVectorResolverInput();
      input.selector = selector;
      input.repositoryResult = { state: "not_requested" };
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "scenario_selector_invalid",
      );
    }
  });

  it("keeps loaded owner and selector mismatches as integrity failures", () => {
    const wrongOwner = syntheticScenarioVectorResolverInput();
    wrongOwner.repositoryResult.record.canonicalOwnerUserId =
      SYNTHETIC_RESOLVER_OWNER_B;
    assertBlocked(
      resolveSimulationScenarioVectorApproval(wrongOwner),
      "loaded_record_owner_mismatch",
    );

    const wrongSelector = syntheticScenarioVectorResolverInput();
    wrongSelector.repositoryResult.record.scenarioVersion = "v2";
    assertBlocked(
      resolveSimulationScenarioVectorApproval(wrongSelector),
      "loaded_record_selector_mismatch",
    );

    const caseMismatch = syntheticScenarioVectorResolverInput();
    caseMismatch.selector.scenarioId = "Synthetic-resolver";
    assertBlocked(
      resolveSimulationScenarioVectorApproval(caseMismatch),
      "loaded_record_selector_mismatch",
    );
  });

  it("rejects policy and Gate 0 drift", () => {
    const policy = syntheticScenarioVectorResolverInput();
    policy.repositoryResult.record.portfolioPathPolicyId = "synthetic-policy";
    const gate = syntheticScenarioVectorResolverInput();
    gate.repositoryResult.record.gate0ApprovalCommit = "synthetic-gate";

    assertBlocked(
      resolveSimulationScenarioVectorApproval(policy),
      "approval_policy_mismatch",
    );
    assertBlocked(
      resolveSimulationScenarioVectorApproval(gate),
      "approval_policy_mismatch",
    );
  });

  it("rejects missing or non-v1 vector hash versions before hash validation", () => {
    const missing = syntheticScenarioVectorResolverInput();
    delete missing.repositoryResult.record.scenarioVectorHashVersion;
    const v2 = syntheticScenarioVectorResolverInput();
    v2.repositoryResult.record.scenarioVectorHashVersion =
      "simulation_scenario_vector_hash_v2";

    for (const input of [missing, v2]) {
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "scenario_vector_hash_version_mismatch",
      );
    }
  });

  it("rejects terminal or unknown lifecycle values in a loaded state", () => {
    for (const lifecycleStatus of ["revoked", "superseded", "unknown"]) {
      const input = syntheticScenarioVectorResolverInput();
      input.repositoryResult.record.lifecycleStatus = lifecycleStatus;
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "approval_lifecycle_invalid",
      );
    }
  });

  it("keeps audit invalid and unavailable states distinct", () => {
    const invalid = syntheticScenarioVectorResolverInput();
    invalid.repositoryResult.auditStatus = "invalid";
    const unavailable = syntheticScenarioVectorResolverInput();
    unavailable.repositoryResult.auditStatus = "unavailable";

    assertBlocked(
      resolveSimulationScenarioVectorApproval(invalid),
      "approval_audit_invalid",
    );
    assertBlocked(
      resolveSimulationScenarioVectorApproval(unavailable),
      "approval_audit_unavailable",
    );
  });

  it("validates record and audit-envelope revision equality", () => {
    const invalidTopLevel = syntheticScenarioVectorResolverInput();
    invalidTopLevel.repositoryResult.record.approvalRevision = 0;
    const mismatch = syntheticScenarioVectorResolverInput();
    mismatch.repositoryResult.record.auditEnvelope.approvalRevision = 8;
    const nonInteger = syntheticScenarioVectorResolverInput();
    nonInteger.repositoryResult.record.auditEnvelope.approvalRevision = 7.5;

    for (const input of [invalidTopLevel, mismatch, nonInteger]) {
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "approval_revision_invalid",
      );
    }
  });

  it("validates the minimal immutable audit envelope and UTC timestamp", () => {
    const invalidTopLevelDate = syntheticScenarioVectorResolverInput();
    invalidTopLevelDate.repositoryResult.record.approvedAt =
      "2026-01-02 03:04:05";
    const mismatchedDate = syntheticScenarioVectorResolverInput();
    mismatchedDate.repositoryResult.record.auditEnvelope.approvedAt =
      "2026-01-02T03:04:06.000Z";
    const wrongVersion = syntheticScenarioVectorResolverInput();
    wrongVersion.repositoryResult.record.auditEnvelope.version =
      "synthetic-audit-v2";
    const wrongDecision = syntheticScenarioVectorResolverInput();
    wrongDecision.repositoryResult.record.auditEnvelope.decisionKind =
      "synthetic-decision";
    const extraMetadata = syntheticScenarioVectorResolverInput();
    extraMetadata.repositoryResult.record.auditEnvelope.actor =
      "must-not-be-accepted";

    for (const input of [
      invalidTopLevelDate,
      mismatchedDate,
      wrongVersion,
      wrongDecision,
      extraMetadata,
    ]) {
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "approval_audit_envelope_invalid",
      );
    }
  });

  it("rejects malformed, noncanonical, duplicate, and wrong-total vectors", () => {
    const outOfOrder = syntheticScenarioVectorResolverInput();
    outOfOrder.repositoryResult.record.canonicalVector.reverse();
    const wrongTotal = syntheticScenarioVectorResolverInput();
    wrongTotal.repositoryResult.record.canonicalVector[1].weightBps = 3_999;
    const duplicate = syntheticScenarioVectorResolverInput();
    duplicate.repositoryResult.record.canonicalVector[1] = {
      ...duplicate.repositoryResult.record.canonicalVector[0],
      weightBps: 4_000,
    };
    const unsupportedCurrency = syntheticScenarioVectorResolverInput();
    unsupportedCurrency.repositoryResult.record.canonicalVector[1].currency =
      "EUR";
    const noncanonicalMarket = syntheticScenarioVectorResolverInput();
    noncanonicalMarket.repositoryResult.record.canonicalVector[0].market =
      "Alpha";
    const extraRowField = syntheticScenarioVectorResolverInput();
    extraRowField.repositoryResult.record.canonicalVector[0].note = "extra";

    for (const input of [
      outOfOrder,
      wrongTotal,
      duplicate,
      unsupportedCurrency,
      noncanonicalMarket,
      extraRowField,
    ]) {
      assertBlocked(
        resolveSimulationScenarioVectorApproval(input),
        "scenario_vector_invalid",
      );
    }
  });

  it("recalculates and compares the scenario vector hash", () => {
    const hashMismatch = syntheticScenarioVectorResolverInput();
    hashMismatch.repositoryResult.record.scenarioVectorHash =
      `sha256:${"f".repeat(64)}`;
    const identityDrift = syntheticScenarioVectorResolverInput();
    identityDrift.selector.scenarioId = "synthetic-resolver-v2";
    identityDrift.repositoryResult.record.scenarioId = "synthetic-resolver-v2";

    assertBlocked(
      resolveSimulationScenarioVectorApproval(hashMismatch),
      "scenario_vector_hash_mismatch",
    );
    assertBlocked(
      resolveSimulationScenarioVectorApproval(identityDrift),
      "scenario_vector_hash_mismatch",
    );
  });

  it("allows an explicit zero-weight synthetic row without dropping it", () => {
    const input = syntheticScenarioVectorResolverInput({
      scenarioId: "synthetic-zero-weight",
      vector: [
        {
          market: "alpha",
          currency: "KRW",
          ticker: "SYN_A",
          weightBps: 10_000,
        },
        {
          market: "omega",
          currency: "USD",
          ticker: "SYN_B",
          weightBps: 0,
        },
      ],
    });
    const result = resolveSimulationScenarioVectorApproval(input);

    assert.equal(result.resolutionStatus, "resolved");
    assert.equal(result.evidence.canonicalVector.length, 2);
    assert.equal(result.evidence.canonicalVector[1].weightBps, 0);
  });

  it("keeps the pure policy outside runtime trust and execution", () => {
    const result = resolveSimulationScenarioVectorApproval(
      syntheticScenarioVectorResolverInput(),
    );

    assert.equal(
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.runtimeTrustStatus,
      "not_established",
    );
    assert.equal(
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.repositoryAccess,
      "forbidden_in_pure_helper",
    );
    assert.equal(
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.scenarioVectorHashVersion,
      "simulation_scenario_vector_hash_v1",
    );
    assert.equal(
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.productionVectorAccess,
      "forbidden",
    );
    assert.deepEqual(
      SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.repositoryStates,
      [
        "not_requested",
        "not_found",
        "not_current",
        "unavailable",
        "collision",
        "loaded",
      ],
    );
    assert.equal(result.runtimeTrustStatus, "not_established");
  });
});

function assertBlocked(result, reason) {
  assert.equal(result.resolutionStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.evidence, null);
  assert.deepEqual(result.blocker, { reason });
  assert.deepEqual(Object.keys(result).sort(), [
    "blocker",
    "evidence",
    "resolutionStatus",
    "runtimeTrustStatus",
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.blocker), true);
}
