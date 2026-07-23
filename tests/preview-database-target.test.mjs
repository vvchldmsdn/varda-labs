import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PREVIEW_DATABASE_TARGET_POLICY,
  attestPreviewDatabaseTarget,
  sha256Fingerprint,
} from "../src/lib/deployment/preview-database-target.ts";
import {
  assertReviewedPreviewDatabaseState,
  publicPreviewDatabaseEvidence,
} from "../src/lib/deployment/preview-database-evidence.ts";

const PROJECT_ID = "synthetic-neon-project";
const PRODUCTION_ENDPOINT = "ep-production-synthetic";
const PREVIEW_ENDPOINT = "ep-preview-synthetic";
const POLICY = {
  policyId: "preview_database_target_attestation_v1",
  expectedNeonProjectSha256: sha256Fingerprint(PROJECT_ID),
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
};

describe("Preview database target attestation", () => {
  it("attests one pooled and unpooled Preview target in the pinned project", () => {
    const result = attestPreviewDatabaseTarget(
      environment(PREVIEW_ENDPOINT),
      POLICY,
    );

    assert.equal(result.status, "attested");
    assert.equal(result.projectFingerprint, sha256Fingerprint(PROJECT_ID));
    assert.equal(
      result.endpointFingerprint,
      sha256Fingerprint(PREVIEW_ENDPOINT),
    );
    assert.match(result.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
  });

  it("blocks the pinned Production endpoint even in VERCEL_ENV=preview", () => {
    assert.throws(
      () =>
        attestPreviewDatabaseTarget(
          environment(PRODUCTION_ENDPOINT),
          POLICY,
        ),
      /Production Neon endpoint/,
    );
  });

  it("blocks a database from another Neon project", () => {
    assert.throws(
      () =>
        attestPreviewDatabaseTarget(
          {
            ...environment(PREVIEW_ENDPOINT),
            NEON_PROJECT_ID: "unexpected-project",
          },
          POLICY,
        ),
      /unexpected Neon project/,
    );
  });

  it("blocks pooled and unpooled URL identity drift", () => {
    assert.throws(
      () =>
        attestPreviewDatabaseTarget(
          {
            ...environment(PREVIEW_ENDPOINT),
            DATABASE_URL_UNPOOLED: databaseUrl(
              "ep-another-preview",
              false,
            ),
          },
          POLICY,
        ),
      /do not identify one database target/,
    );
  });

  it("keeps the committed target policy fingerprint-only", () => {
    const serialized = JSON.stringify(PREVIEW_DATABASE_TARGET_POLICY);
    assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(serialized, /\.neon\.tech/i);
    assert.match(
      PREVIEW_DATABASE_TARGET_POLICY.expectedNeonProjectSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.match(
      PREVIEW_DATABASE_TARGET_POLICY.productionEndpointSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("keeps runtime evidence Preview-only, read-only, and access-gated", () => {
    const route = readFileSync(
      "src/app/admin/preview-db-evidence/route.ts",
      "utf8",
    );
    const proxy = readFileSync("src/proxy.ts", "utf8");
    const smoke = readFileSync(
      "scripts/smoke-simulation-route.mjs",
      "utf8",
    );

    assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
    assert.match(route, /assertReviewedPreviewDatabaseState/);
    assert.match(route, /Cache-Control": "no-store"/);
    assert.doesNotMatch(
      route,
      /\.insert\(|\.update\(|\.delete\(|\b(?:insert|update|delete|merge)\s+into\b/i,
    );
    assert.match(proxy, /"\/admin\/:path\*"/);
    assert.match(smoke, /--remote-db-evidence/);
    assert.match(smoke, /\/admin\/preview-db-evidence/);
  });

  it("does not label pending schema evidence as reviewed", () => {
    const reviewed = reviewedState();
    assert.doesNotThrow(() =>
      assertReviewedPreviewDatabaseState(reviewed),
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).catalogStatus,
      "reviewed_0019_present",
    );

    const pending = { ...reviewed, latestMigration: null };
    assert.throws(
      () => assertReviewedPreviewDatabaseState(pending),
      /latest migration/,
    );
    assert.deepEqual(
      {
        latestReviewedMigration:
          publicPreviewDatabaseEvidence(pending).latestReviewedMigration,
        catalogStatus: publicPreviewDatabaseEvidence(pending).catalogStatus,
      },
      {
        latestReviewedMigration: null,
        catalogStatus: "reviewed_0019_not_present",
      },
    );
  });
});

function environment(endpoint) {
  return {
    VERCEL_ENV: "preview",
    NEON_PROJECT_ID: PROJECT_ID,
    DATABASE_URL: databaseUrl(endpoint, true),
    DATABASE_URL_UNPOOLED: databaseUrl(endpoint, false),
  };
}

function databaseUrl(endpoint, pooled) {
  return `postgresql://preview_user:preview_password@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/neondb?sslmode=require`;
}

function reviewedState() {
  return {
    target: {
      policyId: "preview_database_target_attestation_v1",
      status: "attested",
      projectFingerprint: sha256Fingerprint(PROJECT_ID),
      endpointFingerprint: sha256Fingerprint(PREVIEW_ENDPOINT),
      targetFingerprint: sha256Fingerprint("synthetic-target"),
    },
    rowCounts: {
      assets: 1,
      priceSnapshots: 2,
      fxRates: 3,
      approvalRevisions: 0,
    },
    latestMigration: {
      createdAt:
        PREVIEW_DATABASE_TARGET_POLICY.latestReviewedMigration.createdAt,
      sha256: PREVIEW_DATABASE_TARGET_POLICY.latestReviewedMigration.sha256,
    },
    reviewedCatalog: {
      adjustedClosePriceNullable: true,
      presentColumns: [
        "adjusted_close_basis",
        "adjusted_close_provider",
        "adjusted_close_source",
        "adjusted_close_fetched_at",
        "provider_symbol",
        "provider_exchange",
        "fetched_at",
      ],
      instrumentDateUniqueIndex: true,
    },
  };
}
