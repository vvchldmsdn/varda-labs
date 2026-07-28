import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  LegacyAccountOwnershipArgumentError,
  buildLegacyAccountOwnershipDiscovery,
  buildLegacyAccountOwnershipPreflight,
  fingerprintAppUserId,
  fingerprintLegacyOwner,
  parseLegacyAccountOwnershipArgs,
} from "../scripts/lib/legacy-account-ownership-preflight.mjs";

const TARGET_USER = "11111111-1111-4111-8111-111111111111";
const FOREIGN_USER = "22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER = "legacy-owner-a";
const OTHER_LEGACY_OWNER = "legacy-owner-b";
const TARGET_FINGERPRINT = fingerprintAppUserId(TARGET_USER);
const LEGACY_FINGERPRINT = fingerprintLegacyOwner(LEGACY_OWNER);

describe("legacy account ownership evidence preflight v1", () => {
  it("requires either discovery or two full SHA-256 evaluation inputs", () => {
    assert.deepEqual(parseLegacyAccountOwnershipArgs(["--discover"]), {
      mode: "discover",
    });
    assert.deepEqual(
      parseLegacyAccountOwnershipArgs([
        "--target-app-user-sha256",
        TARGET_FINGERPRINT,
        "--legacy-owner-sha256",
        LEGACY_FINGERPRINT,
      ]),
      {
        mode: "evaluate",
        targetAppUserSha256: TARGET_FINGERPRINT,
        legacyOwnerSha256: LEGACY_FINGERPRINT,
      },
    );

    for (const argv of [
      [],
      ["--write"],
      ["--discover", "--legacy-owner-sha256", LEGACY_FINGERPRINT],
      ["--target-app-user-sha256", "sha256:short"],
    ]) {
      assert.throws(
        () => parseLegacyAccountOwnershipArgs(argv),
        LegacyAccountOwnershipArgumentError,
      );
    }
  });

  it("discovers only fingerprints and aggregate account state", () => {
    const output = buildLegacyAccountOwnershipDiscovery({
      appUsers: [appUser()],
      accounts: [
        account({ legacyOwnerUserId: LEGACY_OWNER }),
        account({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          legacyOwnerUserId: LEGACY_OWNER,
        }),
      ],
    });
    const serialized = JSON.stringify(output);

    assert.equal(output.result, "discovered");
    assert.equal(output.appUserCandidates.length, 1);
    assert.deepEqual(output.legacyOwnerCandidates, [
      { fingerprint: LEGACY_FINGERPRINT, accountRows: 2 },
    ]);
    assert.deepEqual(output.accountRows, {
      total: 2,
      canonicalUnassigned: 2,
      canonicalAssigned: 0,
    });
    assert.doesNotMatch(serialized, new RegExp(TARGET_USER, "i"));
    assert.equal(serialized.includes(LEGACY_OWNER), false);
  });

  it("classifies exact unassigned evidence as eligible", () => {
    const output = preflight({
      accounts: [account({ legacyOwnerUserId: LEGACY_OWNER })],
    });

    assert.equal(output.result, "evidence_ready");
    assert.deepEqual(output.classifications, {
      eligible: 1,
      alreadyAssigned: 0,
      foreignOwnerConflict: 0,
      missingLegacyEvidence: 0,
      unresolved: 0,
    });
    assert.deepEqual(output.blockers, []);
    assert.deepEqual(output.findings, []);
    assert.equal(output.plannedWrites.accounts, 0);
  });

  it("distinguishes assigned, foreign, missing, and unresolved rows", () => {
    const output = preflight({
      accounts: [
        account({
          legacyOwnerUserId: LEGACY_OWNER,
          canonicalOwnerUserId: TARGET_USER,
        }),
        account({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          legacyOwnerUserId: LEGACY_OWNER,
          canonicalOwnerUserId: FOREIGN_USER,
        }),
        account({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          legacyOwnerUserId: null,
        }),
        account({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          legacyOwnerUserId: OTHER_LEGACY_OWNER,
        }),
      ],
    });

    assert.equal(output.result, "review_required");
    assert.deepEqual(output.classifications, {
      eligible: 0,
      alreadyAssigned: 1,
      foreignOwnerConflict: 1,
      missingLegacyEvidence: 1,
      unresolved: 1,
    });
    assert.deepEqual(output.findings, [
      "foreign_owner_conflict_present",
      "missing_legacy_evidence_present",
      "unresolved_account_rows_present",
    ]);
  });

  it("blocks absent or invalid provisioning targets and missing evidence", () => {
    const missingTarget = preflight({
      appUsers: [],
      accounts: [account({ legacyOwnerUserId: LEGACY_OWNER })],
    });
    assert.equal(missingTarget.result, "blocked");
    assert.deepEqual(missingTarget.blockers, ["target_app_user_not_found"]);

    const activeTarget = preflight({
      appUsers: [appUser({ status: "active" })],
      accounts: [account({ legacyOwnerUserId: LEGACY_OWNER })],
    });
    assert.equal(activeTarget.result, "blocked");
    assert.deepEqual(activeTarget.blockers, [
      "target_app_user_state_mismatch",
    ]);

    const noLegacyMatch = preflight({
      accounts: [account({ legacyOwnerUserId: OTHER_LEGACY_OWNER })],
    });
    assert.equal(noLegacyMatch.result, "blocked");
    assert.deepEqual(noLegacyMatch.blockers, [
      "legacy_owner_evidence_not_found",
    ]);
  });

  it("keeps digests stable across input order and sensitive values out of output", () => {
    const first = preflight({
      accounts: [
        account({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          legacyOwnerUserId: LEGACY_OWNER,
        }),
        account({ legacyOwnerUserId: LEGACY_OWNER }),
      ],
    });
    const second = preflight({
      accounts: [
        account({ legacyOwnerUserId: LEGACY_OWNER }),
        account({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          legacyOwnerUserId: LEGACY_OWNER,
        }),
      ],
    });
    const serialized = JSON.stringify(first);

    assert.equal(first.candidateSetDigest, second.candidateSetDigest);
    assert.equal(first.eligibleSetDigest, second.eligibleSetDigest);
    assert.doesNotMatch(serialized, new RegExp(TARGET_USER, "i"));
    assert.equal(serialized.includes(LEGACY_OWNER), false);
    assert.doesNotMatch(
      serialized,
      /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/i,
    );
  });

  it("keeps the executable SELECT-only and accounts-only", () => {
    const source = readFileSync(
      "scripts/preflight-legacy-account-ownership.mjs",
      "utf8",
    );

    assert.match(source, /isolationLevel:\s*"RepeatableRead"/);
    assert.match(source, /readOnly:\s*true/);
    assert.match(source, /from app_users/);
    assert.match(source, /from accounts/);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+|delete\s+from|merge\s+into)\b/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:assets|daily_position_snapshots|goals|transactions)\b/i,
    );
  });
});

function preflight({ appUsers = [appUser()], accounts }) {
  return buildLegacyAccountOwnershipPreflight({
    appUsers,
    accounts,
    targetAppUserSha256: TARGET_FINGERPRINT,
    legacyOwnerSha256: LEGACY_FINGERPRINT,
    intentionallySkippedTables: [
      "goals",
      "transactions",
      "fixed_transactions",
      "monthly_incomes",
    ],
  });
}

function appUser(overrides = {}) {
  return {
    id: TARGET_USER,
    status: "provisioning",
    role: "user",
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    legacyOwnerUserId: null,
    canonicalOwnerUserId: null,
    ...overrides,
  };
}
