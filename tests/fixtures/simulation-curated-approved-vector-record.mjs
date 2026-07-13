import assert from "node:assert/strict";

import { createSimulationScenarioVectorHashV2 } from "../../src/lib/simulation-scenario-vector-hash-v2.ts";

export const SYNTHETIC_APPROVED_VECTOR_OWNER_ID =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SYNTHETIC_APPROVED_VECTOR_OTHER_OWNER_ID =
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SYNTHETIC_APPROVED_VECTOR_REVISION_ID =
  "11111111-1111-4111-8111-111111111111";

export function createSyntheticCuratedApprovedVectorRecordV2(options = {}) {
  const scenarioId = options.scenarioId ?? "research-kr-us-cross-market";
  const scenarioVersion = options.scenarioVersion ?? "v1";
  const vector = options.vector ?? [
    { market: "korea", currency: "KRW", ticker: "069500", weightBps: 5_000 },
    { market: "us", currency: "USD", ticker: "QQQ", weightBps: 5_000 },
  ];
  const hash = createSimulationScenarioVectorHashV2({
    scenarioId,
    scenarioVersion,
    vector,
  });
  assert.equal(hash.status, "hashable", JSON.stringify(hash));

  return {
    expectedOwnerUserId: SYNTHETIC_APPROVED_VECTOR_OWNER_ID,
    selector: { scenarioId, scenarioVersion },
    record: {
      id: SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
      ownerUserId: SYNTHETIC_APPROVED_VECTOR_OWNER_ID,
      portfolioPathPolicyId: hash.portfolioPathPolicyId,
      gate0ApprovalCommit: hash.gate0ApprovalCommit,
      scenarioId,
      scenarioVersion,
      approvalRevision: 1,
      scenarioVectorHashVersion: hash.hashVersion,
      scenarioVectorHash: hash.scenarioVectorHash,
      approvedAt: "2026-07-13T12:00:00.000Z",
      lifecycleStatus: "approved",
      terminalAt: null,
      vectorRows: vector.map((row) => ({
        approvalRevisionId: SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
        ...row,
      })),
      lifecycleEvents: [
        {
          approvalRevisionId: SYNTHETIC_APPROVED_VECTOR_REVISION_ID,
          eventSequence: 1,
          auditVersion: "scenario_vector_approval_audit_v1",
          transitionKind: "explicit_approval",
          previousStatus: null,
          resultingStatus: "approved",
          transitionedAt: "2026-07-13T12:00:00.000Z",
          replacementRevisionId: null,
        },
      ],
    },
  };
}
