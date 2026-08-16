import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assessTenantTransactionContext,
  normalizeTenantContextOwnerUserId,
  TenantTransactionContextError,
} from "../src/lib/deployment/tenant-transaction-context.ts";

const OWNER_ID = "11111111-2222-4333-8444-555555555555";

describe("tenant transaction context", () => {
  it("normalizes a canonical UUID and rejects untrusted identifiers", () => {
    assert.equal(
      normalizeTenantContextOwnerUserId(`  ${OWNER_ID.toUpperCase()}  `),
      OWNER_ID,
    );
    for (const value of [undefined, null, "", "owner-1", `${OWNER_ID} extra`]) {
      assert.throws(
        () => normalizeTenantContextOwnerUserId(value),
        (error) =>
          error instanceof TenantTransactionContextError &&
          error.code === "invalid_owner_user_id",
      );
    }
  });

  it("passes only when the context is local to one transaction", () => {
    const assessment = assessTenantTransactionContext({
      expectedOwnerUserId: OWNER_ID,
      beforeTransaction: null,
      configuredValue: OWNER_ID,
      insideTransaction: OWNER_ID,
      nextTransaction: "",
      afterTransaction: null,
    });

    assert.equal(assessment.status, "transaction_context_passed");
    assert.deepEqual(assessment.blockers, []);
    assert.doesNotMatch(JSON.stringify(assessment), new RegExp(OWNER_ID));
  });

  it("reports every stale or mismatched context boundary", () => {
    const otherOwner = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const assessment = assessTenantTransactionContext({
      expectedOwnerUserId: OWNER_ID,
      beforeTransaction: otherOwner,
      configuredValue: otherOwner,
      insideTransaction: otherOwner,
      nextTransaction: otherOwner,
      afterTransaction: otherOwner,
    });

    assert.equal(assessment.status, "blocked");
    assert.deepEqual(assessment.blockers, [
      "context_present_before_transaction",
      "context_configuration_mismatch",
      "context_not_visible_inside_transaction",
      "context_present_in_next_transaction",
      "context_present_after_transaction",
    ]);
  });

  it("keeps the runtime wrapper read-only, ordered, and fail-closed", () => {
    const source = readFileSync(
      "src/db/tenant-transaction-context.ts",
      "utf8",
    );
    const audit = readFileSync(
      "scripts/audit-tenant-transaction-context.ts",
      "utf8",
    );

    assert.match(source, /^import "server-only";/);
    assert.match(source, /getTenantSqlClient\(\)/);
    assert.match(source, /normalizeTenantContextOwnerUserId\(ownerUserId\)/);
    assert.match(
      source,
      /return \[\s*transaction\.query\(CONFIGURE_CONTEXT_SQL,[\s\S]*?transaction\.query\(READ_CONTEXT_SQL, \[settingName\(\)\]\),/,
    );
    assert.match(source, /readOnly: TENANT_TRANSACTION_CONTEXT_POLICY\.readOnly/);
    assert.match(source, /context_attestation_failed/);
    assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
    assert.match(audit, /publicTableReads: 0/);
    assert.match(audit, /persistentDatabaseSideEffects: false/);
    assert.doesNotMatch(
      `${source}\n${audit}`,
      /\b(?:insert|update|delete|alter|drop)\s+(?:into|table|from)\b/i,
    );
    assert.doesNotMatch(audit, /console\.log\(process\.env/);
    assert.doesNotMatch(audit, /error\.message|String\(error\)/);
  });
});
