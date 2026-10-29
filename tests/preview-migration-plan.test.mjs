import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planPreviewMigrations } from "../src/lib/deployment/preview-migration-plan.ts";
import { canonicalizePreviewMigrationEvidence, PREVIEW_MIGRATION_HASH_COMPATIBILITY, PREVIEW_MIGRATION_HASH_COMPATIBILITIES } from "../src/lib/deployment/preview-migration-compatibility.ts";
import { PREVIEW_DATABASE_TARGET_GUARD_POLICY } from "../src/lib/deployment/preview-database-target.ts";

const LOCAL = Object.freeze([
  migration("0000_synthetic", 1000, "1"),
  migration("0001_synthetic", 2000, "2"),
  migration("0002_synthetic", 3000, "3"),
]);

describe("Preview migration allowlist", () => {
  it("allows only the exact reviewed pending suffix", () => {
    const plan = planPreviewMigrations({
      localMigrations: LOCAL,
      appliedMigrations: LOCAL.slice(0, 2).map(applied),
      allowedPendingMigrations: [LOCAL[2]],
    });

    assert.deepEqual(plan, {
      status: "ready",
      appliedCount: 2,
      localCount: 3,
      latestAppliedTag: "0001_synthetic",
      pendingTags: ["0002_synthetic"],
    });
  });

  it("accepts an already current exact ledger without pending writes", () => {
    const plan = planPreviewMigrations({
      localMigrations: LOCAL,
      appliedMigrations: LOCAL.map(applied),
      allowedPendingMigrations: [LOCAL[2]],
    });
    assert.deepEqual(plan.pendingTags, []);
  });

  it("blocks an unreviewed future migration", () => {
    assert.throws(
      () =>
        planPreviewMigrations({
          localMigrations: LOCAL,
          appliedMigrations: LOCAL.slice(0, 2).map(applied),
          allowedPendingMigrations: [],
        }),
      /not allowlisted: 0002_synthetic/,
    );
  });

  it("blocks ledger hash or journal order divergence", () => {
    assert.throws(
      () =>
        planPreviewMigrations({
          localMigrations: LOCAL,
          appliedMigrations: [
            applied(LOCAL[0]),
            { ...applied(LOCAL[1]), sha256: "f".repeat(64) },
          ],
          allowedPendingMigrations: [LOCAL[2]],
        }),
      /ledger diverges/,
    );
  });

  it("blocks a database ledger ahead of the reviewed local journal", () => {
    assert.throws(
      () =>
        planPreviewMigrations({
          localMigrations: LOCAL.slice(0, 2),
          appliedMigrations: LOCAL.map(applied),
          allowedPendingMigrations: [],
        }),
      /ledger is ahead/,
    );
  });
});

function migration(tag, createdAt, hashCharacter) {
  return { tag, createdAt, sha256: hashCharacter.repeat(64) };
}

function applied({ createdAt, sha256 }) {
  return { createdAt, sha256 };
}

const known = PREVIEW_MIGRATION_HASH_COMPATIBILITY;
const knownLocal = Object.freeze({ tag: known.tag, createdAt: known.createdAt, sha256: known.canonicalSha256 });
const knownApplied = Object.freeze({ createdAt: known.createdAt, sha256: known.appliedSha256 });
const hash = value => createHash("sha256").update(value).digest("hex");

describe("documented migration artifact compatibility", () => {
  it("proves the fixed hashes are exactly the repository SQL and its CRLF rendering", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const entry = journal.entries.find(row => row.tag === known.tag);
    const sql = readFileSync("drizzle/0047_member_activity.sql", "utf8");
    assert.equal(entry.when, known.createdAt);
    assert.doesNotMatch(sql, /\r/);
    assert.equal(hash(sql), known.canonicalSha256);
    assert.equal(hash(sql.replaceAll("\n", "\r\n")), known.appliedSha256);
  });

  it("admits the documented artifact without changing raw ledger evidence", () => {
    const canonical = canonicalizePreviewMigrationEvidence(knownApplied);
    assert.deepEqual(canonical, applied(knownLocal));
    assert.notEqual(canonical, knownApplied);
    assert.equal(knownApplied.sha256, known.appliedSha256);
    assert.deepEqual(planPreviewMigrations({ localMigrations: [knownLocal], appliedMigrations: [knownApplied], allowedPendingMigrations: [] }).pendingTags, []);
  });

  it("does not generalize normalization to another timestamp, tag, hash, or reverse alias", () => {
    const wrongDate = { ...knownApplied, createdAt: known.createdAt + 1 };
    const wrongHash = { ...knownApplied, sha256: "f".repeat(64) };
    assert.deepEqual(canonicalizePreviewMigrationEvidence(wrongDate), wrongDate);
    assert.deepEqual(canonicalizePreviewMigrationEvidence(wrongHash), wrongHash);
    for (const [local, recorded] of [
      [knownLocal, wrongDate],
      [knownLocal, wrongHash],
      [{ ...knownLocal, tag: "0047_unreviewed" }, knownApplied],
      [{ ...knownLocal, createdAt: known.createdAt + 1 }, wrongDate],
      [{ ...knownLocal, sha256: known.appliedSha256 }, applied(knownLocal)],
    ]) assert.throws(() => planPreviewMigrations({ localMigrations: [local], appliedMigrations: [recorded], allowedPendingMigrations: [] }), /ledger diverges/);
  });

  it("accepts the current full ledger with all four artifacts but never permits new pending DDL", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    const local = journal.entries.map(entry => ({ tag: entry.tag, createdAt: entry.when, sha256: hash(readFileSync('drizzle/' + entry.tag + '.sql')) }));
    const recorded = Object.freeze(local.map(entry => {
      const artifact = PREVIEW_MIGRATION_HASH_COMPATIBILITIES.find(row => row.tag === entry.tag);
      return Object.freeze({ createdAt: entry.createdAt, sha256: artifact?.appliedSha256 ?? entry.sha256 });
    }));
    const before = JSON.stringify(recorded);
    assert.equal("sha256:" + hash(JSON.stringify(recorded.map(canonicalizePreviewMigrationEvidence))), PREVIEW_DATABASE_TARGET_GUARD_POLICY.reviewedMigrationLedger.sha256);
    const input = { localMigrations: local, appliedMigrations: recorded, allowedPendingMigrations: PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations };
    assert.equal(planPreviewMigrations(input).appliedCount, 65);
    assert.equal(JSON.stringify(recorded), before, "comparison must preserve every raw applied hash");
    assert.deepEqual(planPreviewMigrations(input).pendingTags, []);
    assert.throws(() => planPreviewMigrations({ ...input, appliedMigrations: recorded.slice(0, -1) }), /not allowlisted: 0064_contribution_effects/);
    assert.throws(() => planPreviewMigrations({ ...input, localMigrations: [...local, migration("0065_unreviewed", local.at(-1).createdAt + 1, "f")] }), /not allowlisted: 0065_unreviewed/);
    assert.throws(() => planPreviewMigrations({ ...input, appliedMigrations: [...recorded.slice(0, 47), { ...knownApplied, sha256: "f".repeat(64) }, ...recorded.slice(48)] }), /ledger diverges at local migration 0047_member_activity/);
  });
});

for (const artifact of PREVIEW_MIGRATION_HASH_COMPATIBILITIES.slice(1)) {
  describe(artifact.tag + " historical byte evidence", () => {
    const local = Object.freeze({ tag: artifact.tag, createdAt: artifact.createdAt, sha256: artifact.canonicalSha256 });
    const recorded = Object.freeze({ createdAt: artifact.createdAt, sha256: artifact.appliedSha256 });
    it("reproduces the exact applied hash from the unchanged repository SQL", () => {
      const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
      assert.equal(journal.entries.find(entry => entry.tag === artifact.tag).when, artifact.createdAt);
      const sql = readFileSync("drizzle/" + artifact.tag + ".sql", "utf8");
      assert.doesNotMatch(sql, /\r/);
      assert.equal(hash(sql), artifact.canonicalSha256);
      let historical = sql.replaceAll("\n", "\r\n");
      if (artifact.tag === "0058_broker_recovery_evidence") {
        const lines = sql.split("\n");
        assert.equal(lines.length - 1, 54);
        // Exactly 1-based newline positions 22-25 remain LF; all others are CRLF.
        historical = lines.map((line, index) => line + (index < lines.length - 1
          ? index >= 21 && index <= 24 ? "\n" : "\r\n" : "")).join("");
        assert.equal(Buffer.byteLength(historical), 4356);
        assert.equal((historical.match(/\r\n/g) ?? []).length, 50);
        assert.equal((historical.match(/(?<!\r)\n/g) ?? []).length, 4);
        assert.notEqual(hash(sql.replaceAll("\n", "\r\n")), artifact.appliedSha256);
      }
      assert.equal(historical.replaceAll("\r\n", "\n"), sql);
      assert.equal(hash(historical), artifact.appliedSha256);
    });

    it("accepts only its exact identity while preserving the raw record", () => {
      assert.deepEqual(canonicalizePreviewMigrationEvidence(recorded), applied(local));
      assert.equal(recorded.sha256, artifact.appliedSha256);
      assert.deepEqual(planPreviewMigrations({ localMigrations: [local], appliedMigrations: [recorded], allowedPendingMigrations: [] }).pendingTags, []);
      const wrongDate = { ...recorded, createdAt: artifact.createdAt + 1 };
      const wrongHash = { ...recorded, sha256: "f".repeat(64) };
      assert.deepEqual(canonicalizePreviewMigrationEvidence(wrongDate), wrongDate);
      assert.deepEqual(canonicalizePreviewMigrationEvidence(wrongHash), wrongHash);
      for (const [expected, actual] of [
        [local, wrongDate], [local, wrongHash],
        [{ ...local, tag: artifact.tag.slice(0, 4) + "_unreviewed" }, recorded],
        [{ ...local, createdAt: artifact.createdAt + 1 }, wrongDate],
        [{ ...local, sha256: artifact.appliedSha256 }, applied(local)],
      ]) assert.throws(() => planPreviewMigrations({ localMigrations: [expected], appliedMigrations: [actual], allowedPendingMigrations: [] }), /ledger diverges/);
    });
  });
}
