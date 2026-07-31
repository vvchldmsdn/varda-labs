import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY,
  IdentityBootstrapClaimMigrationCliError,
  loadIdentityBootstrapClaimEnvironment,
  readIdentityBootstrapClaimMigrationCliOptions,
  runIdentityBootstrapClaimMigrationCli,
} from "../scripts/issue-identity-bootstrap-claim.mjs";
import {
  IdentityBootstrapClaimIssuerError,
} from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import {
  fingerprintAppUserId,
} from "../scripts/lib/legacy-account-ownership-evidence.mjs";

const TARGET = "11111111-1111-4111-8111-111111111111";
const TARGET_SHA256 = fingerprintAppUserId(TARGET);
const RAW_CLAIM =
  `varda-bootstrap-claim-v1.${Buffer.alloc(32, 0xab).toString("base64url")}`;
const CLAIM_DIGEST =
  `bootstrap-claim-sha256-v1:${"a".repeat(64)}`;
const INTENT_SHA256 = `sha256:${"b".repeat(64)}`;
const DATABASE_TARGET_SHA256 = `sha256:${"c".repeat(64)}`;

describe("identity bootstrap claim migration CLI", () => {
  it("parses dry-run by default and requires the exact write gates", () => {
    assert.deepEqual(
      readIdentityBootstrapClaimMigrationCliOptions(baseArgs()),
      {
        mode: "dry_run",
        write: false,
        targetAppUserId: TARGET,
        targetAppUserSha256: TARGET_SHA256,
      },
    );
    assert.deepEqual(
      readIdentityBootstrapClaimMigrationCliOptions(writeArgs()),
      {
        mode: "write",
        write: true,
        targetAppUserId: TARGET,
        targetAppUserSha256: TARGET_SHA256,
      },
    );
    for (const args of [
      [...baseArgs(), "--write"],
      [...baseArgs(), "--write", "--reveal-on-tty"],
      [
        ...baseArgs(),
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.confirmation,
      ],
      [...baseArgs(), "--unknown"],
      [...baseArgs(), "--target-app-user-id", TARGET],
    ]) {
      assert.throws(
        () => readIdentityBootstrapClaimMigrationCliOptions(args),
        (error) =>
          error instanceof IdentityBootstrapClaimMigrationCliError,
      );
    }
  });

  it("loads only the exact database guard keys from .env.local", () => {
    const environment = loadIdentityBootstrapClaimEnvironment(
      "C:\\repo",
      {
        readFile(path, options) {
          assert.equal(path, "C:\\repo\\.env.local");
          assert.deepEqual(options, { encoding: "utf8" });
          return "ignored";
        },
        parseEnvironment() {
          const parsed = {
            DATABASE_URL: "pooled",
            DATABASE_URL_UNPOOLED: "unpooled",
            NEON_PROJECT_ID: "project",
            NEON_API_KEY: "must-not-cross",
          };
          Object.defineProperty(parsed, "DOTENV_KEY", {
            get() {
              assert.fail("Environment accessors must not run.");
            },
          });
          return parsed;
        },
      },
    );

    assert.equal(Object.getPrototypeOf(environment), null);
    assert.deepEqual(Object.keys(environment), [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_PROJECT_ID",
    ]);
    assert.equal(Object.hasOwn(environment, "NEON_API_KEY"), false);
    assert.equal(Object.hasOwn(environment, "DOTENV_KEY"), false);
  });

  it("returns a guarded dry-run plan without creating a Pool", async () => {
    let pools = 0;
    const result = await runIdentityBootstrapClaimMigrationCli({
      args: baseArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool() {
        pools += 1;
      },
    });

    assert.equal(pools, 0);
    assert.deepEqual(result, {
      operation:
        IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.operation,
      mode: "dry_run",
      result: "planned",
      reviewedTargetAppUserSha256: TARGET_SHA256,
      databaseTargetFingerprint: DATABASE_TARGET_SHA256,
      plannedWrites: {
        identityPairingIntents: 1,
        identityPairingIntentEvents: 0,
        authIdentities: 0,
        appUsers: 0,
        productTables: 0,
      },
      revealTransport:
        "interactive_tty_stderr_once_after_commit",
      retryCount: 0,
    });
    assert.equal(JSON.stringify(result).includes(TARGET), false);
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
  });

  it("rejects non-TTY and accessor-backed reveal ports before env or DB work", async () => {
    for (const fixture of [
      {
        revealPort: { isTTY: false, reveal() {} },
        accessorCalls: () => 0,
      },
      accessorRevealPort(),
    ]) {
      const calls = {
        environment: 0,
        guard: 0,
        pool: 0,
        issue: 0,
      };
      await assert.rejects(
        runIdentityBootstrapClaimMigrationCli({
          args: writeArgs(),
          revealPort: fixture.revealPort,
          loadEnvironment() {
            calls.environment += 1;
          },
          guardDatabaseTarget() {
            calls.guard += 1;
          },
          createPool() {
            calls.pool += 1;
          },
          createIssuerPort() {
            calls.issue += 1;
          },
        }),
        (error) =>
          error instanceof IdentityBootstrapClaimMigrationCliError &&
          error.code === "tty_reveal_required",
      );
      assert.deepEqual(calls, {
        environment: 0,
        guard: 0,
        pool: 0,
        issue: 0,
      });
      assert.equal(fixture.accessorCalls(), 0);
    }
  });

  it("reveals exactly once only after issue commit and pool close", async () => {
    const events = [];
    const result = await runIdentityBootstrapClaimMigrationCli({
      ...writeDependencies(events),
      revealPort: {
        isTTY: true,
        async reveal(value) {
          events.push("reveal");
          assert.equal(value, RAW_CLAIM);
        },
      },
    });

    assert.deepEqual(events, [
      "load_environment",
      "guard_target",
      "create_pool",
      "create_issuer",
      "issue",
      "pool_end",
      "take",
      "reveal",
    ]);
    assert.equal(result.result, "revealed_to_tty");
    assert.equal(result.issued, true);
    assert.equal(result.committed, true);
    assert.equal(result.revealStatus, "tty_write_completed");
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
    assert.equal(JSON.stringify(result).includes(TARGET), false);
  });

  it("does not reveal while issuance is still pending", async () => {
    let settleIssue;
    let revealCalls = 0;
    const issuePromise = new Promise((resolvePromise) => {
      settleIssue = resolvePromise;
    });
    const run = runIdentityBootstrapClaimMigrationCli({
      args: writeArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool: () => ({
        async end() {},
      }),
      createIssuerPort: () => ({
        issue() {
          return issuePromise;
        },
        take() {
          return { rawClaim: RAW_CLAIM };
        },
      }),
      revealPort: {
        isTTY: true,
        async reveal() {
          revealCalls += 1;
        },
      },
    });

    await Promise.resolve();
    assert.equal(revealCalls, 0);
    settleIssue(issuedResult());
    assert.equal((await run).result, "revealed_to_tty");
    assert.equal(revealCalls, 1);
  });

  it("reports post-commit reveal failure without reissue or secret leakage", async () => {
    const calls = {
      issue: 0,
      take: 0,
      reveal: 0,
    };
    const result = await runIdentityBootstrapClaimMigrationCli({
      args: writeArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool: () => ({
        async end() {},
      }),
      createIssuerPort: () => ({
        async issue() {
          calls.issue += 1;
          return issuedResult();
        },
        take() {
          calls.take += 1;
          return { rawClaim: RAW_CLAIM };
        },
      }),
      revealPort: {
        isTTY: true,
        async reveal() {
          calls.reveal += 1;
          throw new Error(`do not expose ${RAW_CLAIM}`);
        },
      },
    });

    assert.deepEqual(calls, {
      issue: 1,
      take: 1,
      reveal: 1,
    });
    assert.equal(result.result, "tty_reveal_unconfirmed");
    assert.equal(result.issued, true);
    assert.equal(result.committed, true);
    assert.equal(result.revealStatus, "tty_write_unconfirmed");
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
  });

  it("does not extract or reveal after a post-commit Pool close failure", async () => {
    const calls = {
      issue: 0,
      take: 0,
      reveal: 0,
      close: 0,
    };
    const result = await runIdentityBootstrapClaimMigrationCli({
      args: writeArgs(),
      loadEnvironment: () => environment(),
      guardDatabaseTarget: () => ({
        targetFingerprint: DATABASE_TARGET_SHA256,
      }),
      createPool: () => ({
        async end() {
          calls.close += 1;
          throw new Error("close failed");
        },
      }),
      createIssuerPort: () => ({
        async issue() {
          calls.issue += 1;
          return issuedResult();
        },
        take() {
          calls.take += 1;
          return { rawClaim: RAW_CLAIM };
        },
      }),
      revealPort: {
        isTTY: true,
        async reveal() {
          calls.reveal += 1;
        },
      },
    });

    assert.deepEqual(calls, {
      issue: 1,
      take: 0,
      reveal: 0,
      close: 1,
    });
    assert.equal(result.result, "tty_reveal_unconfirmed");
    assert.equal(result.revealStatus, "tty_write_unconfirmed");
    assert.equal(JSON.stringify(result).includes(RAW_CLAIM), false);
  });

  it("does not retry when an active intent blocks issuance", async () => {
    const calls = {
      issue: 0,
      take: 0,
      reveal: 0,
      close: 0,
    };
    await assert.rejects(
      runIdentityBootstrapClaimMigrationCli({
        args: writeArgs(),
        loadEnvironment: () => environment(),
        guardDatabaseTarget: () => ({
          targetFingerprint: DATABASE_TARGET_SHA256,
        }),
        createPool: () => ({
          async end() {
            calls.close += 1;
          },
        }),
        createIssuerPort: () => ({
          async issue() {
            calls.issue += 1;
            throw new IdentityBootstrapClaimIssuerError(
              "unexpired_intent_exists",
            );
          },
          take() {
            calls.take += 1;
          },
        }),
        revealPort: {
          isTTY: true,
          async reveal() {
            calls.reveal += 1;
          },
        },
      }),
      (error) =>
        error instanceof IdentityBootstrapClaimMigrationCliError &&
        error.code === "unexpired_intent_exists",
    );
    assert.deepEqual(calls, {
      issue: 1,
      take: 0,
      reveal: 0,
      close: 1,
    });
  });
});

function baseArgs() {
  return [
    "--target-app-user-id",
    TARGET,
    "--target-app-user-sha256",
    TARGET_SHA256,
  ];
}

function writeArgs() {
  return [
    ...baseArgs(),
    "--write",
    "--reveal-on-tty",
    IDENTITY_BOOTSTRAP_CLAIM_MIGRATION_CLI_POLICY.confirmation,
  ];
}

function environment() {
  return {
    DATABASE_URL: "postgresql://pooled",
    DATABASE_URL_UNPOOLED: "postgresql://unpooled",
    NEON_PROJECT_ID: "project",
  };
}

function issuedResult() {
  return Object.freeze({
    result: "issued",
    committed: true,
    evidence: Object.freeze({
      expiresAt: "2026-07-31T12:10:00.000Z",
    }),
    executionBinding: Object.freeze({
      targetAppUserSha256: TARGET_SHA256,
      provider: "neon_auth",
      claimDigestVersion: "bootstrap_claim_sha256_v1",
      claimDigest: CLAIM_DIGEST,
      identityPairingIntentSha256: INTENT_SHA256,
    }),
  });
}

function writeDependencies(events) {
  return {
    args: writeArgs(),
    loadEnvironment() {
      events.push("load_environment");
      return environment();
    },
    guardDatabaseTarget() {
      events.push("guard_target");
      return { targetFingerprint: DATABASE_TARGET_SHA256 };
    },
    createPool() {
      events.push("create_pool");
      return {
        async end() {
          events.push("pool_end");
        },
      };
    },
    createIssuerPort() {
      events.push("create_issuer");
      return {
        async issue() {
          events.push("issue");
          return issuedResult();
        },
        take() {
          events.push("take");
          return { rawClaim: RAW_CLAIM };
        },
      };
    },
  };
}

function accessorRevealPort() {
  let accessorCalls = 0;
  const port = {};
  Object.defineProperty(port, "isTTY", {
    get() {
      accessorCalls += 1;
      return true;
    },
  });
  Object.defineProperty(port, "reveal", {
    value() {},
  });
  return {
    revealPort: port,
    accessorCalls: () => accessorCalls,
  };
}
