import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuditTenantContext,
  parseAuditOwnerUserId,
} from "../scripts/lib/audit-tenant-selector.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const UUID_V7_OWNER = "018f7f2e-7b8d-7a11-8e42-111111111111";

describe("audit tenant selector", () => {
  it("requires one explicit canonical owner argument", () => {
    assert.equal(
      parseAuditOwnerUserId([`--owner-user-id=${OWNER.toUpperCase()}`]),
      OWNER,
    );
    assert.equal(
      parseAuditOwnerUserId([`--owner-user-id=${UUID_V7_OWNER}`]),
      UUID_V7_OWNER,
    );
    assert.throws(() => parseAuditOwnerUserId([]));
    assert.throws(() => parseAuditOwnerUserId(["--owner-user-id=bad"]));
    assert.throws(() =>
      parseAuditOwnerUserId([
        `--owner-user-id=${OWNER}`,
        `--owner-user-id=${OWNER}`,
      ]),
    );
  });

  it("accepts exactly one active user or admin row", () => {
    assert.deepEqual(
      buildAuditTenantContext(OWNER, [{ status: "active", role: "user" }]),
      { ownerUserId: OWNER, role: "user" },
    );
    assert.throws(() =>
      buildAuditTenantContext(OWNER, [
        { status: "provisioning", role: "user" },
      ]),
    );
    assert.throws(() =>
      buildAuditTenantContext(OWNER, [
        { status: "active", role: "operator" },
      ]),
    );
    assert.throws(() => buildAuditTenantContext(OWNER, []));
  });
});
