import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ACCOUNT_MANAGEMENT_POLICY,
  generatedAccountCode,
  parseAccountArchiveInput,
  parseAccountCreateInput,
  parseAccountRestoreInput,
  parseAccountUpdateInput,
} from "../src/lib/account-management.ts";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-08-16T01:02:03.000Z";
const querySource = source("../src/db/queries/account-management.ts");
const writerSource = source("../src/lib/account-management-write.ts");
const actionSource = source("../src/app/portfolio/accounts/actions.ts");
const pageSource = source("../src/app/portfolio/accounts/page.tsx");
const componentSource = source("../src/components/account-management.tsx");

describe("owner-scoped account management", () => {
  it("normalizes a display name and generates an immutable internal code", () => {
    const parsed = parseAccountCreateInput(form({ name: "  Main   broker  " }));

    assert.deepEqual(parsed, {
      ok: true,
      input: { name: "Main broker" },
    });
    assert.equal(
      generatedAccountCode(ACCOUNT_ID),
      "acct_11111111111141118111111111111111",
    );
    assert.equal(ACCOUNT_MANAGEMENT_POLICY.generatedAccountType, "investment");
    assert.equal(ACCOUNT_MANAGEMENT_POLICY.generatedReportingCurrency, "KRW");
  });

  it("requires canonical identity and exact version evidence for updates", () => {
    const valid = parseAccountUpdateInput(
      form({
        accountId: ACCOUNT_ID,
        expectedUpdatedAt: UPDATED_AT,
        name: "Retirement",
      }),
    );
    const invalidId = parseAccountUpdateInput(
      form({ accountId: "account-1", expectedUpdatedAt: UPDATED_AT, name: "A" }),
    );
    const invalidDate = parseAccountUpdateInput(
      form({
        accountId: ACCOUNT_ID,
        expectedUpdatedAt: "2026-99-99T01:02:03.000Z",
        name: "A",
      }),
    );

    assert.equal(valid.ok, true);
    assert.equal(invalidId.ok, false);
    assert.equal(invalidDate.ok, false);
  });

  it("requires explicit archive confirmation while restore remains reversible", () => {
    const blocked = parseAccountArchiveInput(
      form({ accountId: ACCOUNT_ID, expectedUpdatedAt: UPDATED_AT }),
    );
    const archived = parseAccountArchiveInput(
      form({
        accountId: ACCOUNT_ID,
        expectedUpdatedAt: UPDATED_AT,
        archiveConfirmed: "yes",
      }),
    );
    const restored = parseAccountRestoreInput(
      form({ accountId: ACCOUNT_ID, expectedUpdatedAt: UPDATED_AT }),
    );

    assert.equal(blocked.ok, false);
    assert.equal(archived.ok, true);
    assert.equal(restored.ok, true);
  });

  it("reads all owner accounts and computes blockers without legacy fixed codes", () => {
    assert.match(querySource, /await Promise\.all\(\[/);
    assert.match(querySource, /runTenantReadTransaction\(ownerUserId/);
    assert.match(querySource, /eq\(assets\.canonicalOwnerUserId, ownerUserId\)/);
    assert.match(querySource, /openGroupReferenceCount/);
    assert.doesNotMatch(querySource, /NAMED_PORTFOLIO_ACCOUNTS/);
    assert.doesNotMatch(querySource, /\bfetch\s*\(/);

    const accountSql = querySource.match(
      /const ACCOUNT_MANAGEMENT_ACCOUNT_ROWS_SQL = `([\s\S]*?)`;/,
    )?.[1];
    assert.ok(accountSql);
    assert.match(accountSql, /from public\.accounts/);
    assert.doesNotMatch(accountSql, /canonical_owner_user_id|owner_user_id/);
  });

  it("serializes owner writes and archives only after reference checks", () => {
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /prepareTenantWriteContext\(/);
    assert.match(writerSource, /pg_advisory_xact_lock/);
    assert.match(writerSource, /for update of account_row/i);
    assert.match(writerSource, /active_holding_count/);
    assert.match(writerSource, /open_group_reference_count/);
    assert.match(writerSource, /inconsistent_asset_count/);
    assert.match(writerSource, /set is_active = false/i);
    assert.match(writerSource, /set is_active = true/i);
    assert.doesNotMatch(writerSource, /delete from accounts/i);
    assert.doesNotMatch(writerSource, /\bfetch\s*\(/);
  });

  it("keeps Server Actions thin and exposes only minimal account DTOs", () => {
    assert.match(actionSource, /"use server"/);
    assert.match(actionSource, /createSessionAccount\(formData\)/);
    assert.match(actionSource, /archiveSessionAccount\(formData\)/);
    assert.match(actionSource, /revalidatePath\(path\)/);
    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /getReadOnlyTenantAccountManagementModel\(/);
    assert.match(componentSource, /"use client"/);
    assert.match(componentSource, /useActionState\(createAccount/);
    assert.doesNotMatch(componentSource, /canonicalOwnerUserId|ownerUserId/);
    assert.doesNotMatch(pageSource, /\bfetch\s*\(/);
  });
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
