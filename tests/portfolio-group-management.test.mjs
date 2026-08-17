import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PORTFOLIO_GROUP_MANAGEMENT_POLICY,
  parsePortfolioGroupArchiveInput,
  parsePortfolioGroupSaveInput,
} from "../src/lib/portfolio-group-management.ts";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_A = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_B = "33333333-3333-4333-8333-333333333333";
const ASSET_A = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-08-13T01:02:03.000Z";

const querySource = source("../src/db/queries/portfolio-group-management.ts");
const groupReadSource = source("../src/db/queries/tenant-group-reads.ts");
const writerSource = source("../src/lib/portfolio-group-management-write.ts");
const actionSource = source("../src/app/portfolio/groups/actions.ts");
const pageSource = source("../src/app/portfolio/groups/page.tsx");
const componentSource = source(
  "../src/components/portfolio-group-management.tsx",
);

describe("portfolio group management", () => {
  it("normalizes create input and canonicalizes membership lists", () => {
    const result = parsePortfolioGroupSaveInput(
      form({
        name: "  장기   성장  ",
        description: " 여러 계좌를 함께 분석 ",
        accountId: [ACCOUNT_B, ACCOUNT_A, ACCOUNT_B],
        assetId: [ASSET_A, ASSET_A],
      }),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.input, {
      mode: "create",
      groupId: null,
      expectedUpdatedAt: null,
      name: "장기 성장",
      description: "여러 계좌를 함께 분석",
      accountIds: [ACCOUNT_A, ACCOUNT_B],
      assetIds: [ASSET_A],
    });
  });

  it("requires an exact version for updates and bounded owned identifiers", () => {
    const valid = parsePortfolioGroupSaveInput(
      form({
        groupId: GROUP_ID,
        expectedUpdatedAt: UPDATED_AT,
        name: "미국 성장",
      }),
    );
    const missingVersion = parsePortfolioGroupSaveInput(
      form({ groupId: GROUP_ID, name: "미국 성장" }),
    );
    const invalidAccount = parsePortfolioGroupSaveInput(
      form({ name: "미국 성장", accountId: ["not-a-uuid"] }),
    );

    assert.equal(valid.ok, true);
    assert.equal(valid.input.mode, "update");
    assert.equal(missingVersion.ok, false);
    assert.equal(invalidAccount.ok, false);
    assert.equal(
      PORTFOLIO_GROUP_MANAGEMENT_POLICY.maximumDirectAssetMemberships,
      256,
    );
  });

  it("requires explicit archive confirmation", () => {
    const blocked = parsePortfolioGroupArchiveInput(
      form({ groupId: GROUP_ID, expectedUpdatedAt: UPDATED_AT }),
    );
    const allowed = parsePortfolioGroupArchiveInput(
      form({
        groupId: GROUP_ID,
        expectedUpdatedAt: UPDATED_AT,
        archiveConfirmed: "yes",
      }),
    );

    assert.equal(blocked.ok, false);
    assert.deepEqual(allowed, {
      ok: true,
      input: { groupId: GROUP_ID, expectedUpdatedAt: UPDATED_AT },
    });
  });

  it("keeps the read model tenant-scoped and parallel", () => {
    assert.match(querySource, /await Promise\.all\(\[/);
    assert.match(querySource, /loadActiveTenantPortfolioGroups/);
    assert.match(querySource, /loadTenantPortfolioGroupMemberships/);
    assert.match(querySource, /mode: "effective"/);
    assert.match(querySource, /eq\(accounts\.canonicalOwnerUserId, ownerUserId\)/);
    assert.match(querySource, /eq\(assets\.canonicalOwnerUserId, ownerUserId\)/);
    assert.match(groupReadSource, /runTenantReadTransaction/);
    assert.match(groupReadSource, /valid_from <= \$3::date/);
    assert.match(groupReadSource, /valid_to > \$3::date/);
    assert.doesNotMatch(querySource, /\bfetch\s*\(/);
  });

  it("serializes owner writes and preserves effective-dated history", () => {
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /prepareTenantWriteContext\(/);
    assert.match(writerSource, /pg_advisory_xact_lock/);
    assert.match(writerSource, /for update of group_row/i);
    assert.match(writerSource, /group_row\.updated_at = \$5::timestamptz/);
    assert.match(writerSource, /effective_requested_assets/);
    assert.match(writerSource, /set valid_to = \$8::date/i);
    assert.match(writerSource, /set archived_at = \$6::timestamptz/i);
    assert.doesNotMatch(writerSource, /delete from portfolio_groups/i);
    assert.doesNotMatch(writerSource, /\bfetch\s*\(/);
  });

  it("keeps Server Actions thin and each group form independently stateful", () => {
    assert.match(actionSource, /"use server"/);
    assert.match(actionSource, /writeSessionPortfolioGroup\(formData\)/);
    assert.match(actionSource, /archiveSessionPortfolioGroup\(formData\)/);
    assert.match(actionSource, /revalidatePath\(path\)/);
    assert.match(componentSource, /"use client"/);
    assert.match(componentSource, /function PortfolioGroupEditor/);
    assert.match(componentSource, /useActionState\(\s*savePortfolioGroup/);
    assert.match(componentSource, /useActionState\(\s*archivePortfolioGroup/);
    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.doesNotMatch(componentSource, /canonicalOwnerUserId|ownerUserId/);
    assert.doesNotMatch(pageSource, /\bfetch\s*\(/);
  });
});

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      data.append(key, entry);
    }
  }
  return data;
}
