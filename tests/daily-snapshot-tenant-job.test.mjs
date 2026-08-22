import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildDailySnapshotJobResult } from "../src/lib/snapshots/daily-job-result.ts";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

describe("tenant daily snapshot job", () => {
  it("keeps ready and blocked tenant dry-runs separate", () => {
    const result = buildDailySnapshotJobResult({
      dryRun: true,
      snapshotDate: "2026-07-08",
      requestedAccount: "all",
      targets: [
        { ownerUserId: OWNER_A, status: "ready", result: snapshot(true) },
        { ownerUserId: OWNER_B, status: "blocked", result: snapshot(false) },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.writeReady, false);
    assert.equal(result.targetCount, 2);
    assert.equal(result.readyCount, 1);
    assert.equal(result.blockedCount, 1);
    assert.equal(result.failedCount, 0);
  });

  it("reports cross-tenant partial writes without hiding the failed tenant", () => {
    const result = buildDailySnapshotJobResult({
      dryRun: false,
      snapshotDate: "2026-07-08",
      requestedAccount: "brokerage",
      targets: [
        { ownerUserId: OWNER_A, status: "written", result: snapshot(true) },
        {
          ownerUserId: OWNER_B,
          status: "failed",
          error: { code: "blocked", message: "blocked", statusCode: 409 },
        },
      ],
    });

    assert.equal(result.ok, false);
    assert.equal(result.writeReady, false);
    assert.equal(result.writtenCount, 1);
    assert.equal(result.failedCount, 1);
  });

  it("derives owners from active account roots and rejects HTTP owner selectors", () => {
    const job = readFileSync("src/lib/snapshots/daily-job.ts", "utf8");
    const route = readFileSync(
      "src/app/api/admin/snapshots/daily/route.ts",
      "utf8",
    );
    const writer = readFileSync("src/lib/snapshots/daily.ts", "utf8");

    assert.match(job, /eq\(accounts\.canonicalOwnerUserId, appUsers\.id\)/);
    assert.match(job, /ne\(accounts\.accountType, "cash"\)/);
    assert.match(job, /eq\(assets\.accountId, accounts\.id\)/);
    assert.match(job, /gt\(assets\.quantity, "0"\)/);
    assert.match(job, /eq\(appUsers\.status, "active"\)/);
    assert.match(job, /mapWithConcurrency\(\s*targets,\s*2,/);
    assert.doesNotMatch(job, /SNAPSHOT_ACCOUNT_CODES/);
    assert.doesNotMatch(job, /\.limit\(1\)/);
    assert.match(route, /hasUnsupportedQuery/);
    assert.doesNotMatch(route, /SNAPSHOT_ACCOUNTS|parseAccount/);
    assert.doesNotMatch(route, /searchParams\.get\(["'](?:owner|ownerUserId|canonicalOwnerUserId)/);
    assert.match(writer, /select\(getTableColumns\(assets\)\)/);
    assert.match(writer, /eq\(accounts\.canonicalOwnerUserId, ownerUserId\)/);
    assert.match(writer, /canonicalOwnerUserId: context\.ownerUserId/);
    assert.match(writer, /mapWithConcurrency\(\s*targetAccounts,\s*2,/);
  });

  it("pins owner-aware keys and a dry-run-default generated-row backfill", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const backfill = readFileSync(
      "scripts/backfill-generated-snapshot-owners.mjs",
      "utf8",
    );

    assert.match(schema, /accounts_canonical_owner_code_unique/);
    assert.match(schema, /daily_portfolio_snapshots_account_owner_fk/);
    assert.match(schema, /daily_position_snapshots_account_owner_fk/);
    assert.match(schema, /daily_position_snapshots_asset_account_fk/);
    assert.match(schema, /daily_position_snapshots_asset_identity_check/);
    assert.doesNotMatch(writerSource(), /missing_legacy_asset_id/);
    assert.match(backfill, /const write = args\[0\] === "--write"/);
    assert.match(backfill, /canonical_owner_user_id is null/g);
    assert.match(backfill, /guardProductionDatabaseTarget/);
    assert.match(
      backfill,
      /validate constraint daily_portfolio_snapshots_generated_owner_check/,
    );
    assert.match(
      backfill,
      /validate constraint daily_position_snapshots_generated_owner_check/,
    );
    assert.doesNotMatch(backfill, /delete\s+from/i);
  });

  it("keeps migration 0023 data-preserving and orders composite keys before foreign keys", () => {
    const migration = readFileSync(
      "drizzle/0023_nasty_overlord.sql",
      "utf8",
    );

    for (const statement of migration.split("--> statement-breakpoint")) {
      assert.doesNotMatch(
        statement.trim(),
        /^(?:insert\s+into|update|delete\s+from|truncate|drop\s+table)\b/i,
      );
    }
    assert.match(
      migration,
      /daily_portfolio_snapshots_generated_owner_check[^;]+NOT VALID/,
    );
    assert.match(
      migration,
      /daily_position_snapshots_generated_owner_check[^;]+NOT VALID/,
    );
    assert.ok(
      migration.indexOf('CREATE UNIQUE INDEX "assets_id_account_unique"') <
        migration.indexOf(
          'ADD CONSTRAINT "daily_position_snapshots_asset_account_fk"',
        ),
    );
    assert.match(
      migration,
      /ALTER COLUMN "legacy_asset_id" DROP NOT NULL/,
    );
  });

  it("widens generated snapshot checks for dynamic accounts without DML", () => {
    const migration = readFileSync(
      "drizzle/0030_spooky_ikaris.sql",
      "utf8",
    );

    assert.match(
      migration,
      /daily_portfolio_snapshots_generated_owner_check/,
    );
    assert.match(
      migration,
      /"account" <> 'all' and "daily_portfolio_snapshots"\."account_id" is not null/,
    );
    assert.match(
      migration,
      /"daily_position_snapshots"\."account" <> 'all'/,
    );
    assert.doesNotMatch(migration, /'brokerage', 'isa', 'irp'/);
    assert.doesNotMatch(
      migration,
      /\b(?:insert\s+into|update|delete\s+from|truncate)\b/i,
    );
  });
});

function snapshot(writeReady) {
  return { ok: writeReady, writeReady };
}

function writerSource() {
  return readFileSync("src/lib/snapshots/daily.ts", "utf8");
}
