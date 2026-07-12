import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY,
  validateHistoryCoverageManifest,
} from "../src/lib/history-coverage-manifest-validator.ts";
import {
  APPROVED_HISTORY_MANIFEST_ARTIFACT_COMMIT,
  approvedPortfolioBrokerageObservedManifest,
  manifest,
} from "./fixtures/history-coverage-manifest.mjs";

describe("History coverage manifest pure validator v1", () => {
  it("validates the exact approved candidate fixture without granting runtime trust", () => {
    const result = validateHistoryCoverageManifest(
      approvedPortfolioBrokerageObservedManifest,
    );

    assert.equal(result.status, "valid_supported_fixture");
    assert.equal(result.shapeStatus, "valid");
    assert.equal(result.supportStatus, "supported_fixture");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.manifest, {
      manifestVersion: "portfolio-brokerage-observed-v1",
      sourceAuthority: "stored_daily_portfolio_snapshots_display_evidence_v1",
      lane: "portfolio",
      account: "brokerage",
      mode: "observed_only",
      validationEvidence: [
        "portfolio_named_account_source_summary_read_2026-07-12",
        "repository_data_integrity_audit_2026-07-12T00:47:06.560Z",
      ],
    });
    assert.equal(Object.hasOwn(result.manifest, "requiredDates"), false);
  });

  it("keeps the approval commit in fixture provenance and out of validator trust", () => {
    const result = validateHistoryCoverageManifest(manifest());
    const source = readFileSync(
      "src/lib/history-coverage-manifest-validator.ts",
      "utf8",
    );

    assert.equal(
      APPROVED_HISTORY_MANIFEST_ARTIFACT_COMMIT,
      "689abe0fb69e04a562843b7eb69de65668723490",
    );
    assert.equal(result.status, "valid_supported_fixture");
    assert.doesNotMatch(source, /689abe0fb69e04a562843b7eb69de65668723490/);
    assert.equal(
      HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY.approvalRecordRuntimeTrust,
      "forbidden",
    );
  });

  it("blocks every identity drift without reflecting arbitrary values", () => {
    const variants = [
      { manifestVersion: "portfolio-brokerage-observed-v2" },
      { sourceAuthority: "some_other_authority" },
      { lane: "balance" },
      { account: "isa" },
      { mode: "explicit_date_list" },
    ];

    for (const override of variants) {
      const result = validateHistoryCoverageManifest(manifest(override));
      assert.equal(result.status, "blocked");
      assert.equal(result.supportStatus, "unsupported");
      assert.equal(result.manifest, null);
      assert.ok(hasIssue(result, "manifest_identity_unsupported"));
    }
  });

  it("blocks every observed-only forbidden field even when empty", () => {
    for (const field of HISTORY_COVERAGE_MANIFEST_VALIDATOR_POLICY
      .observedOnlyForbiddenFields) {
      const result = validateHistoryCoverageManifest(
        manifest({ [field]: undefined }),
      );

      assert.equal(result.status, "blocked");
      assert.equal(result.shapeStatus, "blocked");
      assert.ok(hasIssue(result, "observed_only_forbidden_field", field));
    }
  });

  it("blocks unknown fields without returning their names", () => {
    const secretLikeField = "authorization_secret";
    const result = validateHistoryCoverageManifest(
      manifest({ [secretLikeField]: "must-not-reflect" }),
    );
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "blocked");
    assert.ok(hasIssue(result, "unknown_field", null));
    assert.doesNotMatch(serialized, /authorization_secret|must-not-reflect/);
  });

  it("validates non-authoritative evidence references independently of identity", () => {
    const reversed = validateHistoryCoverageManifest(
      manifest({
        validationEvidence: [
          "portfolio_named_account_source_summary_read_2026-07-12",
          "repository_data_integrity_audit_2026-07-12T00:47:06.560Z",
        ],
      }),
    );
    const undefinedField = validateHistoryCoverageManifest(
      manifest({ validationEvidence: undefined }),
    );
    const withoutEvidence = manifest();
    delete withoutEvidence.validationEvidence;
    const absent = validateHistoryCoverageManifest(withoutEvidence);

    assert.equal(reversed.status, "valid_supported_fixture");
    assert.deepEqual(
      reversed.manifest.validationEvidence,
      approvedPortfolioBrokerageObservedManifest.validationEvidence
        .slice()
        .sort(),
    );
    assert.equal(undefinedField.status, "blocked");
    assert.ok(hasIssue(undefinedField, "validation_evidence_invalid"));
    assert.equal(absent.status, "valid_supported_fixture");
    assert.deepEqual(absent.manifest.validationEvidence, []);
  });

  it("blocks duplicate, malformed, and unsupported validation evidence", () => {
    const duplicate = validateHistoryCoverageManifest(
      manifest({ validationEvidence: ["duplicate", "duplicate"] }),
    );
    const malformed = validateHistoryCoverageManifest(
      manifest({ validationEvidence: [""] }),
    );
    const unsupported = validateHistoryCoverageManifest(
      manifest({ validationEvidence: ["unknown_audit"] }),
    );

    assert.ok(hasIssue(duplicate, "validation_evidence_duplicate"));
    assert.ok(hasIssue(duplicate, "validation_evidence_unsupported"));
    assert.ok(hasIssue(malformed, "validation_evidence_invalid"));
    assert.ok(hasIssue(unsupported, "validation_evidence_unsupported"));
  });

  it("blocks malformed input and incomplete core identity", () => {
    const variants = [null, [], "manifest", {}, { ...manifest(), lane: null }];

    for (const input of variants) {
      const result = validateHistoryCoverageManifest(input);
      assert.equal(result.status, "blocked");
      assert.equal(result.manifest, null);
      assert.ok(result.issues.length > 0);
    }
  });

  it("recognizes later contract modes but does not implement them", () => {
    for (const mode of ["explicit_date_list", "declared_service_schedule"]) {
      const result = validateHistoryCoverageManifest(manifest({ mode }));

      assert.equal(result.status, "blocked");
      assert.equal(result.shapeStatus, "blocked");
      assert.ok(hasIssue(result, "mode_not_implemented", "mode"));
      assert.ok(hasIssue(result, "manifest_identity_unsupported"));
    }
  });

  it("is pure, immutable, and independent of docs, DB, providers, and runtime routes", () => {
    const result = validateHistoryCoverageManifest(manifest());
    const source = readFileSync(
      "src/lib/history-coverage-manifest-validator.ts",
      "utf8",
    );

    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.manifest), true);
    assert.equal(Object.isFrozen(result.manifest.validationEvidence), true);
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(
      source,
      /readFile|\.md\b|drizzle|neon|server-only|fetch\s*\(|\/api\/|insert\s*\(|update\s*\(|delete\s*\(/i,
    );
  });
});

function hasIssue(result, code, field = undefined) {
  return result.issues.some(
    (row) =>
      row.code === code && (field === undefined || row.field === field),
  );
}
