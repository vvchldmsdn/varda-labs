import { SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY } from "../../src/lib/simulation-scenario-vector-resolver-policy.ts";
import {
  canonicalizeSimulationScenarioVector,
  hashSimulationScenarioVector,
} from "../../src/lib/simulation-scenario-vector-review-serialization.ts";

export const SYNTHETIC_RESOLVER_OWNER_A =
  "11111111-1111-4111-8111-111111111111";
export const SYNTHETIC_RESOLVER_OWNER_B =
  "22222222-2222-4222-8222-222222222222";

export const SYNTHETIC_RESOLVER_VECTOR = Object.freeze([
  Object.freeze({
    market: "alpha",
    currency: "KRW",
    ticker: "SYN_A",
    weightBps: 6_000,
  }),
  Object.freeze({
    market: "omega",
    currency: "USD",
    ticker: "SYN_B",
    weightBps: 4_000,
  }),
]);

export function syntheticScenarioVectorResolverInput(options = {}) {
  const ownerUserId = options.ownerUserId ?? SYNTHETIC_RESOLVER_OWNER_A;
  const scenarioId = options.scenarioId ?? "synthetic-resolver";
  const scenarioVersion = options.scenarioVersion ?? "v1";
  const canonicalVector = (options.vector ?? SYNTHETIC_RESOLVER_VECTOR).map(
    (row) => ({ ...row }),
  );
  const approvalRevision = options.approvalRevision ?? 7;
  const approvedAt = options.approvedAt ?? "2026-01-02T03:04:05.000Z";
  const scenarioVectorHash = hashSimulationScenarioVector(
    canonicalizeSimulationScenarioVector({
      scenarioId,
      scenarioVersion,
      vector: canonicalVector,
    }),
  );

  return {
    tenantContext: {
      ownerUserId,
      role: options.role ?? "user",
    },
    selector: {
      scenarioId,
      scenarioVersion,
    },
    repositoryResult: {
      state: "loaded",
      auditStatus: "verified",
      record: {
        canonicalOwnerUserId: ownerUserId,
        portfolioPathPolicyId:
          SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.portfolioPathPolicyId,
        gate0ApprovalCommit:
          SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.gate0ApprovalCommit,
        scenarioId,
        scenarioVersion,
        canonicalVector,
        scenarioVectorHashVersion:
          SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.scenarioVectorHashVersion,
        scenarioVectorHash,
        approvalRevision,
        approvedAt,
        lifecycleStatus: "approved",
        auditEnvelope: {
          version:
            SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.auditEnvelopeVersion,
          decisionKind:
            SIMULATION_SCENARIO_VECTOR_RESOLVER_POLICY.auditDecisionKind,
          approvalRevision,
          approvedAt,
        },
      },
    },
  };
}
