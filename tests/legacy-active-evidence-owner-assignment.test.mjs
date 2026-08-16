import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY,
  LegacyActiveEvidenceOwnerAssignmentCliError,
  readLegacyActiveEvidenceOwnerAssignmentCliOptions,
} from "../scripts/assign-legacy-active-evidence-owners.mjs";
import {
  buildLegacyActiveEvidenceOwnerAssignmentPlan,
  LegacyActiveEvidenceOwnerAssignmentError,
} from "../scripts/lib/legacy-active-evidence-owner-assignment.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const IDENTITY_ID = "66666666-6666-4666-8666-666666666666";
const MANIFEST_SHA256 = `sha256:${"a".repeat(64)}`;
const TARGET_SHA256 = `sha256:${"b".repeat(64)}`;

describe("legacy active evidence owner assignment", () => {
  it("plans every active legacy evidence table without exposing row details", () => {
    const input = fixture();
    const plan = buildLegacyActiveEvidenceOwnerAssignmentPlan(input);
    const reordered = buildLegacyActiveEvidenceOwnerAssignmentPlan({
      ...input,
      dailyPositionSnapshots: [...input.dailyPositionSnapshots].reverse(),
      eventLedgerEntries: [...input.eventLedgerEntries].reverse(),
    });

    assert.equal(plan.state, "assignment_pending");
    assert.deepEqual(plan.candidateCounts, {
      accountBalanceSnapshots: 1,
      dailyPortfolioSnapshots: 1,
      dailyPositionSnapshots: 2,
      eventLedgerEntries: 2,
      marketRegimeDaily: 1,
      settings: 1,
    });
    assert.deepEqual(plan.plannedWrites, plan.candidateCounts);
    assert.match(plan.ownerFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(plan.manifestSha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(reordered.manifestSha256, plan.manifestSha256);
    assert.equal(JSON.stringify(plan).includes("069500"), false);
    assert.equal(JSON.stringify(plan).includes("brokerage"), false);
  });

  it("preserves unmatched legacy assets while requiring an owned account", () => {
    const input = fixture();
    input.dailyPositionSnapshots[1].asset_id = null;
    const plan = buildLegacyActiveEvidenceOwnerAssignmentPlan(input);

    assert.equal(plan.plannedWrites.dailyPositionSnapshots, 2);

    input.dailyPositionSnapshots[1].account_id = OTHER_OWNER_ID;
    assert.throws(
      () => buildLegacyActiveEvidenceOwnerAssignmentPlan(input),
      matchesCode("position_snapshot_account_invalid"),
    );
  });

  it("recognizes an idempotently completed assignment", () => {
    const input = fixture();
    for (const key of [
      "accountBalanceSnapshots",
      "dailyPortfolioSnapshots",
      "dailyPositionSnapshots",
      "eventLedgerEntries",
      "marketRegimeDaily",
      "settings",
    ]) {
      for (const row of input[key]) row.canonical_owner_user_id = OWNER_ID;
    }
    const plan = buildLegacyActiveEvidenceOwnerAssignmentPlan(input);

    assert.equal(plan.state, "already_applied");
    assert.equal(
      Object.values(plan.plannedWrites).reduce((sum, count) => sum + count, 0),
      0,
    );
  });

  it("blocks owner conflicts, relationship drift, and duplicate snapshot keys", () => {
    const cases = [
      [
        () => {
          const input = fixture();
          input.settings[0].canonical_owner_user_id = OTHER_OWNER_ID;
          return input;
        },
        "settings_owner_conflict",
      ],
      [
        () => {
          const input = fixture();
          input.marketRegimeDaily[0].account = "isa";
          return input;
        },
        "market_regime_account_invalid",
      ],
      [
        () => {
          const input = fixture();
          input.eventLedgerEntries[1].corrects_event_id = OTHER_OWNER_ID;
          return input;
        },
        "event_correction_invalid",
      ],
      [
        () => {
          const input = fixture();
          input.dailyPortfolioSnapshots.push({
            ...input.dailyPortfolioSnapshots[0],
            id: OTHER_OWNER_ID,
            legacy_base44_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
          });
          return input;
        },
        "portfolio_snapshot_key_collision",
      ],
    ];

    for (const [makeInput, code] of cases) {
      assert.throws(
        () => buildLegacyActiveEvidenceOwnerAssignmentPlan(makeInput()),
        matchesCode(code),
      );
    }
  });

  it("defaults to dry-run and gates writes on exact reviewed evidence", () => {
    assert.deepEqual(readLegacyActiveEvidenceOwnerAssignmentCliOptions([]), {
      mode: "dry_run",
      write: false,
      reviewedManifestSha256: null,
      reviewedDatabaseTargetFingerprint: null,
    });
    assert.deepEqual(
      readLegacyActiveEvidenceOwnerAssignmentCliOptions([
        "--write",
        LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
        "--reviewed-manifest-sha256",
        MANIFEST_SHA256,
        "--reviewed-database-target-fingerprint",
        TARGET_SHA256,
      ]),
      {
        mode: "write",
        write: true,
        reviewedManifestSha256: MANIFEST_SHA256,
        reviewedDatabaseTargetFingerprint: TARGET_SHA256,
      },
    );

    for (const args of [
      ["--write"],
      [LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation],
      ["--reviewed-manifest-sha256", MANIFEST_SHA256],
      [
        "--write",
        LEGACY_ACTIVE_EVIDENCE_OWNER_ASSIGNMENT_CLI_POLICY.confirmation,
        "--reviewed-manifest-sha256",
        "invalid",
        "--reviewed-database-target-fingerprint",
        TARGET_SHA256,
      ],
    ]) {
      assert.throws(
        () => readLegacyActiveEvidenceOwnerAssignmentCliOptions(args),
        (error) =>
          error instanceof LegacyActiveEvidenceOwnerAssignmentCliError,
      );
    }
  });
});

function fixture() {
  return {
    appUsers: [{ id: OWNER_ID, status: "active", role: "user" }],
    authIdentities: [
      { id: IDENTITY_ID, app_user_id: OWNER_ID, status: "active" },
    ],
    accounts: [
      {
        id: ACCOUNT_ID,
        canonical_owner_user_id: OWNER_ID,
        code: "brokerage",
      },
    ],
    assets: [
      {
        id: ASSET_ID,
        canonical_owner_user_id: OWNER_ID,
        account_id: ACCOUNT_ID,
      },
    ],
    assetGroups: [
      { id: GROUP_ID, canonical_owner_user_id: OWNER_ID },
    ],
    accountBalanceSnapshots: [
      legacyRow("77777777-7777-4777-8777-777777777777", "01"),
    ],
    dailyPortfolioSnapshots: [
      {
        ...legacyRow("88888888-8888-4888-8888-888888888888", "02"),
        snapshot_date: "2026-07-01",
        account: "all",
        account_id: null,
        source: "base44_import",
      },
    ],
    dailyPositionSnapshots: [
      {
        ...legacyRow("99999999-9999-4999-8999-999999999999", "03"),
        snapshot_date: "2026-07-01",
        account: "brokerage",
        account_id: ACCOUNT_ID,
        asset_id: null,
        legacy_asset_id: "111111111111111111111111",
        source: "base44_import",
      },
      {
        ...legacyRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "04"),
        snapshot_date: "2026-07-02",
        account: "brokerage",
        account_id: ACCOUNT_ID,
        asset_id: ASSET_ID,
        legacy_asset_id: "222222222222222222222222",
        source: "base44_import",
      },
    ],
    eventLedgerEntries: [
      {
        ...legacyRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "05"),
        account: null,
        account_id: null,
        asset_id: null,
        legacy_asset_id: "333333333333333333333333",
        group_id: null,
        corrects_event_id: null,
      },
      {
        ...legacyRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "06"),
        account: "brokerage",
        account_id: ACCOUNT_ID,
        asset_id: ASSET_ID,
        legacy_asset_id: "222222222222222222222222",
        group_id: GROUP_ID,
        corrects_event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
    ],
    marketRegimeDaily: [
      {
        ...legacyRow("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "07"),
        date: "2026-07-01",
        account: "brokerage",
        account_id: ACCOUNT_ID,
      },
    ],
    settings: [
      legacyRow("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "08"),
    ],
  };
}

function legacyRow(id, suffix) {
  return {
    id,
    legacy_base44_id: suffix.padStart(24, "0"),
    canonical_owner_user_id: null,
  };
}

function matchesCode(code) {
  return (error) =>
    error instanceof LegacyActiveEvidenceOwnerAssignmentError &&
    error.code === code;
}
