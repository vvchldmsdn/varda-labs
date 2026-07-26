import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planReviewedMigrations } from "../src/lib/deployment/migration-ledger-plan.ts";

const LOCAL = Object.freeze([
  migration("0000_synthetic", 1000, "1"),
  migration("0001_synthetic", 2000, "2"),
  migration("0002_synthetic", 3000, "3"),
]);

describe("reviewed migration ledger plan", () => {
  it("allows only the exact reviewed pending suffix", () => {
    assert.deepEqual(
      planReviewedMigrations({
        localMigrations: LOCAL,
        appliedMigrations: LOCAL.slice(0, 2).map(applied),
        allowedPendingMigrations: [LOCAL[2]],
      }),
      {
        status: "ready",
        appliedCount: 2,
        localCount: 3,
        latestAppliedTag: "0001_synthetic",
        pendingTags: ["0002_synthetic"],
      },
    );
  });

  it("accepts an exact fully applied ledger", () => {
    const plan = planReviewedMigrations({
      localMigrations: LOCAL,
      appliedMigrations: LOCAL.map(applied),
      allowedPendingMigrations: [],
    });

    assert.deepEqual(plan.pendingTags, []);
    assert.equal(plan.latestAppliedTag, "0002_synthetic");
  });

  it("blocks an unreviewed pending migration", () => {
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: LOCAL,
          appliedMigrations: LOCAL.slice(0, 2).map(applied),
          allowedPendingMigrations: [],
        }),
      /not allowlisted: 0002_synthetic/,
    );
  });

  it("blocks a diverged or ahead database ledger", () => {
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: LOCAL,
          appliedMigrations: [
            applied(LOCAL[0]),
            { ...applied(LOCAL[1]), sha256: "f".repeat(64) },
          ],
          allowedPendingMigrations: [LOCAL[2]],
        }),
      /ledger diverges \(hash\)/,
    );
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: LOCAL,
          appliedMigrations: [
            applied(LOCAL[0]),
            { ...applied(LOCAL[1]), createdAt: 2500 },
          ],
          allowedPendingMigrations: [LOCAL[2]],
        }),
      /ledger diverges \(timestamp\)/,
    );
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: LOCAL.slice(0, 2),
          appliedMigrations: LOCAL.map(applied),
          allowedPendingMigrations: [],
        }),
      /ledger is ahead/,
    );
  });

  it("blocks duplicate or out-of-order migration identities", () => {
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: [LOCAL[0], { ...LOCAL[1], tag: LOCAL[0].tag }],
          appliedMigrations: [],
          allowedPendingMigrations: [],
        }),
      /duplicate identity/,
    );
    assert.throws(
      () =>
        planReviewedMigrations({
          localMigrations: [LOCAL[1], LOCAL[0]],
          appliedMigrations: [],
          allowedPendingMigrations: [],
        }),
      /strict journal order/,
    );
  });
});

function migration(tag, createdAt, hashCharacter) {
  return { tag, createdAt, sha256: hashCharacter.repeat(64) };
}

function applied({ createdAt, sha256 }) {
  return { createdAt, sha256 };
}
