import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS,
  projectIdentityPairingClaimPresentationAudit,
} from "../src/lib/auth/identity-pairing-claim-presentation-audit.ts";

const RAW_CLAIM = `varda-bootstrap-claim-v1.${"A".repeat(43)}`;
const RAW_SUBJECT = "raw-provider-subject-must-not-escape";

describe("identity pairing claim presentation audit", () => {
  it("projects only the reviewed result categories", () => {
    const cases = [
      [
        { result: "consumed", committed: true, writerInvoked: true },
        { outcome: "consumed", phase: "complete", category: "consumed" },
      ],
      [
        blocked("claim_invalid"),
        {
          outcome: "not_consumed",
          phase: "claim_validation",
          category: "claim_invalid",
        },
      ],
      [
        blocked("database_port_invalid"),
        {
          outcome: "not_consumed",
          phase: "runtime_composition",
          category: "database_port_invalid",
        },
      ],
      [
        blocked("composition_invalid"),
        {
          outcome: "not_consumed",
          phase: "runtime_composition",
          category: "composition_invalid",
        },
      ],
      [
        blocked("verified_session_unavailable"),
        {
          outcome: "not_consumed",
          phase: "verified_session",
          category: "verified_session_unavailable",
        },
      ],
      [
        blocked("session_capability_invalid"),
        {
          outcome: "not_consumed",
          phase: "session_capability",
          category: "session_capability_invalid",
        },
      ],
      [
        failed(true),
        {
          outcome: "not_consumed",
          phase: "identity_consume",
          category: "identity_consume_failed",
        },
      ],
      [
        failed(false),
        {
          outcome: "not_consumed",
          phase: "session_capability",
          category: "identity_consume_failed",
        },
      ],
    ];

    for (const [input, expected] of cases) {
      const result = projectIdentityPairingClaimPresentationAudit(input);
      assert.deepEqual({ ...result }, expected);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.getPrototypeOf(result), null);
    }
  });

  it("fails closed without invoking accessors or reflecting unknown data", () => {
    let accessorReads = 0;
    const input = { rawClaim: RAW_CLAIM, subject: RAW_SUBJECT };
    for (const key of ["result", "committed", "writerInvoked", "blocker"]) {
      Object.defineProperty(input, key, {
        get() {
          accessorReads += 1;
          return "consumed";
        },
      });
    }

    const result = projectIdentityPairingClaimPresentationAudit(input);

    assert.equal(accessorReads, 0);
    assert.deepEqual({ ...result }, {
      outcome: "not_consumed",
      phase: "runtime_result",
      category: "result_invalid",
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(RAW_SUBJECT), false);
  });

  it("keeps transport and runtime events as fixed audit constants", () => {
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS).map(
          ([key, value]) => [key, { ...value }],
        ),
      ),
      {
        transportRejected: {
          outcome: "not_consumed",
          phase: "transport",
          category: "transport_rejected",
        },
        runtimeMisconfigured: {
          outcome: "unavailable",
          phase: "configuration",
          category: "runtime_misconfigured",
        },
        runtimeUnavailable: {
          outcome: "unavailable",
          phase: "runtime",
          category: "runtime_unavailable",
        },
      },
    );
  });

  it("keeps the projection server-side and the HTTP response generic", () => {
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );
    assert.match(route, /^import "server-only";/);
    assert.match(route, /projectIdentityPairingClaimPresentationAudit\(result\)/);
    assert.match(route, /phase=\$\{audit\.phase\}/);
    assert.match(route, /category=\$\{audit\.category\}/);
    assert.doesNotMatch(
      route,
      /result\.blocker|rawClaim.*console|subject.*console|JSON\.stringify\(result\)/,
    );
  });
});

function blocked(blocker) {
  return Object.freeze({
    result: "blocked",
    blocker,
    committed: false,
    writerInvoked: false,
    rawClaim: RAW_CLAIM,
    subject: RAW_SUBJECT,
  });
}

function failed(writerInvoked) {
  return Object.freeze({
    result: "failed",
    blocker: "identity_consume_failed",
    committed: false,
    writerInvoked,
    rawClaim: RAW_CLAIM,
    subject: RAW_SUBJECT,
  });
}
