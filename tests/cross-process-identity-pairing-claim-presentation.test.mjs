import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY,
  executeCrossProcessIdentityPairingClaimPresentation,
} from "../scripts/lib/cross-process-identity-pairing-claim-presentation.mjs";
import {
  createGuardedCrossProcessClaimPresentationRuntime,
} from "../scripts/lib/guarded-cross-process-claim-presentation-runtime.mjs";
import {
  createVerifiedSessionConsumeCapability,
} from "../scripts/lib/verified-session-consume-capability.mjs";
import {
  guardProductionDatabaseTarget,
} from "../src/lib/deployment/production-database-target.ts";
import {
  sha256Fingerprint,
} from "../src/lib/deployment/preview-database-target.ts";

const RAW_CLAIM = `varda-bootstrap-claim-v1.${Buffer.alloc(32, 5).toString(
  "base64url",
)}`;
const SUBJECT = "cross-process-presentation-subject";
const HMAC_KEY = Uint8Array.from({ length: 32 }, () => 11);
const PROJECT_ID = "cross-process-synthetic-project";
const PRODUCTION_ENDPOINT = "ep-cross-process-production";
const OTHER_ENDPOINT = "ep-cross-process-other";
const DATABASE_TARGET_POLICY = Object.freeze({
  policyId: "production_database_target_operational_guard_v1",
  expectedNeonIntegrationProjectSha256: sha256Fingerprint(PROJECT_ID),
  productionEndpointSha256: sha256Fingerprint(PRODUCTION_ENDPOINT),
});

describe("cross-process identity pairing claim presentation", () => {
  it("consumes one canonical claim with one session read and writer call", async () => {
    const session = syntheticSessionPort();
    const writerCalls = [];
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        dependencies({
          session,
          async writer(input) {
            writerCalls.push(input);
            assert.equal(Object.hasOwn(input.pool, "connect"), true);
            assert.equal(input.rawClaim, RAW_CLAIM);
            assert.deepEqual(
              await input.verifiedSessionSubjectPort.read(),
              verifiedEvidence(),
            );
            assert.deepEqual(input.hmacKey, HMAC_KEY);
            return Object.freeze({ result: "consumed", committed: true });
          },
        }),
      );

    assert.deepEqual(result, {
      operation: "cross_process_identity_pairing_claim_presentation_v1",
      result: "consumed",
      committed: true,
      writerInvoked: true,
      retryCount: 0,
    });
    assert.equal(session.readCount(), 1);
    assert.equal(writerCalls.length, 1);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(SUBJECT), false);
  });

  it("blocks malformed claims before reading the session", async () => {
    const session = syntheticSessionPort();
    let writerCalls = 0;
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: "not-a-claim", pool: syntheticPool() },
        dependencies({
          session,
          async writer() {
            writerCalls += 1;
          },
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "claim_invalid");
    assert.equal(session.readCount(), 0);
    assert.equal(writerCalls, 0);
  });

  it("blocks an unavailable session without invoking the writer", async () => {
    let writerCalls = 0;
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        Object.freeze({
          async createSessionCapability() {
            return Object.freeze({ state: "missing" });
          },
          async consumeIdentityPairingClaim() {
            writerCalls += 1;
          },
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "verified_session_unavailable");
    assert.equal(writerCalls, 0);
  });

  it("returns a secret-free failure when the atomic writer fails", async () => {
    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool: syntheticPool() },
        dependencies({
          session: syntheticSessionPort(),
          async writer() {
            throw new Error(`sensitive ${RAW_CLAIM} ${SUBJECT}`);
          },
        }),
      );

    assert.deepEqual(result, {
      operation: "cross_process_identity_pairing_claim_presentation_v1",
      result: "failed",
      blocker: "identity_consume_failed",
      committed: false,
      writerInvoked: true,
      retryCount: 0,
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(RAW_CLAIM), false);
    assert.equal(serialized.includes(SUBJECT), false);
  });

  it("rejects accessor database ports without invoking the accessor", async () => {
    let accessorReads = 0;
    let sessionReads = 0;
    const pool = {};
    Object.defineProperty(pool, "connect", {
      get() {
        accessorReads += 1;
        return () => {};
      },
    });

    const result =
      await executeCrossProcessIdentityPairingClaimPresentation(
        { rawClaim: RAW_CLAIM, pool },
        Object.freeze({
          async createSessionCapability() {
            sessionReads += 1;
          },
          async consumeIdentityPairingClaim() {},
        }),
      );

    assert.equal(result.result, "blocked");
    assert.equal(result.blocker, "database_port_invalid");
    assert.equal(accessorReads, 0);
    assert.equal(sessionReads, 0);
  });

  it("keeps the runtime adapter separate from issuer and owner assignment", () => {
    const adapter = readFileSync(
      "src/lib/auth/private-cross-process-claim-presentation.ts",
      "utf8",
    );
    const core = readFileSync(
      "scripts/lib/cross-process-identity-pairing-claim-presentation.mjs",
      "utf8",
    );
    const guardedRuntime = readFileSync(
      "scripts/lib/guarded-cross-process-claim-presentation-runtime.mjs",
      "utf8",
    );
    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );

    assert.match(adapter, /^import "server-only";/);
    assert.match(adapter, /createPrivateSessionConsumeCapability/);
    assert.match(adapter, /consumeIdentityPairingClaim/);
    assert.match(adapter, /guardProductionDatabaseTarget/);
    assert.match(
      adapter,
      /createGuardedCrossProcessClaimPresentationRuntime/,
    );
    assert.match(
      adapter,
      /executeCrossProcessIdentityPairingClaimPresentation/,
    );
    assert.doesNotMatch(
      `${adapter}\n${core}\n${route}`,
      /identity-bootstrap-claim-issuer|legacy-account-owner-assignment-writer/,
    );
    assert.doesNotMatch(
      core,
      /DATABASE_URL|process\.env|@\/db|drizzle|@neondatabase|next\/server/,
    );
    assert.doesNotMatch(
      guardedRuntime,
      /process\.env|@\/db|drizzle|@neondatabase|next\/server/,
    );
    const guardIndex = guardedRuntime.indexOf(
      "Reflect.apply(guardDatabaseTarget",
    );
    const poolIndex = guardedRuntime.indexOf(
      "Reflect.apply(createPoolPort",
    );
    const guardedPoolReadIndex = guardedRuntime.indexOf(
      "const pool = getGuardedPoolPort()",
    );
    const presentationIndex = guardedRuntime.indexOf(
      "Reflect.apply(executePresentation",
    );
    assert.ok(guardIndex >= 0);
    assert.ok(poolIndex > guardIndex);
    assert.ok(guardedPoolReadIndex >= 0);
    assert.ok(presentationIndex > guardedPoolReadIndex);
    assert.doesNotMatch(
      route,
      /private-verified-session-claim-presentation|private-verified-session-identity-consume/,
    );
  });

  it("keeps policy limits exact", () => {
    assert.deepEqual(
      CROSS_PROCESS_IDENTITY_PAIRING_CLAIM_PRESENTATION_POLICY,
      {
        operation: "cross_process_identity_pairing_claim_presentation_v1",
        claimSource: "canonical_http_request_body",
        clientBindingFields: 0,
        sessionReadsPerAttempt: 1,
        writerInvocationsPerAttempt: 1,
        retryCount: 0,
      },
    );
  });

  it("guards the Production target before Pool, session, or writer work", async () => {
    const validEnvironment = productionDatabaseEnvironment();
    const invalidEnvironments = [
      { ...validEnvironment, DATABASE_URL: undefined },
      { ...validEnvironment, DATABASE_URL_UNPOOLED: undefined },
      { ...validEnvironment, NEON_PROJECT_ID: "unexpected-project" },
      {
        ...validEnvironment,
        DATABASE_URL: productionDatabaseUrl(OTHER_ENDPOINT, true),
      },
      {
        ...validEnvironment,
        DATABASE_URL_UNPOOLED: productionDatabaseUrl(
          OTHER_ENDPOINT,
          false,
        ),
      },
    ];

    for (const environment of invalidEnvironments) {
      const calls = runtimeCallCounters();
      const runtime = createGuardedCrossProcessClaimPresentationRuntime(
        guardedRuntimeDependencies(environment, calls),
      );

      await assert.rejects(runtime.present(RAW_CLAIM));
      assert.deepEqual(calls, {
        environment: 1,
        guard: 1,
        pool: 0,
        presentation: 0,
        session: 0,
        writer: 0,
      });
    }
  });

  it("uses only the guarded unpooled target before presentation", async () => {
    const calls = runtimeCallCounters();
    const events = [];
    const environment = productionDatabaseEnvironment();
    const runtime = createGuardedCrossProcessClaimPresentationRuntime(
      guardedRuntimeDependencies(environment, calls, events),
    );

    const result = await runtime.present(RAW_CLAIM);

    assert.deepEqual(result, { result: "consumed" });
    assert.deepEqual(events, [
      "read_environment",
      "guard_database_target",
      "create_pool_port",
      "execute_presentation",
      "create_session_capability",
      "consume_identity_pairing_claim",
    ]);
    assert.deepEqual(calls, {
      environment: 1,
      guard: 1,
      pool: 1,
      presentation: 1,
      session: 1,
      writer: 1,
    });
  });

  it("does not invoke accessor-backed database environment values", async () => {
    let accessorReads = 0;
    const environment = productionDatabaseEnvironment();
    Object.defineProperty(environment, "DATABASE_URL_UNPOOLED", {
      get() {
        accessorReads += 1;
        return productionDatabaseUrl(PRODUCTION_ENDPOINT, false);
      },
    });
    const calls = runtimeCallCounters();
    const runtime = createGuardedCrossProcessClaimPresentationRuntime(
      guardedRuntimeDependencies(environment, calls),
    );

    await assert.rejects(runtime.present(RAW_CLAIM));
    assert.equal(accessorReads, 0);
    assert.deepEqual(calls, {
      environment: 1,
      guard: 1,
      pool: 0,
      presentation: 0,
      session: 0,
      writer: 0,
    });
  });
});

function dependencies({ session, writer }) {
  return Object.freeze({
    createSessionCapability() {
      return createVerifiedSessionConsumeCapability({
        sessionPort: session.port,
        hmacKey: HMAC_KEY,
      });
    },
    consumeIdentityPairingClaim: writer,
  });
}

function syntheticPool() {
  return Object.freeze({
    async connect() {
      throw new Error("The synthetic writer should not connect directly");
    },
  });
}

function syntheticSessionPort() {
  let reads = 0;
  return Object.freeze({
    port: Object.freeze({
      async read() {
        reads += 1;
        return verifiedEvidence();
      },
    }),
    readCount() {
      return reads;
    },
  });
}

function verifiedEvidence() {
  return Object.freeze({
    state: "verified",
    provider: "neon_auth",
    subject: SUBJECT,
    verificationSource: "server_verified_session",
  });
}

function guardedRuntimeDependencies(environment, calls, events = []) {
  return Object.freeze({
    readEnvironment() {
      calls.environment += 1;
      events.push("read_environment");
      return environment;
    },
    guardDatabaseTarget(candidate) {
      calls.guard += 1;
      events.push("guard_database_target");
      return guardProductionDatabaseTarget(
        candidate,
        DATABASE_TARGET_POLICY,
      );
    },
    createPoolPort(connectionString) {
      calls.pool += 1;
      events.push("create_pool_port");
      assert.equal(
        connectionString,
        productionDatabaseUrl(PRODUCTION_ENDPOINT, false),
      );
      return Object.freeze({
        async connect() {
          throw new Error("Synthetic presentation does not connect");
        },
      });
    },
    async executePresentation(input, dependencies) {
      calls.presentation += 1;
      events.push("execute_presentation");
      assert.equal(typeof input.pool.connect, "function");
      await dependencies.createSessionCapability();
      await dependencies.consumeIdentityPairingClaim();
      return Object.freeze({ result: "consumed" });
    },
    async createSessionCapability() {
      calls.session += 1;
      events.push("create_session_capability");
    },
    async consumeIdentityPairingClaim() {
      calls.writer += 1;
      events.push("consume_identity_pairing_claim");
    },
  });
}

function runtimeCallCounters() {
  return {
    environment: 0,
    guard: 0,
    pool: 0,
    presentation: 0,
    session: 0,
    writer: 0,
  };
}

function productionDatabaseEnvironment() {
  return {
    DATABASE_URL: productionDatabaseUrl(PRODUCTION_ENDPOINT, true),
    DATABASE_URL_UNPOOLED: productionDatabaseUrl(
      PRODUCTION_ENDPOINT,
      false,
    ),
    NEON_PROJECT_ID: PROJECT_ID,
  };
}

function productionDatabaseUrl(endpoint, pooled) {
  return `postgresql://runtime_user:runtime_password@${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech/neondb?sslmode=require`;
}
