import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planPreviewMigrations } from "../src/lib/deployment/preview-migration-plan.ts";

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
