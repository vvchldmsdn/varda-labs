import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  createIdentityBootstrapClaimIssuerPort,
  IdentityBootstrapClaimIssuerError,
  createOneTimeIdentityBootstrapClaim,
} from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import * as issuerModule from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import { fingerprintAppUserId } from "../scripts/lib/legacy-account-ownership-evidence.mjs";
import { digestIdentityBootstrapClaim } from "../src/lib/identity-bootstrap-claim.ts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_SHA256 = fingerprintAppUserId(TARGET);
const INTENT = "22222222-2222-4222-8222-222222222222";

describe("identity bootstrap claim issuer", () => {
  it("creates one canonical claim and clears mutable entropy", () => {
    const entropy = Buffer.alloc(32, 0xab);
    const claim = createOneTimeIdentityBootstrapClaim(() => entropy);
    const serialized = JSON.stringify(claim);
    const rawClaim = claim.take();

    assert.match(
      rawClaim,
      /^varda-bootstrap-claim-v1\.[A-Za-z0-9_-]{43}$/,
    );
    assert.match(
      claim.claimDigest,
      /^bootstrap-claim-sha256-v1:[0-9a-f]{64}$/,
    );
    assert.equal(entropy.every((byte) => byte === 0), true);
    assert.doesNotMatch(serialized, /varda-bootstrap-claim-v1\./);
    assert.throws(
      () => claim.take(),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "claim_material_already_taken",
    );
  });

  it("issues one immutable intent and keeps secrets out of serialized output", async () => {
    const { pool, calls } = mockIssuerPool();
    const issuerPort = createIdentityBootstrapClaimIssuerPort({
      pool,
      targetAppUserId: TARGET,
      randomSource: () => Buffer.alloc(32, 0xcd),
    });
    const result = await issuerPort.issue({
      targetAppUserSha256: TARGET_SHA256,
    });

    assert.equal(result.result, "issued");
    assert.equal(result.committed, true);
    assert.equal(result.actualWrites.identityPairingIntents, 1);
    assert.equal(calls.length, 6);
    assert.equal(
      normalize(calls[0].text),
      "begin isolation level read committed",
    );
    assert.equal(
      normalize(calls[1].text),
      "set local lock_timeout = '2s'",
    );
    assert.equal(
      normalize(calls[2].text),
      "set local statement_timeout = '8s'",
    );
    assert.match(normalize(calls[3].text), /from app_users .* for update/);
    assert.match(
      calls[4].text,
      /insert into identity_pairing_intents/i,
    );
    assert.equal(normalize(calls[5].text), "commit");

    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /varda-bootstrap-claim-v1\./);
    assert.equal(serialized.includes(INTENT), false);
    assert.equal(serialized.includes(TARGET), false);
    assert.equal(Object.hasOwn(result, "continuation"), false);
    const expectedRawClaim =
      `varda-bootstrap-claim-v1.${Buffer.alloc(32, 0xcd).toString("base64url")}`;
    assert.deepEqual(result.executionBinding, {
      targetAppUserSha256: TARGET_SHA256,
      provider: "neon_auth",
      claimDigestVersion: "bootstrap_claim_sha256_v1",
      claimDigest: digestIdentityBootstrapClaim(expectedRawClaim),
      identityPairingIntentSha256: `sha256:${createHash("sha256")
        .update(INTENT, "utf8")
        .digest("hex")}`,
    });

    const privateValue = issuerPort.take(result);
    assert.deepEqual(Object.keys(privateValue), ["rawClaim"]);
    assert.match(
      privateValue.rawClaim,
      /^varda-bootstrap-claim-v1\./,
    );
    assert.throws(
      () => issuerPort.take(result),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "claim_continuation_unavailable",
    );
  });

  it("keeps raw claim extraction scoped to the issuing capability", async () => {
    assert.equal(
      Object.hasOwn(issuerModule, "takeIssuedIdentityBootstrapClaim"),
      false,
    );

    const firstPool = mockIssuerPool().pool;
    const secondPool = mockIssuerPool().pool;
    const firstPort = createIdentityBootstrapClaimIssuerPort({
      pool: firstPool,
      targetAppUserId: TARGET,
      randomSource: () => Buffer.alloc(32, 0xaa),
    });
    const secondPort = createIdentityBootstrapClaimIssuerPort({
      pool: secondPool,
      targetAppUserId: TARGET,
      randomSource: () => Buffer.alloc(32, 0xbb),
    });
    const result = await firstPort.issue({
      targetAppUserSha256: TARGET_SHA256,
    });

    assert.throws(
      () => secondPort.take(result),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "claim_continuation_unavailable",
    );
    assert.match(
      firstPort.take(result).rawClaim,
      /^varda-bootstrap-claim-v1\./,
    );
  });

  it("rejects reviewed-target drift before opening a transaction", async () => {
    const { pool, calls } = mockIssuerPool();
    const issuerPort = createIdentityBootstrapClaimIssuerPort({
      pool,
      targetAppUserId: TARGET,
    });
    await assert.rejects(
      issuerPort.issue({
        targetAppUserSha256: `sha256:${"0".repeat(64)}`,
      }),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "target_app_user_fingerprint_mismatch",
    );
    assert.equal(calls.length, 0);
  });

  it("fails closed before DML when the database connection is unavailable", async () => {
    const entropy = Buffer.alloc(32, 0xaa);
    const issuerPort = createIdentityBootstrapClaimIssuerPort({
      pool: {
        async connect() {
          throw Object.assign(new Error("unavailable"), {
            code: "08006",
          });
        },
      },
      targetAppUserId: TARGET,
      randomSource: () => entropy,
    });
    await assert.rejects(
      issuerPort.issue({
        targetAppUserSha256: TARGET_SHA256,
      }),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "database_transaction_failed",
    );
    assert.equal(entropy.every((byte) => byte === 0), true);
  });

  it("does not invoke an accessor-backed database error code", async () => {
    let accessorCalls = 0;
    const issuerPort = createIdentityBootstrapClaimIssuerPort({
      pool: {
        async connect() {
          const error = new Error("unavailable");
          Object.defineProperty(error, "code", {
            get() {
              accessorCalls += 1;
              return "57014";
            },
          });
          throw error;
        },
      },
      targetAppUserId: TARGET,
      randomSource: () => Buffer.alloc(32, 0xbb),
    });
    await assert.rejects(
      issuerPort.issue({
        targetAppUserSha256: TARGET_SHA256,
      }),
      (error) =>
        error instanceof IdentityBootstrapClaimIssuerError &&
        error.code === "database_transaction_failed",
    );
    assert.equal(accessorCalls, 0);
  });

  it("rolls back when a provider identity or open intent blocks issuance", async () => {
    for (const blocker of [
      "target_provider_identity_preexists",
      "unexpired_intent_exists",
    ]) {
      const { pool, calls } = mockIssuerPool({ blocker });
      const issuerPort = createIdentityBootstrapClaimIssuerPort({
        pool,
        targetAppUserId: TARGET,
        randomSource: () => Buffer.alloc(32, 0xef),
      });
      await assert.rejects(
        issuerPort.issue({
          targetAppUserSha256: TARGET_SHA256,
        }),
        (error) =>
          error instanceof IdentityBootstrapClaimIssuerError &&
          error.code === blocker,
      );
      assert.equal(normalize(calls.at(-1).text), "rollback");
    }
  });
});

function mockIssuerPool({ blocker = null } = {}) {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ text, params });
      const sql = normalize(text);
      if (sql.includes("from app_users")) {
        return {
          rowCount: 1,
          rows: [{ id: TARGET, status: "provisioning", role: "user" }],
        };
      }
      if (sql.includes("insert into identity_pairing_intents")) {
        return blocker === null
          ? {
              rowCount: 1,
              rows: [
                {
                  id: INTENT,
                  expires_at: "2026-07-30T12:10:00.000Z",
                  blocker: null,
                },
              ],
            }
          : {
              rowCount: 1,
              rows: [{ id: null, expires_at: null, blocker }],
            };
      }
      return { rowCount: null, rows: [] };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

function normalize(value) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
