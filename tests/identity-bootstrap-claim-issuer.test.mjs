import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION,
  IdentityBootstrapClaimIssuerArgumentError,
  buildIdentityBootstrapClaimIssueOutput,
  buildIdentityBootstrapClaimIssuerPlan,
  createOneTimeIdentityBootstrapClaim,
  digestIdentityBootstrapClaim,
  isCanonicalSha256Fingerprint,
  parseIdentityBootstrapClaimIssuerArgs,
} from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import { readIdentityBootstrapClaimIssuerState } from "../scripts/lib/identity-bootstrap-claim-issuer-state.mjs";
import {
  IDENTITY_BOOTSTRAP_CLAIM_ISSUER_TARGET_POLICY,
  IdentityBootstrapClaimIssuerTargetError,
  guardIdentityBootstrapClaimIssuerTarget,
} from "../scripts/lib/identity-bootstrap-claim-issuer-target.mjs";
import { buildIdentityBootstrapClaimIssueQueries } from "../scripts/lib/identity-bootstrap-claim-issuer-write.mjs";
import { sha256Fingerprint } from "../src/lib/deployment/neon-database-target.ts";
import { TENANT_WRITER_REGISTRY } from "../src/lib/tenant-writer-registry.ts";

const ROOT = process.cwd();
const TARGET = "11111111-1111-4111-8111-111111111111";
const OTHER_TARGET = "22222222-2222-4222-8222-222222222222";
const PRODUCTION_ENDPOINT = "ep-production-synthetic";
const OTHER_ENDPOINT = "ep-other-synthetic";
const TARGET_POLICY = {
  policyId: "bootstrap_claim_issuer_target_guard_v1",
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
};

describe("server-only identity bootstrap claim issuer", () => {
  it("defaults to dry-run and requires an explicit target and write confirmation", () => {
    assert.deepEqual(
      parseIdentityBootstrapClaimIssuerArgs([
        "--target-app-user-id",
        TARGET,
      ]),
      {
        targetAppUserId: TARGET,
        write: false,
        reviewedTargetFingerprint: null,
      },
    );
    const reviewedTargetFingerprint = sha256Fingerprint("reviewed-target");
    assert.deepEqual(
      parseIdentityBootstrapClaimIssuerArgs([
        "--target-app-user-id",
        TARGET,
        "--write",
        "--confirm",
        IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION,
        "--reviewed-target-fingerprint",
        reviewedTargetFingerprint,
      ]),
      {
        targetAppUserId: TARGET,
        write: true,
        reviewedTargetFingerprint,
      },
    );
    assertArgumentError([], "invalid_target_app_user_id");
    assertArgumentError(
      ["--target-app-user-id", TARGET, "--write"],
      "missing_write_confirmation",
    );
    assertArgumentError(
      [
        "--target-app-user-id",
        TARGET,
        "--write",
        "--confirm",
        IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION,
      ],
      "missing_reviewed_target_fingerprint",
    );
    assertArgumentError(
      [
        "--target-app-user-id",
        TARGET,
        "--confirm",
        IDENTITY_BOOTSTRAP_CLAIM_WRITE_CONFIRMATION,
      ],
      "confirmation_without_write",
    );
    assertArgumentError(
      [
        "--target-app-user-id",
        TARGET,
        "--reviewed-target-fingerprint",
        reviewedTargetFingerprint,
      ],
      "reviewed_target_fingerprint_without_write",
    );
  });

  it("binds dry-run and write to one reviewed Production database and app user", () => {
    const dryRunTarget = guardIdentityBootstrapClaimIssuerTarget(
      targetEnvironment(TARGET),
      TARGET_POLICY,
    );

    assert.equal(
      dryRunTarget.status,
      "production_issuer_target_guard_passed",
    );
    assert.equal(dryRunTarget.reviewStatus, "dry_run_review_required");
    assert.equal(
      dryRunTarget.endpointFingerprint,
      sha256Fingerprint(PRODUCTION_ENDPOINT),
    );
    assert.match(
      dryRunTarget.databaseTargetFingerprint,
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.match(dryRunTarget.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      isCanonicalSha256Fingerprint(dryRunTarget.targetFingerprint),
      true,
    );

    const reviewedTarget = guardIdentityBootstrapClaimIssuerTarget(
      {
        ...targetEnvironment(TARGET),
        reviewedTargetFingerprint: dryRunTarget.targetFingerprint,
      },
      TARGET_POLICY,
    );
    assert.equal(reviewedTarget.reviewStatus, "reviewed_target_match");
    assert.equal(
      reviewedTarget.targetFingerprint,
      dryRunTarget.targetFingerprint,
    );

    const serialized = JSON.stringify(reviewedTarget);
    assert.doesNotMatch(
      serialized,
      /synthetic_(?:user|password)|neondb|\.neon\.tech/,
    );
    assert.doesNotMatch(
      JSON.stringify(IDENTITY_BOOTSTRAP_CLAIM_ISSUER_TARGET_POLICY),
      /postgres(?:ql)?:\/\/|\.neon\.tech/i,
    );
  });

  it("fails closed on database, pooling, credential, endpoint, or review drift", () => {
    const dryRunTarget = guardIdentityBootstrapClaimIssuerTarget(
      targetEnvironment(TARGET),
      TARGET_POLICY,
    );
    const scenarios = [
      [
        {
          ...targetEnvironment(TARGET),
          databaseUrlUnpooled: databaseUrl(OTHER_ENDPOINT, false),
        },
        "issuer_database_target_invalid",
      ],
      [
        {
          ...targetEnvironment(TARGET),
          databaseUrlUnpooled: databaseUrl(
            PRODUCTION_ENDPOINT,
            false,
            "other_user",
          ),
        },
        "issuer_database_target_invalid",
      ],
      [
        {
          ...targetEnvironment(TARGET),
          databaseUrlUnpooled: databaseUrl(PRODUCTION_ENDPOINT, true),
        },
        "issuer_database_pooling_mismatch",
      ],
      [
        {
          ...targetEnvironment(TARGET),
          databaseUrl: databaseUrl(OTHER_ENDPOINT, true),
          databaseUrlUnpooled: databaseUrl(OTHER_ENDPOINT, false),
        },
        "issuer_database_not_pinned_production",
      ],
      [
        {
          ...targetEnvironment(OTHER_TARGET),
          reviewedTargetFingerprint: dryRunTarget.targetFingerprint,
        },
        "reviewed_target_fingerprint_mismatch",
      ],
      [
        {
          ...targetEnvironment(TARGET),
          databaseUrl: databaseUrl(
            PRODUCTION_ENDPOINT,
            true,
            "synthetic_user",
            "otherdb",
          ),
          databaseUrlUnpooled: databaseUrl(
            PRODUCTION_ENDPOINT,
            false,
            "synthetic_user",
            "otherdb",
          ),
          reviewedTargetFingerprint: dryRunTarget.targetFingerprint,
        },
        "reviewed_target_fingerprint_mismatch",
      ],
      [
        {
          ...targetEnvironment(TARGET),
          reviewedTargetFingerprint: sha256Fingerprint("wrong-target"),
        },
        "reviewed_target_fingerprint_mismatch",
      ],
    ];

    for (const [input, expectedCode] of scenarios) {
      assert.throws(
        () =>
          guardIdentityBootstrapClaimIssuerTarget(input, TARGET_POLICY),
        (error) =>
          error instanceof IdentityBootstrapClaimIssuerTargetError &&
          error.code === expectedCode,
      );
    }
  });

  it("plans one intent only for the explicit provisioning user", () => {
    const targetEvidence = guardIdentityBootstrapClaimIssuerTarget(
      targetEnvironment(TARGET),
      TARGET_POLICY,
    );
    const plan = buildIdentityBootstrapClaimIssuerPlan({
      targetAppUserId: TARGET,
      state: readyState(),
      targetEvidence,
    });

    assert.equal(plan.result, "ready");
    assert.equal(plan.mode, "dry_run");
    assert.deepEqual(plan.plannedWrites, {
      identityPairingIntents: 1,
      identityPairingIntentEvents: 0,
      authIdentities: 0,
      appUsers: 0,
      productTables: 0,
    });
    assert.equal(plan.committed, false);
    assert.equal(JSON.stringify(plan).includes(TARGET), false);
    assert.equal(plan.targetFingerprint, targetEvidence.targetFingerprint);
    assert.deepEqual(plan.databaseTarget, {
      policyId: targetEvidence.policyId,
      status: targetEvidence.status,
      reviewStatus: targetEvidence.reviewStatus,
      endpointFingerprint: targetEvidence.endpointFingerprint,
      databaseTargetFingerprint:
        targetEvidence.databaseTargetFingerprint,
    });
  });

  it("blocks target drift, existing identity, and an unexpired intent", () => {
    const scenarios = [
      [
        { targetFound: false, targetStatus: null, targetRole: null },
        "reviewed_target_not_found",
      ],
      [{ targetStatus: "active" }, "reviewed_target_state_mismatch"],
      [{ targetRole: "admin" }, "reviewed_target_state_mismatch"],
      [
        { targetProviderIdentityCount: 1 },
        "target_provider_identity_preexists",
      ],
      [{ openIntentCount: 1 }, "unexpired_intent_exists"],
      [{ schemaAvailable: false }, "pairing_schema_unavailable"],
    ];

    for (const [override, blocker] of scenarios) {
      const plan = buildIdentityBootstrapClaimIssuerPlan({
        targetAppUserId: TARGET,
        state: readyState(override),
      });
      assert.equal(plan.result, "blocked");
      assert.ok(plan.blockers.includes(blocker));
      assert.equal(plan.plannedWrites.identityPairingIntents, 0);
    }
  });

  it("checks schema presence before reading target or intent state", async () => {
    const unavailableCalls = [];
    const unavailable = await readIdentityBootstrapClaimIssuerState(
      {
        async query(text) {
          unavailableCalls.push(text);
          return [{ intents_table: null, events_table: null }];
        },
      },
      TARGET,
    );
    assert.deepEqual(unavailable, {
      schemaAvailable: false,
      targetFound: false,
      targetStatus: null,
      targetRole: null,
      targetProviderIdentityCount: 0,
      openIntentCount: 0,
    });
    assert.equal(unavailableCalls.length, 1);

    const availableCalls = [];
    const available = await readIdentityBootstrapClaimIssuerState(
      {
        async query(text, params) {
          availableCalls.push({ text, params });
          if (availableCalls.length === 1) {
            return [
              {
                intents_table: "identity_pairing_intents",
                events_table: "identity_pairing_intent_events",
              },
            ];
          }
          return [
            {
              target_found: true,
              target_status: "provisioning",
              target_role: "user",
              target_provider_identity_count: 0,
              open_intent_count: 0,
            },
          ];
        },
      },
      TARGET,
    );
    assert.deepEqual(available, readyState());
    assert.equal(availableCalls.length, 2);
    assert.deepEqual(availableCalls[1].params, [TARGET]);
  });

  it("generates a 256-bit base64url claim and stores only its digest", () => {
    const entropy = Buffer.alloc(32, 0xab);
    const generated = createOneTimeIdentityBootstrapClaim((size) => {
      assert.equal(size, 32);
      return entropy;
    });
    const expectedDigest = `bootstrap-claim-sha256-v1:${createHash("sha256")
      .update(generated.rawClaim)
      .digest("hex")}`;

    assert.match(
      generated.rawClaim,
      /^varda-bootstrap-claim-v1\.[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(generated.claimDigest, expectedDigest);
    assert.equal(
      digestIdentityBootstrapClaim(generated.rawClaim),
      expectedDigest,
    );
    assert.throws(
      () => digestIdentityBootstrapClaim("not-a-bootstrap-claim"),
      /format is invalid/,
    );
  });

  it("locks only the explicit target and inserts one digest-bound intent", () => {
    const digest = `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
    const queries = buildIdentityBootstrapClaimIssueQueries({
      targetAppUserId: TARGET,
      claimDigest: digest,
    });
    const lockSql = queries.targetLock.text
      .replace(/\s+/g, " ")
      .toLowerCase();
    const issueSql = queries.issue.text.replace(/\s+/g, " ").toLowerCase();

    assert.equal(
      (issueSql.match(/insert into identity_pairing_intents/g) ?? [])
        .length,
      1,
    );
    assert.match(lockSql, /from app_users where id = \$1::uuid for update/);
    assert.doesNotMatch(issueSql, /for update/);
    assert.match(issueSql, /clock_timestamp\(\)/);
    assert.match(issueSql, /terminal_event\.id is null/);
    assert.match(issueSql, /intent\.expires_at > issue_clock\.issued_at/);
    assert.doesNotMatch(`${lockSql}\n${issueSql}`, /pg_advisory/);
    assert.doesNotMatch(
      issueSql,
      /insert into (?:auth_identities|identity_pairing_intent_events|app_users)/,
    );
    assert.doesNotMatch(
      issueSql,
      /\b(?:update\s+[a-z_"]+\s+set|delete\s+from|truncate)\b/,
    );
    assert.equal(queries.targetLock.text.includes(TARGET), false);
    assert.equal(queries.issue.text.includes(TARGET), false);
    assert.deepEqual(queries.targetLock.params, [TARGET]);
    assert.deepEqual(queries.issue.params, [TARGET, digest]);
  });

  it("reveals the raw claim only after exactly one committed insert", () => {
    const plan = buildIdentityBootstrapClaimIssuerPlan({
      targetAppUserId: TARGET,
      state: readyState(),
    });
    const generated = createOneTimeIdentityBootstrapClaim(() =>
      Buffer.alloc(32, 0xcd),
    );
    const issued = buildIdentityBootstrapClaimIssueOutput({
      plan,
      lockedState: {
        inserted_count: 1,
        expires_at: "2026-07-26T12:10:00.000Z",
      },
      rawClaim: generated.rawClaim,
    });

    assert.equal(issued.result, "issued");
    assert.equal(issued.committed, true);
    assert.equal(issued.actualWrites.identityPairingIntents, 1);
    assert.equal(issued.oneTimeDelivery.rawClaim, generated.rawClaim);
    assert.equal(issued.oneTimeDelivery.displayCount, 1);
    assert.equal(JSON.stringify(issued).includes(TARGET), false);
    assert.equal(JSON.stringify(issued).includes(generated.claimDigest), false);

    const blocked = buildIdentityBootstrapClaimIssueOutput({
      plan,
      lockedState: { inserted_count: 0 },
      rawClaim: generated.rawClaim,
    });
    assert.equal(blocked.result, "blocked");
    assert.equal("oneTimeDelivery" in blocked, false);
    assert.equal(
      JSON.stringify(blocked).includes(generated.rawClaim),
      false,
    );
  });

  it("keeps issuance in a local CLI with no route, retry, or advisory lock", () => {
    const script = readFileSync(
      join(ROOT, "scripts", "issue-identity-bootstrap-claim.mjs"),
      "utf8",
    );
    const generateAt = script.indexOf("createOneTimeIdentityBootstrapClaim()");
    const readyAt = script.indexOf('plan.result !== "ready"');
    const targetLockAt = script.indexOf("issueQueries.targetLock.text");
    const issueAt = script.indexOf("issueQueries.issue.text");
    const guardAt = script.indexOf(
      "guardIdentityBootstrapClaimIssuerTarget",
    );
    const connectAt = script.indexOf("neon(databaseUrlUnpooled)");

    assert.ok(readyAt >= 0 && generateAt > readyAt);
    assert.ok(targetLockAt >= 0 && issueAt > targetLockAt);
    assert.ok(guardAt >= 0 && connectAt > guardAt);
    assert.match(script, /sql\.transaction/);
    assert.match(script, /process\.env\.DATABASE_URL\b/);
    assert.match(script, /process\.env\.DATABASE_URL_UNPOOLED\b/);
    assert.doesNotMatch(
      script,
      /DATABASE_URL_UNPOOLED\s*\?\?\s*process\.env\.DATABASE_URL/,
    );
    assert.match(script, /set local lock_timeout = '5s'/);
    assert.match(script, /set local statement_timeout = '30s'/);
    assert.doesNotMatch(script, /pg_advisory|setTimeout|retry|while\s*\(/i);
    assert.equal(
      readFileSync(join(ROOT, "package.json"), "utf8").includes(
        '"issue:identity-bootstrap-claim"',
      ),
      true,
    );
  });

  it("registers exactly one identity-system insert writer", () => {
    const writer = TENANT_WRITER_REGISTRY.find(
      ({ id }) => id === "identity_bootstrap_claim_issuer",
    );

    assert.deepEqual(writer, {
      id: "identity_bootstrap_claim_issuer",
      classification: "identity_system",
      authorization: "migration_cli",
      entrypoints: ["scripts/issue-identity-bootstrap-claim.mjs"],
      implementationPaths: [
        "scripts/lib/identity-bootstrap-claim-issuer-write.mjs",
      ],
      targets: [
        {
          table: "identity_pairing_intents",
          classification: "identity_system",
          operations: ["insert"],
          ownerPolicy: "owner_forbidden",
        },
      ],
      transition: {
        prepare: "dry_run_only",
        activate: "single_claim_intent_insert",
        freeze: "not_required",
      },
      canonicalOwnerRolloutScope: "not_applicable",
      canonicalOwnerHttpInput: "forbidden",
      legacyOwnerEvidence: "not_applicable",
    });
  });

  it("does not infer a target from global user cardinality", () => {
    const sources = [
      "scripts/issue-identity-bootstrap-claim.mjs",
      "scripts/lib/identity-bootstrap-claim-issuer.mjs",
      "scripts/lib/identity-bootstrap-claim-issuer-state.mjs",
      "scripts/lib/identity-bootstrap-claim-issuer-target.mjs",
      "scripts/lib/identity-bootstrap-claim-issuer-write.mjs",
    ]
      .map((path) => readFileSync(join(ROOT, path), "utf8"))
      .join("\n");

    assert.doesNotMatch(
      sources,
      /select\s+count\(\*\)[\s\S]{0,120}from\s+app_users/i,
    );
    assert.doesNotMatch(sources, /limit\s+1[\s\S]{0,120}app_users/i);
    assert.equal(sources.includes("--target-app-user-id"), true);
    assert.equal(sources.includes(OTHER_TARGET), false);
  });
});

function readyState(overrides = {}) {
  return {
    schemaAvailable: true,
    targetFound: true,
    targetStatus: "provisioning",
    targetRole: "user",
    targetProviderIdentityCount: 0,
    openIntentCount: 0,
    ...overrides,
  };
}

function assertArgumentError(argv, expectedCode) {
  assert.throws(
    () => parseIdentityBootstrapClaimIssuerArgs(argv),
    (error) =>
      error instanceof IdentityBootstrapClaimIssuerArgumentError &&
      error.code === expectedCode,
  );
}

function targetEnvironment(targetAppUserId) {
  return {
    databaseUrl: databaseUrl(PRODUCTION_ENDPOINT, true),
    databaseUrlUnpooled: databaseUrl(PRODUCTION_ENDPOINT, false),
    targetAppUserId,
  };
}

function databaseUrl(
  endpoint,
  pooled,
  username = "synthetic_user",
  databaseName = "neondb",
) {
  return `postgresql://${username}:synthetic_password@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/${databaseName}?sslmode=require`;
}
