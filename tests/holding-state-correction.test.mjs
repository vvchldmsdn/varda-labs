import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HOLDING_STATE_CORRECTION_POLICY,
  parseHoldingStateCorrectionInput,
} from "../src/lib/holding-state-correction.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-08-16T01:02:03.000Z";
const writerSource = source("../src/lib/holding-state-correction-write.ts");
const actionSource = source("../src/app/portfolio/holdings/actions.ts");
const componentSource = source(
  "../src/components/holding-state-correction-form.tsx",
);
const querySource = source("../src/db/queries/tenant-holdings.ts");
const schemaSource = source("../src/db/schema.ts");
const registrySource = source("../src/lib/tenant-writer-registry.ts");
const migrationSource = source("../drizzle/0027_easy_kulan_gath.sql");

describe("owner-scoped holding state correction", () => {
  it("parses only positive, bounded quantity and average-cost corrections", () => {
    const parsed = parseHoldingStateCorrectionInput(
      form({
        assetId: ASSET_ID,
        expectedUpdatedAt: UPDATED_AT,
        quantity: "47.125",
        averageCost: "90123.4500",
        reason: "  최초   수량 오기  ",
      }),
    );

    assert.deepEqual(parsed, {
      ok: true,
      input: {
        assetId: ASSET_ID,
        expectedUpdatedAt: UPDATED_AT,
        quantity: "47.125",
        averageCost: "90123.4500",
        reason: "최초 수량 오기",
      },
    });
    assert.equal(HOLDING_STATE_CORRECTION_POLICY.semantics, "current_state_correction_not_trade");
  });

  it("rejects stale identity evidence, zero values, excessive scale, and long reasons", () => {
    const base = {
      assetId: ASSET_ID,
      expectedUpdatedAt: UPDATED_AT,
      quantity: "1",
      averageCost: "1",
    };

    assert.equal(
      parseHoldingStateCorrectionInput(
        form({ ...base, expectedUpdatedAt: "2026-08-16" }),
      ).ok,
      false,
    );
    assert.equal(
      parseHoldingStateCorrectionInput(form({ ...base, quantity: "0" })).ok,
      false,
    );
    assert.equal(
      parseHoldingStateCorrectionInput(
        form({ ...base, averageCost: "1.00001" }),
      ).ok,
      false,
    );
    assert.equal(
      parseHoldingStateCorrectionInput(
        form({ ...base, reason: "x".repeat(501) }),
      ).ok,
      false,
    );
  });

  it("serializes owner-verified updates and immutable audit insertion atomically", () => {
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /prepareTenantWriteContext\(/);
    assert.match(writerSource, /pg_advisory_xact_lock/);
    assert.match(writerSource, /for update of asset/i);
    assert.match(writerSource, /asset\.canonical_owner_user_id = \$2::uuid/);
    assert.match(writerSource, /account_row\.canonical_owner_user_id = \$2::uuid/);
    assert.match(writerSource, /updated_at = \$4::timestamptz/);
    assert.match(writerSource, /insert into holding_state_corrections/i);
    assert.match(writerSource, /previous_quantity/i);
    assert.match(writerSource, /previous_average_cost/i);
    assert.doesNotMatch(writerSource, /event_ledger/i);
    assert.doesNotMatch(writerSource, /delete\s+from/i);
    assert.doesNotMatch(writerSource, /\bfetch\s*\(/);
  });

  it("keeps the Server Action thin and the form explicit about non-trade semantics", () => {
    assert.match(actionSource, /writeSessionHoldingStateCorrection\(formData\)/);
    assert.match(actionSource, /revalidatePath\(path\)/);
    assert.match(componentSource, /current_state|오입력 정정 전용|매수·매도 거래/);
    assert.match(componentSource, /name="expectedUpdatedAt"/);
    assert.doesNotMatch(componentSource, /canonicalOwnerUserId|ownerUserId/);
  });

  it("exposes only the resource and version evidence needed by the correction form", () => {
    assert.match(querySource, /averageCost: assets\.averageCost/);
    assert.match(querySource, /updatedAt: assets\.updatedAt/);
    assert.doesNotMatch(querySource, /\bfetch\s*\(/);
  });

  it("registers an owner-scoped writer and an immutable correction table", () => {
    assert.match(registrySource, /session_holding_state_correction/);
    assert.match(registrySource, /userTarget\("assets", "update"\)/);
    assert.match(
      registrySource,
      /userTarget\("holding_state_corrections", "insert"\)/,
    );
    assert.match(schemaSource, /export const holdingStateCorrections = pgTable/);
    assert.match(schemaSource, /holding_state_corrections_asset_owner_fk/);
    assert.match(schemaSource, /holding_state_corrections_account_owner_fk/);
    assert.match(schemaSource, /holding_state_corrections_asset_account_fk/);
    assert.match(schemaSource, /holding_state_correction_v1/);
  });

  it("generates one expand-only migration with no data mutation", () => {
    assert.equal(
      migrationSource.match(/CREATE TABLE /g)?.length,
      1,
    );
    assert.match(migrationSource, /CREATE TABLE "holding_state_corrections"/);
    assert.match(migrationSource, /holding_state_corrections_asset_owner_fk/);
    assert.match(migrationSource, /holding_state_corrections_account_owner_fk/);
    assert.match(migrationSource, /holding_state_corrections_asset_account_fk/);
    for (const forbidden of [
      /\bDROP\b/i,
      /\bDELETE\s+FROM\b/i,
      /\bUPDATE\s+[^;]+\s+SET\b/i,
      /\bTRUNCATE\b/i,
      /\bINSERT\s+INTO\b/i,
      /\bRENAME\b/i,
    ]) {
      assert.doesNotMatch(migrationSource, forbidden);
    }
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
