import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER,
  SIMULATION_CURATED_ADMISSION_PLANNER_POLICY,
  planSyntheticCuratedVectorAdmission,
} from "../src/lib/simulation-curated-admission-planner.ts";
import {
  parseSimulationCuratedAdmissionSyntheticInstant,
  serializeSimulationCuratedAdmissionEnvelope,
} from "../src/lib/simulation-curated-admission-planner-serialization.ts";
import { createSimulationScenarioVectorHashV2 } from "../src/lib/simulation-scenario-vector-hash-v2.ts";
import {
  SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
  SYNTHETIC_CURATED_ADMISSION_ENVELOPE_JSON,
  SYNTHETIC_CURATED_ADMISSION_OWNER_ID,
  SYNTHETIC_CURATED_ADMISSION_V2_DIGEST,
  createSyntheticCuratedAdmissionPlannerInput,
  createSyntheticCuratedAdmissionRows,
} from "./fixtures/simulation-curated-admission-planner.mjs";

describe("synthetic curated admission planner", () => {
  it("returns only synthetic precondition evidence for the pinned fixture", () => {
    const result = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput(),
    );

    assert.deepEqual(result, {
      policyId: "curated_vector_synthetic_admission_planner_v1",
      policyVersion: 1,
      mode: "synthetic_only",
      runtimeTrustStatus: "not_established",
      readinessStatus: "not_ready",
      decision: "synthetic_preconditions_satisfied",
      intent: "initial_approval",
      blockers: [],
      rowCount: 2,
      totalWeightBps: 10_000,
      zeroWeightRowCount: 0,
      checks: {
        policyBinding: "pass",
        actorAssumptions: "pass",
        exactIdentityShape: "pass",
        sourceVector: "pass",
        vectorHash: "pass",
        approvalEnvelope: "pass",
        confirmationAssumptions: "pass",
        durableStateAssumptions: "pass",
      },
    });
  });

  it("pins policy, caps, decisions, and ordered blocker vocabulary", () => {
    assert.deepEqual(SIMULATION_CURATED_ADMISSION_PLANNER_POLICY, {
      policyId: "curated_vector_synthetic_admission_planner_v1",
      policyVersion: 1,
      mode: "synthetic_only",
      runtimeTrustStatus: "not_established",
      readinessStatus: "not_ready",
      evidenceSource: "caller_supplied_synthetic_unverified",
      supportedIntent: "initial_approval",
      supportedActorMode: "tenant_self_approval_v1",
      confirmationPolicyId: "curated_vector_self_confirmation_v1",
      vectorHashVersion: "simulation_scenario_vector_hash_v2",
      approvalEnvelopeDigestVersion:
        "curated_vector_approval_envelope_digest_v1",
      portfolioPathPolicyId: "gross_normalized_buy_and_hold_v1",
      gate0ApprovalCommit: "652b9ea9c9b48f51dc4c68e8f148132ca8893d7e",
      writeSafetyApprovalCommit:
        "c0a2f584e167f153db0dedb6cfc418d76b2fc5bd",
      contractApprovalCommit:
        "38e7981cc2c2e61b9ce50c2e52edc09770b0d70a",
      maxVectorRows: 64,
      requiredWeightTotalBps: 10_000,
      maxCanonicalInputBytes: 32_768,
    });
    assert.equal(Object.isFrozen(SIMULATION_CURATED_ADMISSION_PLANNER_POLICY), true);
    assert.equal(
      Object.isFrozen(SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER),
      true,
    );
    assert.equal(SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER.length, 30);
  });

  it("covers every blocker and preserves the frozen policy order", () => {
    const cases = blockerCases();
    const seen = new Set();

    for (const [expected, input] of cases) {
      const result = planSyntheticCuratedVectorAdmission(input);
      assert.equal(result.decision, "blocked", expected);
      assert.ok(result.blockers.includes(expected), expected);
      assertInPolicyOrder(result.blockers);
      for (const blocker of result.blockers) seen.add(blocker);
    }

    assert.deepEqual(
      [...SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER].filter((blocker) =>
        seen.has(blocker),
      ),
      [...SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER],
    );
  });

  it("keeps the output intent fixed when input is malformed or unsupported", () => {
    const malformed = planSyntheticCuratedVectorAdmission(null);
    const unsupported = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        exactIdentity: { intent: "replacement_approval" },
      }),
    );

    assert.equal(malformed.intent, "initial_approval");
    assert.equal(unsupported.intent, "initial_approval");
    assert.deepEqual(malformed.blockers, ["invalid_synthetic_input"]);
    assert.ok(unsupported.blockers.includes("unsupported_admission_intent"));
  });

  it("covers every synthetic actor assumption failure enum", () => {
    const cases = [
      ["sessionAssumption", "not_verified", "synthetic_session_not_verified_active"],
      ["sessionAssumption", "inactive", "synthetic_session_not_verified_active"],
      ["sessionAssumption", "unknown", "synthetic_session_not_verified_active"],
      [
        "identityMappingAssumption",
        "missing",
        "synthetic_identity_mapping_not_exactly_one_active",
      ],
      [
        "identityMappingAssumption",
        "ambiguous",
        "synthetic_identity_mapping_not_exactly_one_active",
      ],
      [
        "identityMappingAssumption",
        "inactive",
        "synthetic_identity_mapping_not_exactly_one_active",
      ],
      [
        "identityMappingAssumption",
        "unknown",
        "synthetic_identity_mapping_not_exactly_one_active",
      ],
      ["appUserAssumption", "provisioning", "synthetic_app_user_not_active"],
      ["appUserAssumption", "disabled", "synthetic_app_user_not_active"],
      ["appUserAssumption", "missing", "synthetic_app_user_not_active"],
      ["appUserAssumption", "unknown", "synthetic_app_user_not_active"],
      ["actorOwnerAssumption", "mismatch", "synthetic_actor_owner_mismatch"],
      ["actorOwnerAssumption", "unknown", "synthetic_actor_owner_mismatch"],
    ];

    for (const [field, value, blocker] of cases) {
      const result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          actorAssumptions: { [field]: value },
        }),
      );
      assert.ok(result.blockers.includes(blocker), `${field}=${value}`);
    }
  });

  it("covers every minimal durable-state assumption enum", () => {
    const cases = [
      [
        "approvalRevisionAssumption",
        "current_approval_exists",
        "synthetic_current_approval_exists",
      ],
      [
        "approvalRevisionAssumption",
        "prior_revision_exists",
        "synthetic_prior_revision_exists",
      ],
      [
        "approvalRevisionAssumption",
        "unknown",
        "synthetic_durable_state_unproven",
      ],
      [
        "competingChallengeAssumption",
        "live_competitor_present",
        "synthetic_competing_challenge",
      ],
      [
        "competingChallengeAssumption",
        "unknown",
        "synthetic_durable_state_unproven",
      ],
    ];

    for (const [field, value, blocker] of cases) {
      const result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          durableStateAssumptions: { [field]: value },
        }),
      );
      assert.ok(result.blockers.includes(blocker), `${field}=${value}`);
    }
  });

  it("covers every non-pending confirmation state", () => {
    for (const state of [
      "consumed",
      "expired",
      "invalidated",
      "conflicted",
      "unknown",
    ]) {
      const result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          confirmationAssumptions: { state },
        }),
      );
      assert.ok(result.blockers.includes("confirmation_not_pending"), state);
    }

    for (const ownerBindingAssumption of ["mismatch", "unknown"]) {
      const result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          confirmationAssumptions: { ownerBindingAssumption },
        }),
      );
      assert.ok(
        result.blockers.includes("confirmation_owner_binding_mismatch"),
        ownerBindingAssumption,
      );
    }
  });

  it("enforces empty, 64-row, and 65-row boundaries before row reads", () => {
    const empty = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({ vector: [] }),
    );
    const sixtyFour = planSyntheticCuratedVectorAdmission(
      bindInput(
        createSyntheticCuratedAdmissionPlannerInput({
          vector: createSyntheticCuratedAdmissionRows(64, true),
        }),
      ),
    );
    const sixtyFive = new Array(65);
    let indexGetterCalls = 0;
    Object.defineProperty(sixtyFive, "0", {
      enumerable: true,
      configurable: true,
      get() {
        indexGetterCalls += 1;
        return { market: "us", currency: "USD", ticker: "NOPE", weightBps: 1 };
      },
    });
    const overCap = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({ vector: sixtyFive }),
    );

    assert.deepEqual(
      [empty.rowCount, empty.zeroWeightRowCount, empty.totalWeightBps],
      [0, 0, 0],
    );
    assert.ok(empty.blockers.includes("source_vector_empty"));
    assert.ok(empty.blockers.includes("source_vector_total_not_10000_bps"));
    assert.equal(sixtyFour.decision, "synthetic_preconditions_satisfied");
    assert.deepEqual(
      [sixtyFour.rowCount, sixtyFour.zeroWeightRowCount, sixtyFour.totalWeightBps],
      [64, 63, 10_000],
    );
    assert.deepEqual(
      [overCap.rowCount, overCap.zeroWeightRowCount, overCap.totalWeightBps],
      [null, null, null],
    );
    assert.deepEqual(overCap.blockers, ["source_vector_row_cap_exceeded"]);
    assert.equal(indexGetterCalls, 0);
  });

  it("rejects duplicates, noncanonical ASCII order, and unsupported identity axes", () => {
    const duplicate = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [
          { market: "us", currency: "USD", ticker: "SAME", weightBps: 5_000 },
          { market: "us", currency: "USD", ticker: "SAME", weightBps: 5_000 },
        ],
      }),
    );
    const reversed = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [
          { market: "us", currency: "USD", ticker: "A:B", weightBps: 5_000 },
          { market: "us", currency: "USD", ticker: "A.B", weightBps: 5_000 },
        ],
      }),
    );
    const eur = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [{ market: "us", currency: "EUR", ticker: "ONLY", weightBps: 10_000 }],
      }),
    );

    assert.ok(duplicate.blockers.includes("duplicate_instrument_identity"));
    assert.ok(reversed.blockers.includes("source_vector_not_canonical_order"));
    assert.ok(eur.blockers.includes("invalid_instrument_identity"));
  });

  it("rejects invalid numeric weights without renormalizing or unsafe totals", () => {
    for (const weightBps of ["10000", null, Number.NaN, Infinity, -1, -0, 1.5, 10_001, Number.MAX_SAFE_INTEGER]) {
      const result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          vector: [{ market: "us", currency: "USD", ticker: "ONLY", weightBps }],
        }),
      );
      assert.ok(result.blockers.includes("invalid_weight_bps"), String(weightBps));
      assert.equal(result.totalWeightBps, null);
      assert.equal(result.zeroWeightRowCount, null);
      assert.equal(result.checks.vectorHash, "not_evaluated");
    }

    const wrongTotal = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [{ market: "us", currency: "USD", ticker: "ONLY", weightBps: 9_999 }],
      }),
    );
    assert.ok(wrongTotal.blockers.includes("source_vector_total_not_10000_bps"));
    assert.equal(wrongTotal.totalWeightBps, 9_999);
  });

  it("pins v2 hash compatibility and keeps canonical serialization out of output", () => {
    const v2 = createSimulationScenarioVectorHashV2({
      scenarioId: "synthetic-punctuation-order",
      scenarioVersion: "v2-fixture-1",
      vector: createSyntheticCuratedAdmissionPlannerInput().vector,
    });
    const result = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput(),
    );

    assert.equal(v2.status, "hashable");
    assert.equal(v2.scenarioVectorHash, SYNTHETIC_CURATED_ADMISSION_V2_DIGEST);
    assert.equal(result.checks.vectorHash, "pass");
    assert.equal(JSON.stringify(result).includes("canonicalSerialization"), false);
    assert.equal(JSON.stringify(result).includes(SYNTHETIC_CURATED_ADMISSION_V2_DIGEST), false);
  });

  it("pins envelope bytes and makes every bound field digest-sensitive", () => {
    const input = createSyntheticCuratedAdmissionPlannerInput();
    const envelope = envelopeInput(input);
    const baseline = serializeSimulationCuratedAdmissionEnvelope(envelope);

    assert.equal(baseline.status, "serialized");
    assert.equal(
      baseline.canonicalSerialization,
      SYNTHETIC_CURATED_ADMISSION_ENVELOPE_JSON,
    );
    assert.equal(
      baseline.approvalEnvelopeDigest,
      SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
    );
    assert.equal(baseline.byteLength, 751);

    const mutations = [
      { actorMode: "tenant_self_approval_v2" },
      { confirmationPolicyId: "curated_vector_self_confirmation_v2" },
      { intent: "replacement_approval" },
      { ownerUserId: "22222222-2222-4222-8222-222222222222" },
      { portfolioPathPolicyId: "synthetic_other_policy_v1" },
      { gate0ApprovalCommit: "0".repeat(40) },
      { scenarioId: "synthetic-other-scenario" },
      { scenarioVersion: "v2-fixture-2" },
      { vectorHashVersion: "simulation_scenario_vector_hash_v3" },
      { scenarioVectorHash: `sha256:${"0".repeat(64)}` },
      {
        vector: [
          { market: "us", currency: "USD", ticker: "A.B", weightBps: 4_999 },
          { market: "us", currency: "USD", ticker: "A:B", weightBps: 5_001 },
        ],
      },
    ];
    for (const mutation of mutations) {
      const changed = serializeSimulationCuratedAdmissionEnvelope({
        ...envelope,
        ...mutation,
      });
      assert.equal(changed.status, "serialized");
      assert.notEqual(
        changed.approvalEnvelopeDigest,
        baseline.approvalEnvelopeDigest,
        JSON.stringify(mutation),
      );
    }
  });

  it("parses strict UTC instants without a current-clock read", () => {
    const valid = [
      "2000-02-29T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2099-12-31T23:59:59.999Z",
    ];
    const invalid = [
      "1999-12-31T23:59:59.999Z",
      "2100-01-01T00:00:00.000Z",
      "2026-02-29T00:00:00.000Z",
      "2026-01-01T00:00:60.000Z",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.000+00:00",
    ];
    for (const value of valid) {
      assert.equal(Number.isSafeInteger(parseSimulationCuratedAdmissionSyntheticInstant(value)), true);
    }
    for (const value of invalid) {
      assert.equal(parseSimulationCuratedAdmissionSyntheticInstant(value), null);
    }

    const priorDateNow = Date.now;
    let result;
    try {
      Date.now = () => {
        throw new Error("clock must not be read");
      };
      result = planSyntheticCuratedVectorAdmission(
        createSyntheticCuratedAdmissionPlannerInput({
          confirmationAssumptions: {
            syntheticEvaluationTime: "2026-01-01T00:00:00.000Z",
          },
        }),
      );
    } finally {
      Date.now = priorDateNow;
    }
    assert.equal(result.decision, "synthetic_preconditions_satisfied");
  });

  it("applies the inclusive-issued and exclusive-expiry interval", () => {
    const atIssued = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: {
          syntheticEvaluationTime: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    const beforeIssued = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: {
          syntheticEvaluationTime: "2025-12-31T23:59:59.999Z",
        },
      }),
    );
    const atExpiry = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: {
          syntheticEvaluationTime: "2026-01-01T00:10:00.000Z",
        },
      }),
    );

    assert.equal(atIssued.decision, "synthetic_preconditions_satisfied");
    assert.ok(beforeIssued.blockers.includes("confirmation_not_yet_valid"));
    assert.ok(atExpiry.blockers.includes("confirmation_expired"));
  });

  it("rejects outer, nested, and vector-index accessors without invoking them", () => {
    const outer = createSyntheticCuratedAdmissionPlannerInput();
    const nested = createSyntheticCuratedAdmissionPlannerInput();
    const indexed = createSyntheticCuratedAdmissionPlannerInput();
    let getterCalls = 0;
    let setterCalls = 0;
    Object.defineProperty(outer, "policyEvidence", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });
    Object.defineProperty(nested.actorAssumptions, "sessionAssumption", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return "verified_active";
      },
      set() {
        setterCalls += 1;
      },
    });
    Object.defineProperty(indexed.vector, "0", {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return {};
      },
    });

    for (const input of [outer, nested, indexed]) {
      const result = planSyntheticCuratedVectorAdmission(input);
      assert.deepEqual(result.blockers, ["invalid_synthetic_input"]);
      assert.equal(result.checks.policyBinding, "not_evaluated");
    }
    assert.equal(getterCalls, 0);
    assert.equal(setterCalls, 0);
  });

  it("never invokes coercion or custom-iteration hooks", () => {
    const input = createSyntheticCuratedAdmissionPlannerInput();
    let calls = 0;
    Object.defineProperties(input, {
      toJSON: {
        enumerable: true,
        value() {
          calls += 1;
        },
      },
      valueOf: {
        enumerable: true,
        value() {
          calls += 1;
        },
      },
      [Symbol.iterator]: {
        enumerable: true,
        value() {
          calls += 1;
        },
      },
    });

    const result = planSyntheticCuratedVectorAdmission(input);
    assert.deepEqual(result.blockers, ["invalid_synthetic_input"]);
    assert.equal(calls, 0);
  });

  it("uses one full snapshot for both projections without caller rereads", () => {
    const input = createSyntheticCuratedAdmissionPlannerInput();
    const target = input.exactIdentity;
    let scenarioIdDescriptorCalls = 0;
    input.exactIdentity = new Proxy(target, {
      getOwnPropertyDescriptor(object, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, property);
        if (property === "scenarioId") {
          scenarioIdDescriptorCalls += 1;
          object.scenarioId = "mutated-after-snapshot";
        }
        return descriptor;
      },
    });

    const result = planSyntheticCuratedVectorAdmission(input);
    assert.equal(result.decision, "synthetic_preconditions_satisfied");
    assert.equal(scenarioIdDescriptorCalls, 1);
    assert.equal(target.scenarioId, "mutated-after-snapshot");
  });

  it("fails closed when a reflective Proxy trap throws", () => {
    const input = createSyntheticCuratedAdmissionPlannerInput();
    input.actorAssumptions = new Proxy(input.actorAssumptions, {
      ownKeys() {
        throw new Error("synthetic trap failure");
      },
    });

    const result = planSyntheticCuratedVectorAdmission(input);
    assert.deepEqual(result.blockers, ["invalid_synthetic_input"]);
    assert.equal(result.checks.vectorHash, "not_evaluated");
    assert.equal(result.checks.approvalEnvelope, "not_evaluated");
  });

  it(
    "keeps planner and envelope stable under inherited toJSON pollution",
    { concurrency: false },
    () => {
      const priorObjectDescriptor = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "toJSON",
      );
      const priorArrayDescriptor = Object.getOwnPropertyDescriptor(
        Array.prototype,
        "toJSON",
      );
      let result;
      let envelope;

      try {
        Object.defineProperty(Object.prototype, "toJSON", {
          value() {
            return "corrupted-object";
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(Array.prototype, "toJSON", {
          value() {
            return ["corrupted-array"];
          },
          enumerable: false,
          writable: true,
          configurable: true,
        });
        const input = createSyntheticCuratedAdmissionPlannerInput();
        result = planSyntheticCuratedVectorAdmission(input);
        envelope = serializeSimulationCuratedAdmissionEnvelope(
          envelopeInput(input),
        );
      } finally {
        restorePropertyDescriptor(
          Object.prototype,
          "toJSON",
          priorObjectDescriptor,
        );
        restorePropertyDescriptor(
          Array.prototype,
          "toJSON",
          priorArrayDescriptor,
        );
      }

      assert.equal(result.decision, "synthetic_preconditions_satisfied");
      assert.equal(envelope.status, "serialized");
      assert.equal(
        envelope.canonicalSerialization,
        SYNTHETIC_CURATED_ADMISSION_ENVELOPE_JSON,
      );
      assert.equal(
        envelope.approvalEnvelopeDigest,
        SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
      );
    },
  );

  it("does not mutate inputs and deeply freezes bounded output", () => {
    const input = createSyntheticCuratedAdmissionPlannerInput();
    const original = structuredClone(input);
    const result = planSyntheticCuratedVectorAdmission(input);

    input.vector[0].ticker = "MUTATED";
    input.confirmationAssumptions.state = "expired";

    assert.deepEqual(original.vector[0].ticker, "A.B");
    assert.equal(result.decision, "synthetic_preconditions_satisfied");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.equal(Object.isFrozen(result.checks), true);
  });

  it("keeps owner, challenge, hashes, rows, and authority claims out of output", () => {
    const result = planSyntheticCuratedVectorAdmission(
      createSyntheticCuratedAdmissionPlannerInput(),
    );
    const serialized = JSON.stringify(result);

    for (const forbidden of [
      SYNTHETIC_CURATED_ADMISSION_OWNER_ID,
      "synthetic-challenge-1",
      SYNTHETIC_CURATED_ADMISSION_V2_DIGEST,
      SYNTHETIC_CURATED_ADMISSION_ENVELOPE_DIGEST,
      "A.B",
      "A:B",
      "would_admit",
      "committed",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("keeps the maximum valid canonical envelope below the fixed byte cap", () => {
    const input = bindInput(
      createSyntheticCuratedAdmissionPlannerInput({
        exactIdentity: {
          scenarioId: `S${"A".repeat(99)}`,
          scenarioVersion: `V${"B".repeat(99)}`,
        },
        vector: createSyntheticCuratedAdmissionRows(64, true).map((row, index) => ({
          ...row,
          market: `m${"a".repeat(17)}${String(index % 10)}`,
          ticker: `T${String(index).padStart(2, "0")}${"X".repeat(47)}`,
        })),
      }),
    );
    const envelope = serializeSimulationCuratedAdmissionEnvelope(
      envelopeInput(input),
    );

    assert.equal(envelope.status, "serialized");
    assert.ok(
      envelope.byteLength <
        SIMULATION_CURATED_ADMISSION_PLANNER_POLICY.maxCanonicalInputBytes,
    );
  });
});

function blockerCases() {
  const hashMismatch = `sha256:${"0".repeat(64)}`;
  return [
    ["invalid_synthetic_input", null],
    [
      "unsupported_evidence_source",
      createSyntheticCuratedAdmissionPlannerInput({
        policyEvidence: { evidenceSource: "unknown" },
      }),
    ],
    [
      "policy_binding_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        policyEvidence: { plannerPolicyVersion: 2 },
      }),
    ],
    [
      "unsupported_actor_mode",
      createSyntheticCuratedAdmissionPlannerInput({
        policyEvidence: { actorMode: "tenant_self_approval_v2" },
      }),
    ],
    [
      "synthetic_session_not_verified_active",
      createSyntheticCuratedAdmissionPlannerInput({
        actorAssumptions: { sessionAssumption: "unknown" },
      }),
    ],
    [
      "synthetic_identity_mapping_not_exactly_one_active",
      createSyntheticCuratedAdmissionPlannerInput({
        actorAssumptions: { identityMappingAssumption: "ambiguous" },
      }),
    ],
    [
      "synthetic_app_user_not_active",
      createSyntheticCuratedAdmissionPlannerInput({
        actorAssumptions: { appUserAssumption: "provisioning" },
      }),
    ],
    [
      "synthetic_actor_owner_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        actorAssumptions: { actorOwnerAssumption: "mismatch" },
      }),
    ],
    [
      "invalid_exact_identity",
      createSyntheticCuratedAdmissionPlannerInput({
        exactIdentity: { ownerUserId: "invalid-owner" },
      }),
    ],
    [
      "unsupported_admission_intent",
      createSyntheticCuratedAdmissionPlannerInput({
        exactIdentity: { intent: "replacement_approval" },
      }),
    ],
    ["source_vector_empty", createSyntheticCuratedAdmissionPlannerInput({ vector: [] })],
    [
      "source_vector_row_cap_exceeded",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: createSyntheticCuratedAdmissionRows(65),
      }),
    ],
    [
      "invalid_instrument_identity",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [{ market: "us", currency: "EUR", ticker: "ONLY", weightBps: 10_000 }],
      }),
    ],
    [
      "duplicate_instrument_identity",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [
          { market: "us", currency: "USD", ticker: "SAME", weightBps: 5_000 },
          { market: "us", currency: "USD", ticker: "SAME", weightBps: 5_000 },
        ],
      }),
    ],
    [
      "source_vector_not_canonical_order",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [
          { market: "us", currency: "USD", ticker: "A:B", weightBps: 5_000 },
          { market: "us", currency: "USD", ticker: "A.B", weightBps: 5_000 },
        ],
      }),
    ],
    [
      "invalid_weight_bps",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [{ market: "us", currency: "USD", ticker: "ONLY", weightBps: -0 }],
      }),
    ],
    [
      "source_vector_total_not_10000_bps",
      createSyntheticCuratedAdmissionPlannerInput({
        vector: [{ market: "us", currency: "USD", ticker: "ONLY", weightBps: 9_999 }],
      }),
    ],
    [
      "scenario_vector_hash_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({ scenarioVectorHash: hashMismatch }),
    ],
    [
      "approval_envelope_digest_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: {
          expectedApprovalEnvelopeDigest: hashMismatch,
          presentedApprovalEnvelopeDigest: hashMismatch,
        },
      }),
    ],
    [
      "invalid_synthetic_instant",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { issuedAt: "2026-02-30T00:00:00.000Z" },
      }),
    ],
    [
      "confirmation_policy_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        policyEvidence: { confirmationPolicyId: "curated_vector_self_confirmation_v2" },
      }),
    ],
    [
      "confirmation_owner_binding_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { ownerBindingAssumption: "mismatch" },
      }),
    ],
    [
      "confirmation_instance_mismatch",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { presentedChallengeInstanceLabel: "other-challenge" },
      }),
    ],
    [
      "confirmation_not_pending",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { state: "consumed" },
      }),
    ],
    [
      "confirmation_not_yet_valid",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { syntheticEvaluationTime: "2025-12-31T23:59:59.999Z" },
      }),
    ],
    [
      "confirmation_expired",
      createSyntheticCuratedAdmissionPlannerInput({
        confirmationAssumptions: { syntheticEvaluationTime: "2026-01-01T00:10:00.000Z" },
      }),
    ],
    [
      "synthetic_current_approval_exists",
      createSyntheticCuratedAdmissionPlannerInput({
        durableStateAssumptions: { approvalRevisionAssumption: "current_approval_exists" },
      }),
    ],
    [
      "synthetic_prior_revision_exists",
      createSyntheticCuratedAdmissionPlannerInput({
        durableStateAssumptions: { approvalRevisionAssumption: "prior_revision_exists" },
      }),
    ],
    [
      "synthetic_competing_challenge",
      createSyntheticCuratedAdmissionPlannerInput({
        durableStateAssumptions: { competingChallengeAssumption: "live_competitor_present" },
      }),
    ],
    [
      "synthetic_durable_state_unproven",
      createSyntheticCuratedAdmissionPlannerInput({
        durableStateAssumptions: { approvalRevisionAssumption: "unknown" },
      }),
    ],
  ];
}

function bindInput(input) {
  const v2 = createSimulationScenarioVectorHashV2({
    scenarioId: input.exactIdentity.scenarioId,
    scenarioVersion: input.exactIdentity.scenarioVersion,
    vector: input.vector,
  });
  assert.equal(v2.status, "hashable", JSON.stringify(v2));
  const withHash = {
    ...input,
    scenarioVectorHash: v2.scenarioVectorHash,
  };
  const envelope = serializeSimulationCuratedAdmissionEnvelope(
    envelopeInput(withHash),
  );
  assert.equal(envelope.status, "serialized");
  return {
    ...withHash,
    confirmationAssumptions: {
      ...withHash.confirmationAssumptions,
      expectedApprovalEnvelopeDigest: envelope.approvalEnvelopeDigest,
      presentedApprovalEnvelopeDigest: envelope.approvalEnvelopeDigest,
    },
  };
}

function envelopeInput(input) {
  return {
    approvalEnvelopeDigestVersion:
      input.policyEvidence.approvalEnvelopeDigestVersion,
    actorMode: input.policyEvidence.actorMode,
    confirmationPolicyId: input.policyEvidence.confirmationPolicyId,
    intent: input.exactIdentity.intent,
    ownerUserId: input.exactIdentity.ownerUserId,
    portfolioPathPolicyId: input.exactIdentity.portfolioPathPolicyId,
    gate0ApprovalCommit: input.exactIdentity.gate0ApprovalCommit,
    scenarioId: input.exactIdentity.scenarioId,
    scenarioVersion: input.exactIdentity.scenarioVersion,
    vectorHashVersion: input.policyEvidence.vectorHashVersion,
    scenarioVectorHash: input.scenarioVectorHash,
    vector: input.vector,
  };
}

function assertInPolicyOrder(blockers) {
  const positions = blockers.map((blocker) =>
    SIMULATION_CURATED_ADMISSION_PLANNER_BLOCKER_ORDER.indexOf(blocker),
  );
  assert.equal(new Set(blockers).size, blockers.length);
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
}

function restorePropertyDescriptor(target, property, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    delete target[property];
  }
}
