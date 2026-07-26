import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
  PREVIEW_DATABASE_TARGET_GUARD_POLICY,
  guardPreviewDatabaseTarget,
  sha256Fingerprint,
} from "../src/lib/deployment/preview-database-target.ts";
import {
  assertReviewedPreviewDatabaseCatalog,
  assertReviewedPreviewDatabaseState,
  publicPreviewDatabaseEvidence,
} from "../src/lib/deployment/preview-database-evidence.ts";

const PROJECT_ID = "synthetic-neon-project";
const PRODUCTION_ENDPOINT = "ep-production-synthetic";
const PREVIEW_ENDPOINT = "ep-preview-synthetic";
const POLICY = {
  policyId: "preview_database_target_operational_guard_v2",
  expectedNeonIntegrationProjectSha256: sha256Fingerprint(PROJECT_ID),
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
};

describe("Preview database target operational guard", () => {
  it("guards one pooled and unpooled Preview target under the pinned integration configuration", () => {
    const result = guardPreviewDatabaseTarget(
      environment(PREVIEW_ENDPOINT),
      POLICY,
    );

    assert.equal(result.status, "operational_guard_passed");
    assert.equal(
      result.integrationProjectFingerprint,
      sha256Fingerprint(PROJECT_ID),
    );
    assert.equal(
      result.endpointFingerprint,
      sha256Fingerprint(PREVIEW_ENDPOINT),
    );
    assert.equal(
      result.endpointProjectBinding,
      "external_vercel_neon_integration_control",
    );
    assert.match(result.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
  });

  it("blocks the pinned Production endpoint even in VERCEL_ENV=preview", () => {
    assert.throws(
      () =>
        guardPreviewDatabaseTarget(
          environment(PRODUCTION_ENDPOINT),
          POLICY,
        ),
      /Production Neon endpoint/,
    );
  });

  it("blocks Neon project metadata outside the pinned integration configuration", () => {
    assert.throws(
      () =>
        guardPreviewDatabaseTarget(
          {
            ...environment(PREVIEW_ENDPOINT),
            NEON_PROJECT_ID: "unexpected-project",
          },
          POLICY,
        ),
      /does not match the pinned Vercel-Neon integration configuration/,
    );
  });

  it("does not claim endpoint-to-project binding from independent environment values", () => {
    const result = guardPreviewDatabaseTarget(
      environment("ep-other-project-synthetic"),
      POLICY,
    );

    assert.equal(result.status, "operational_guard_passed");
    assert.equal(
      result.endpointProjectBinding,
      "external_vercel_neon_integration_control",
    );
    assert.notEqual(
      result.endpointFingerprint,
      sha256Fingerprint(PREVIEW_ENDPOINT),
    );
  });

  it("blocks pooled and unpooled URL identity drift", () => {
    assert.throws(
      () =>
        guardPreviewDatabaseTarget(
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
    const serialized = JSON.stringify(PREVIEW_DATABASE_TARGET_GUARD_POLICY);
    assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\//i);
    assert.doesNotMatch(serialized, /\.neon\.tech/i);
    assert.match(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY
        .expectedNeonIntegrationProjectSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.match(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.productionEndpointSha256,
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.deepEqual(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration,
      {
        tag: "0021_strange_sinister_six",
        createdAt: 1784991961050,
        sha256:
          "e3590cbe4e787bb32ca6fa9fdb27ae6f50295701dcd22bfb9b3edd8997fb1553",
      },
    );
    assert.deepEqual(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations,
      [PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration],
    );
    assert.deepEqual(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.reviewedMigrationLedger,
      {
        entryCount: 22,
        sha256:
          "sha256:7733283ad3e1a3b4ae89cd761a370ca2a3cc488c085597fb34573055ca033808",
      },
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
    assert.deepEqual(
      {
        evidenceVersion:
          publicPreviewDatabaseEvidence(reviewed).evidenceVersion,
        status: publicPreviewDatabaseEvidence(reviewed).status,
        endpointProjectBinding:
          publicPreviewDatabaseEvidence(reviewed).endpointProjectBinding,
      },
      {
        evidenceVersion: "preview_database_evidence_v4",
        status: "operational_guard_passed",
        endpointProjectBinding:
          "external_vercel_neon_integration_control",
      },
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).migrationLedgerStatus,
      "reviewed_0021_present",
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).assetPriceCatalogStatus,
      "reviewed_0020_present",
    );

    const appliedMigrations = reviewed.appliedMigrations.slice(0, -1);
    const pending = {
      ...reviewed,
      latestMigration: appliedMigrations.at(-1) ?? null,
      appliedMigrations,
    };
    assert.doesNotThrow(() =>
      assertReviewedPreviewDatabaseCatalog(pending),
    );
    assert.throws(
      () => assertReviewedPreviewDatabaseState(pending),
      /migration ledger/,
    );
    assert.deepEqual(
      {
        latestReviewedMigration:
          publicPreviewDatabaseEvidence(pending).latestReviewedMigration,
        migrationLedgerStatus:
          publicPreviewDatabaseEvidence(pending).migrationLedgerStatus,
        assetPriceCatalogStatus:
          publicPreviewDatabaseEvidence(pending).assetPriceCatalogStatus,
      },
      {
        latestReviewedMigration: null,
        migrationLedgerStatus: "reviewed_0021_not_present",
        assetPriceCatalogStatus: "reviewed_0020_present",
      },
    );
  });

  it("rejects an earlier ledger divergence even when migration 0021 is latest", () => {
    const reviewed = reviewedState();
    const diverged = {
      ...reviewed,
      appliedMigrations: reviewed.appliedMigrations.map((migration, index) =>
        index === 0
          ? { ...migration, sha256: "0".repeat(64) }
          : migration,
      ),
    };

    assert.throws(
      () => assertReviewedPreviewDatabaseState(diverged),
      /migration ledger/,
    );
    assert.deepEqual(
      {
        latestReviewedMigration:
          publicPreviewDatabaseEvidence(diverged).latestReviewedMigration,
        migrationLedgerStatus:
          publicPreviewDatabaseEvidence(diverged).migrationLedgerStatus,
        assetPriceCatalogStatus:
          publicPreviewDatabaseEvidence(diverged).assetPriceCatalogStatus,
      },
      {
        latestReviewedMigration: "0021_strange_sinister_six",
        migrationLedgerStatus: "reviewed_0021_not_present",
        assetPriceCatalogStatus: "reviewed_0020_present",
      },
    );
  });

  it("requires exact composite uniqueness and removal of legacy uniqueness", () => {
    const reviewed = reviewedState();
    for (const reviewedCatalog of [
      {
        ...reviewed.reviewedCatalog,
        instrumentDateUniqueIndexExact: false,
      },
      {
        ...reviewed.reviewedCatalog,
        legacyTickerDateIndexPresent: true,
      },
    ]) {
      const drifted = { ...reviewed, reviewedCatalog };
      assert.throws(
        () => assertReviewedPreviewDatabaseState(drifted),
        /catalog is incomplete/,
      );
      assert.equal(
        publicPreviewDatabaseEvidence(drifted).assetPriceCatalogStatus,
        "reviewed_0020_not_present",
      );
    }

    const source = readFileSync(
      "src/lib/deployment/preview-database-evidence.ts",
      "utf8",
    );
    for (const requiredCatalogField of [
      "indisvalid",
      "indisunique",
      "indisready",
      "indislive",
      "indnkeyatts",
      "indnatts",
      "indpred",
      "indexprs",
    ]) {
      assert.match(source, new RegExp(requiredCatalogField));
    }
    assert.match(source, /string_agg\([\s\S]*order by index_key\.ordinality/);
    assert.match(source, /asset_price_snapshots_instrument_date_unique/);
    assert.match(source, /asset_price_snapshots_ticker_date_unique/);
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
  const appliedMigrations = reviewedLocalMigrationLedger();
  return {
    target: {
      policyId: "preview_database_target_operational_guard_v2",
      status: "operational_guard_passed",
      integrationProjectFingerprint: sha256Fingerprint(PROJECT_ID),
      endpointFingerprint: sha256Fingerprint(PREVIEW_ENDPOINT),
      targetFingerprint: sha256Fingerprint("synthetic-target"),
      endpointProjectBinding: "external_vercel_neon_integration_control",
    },
    rowCounts: {
      assets: 1,
      priceSnapshots: 2,
      fxRates: 3,
      approvalRevisions: 0,
    },
    latestMigration: {
      createdAt:
        PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.createdAt,
      sha256:
        PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration.sha256,
    },
    appliedMigrations,
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
      instrumentDateUniqueIndexExact: true,
      legacyTickerDateUniqueIndexExact: false,
      legacyTickerDateIndexPresent: false,
    },
  };
}

function reviewedLocalMigrationLedger() {
  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  );
  const migrations = readMigrationFiles({
    migrationsFolder: "drizzle",
  });
  return journal.entries.map((entry, index) => ({
    createdAt: entry.when,
    sha256: migrations[index].hash,
  }));
}
