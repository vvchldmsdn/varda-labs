import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HOLDING_LIFECYCLE_POLICY,
  parseHoldingArchiveInput,
  parseHoldingRestoreInput,
} from "../src/lib/holding-lifecycle.ts";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const UPDATED_AT = "2026-08-18T01:02:03.000Z";
const writerSource = source("../src/lib/holding-lifecycle-write.ts");
const actionSource = source("../src/app/portfolio/holdings/actions.ts");
const componentSource = source("../src/components/holding-lifecycle-forms.tsx");
const pageSource = source("../src/app/portfolio/holdings/page.tsx");
const schemaSource = source("../src/db/schema.ts");
const registrySource = source("../src/lib/tenant-writer-registry.ts");
const migrationSource = source("../drizzle/0036_curvy_iron_monger.sql");
const dailySnapshotSource = source("../src/lib/snapshots/daily.ts");
const dailySnapshotJobSource = source("../src/lib/snapshots/daily-job.ts");

describe("owner-scoped holding lifecycle", () => {
  it("requires explicit archive confirmation and exact row-version evidence", () => {
    const blocked = parseHoldingArchiveInput(
      form({ assetId: ASSET_ID, expectedUpdatedAt: UPDATED_AT }),
    );
    const archived = parseHoldingArchiveInput(
      form({
        assetId: ASSET_ID,
        expectedUpdatedAt: UPDATED_AT,
        archiveConfirmed: "yes",
        reason: "  전량   매도  ",
      }),
    );
    const restored = parseHoldingRestoreInput(
      form({ assetId: ASSET_ID, expectedUpdatedAt: UPDATED_AT }),
    );

    assert.equal(blocked.ok, false);
    assert.deepEqual(archived, {
      ok: true,
      input: {
        assetId: ASSET_ID,
        expectedUpdatedAt: UPDATED_AT,
        reason: "전량 매도",
      },
    });
    assert.equal(restored.ok, true);
    assert.equal(
      HOLDING_LIFECYCLE_POLICY.semantics,
      "soft_archive_preserve_financial_evidence",
    );
  });

  it("rejects invalid identifiers, timestamps, and unbounded notes", () => {
    const base = {
      assetId: ASSET_ID,
      expectedUpdatedAt: UPDATED_AT,
      archiveConfirmed: "yes",
    };

    assert.equal(
      parseHoldingArchiveInput(form({ ...base, assetId: "holding-1" })).ok,
      false,
    );
    assert.equal(
      parseHoldingArchiveInput(
        form({ ...base, expectedUpdatedAt: "2026-08-18" }),
      ).ok,
      false,
    );
    assert.equal(
      parseHoldingArchiveInput(
        form({ ...base, reason: "x".repeat(501) }),
      ).ok,
      false,
    );
  });

  it("archives and restores one owned row with immutable lifecycle evidence", () => {
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /prepareTenantWriteContext\(/);
    assert.match(writerSource, /pg_advisory_xact_lock/);
    assert.match(writerSource, /for update of asset/i);
    assert.match(writerSource, /asset\.canonical_owner_user_id = \$2::uuid/);
    assert.match(writerSource, /account_row\.canonical_owner_user_id = \$2::uuid/);
    assert.match(writerSource, /asset\.archived_at is null/);
    assert.match(writerSource, /asset\.archived_at is not null/);
    assert.match(writerSource, /insert into holding_lifecycle_events/i);
    assert.match(writerSource, /previous_archived_at/i);
    assert.match(writerSource, /resulting_archived_at/i);
    assert.doesNotMatch(writerSource, /update\s+assets[\s\S]*quantity\s*=/i);
    assert.doesNotMatch(writerSource, /event_ledger/i);
    assert.doesNotMatch(writerSource, /\bfetch\s*\(/);
  });

  it("closes current group memberships without deleting financial evidence", () => {
    assert.match(writerSource, /delete from portfolio_group_asset_memberships/i);
    assert.match(writerSource, /membership\.valid_from >= \$5::date/);
    assert.match(writerSource, /set valid_to = \$5::date/i);
    assert.doesNotMatch(writerSource, /delete from assets/i);
    assert.doesNotMatch(writerSource, /delete from (?:daily_|asset_price_)/i);
  });

  it("keeps Server Actions thin and separates active from archived UI", () => {
    assert.match(actionSource, /archiveSessionHolding\(formData\)/);
    assert.match(actionSource, /restoreSessionHolding\(formData\)/);
    assert.match(actionSource, /revalidatePath\(path\)/);
    assert.match(componentSource, /name="archiveConfirmed"/);
    assert.match(pageSource, /holding\.archivedAt === null/);
    assert.match(pageSource, /종료된 보유종목/);
    assert.doesNotMatch(componentSource, /canonicalOwnerUserId|ownerUserId/);
  });

  it("excludes archived holdings from current daily snapshot work", () => {
    assert.match(dailySnapshotSource, /isNull\(assets\.archivedAt\)/);
    assert.match(dailySnapshotJobSource, /isNull\(assets\.archivedAt\)/);
  });

  it("registers the owner-scoped writer and normalized audit table", () => {
    assert.match(registrySource, /session_holding_lifecycle/);
    assert.match(registrySource, /userTarget\("holding_lifecycle_events", "insert"\)/);
    assert.match(schemaSource, /archivedAt: timestamp\("archived_at"/);
    assert.match(schemaSource, /export const holdingLifecycleEvents = pgTable/);
    assert.match(schemaSource, /holding_lifecycle_events_asset_owner_fk/);
    assert.match(schemaSource, /holding_lifecycle_events_account_owner_fk/);
    assert.match(schemaSource, /holding_lifecycle_events_asset_account_fk/);
    assert.match(schemaSource, /holding_lifecycle_events_tenant_select_v1/);
  });

  it("generates one expand-only migration without financial data mutation", () => {
    assert.equal(migrationSource.match(/CREATE TABLE /g)?.length, 1);
    assert.match(migrationSource, /CREATE TABLE "holding_lifecycle_events"/);
    assert.match(
      migrationSource,
      /ALTER TABLE "assets" ADD COLUMN "archived_at"/,
    );
    assert.match(migrationSource, /holding_lifecycle_events_asset_owner_fk/);
    assert.match(migrationSource, /holding_lifecycle_events_tenant_select_v1/);
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
