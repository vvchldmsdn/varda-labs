import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadIdentityBootstrapClaimHandoffRehearsalEnvironment,
  readIdentityBootstrapClaimHandoffRehearsalOptions,
  runIdentityBootstrapClaimHandoffRehearsal,
} from "../scripts/rehearse-identity-bootstrap-claim-handoff.mjs";
import { digestIdentityBootstrapClaim } from "../src/lib/identity-bootstrap-claim.ts";

const TARGET = "11111111-1111-4111-8111-111111111111";
const RAW_CLAIM =
  `varda-bootstrap-claim-v1.${Buffer.alloc(32, 0xab).toString("base64url")}`;
const CLAIM_DIGEST = digestIdentityBootstrapClaim(RAW_CLAIM);
const CONFIRMATION =
  "--confirm-run-one-disposable-bootstrap-claim-rehearsal";

describe("identity bootstrap claim handoff rehearsal", () => {
  it("requires one explicit confirmation and a repository-local env file", () => {
    const result =
      readIdentityBootstrapClaimHandoffRehearsalOptions({
        args: [
          "--env-file",
          ".env.preview-rehearsal.local",
          CONFIRMATION,
        ],
        repositoryRoot: "C:\\repo",
      });

    assert.equal(
      result.envFile,
      "C:\\repo\\.env.preview-rehearsal.local",
    );
    assert.throws(
      () =>
        readIdentityBootstrapClaimHandoffRehearsalOptions({
          args: [],
          repositoryRoot: "C:\\repo",
      }),
      /failed/,
    );
    assert.throws(
      () =>
        readIdentityBootstrapClaimHandoffRehearsalOptions({
          args: [
            "--env-file",
            ".env.preview-rehearsal.local",
            "--env-file",
            ".env.preview-rehearsal.local",
            CONFIRMATION,
          ],
          repositoryRoot: "C:\\repo",
        }),
      /failed/,
    );
    assert.throws(
      () =>
        readIdentityBootstrapClaimHandoffRehearsalOptions({
          args: [
            "--env-file",
            "..\\outside.env",
            CONFIRMATION,
          ],
          repositoryRoot: "C:\\repo",
        }),
      /failed/,
    );
  });

  it("loads only the exact preview database keys without ambient env reads", () => {
    const reads = [];
    const environment =
      loadIdentityBootstrapClaimHandoffRehearsalEnvironment(
        "C:\\repo\\.env.preview-rehearsal.local",
        {
          readFile(path, options) {
            reads.push({ path, options });
            return "ignored";
          },
          parseEnvironment() {
            return {
              DATABASE_URL: "postgresql://pooled",
              DATABASE_URL_UNPOOLED: "postgresql://unpooled",
              NEON_PROJECT_ID: "project",
              NEON_API_KEY: "must-not-cross-boundary",
            };
          },
        },
      );

    assert.deepEqual(reads, [
      {
        path: "C:\\repo\\.env.preview-rehearsal.local",
        options: { encoding: "utf8" },
      },
    ]);
    assert.deepEqual(Object.keys(environment).sort(), [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_PROJECT_ID",
      "VERCEL_ENV",
    ]);
    assert.equal(environment.VERCEL_ENV, "preview");
    assert.equal(Object.hasOwn(environment, "NEON_API_KEY"), false);
  });

  it("verifies one digest-only issuance without exposing the raw claim", async () => {
    const state = {
      appUsers: 1,
      authIdentities: 0,
      intents: 0,
      events: 0,
      accounts: 4,
      assets: 17,
      targetInserted: false,
      intentInserted: false,
      poolClosed: false,
    };
    const pool = createMockPool(state);
    const environment = Object.freeze({
      VERCEL_ENV: "preview",
      DATABASE_URL: "postgresql://preview",
      DATABASE_URL_UNPOOLED: "postgresql://preview",
      NEON_PROJECT_ID: "project",
    });

    const result = await runIdentityBootstrapClaimHandoffRehearsal({
      args: [CONFIRMATION],
      loadEnvironment: () => environment,
      guardDatabaseTarget(input) {
        assert.equal(input, environment);
        return {
          status: "operational_guard_passed",
          targetFingerprint: `sha256:${"1".repeat(64)}`,
        };
      },
      createPool() {
        return pool;
      },
      createSyntheticAppUserId: () => TARGET,
      async runMigrationCli(options) {
        assert.equal(options.loadEnvironment(), environment);
        assert.equal(
          options.guardDatabaseTarget(environment).status,
          "operational_guard_passed",
        );
        assert.ok(options.args.includes("--write"));
        assert.ok(options.args.includes("--reveal-on-tty"));
        assert.ok(
          options.args.includes(
            "--reviewed-database-target-fingerprint",
          ),
        );
        assert.ok(options.args.includes("--receipt-evidence-dir"));
        const evidencePort = options.createReceiptEvidencePort();
        const stored = evidencePort.store({
          receipt: {
            claimBinding: {
              identityPairingIntentSha256:
                `sha256:${"b".repeat(64)}`,
            },
          },
          databaseTargetFingerprint: `sha256:${"1".repeat(64)}`,
        });
        state.intentInserted = true;
        await options.revealPort.reveal(RAW_CLAIM);
        return {
          result: "revealed_to_tty",
          committed: true,
          receiptEvidenceStatus: stored.status,
          revealStatus: "tty_write_completed",
          claimBinding: {
            claimDigest: CLAIM_DIGEST,
          },
        };
      },
    });

    assert.equal(result.result, "verified");
    assert.equal(result.claimDigestMatched, true);
    assert.deepEqual(result.actualWrites, {
      appUsers: 1,
      identityPairingIntents: 1,
      identityPairingIntentEvents: 0,
      authIdentities: 0,
      productTables: 0,
    });
    assert.equal(state.poolClosed, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /varda-bootstrap-claim-v1\./,
    );
  });
});

function createMockPool(state) {
  return {
    async query(text) {
      const sql = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (sql.startsWith("insert into app_users")) {
        state.targetInserted = true;
        return { rowCount: 1, rows: [{ id: TARGET }] };
      }
      if (
        sql.includes("from app_users user_row") &&
        sql.includes("inner join identity_pairing_intents")
      ) {
        assert.equal(state.targetInserted, true);
        assert.equal(state.intentInserted, true);
        return {
          rowCount: 1,
          rows: [
            {
              status: "provisioning",
              role: "user",
              authority_policy_id:
                "preissued_bootstrap_claim_authority_v1",
              claim_digest_version: "bootstrap_claim_sha256_v1",
              claim_digest: CLAIM_DIGEST,
              target_review_policy_id:
                "single_provisioning_user_explicit_review_v1",
              target_identity_count: 0,
              target_intent_count: 1,
              target_terminal_event_count: 0,
            },
          ],
        };
      }
      if (sql.includes("as app_users")) {
        return {
          rowCount: 1,
          rows: [
            {
              app_users:
                state.appUsers + (state.targetInserted ? 1 : 0),
              auth_identities: state.authIdentities,
              identity_pairing_intents:
                state.intents + (state.intentInserted ? 1 : 0),
              identity_pairing_intent_events: state.events,
              accounts: state.accounts,
              assets: state.assets,
            },
          ],
        };
      }
      throw new Error(`Unexpected mock query: ${sql}`);
    },
    async end() {
      state.poolClosed = true;
    },
  };
}
