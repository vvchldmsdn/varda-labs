import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifySelfServiceTenantOnboardingWrite,
  parseSelfServiceTenantOnboardingInput,
  SELF_SERVICE_TENANT_ONBOARDING_POLICY,
} from "../src/lib/auth/self-service-tenant-onboarding.ts";

const writerSource = source(
  "../src/lib/auth/self-service-tenant-onboarding-write.ts",
);
const resolverSource = source("../src/lib/auth/current-tenant-context.ts");
const actionSource = source("../src/app/portfolio/onboarding/actions.ts");
const pageSource = source("../src/app/portfolio/onboarding/page.tsx");
const accountPageSource = source("../src/app/portfolio/accounts/page.tsx");
const componentSource = source(
  "../src/components/auth/self-service-tenant-onboarding-form.tsx",
);

describe("self-service empty tenant onboarding", () => {
  it("requires explicit confirmation and never infers a legacy pairing", () => {
    const missing = parseSelfServiceTenantOnboardingInput(new FormData());
    const confirmed = new FormData();
    confirmed.set(
      "confirmation",
      SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue,
    );

    assert.equal(missing.ok, false);
    assert.deepEqual(parseSelfServiceTenantOnboardingInput(confirmed), {
      ok: true,
    });
    assert.equal(
      SELF_SERVICE_TENANT_ONBOARDING_POLICY.policyId,
      "authenticated_empty_tenant_onboarding_v1",
    );
  });

  it("accepts only a complete atomic create or an intact existing mapping", () => {
    assert.equal(
      classifySelfServiceTenantOnboardingWrite(evidence({
        insertedAppUserCount: 1,
        insertedIdentityCount: 1,
      })),
      "created",
    );
    assert.equal(
      classifySelfServiceTenantOnboardingWrite(evidence({
        existingIdentityCount: 1,
        identityStatus: "active",
        appUserStatus: "active",
        appUserRole: "user",
        mappedAppUserMatches: true,
      })),
      "already_ready",
    );
    assert.equal(
      classifySelfServiceTenantOnboardingWrite(evidence({
        insertedAppUserCount: 1,
        insertedIdentityCount: 0,
      })),
      "blocked",
    );
    assert.equal(
      classifySelfServiceTenantOnboardingWrite(evidence({
        existingIdentityCount: 1,
        identityStatus: "disabled",
        appUserStatus: "active",
        appUserRole: "user",
        mappedAppUserMatches: true,
      })),
      "blocked",
    );
  });

  it("serializes and atomically inserts only the internal user and identity", () => {
    assert.match(writerSource, /readCurrentSessionSubject\(\)/);
    assert.match(writerSource, /pg_advisory_xact_lock/);
    assert.match(writerSource, /insert into app_users/i);
    assert.match(writerSource, /insert into auth_identities/i);
    assert.match(writerSource, /existing_identity_count = 0/);
    assert.match(writerSource, /set local lock_timeout = '2s'/);
    assert.match(writerSource, /set local statement_timeout = '8s'/);
    assert.doesNotMatch(writerSource, /insert into accounts/i);
    assert.doesNotMatch(writerSource, /update\s+(?:accounts|assets)/i);
    assert.doesNotMatch(writerSource, /delete\s+from/i);
    assert.doesNotMatch(writerSource, /console\./);
  });

  it("keeps the Server Action thin and exposes onboarding only when unlinked", () => {
    assert.match(resolverSource, /getAuthTransportRuntime\(\)/);
    assert.match(actionSource, /"use server"/);
    assert.match(actionSource, /createCurrentSessionTenant\(formData\)/);
    assert.match(actionSource, /redirect\("\/portfolio\/accounts\?account=all"\)/);
    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /failure\.code === "identity_unlinked"/);
    assert.match(pageSource, /SelfServiceTenantOnboardingForm/);
    assert.match(accountPageSource, /redirect\("\/portfolio\/onboarding"\)/);
    assert.match(componentSource, /"use client"/);
    assert.match(componentSource, /useActionState/);
    assert.doesNotMatch(componentSource, /providerSubject|ownerUserId|appUserId/);
  });
});

function evidence(overrides = {}) {
  return {
    existingIdentityCount: 0,
    insertedAppUserCount: 0,
    insertedIdentityCount: 0,
    identityStatus: null,
    appUserStatus: null,
    appUserRole: null,
    mappedAppUserMatches: null,
    ...overrides,
  };
}

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
