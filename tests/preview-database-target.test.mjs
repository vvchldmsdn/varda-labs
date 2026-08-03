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
  assertPreviewTargetPolicyRowsPreserved,
  assertReviewedPreSnapshotOwnerPreviewDatabaseCatalog,
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
        tag: "0023_nasty_overlord",
        createdAt: 1785755593145,
        sha256:
          "ad5a82437e9a80379f7e79c07fa583063f6530fe6ca91727bdb575453f98ebaf",
      },
    );
    assert.deepEqual(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.allowedPendingMigrations,
      [PREVIEW_DATABASE_TARGET_GUARD_POLICY.latestReviewedMigration],
    );
    assert.deepEqual(
      PREVIEW_DATABASE_TARGET_GUARD_POLICY.reviewedMigrationLedger,
      {
        entryCount: 24,
        sha256:
          "sha256:586d255bd37a681bcfbe7726895cb7b755182c81ce5ceccb6618af1ab67d3d57",
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
        evidenceVersion: "preview_database_evidence_v6",
        status: "operational_guard_passed",
        endpointProjectBinding:
          "external_vercel_neon_integration_control",
      },
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).migrationLedgerStatus,
      "reviewed_0023_present",
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).assetPriceCatalogStatus,
      "reviewed_0020_present",
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed).targetPolicyCatalogStatus,
      "reviewed_0022_present",
    );
    assert.equal(
      publicPreviewDatabaseEvidence(reviewed)
        .snapshotOwnershipCatalogStatus,
      "reviewed_0023_present",
    );

    const appliedMigrations = reviewed.appliedMigrations.slice(0, -1);
    const pending = {
      ...reviewed,
      latestMigration: appliedMigrations.at(-1) ?? null,
      appliedMigrations,
      reviewedCatalog: {
        ...reviewed.reviewedCatalog,
        dailyPositionLegacyAssetIdNullable: false,
        snapshotOwnershipConstraints: [],
        accountOwnerCodeUniqueIndexExact: false,
        assetAccountUniqueIndexExact: false,
        portfolioSnapshotIdentityIndexExact: false,
        positionSnapshotIdentityIndexExact: false,
      },
    };
    assert.doesNotThrow(() =>
      assertReviewedPreSnapshotOwnerPreviewDatabaseCatalog(pending),
    );
    assert.throws(
      () => assertReviewedPreviewDatabaseCatalog(pending),
      /0023 catalog is incomplete/,
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
        targetPolicyCatalogStatus:
          publicPreviewDatabaseEvidence(pending).targetPolicyCatalogStatus,
        snapshotOwnershipCatalogStatus:
          publicPreviewDatabaseEvidence(pending)
            .snapshotOwnershipCatalogStatus,
      },
      {
        latestReviewedMigration: null,
        migrationLedgerStatus: "reviewed_0023_not_present",
        assetPriceCatalogStatus: "reviewed_0020_present",
        targetPolicyCatalogStatus: "reviewed_0022_present",
        snapshotOwnershipCatalogStatus: "reviewed_0023_not_present",
      },
    );
  });

  it("treats inherited target-policy rows as data and preserves them", () => {
    const reviewed = reviewedState();
    const inheritedRows = {
      revisions: 1,
      vectorRows: 4,
      lifecycleEvents: 1,
    };
    const inherited = {
      ...reviewed,
      reviewedCatalog: {
        ...reviewed.reviewedCatalog,
        targetPolicyRows: inheritedRows,
      },
    };

    assert.doesNotThrow(() => assertReviewedPreviewDatabaseState(inherited));
    assert.equal(
      publicPreviewDatabaseEvidence(inherited).targetPolicyCatalogStatus,
      "reviewed_0022_present",
    );
    assert.doesNotThrow(() =>
      assertPreviewTargetPolicyRowsPreserved(inheritedRows, inheritedRows),
    );
    assert.throws(
      () =>
        assertPreviewTargetPolicyRowsPreserved(inheritedRows, {
          ...inheritedRows,
          vectorRows: 5,
        }),
      /changed inherited target-policy row counts/,
    );
    assert.doesNotThrow(() =>
      assertPreviewTargetPolicyRowsPreserved(null, {
        revisions: 0,
        vectorRows: 0,
        lifecycleEvents: 0,
      }),
    );
    assert.throws(
      () => assertPreviewTargetPolicyRowsPreserved(null, inheritedRows),
      /unexpectedly seeded target-policy rows/,
    );

    const buildScript = readFileSync(
      "scripts/preview-database-evidence.mjs",
      "utf8",
    );
    assert.match(buildScript, /preview_database_build_preflight_v7/);
    assert.match(buildScript, /targetPolicyRows/);
    assert.match(buildScript, /assertPreviewTargetPolicyRowsPreserved/);
  });

  it("rejects an earlier ledger divergence even when migration 0023 is latest", () => {
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
        latestReviewedMigration: "0023_nasty_overlord",
        migrationLedgerStatus: "reviewed_0023_not_present",
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
    assert.match(source, /accounts_id_canonical_owner_unique/);
    assert.match(source, /accounts_canonical_owner_code_unique/);
    assert.match(source, /assets_id_account_unique/);
    assert.match(
      source,
      /daily_portfolio_snapshots_date_account_source_unique/,
    );
    assert.match(
      source,
      /daily_position_snapshots_date_account_asset_source_unique/,
    );
    assert.match(source, /daily_position_snapshots_asset_account_fk/);
    assert.match(source, /target_policy_revisions_current_unique/);
    assert.match(source, /target_policy_revisions_account_owner_fk/);
  });

  it("requires the reviewed snapshot ownership catalog", () => {
    const reviewed = reviewedState();
    for (const reviewedCatalog of [
      {
        ...reviewed.reviewedCatalog,
        dailyPositionLegacyAssetIdNullable: false,
      },
      {
        ...reviewed.reviewedCatalog,
        snapshotOwnershipConstraints:
          reviewed.reviewedCatalog.snapshotOwnershipConstraints.slice(1),
      },
      {
        ...reviewed.reviewedCatalog,
        positionSnapshotIdentityIndexExact: false,
      },
    ]) {
      const drifted = { ...reviewed, reviewedCatalog };
      assert.throws(
        () => assertReviewedPreviewDatabaseState(drifted),
        /0023 catalog is incomplete/,
      );
      assert.equal(
        publicPreviewDatabaseEvidence(drifted)
          .snapshotOwnershipCatalogStatus,
        "reviewed_0023_not_present",
      );
    }
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
      dailyPortfolioSnapshots: 4,
      dailyPositionSnapshots: 5,
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
      targetPolicyTables: [
        "target_policy_approval_revisions",
        "target_policy_approval_vector_rows",
        "target_policy_approval_lifecycle_events",
      ],
      targetPolicyConstraints: [
        "target_policy_events_sequence_check",
        "target_policy_events_audit_version_check",
        "target_policy_events_transition_shape_check",
        "target_policy_events_revision_fk",
        "target_policy_events_replacement_fk",
        "target_policy_revisions_policy_id_check",
        "target_policy_revisions_version_check",
        "target_policy_revisions_revision_check",
        "target_policy_revisions_universe_hash_check",
        "target_policy_revisions_vector_hash_check",
        "target_policy_revisions_evidence_ref_check",
        "target_policy_revisions_status_check",
        "target_policy_revisions_terminal_state_check",
        "target_policy_revisions_owner_user_fk",
        "target_policy_revisions_account_owner_fk",
        "target_policy_vector_rows_pk",
        "target_policy_vector_rows_market_check",
        "target_policy_vector_rows_currency_check",
        "target_policy_vector_rows_ticker_check",
        "target_policy_vector_rows_weight_check",
        "target_policy_vector_rows_revision_fk",
      ],
      targetPolicyRows: {
        revisions: 0,
        vectorRows: 0,
        lifecycleEvents: 0,
      },
      accountOwnerUniqueIndexExact: true,
      targetPolicyIdentityRevisionIndexExact: true,
      targetPolicyCurrentIndexExact: true,
      targetPolicyEventSequenceIndexExact: true,
      dailyPositionLegacyAssetIdNullable: true,
      snapshotOwnershipConstraints: [
        "daily_portfolio_snapshots_owner_user_fk",
        "daily_portfolio_snapshots_account_owner_fk",
        "daily_portfolio_snapshots_generated_owner_check",
        "daily_position_snapshots_owner_user_fk",
        "daily_position_snapshots_account_owner_fk",
        "daily_position_snapshots_asset_account_fk",
        "daily_position_snapshots_generated_owner_check",
        "daily_position_snapshots_asset_identity_check",
      ],
      accountOwnerCodeUniqueIndexExact: true,
      assetAccountUniqueIndexExact: true,
      portfolioSnapshotIdentityIndexExact: true,
      positionSnapshotIdentityIndexExact: true,
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
