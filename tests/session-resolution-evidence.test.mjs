import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sessionResolutionEvidence } from "../src/lib/session-resolution-evidence.ts";

describe("session resolution evidence", () => {
  it("distinguishes missing sessions from unavailable auth and identity stores", () => {
    assert.equal(sessionResolutionEvidence(success()), "Resolved");
    assert.equal(sessionResolutionEvidence(failure("unauthenticated")), "Sign-in required");
    assert.equal(
      sessionResolutionEvidence(failure("auth_provider_unavailable")),
      "Auth unavailable",
    );
    assert.equal(
      sessionResolutionEvidence(failure("identity_store_unavailable")),
      "Identity store unavailable",
    );
  });

  it("keeps authorization and integrity failures fail-closed", () => {
    assert.equal(sessionResolutionEvidence(failure("identity_unlinked")), "Not linked");
    assert.equal(sessionResolutionEvidence(failure("identity_not_active")), "Inactive");
    assert.equal(sessionResolutionEvidence(failure("app_user_not_active")), "Inactive");
    assert.equal(sessionResolutionEvidence(failure("identity_mapping_collision")), "Blocked");
    assert.equal(sessionResolutionEvidence(failure("identity_mapping_integrity")), "Blocked");
    assert.equal(sessionResolutionEvidence(failure("resolver_state_invalid")), "Blocked");
  });
});

function success() {
  return {
    ok: true,
    tenantContext: {
      ownerUserId: "11111111-1111-4111-8111-111111111111",
      role: "user",
    },
  };
}

function failure(code) {
  return {
    ok: false,
    failure: { code, httpStatus: 500 },
  };
}
