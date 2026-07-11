import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TENANT_EXPAND_PHASES,
  TenantExpandPhaseError,
  classifyTenantExpandPhase,
} from "../scripts/lib/tenant-expand-phase.mjs";

describe("tenant expand phase-aware audit", () => {
  it("accepts the historical empty expand state", () => {
    assert.equal(
      classifyTenantExpandPhase(state()),
      TENANT_EXPAND_PHASES.expandedEmpty,
    );
  });

  it("accepts exactly one provisioning user with no identity or owner rows", () => {
    assert.equal(
      classifyTenantExpandPhase(
        state({
          appUsers: 1,
          provisioningUsers: 1,
          userRoleUsers: 1,
        }),
      ),
      TENANT_EXPAND_PHASES.provisionedEmptyOwner,
    );
  });

  it("blocks identity links, canonical assignments, active users, and count drift", () => {
    for (const override of [
      { appUsers: 1, provisioningUsers: 1, userRoleUsers: 1, authIdentities: 1 },
      {
        appUsers: 1,
        provisioningUsers: 1,
        userRoleUsers: 1,
        canonicalOwnerNonNullRows: 1,
      },
      { appUsers: 1, activeUsers: 1, userRoleUsers: 1 },
      { appUsers: 1, provisioningUsers: 0, userRoleUsers: 1 },
    ]) {
      assert.throws(
        () => classifyTenantExpandPhase(state(override)),
        TenantExpandPhaseError,
      );
    }
  });
});

function state(overrides = {}) {
  return {
    appUsers: 0,
    provisioningUsers: 0,
    activeUsers: 0,
    disabledUsers: 0,
    userRoleUsers: 0,
    adminUsers: 0,
    authIdentities: 0,
    canonicalOwnerNonNullRows: 0,
    ...overrides,
  };
}
