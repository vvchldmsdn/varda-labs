import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  decodeSessionSubjectBindingHmacKey,
  readSessionSubjectBinding,
  SESSION_SUBJECT_BINDING_POLICY,
} from "../src/lib/auth/session-subject-binding.ts";

const HMAC_KEY = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 1,
);
const SUBJECT = "user_01J0M0TESTSUBJECT";
const EXPECTED_BINDING =
  "hmac-sha256-v1:7042e1034f9d7d990e41e16c9bc1a4f157fb62312c73743ca10de60cd65381a4";
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

describe("private session subject binding", () => {
  it("binds a mock verified session to the pinned HMAC fixture", async () => {
    const result = await readSessionSubjectBinding({
      sessionPort: mockPort({
        state: "verified",
        provider: "neon_auth",
        subject: SUBJECT,
        verificationSource: "server_verified_session",
      }),
      hmacKey: HMAC_KEY,
    });

    assert.deepEqual(result, {
      state: "verified",
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBinding: EXPECTED_BINDING,
      verificationSource: "server_verified_session",
    });
    assert.equal(JSON.stringify(result).includes(SUBJECT), false);
    assert.equal(Object.isFrozen(result), true);
  });

  it("keeps the binding deterministic and subject-specific", async () => {
    const first = await bind(SUBJECT, HMAC_KEY);
    const second = await bind(SUBJECT, HMAC_KEY);
    const otherSubject = await bind(`${SUBJECT}_other`, HMAC_KEY);
    const otherKey = await bind(
      SUBJECT,
      Uint8Array.from({ length: 32 }, () => 7),
    );

    assert.deepEqual(first, second);
    assert.notDeepEqual(first, otherSubject);
    assert.notDeepEqual(first, otherKey);
  });

  it("preserves disabled, missing, and unavailable session states", async () => {
    for (const state of ["disabled", "missing", "unavailable"]) {
      assert.deepEqual(
        await readSessionSubjectBinding({
          sessionPort: mockPort({ state }),
          hmacKey: HMAC_KEY,
        }),
        { state },
      );
    }

    assert.deepEqual(
      await readSessionSubjectBinding({
        sessionPort: Object.freeze({
          async read() {
            throw new Error("opaque provider failure");
          },
        }),
        hmacKey: HMAC_KEY,
      }),
      { state: "unavailable" },
    );
  });

  it("rejects invalid keys before reading the session", async () => {
    let sessionReads = 0;
    const sessionPort = Object.freeze({
      async read() {
        sessionReads += 1;
        return {
          state: "verified",
          provider: "neon_auth",
          subject: SUBJECT,
          verificationSource: "server_verified_session",
        };
      },
    });

    for (const hmacKey of [
      new Uint8Array(0),
      new Uint8Array(31),
      new Uint8Array(33),
    ]) {
      assert.deepEqual(
        await readSessionSubjectBinding({ sessionPort, hmacKey }),
        { state: "unavailable" },
      );
    }
    assert.equal(sessionReads, 0);
  });

  it("decodes only the canonical unpadded base64url key", () => {
    const encoded = Buffer.from(HMAC_KEY).toString("base64url");
    const lastIndex = BASE64URL_ALPHABET.indexOf(encoded.at(-1));
    const noncanonical = `${encoded.slice(0, -1)}${
      BASE64URL_ALPHABET[lastIndex + 1]
    }`;

    assert.deepEqual(
      decodeSessionSubjectBindingHmacKey(encoded),
      HMAC_KEY,
    );
    assert.deepEqual(
      Buffer.from(noncanonical, "base64url"),
      Buffer.from(HMAC_KEY),
    );
    assert.equal(
      decodeSessionSubjectBindingHmacKey(noncanonical),
      null,
    );

    for (const candidate of [
      undefined,
      "",
      `${encoded}=`,
      ` ${encoded}`,
      `${encoded} `,
      Buffer.alloc(31).toString("base64url"),
      Buffer.alloc(33).toString("base64url"),
    ]) {
      assert.equal(
        decodeSessionSubjectBindingHmacKey(candidate),
        null,
      );
    }
  });

  it("rejects malformed or noncanonical provider subjects", async () => {
    for (const subject of [
      "",
      ` ${SUBJECT}`,
      `${SUBJECT} `,
      `line\nbreak`,
      `null\u0000byte`,
      "\ud800",
      "\uac00".repeat(86),
    ]) {
      assert.deepEqual(await bind(subject, HMAC_KEY), {
        state: "missing",
      });
    }

    assert.equal(
      (
        await bind(
          "\uc720\ud6a8\ud55c-\uc2dd\ubcc4\uc790-01",
          HMAC_KEY,
        )
      ).state,
      "verified",
    );
  });

  it("fails closed for an unverified provider contract", async () => {
    for (const evidence of [
      {
        state: "verified",
        provider: "other_auth",
        subject: SUBJECT,
        verificationSource: "server_verified_session",
      },
      {
        state: "verified",
        provider: "neon_auth",
        subject: SUBJECT,
        verificationSource: "request_claim",
      },
      { state: "unexpected" },
    ]) {
      assert.deepEqual(
        await readSessionSubjectBinding({
          sessionPort: mockPort(evidence),
          hmacKey: HMAC_KEY,
        }),
        { state: "unavailable" },
      );
    }
  });

  it("does not invoke accessors while snapshotting session evidence", async () => {
    let subjectReads = 0;
    const evidence = {
      state: "verified",
      provider: "neon_auth",
      verificationSource: "server_verified_session",
    };
    Object.defineProperty(evidence, "subject", {
      enumerable: true,
      get() {
        subjectReads += 1;
        return SUBJECT;
      },
    });

    assert.deepEqual(
      await readSessionSubjectBinding({
        sessionPort: mockPort(evidence),
        hmacKey: HMAC_KEY,
      }),
      { state: "unavailable" },
    );
    assert.equal(subjectReads, 0);
  });

  it("keeps the Production adapter private and limits it to the verified-session composition adapter", () => {
    const adapterPath =
      "src/lib/auth/private-session-subject-binding.ts";
    const presentationAdapterPath =
      "src/lib/auth/private-verified-session-claim-presentation.ts";
    const adapter = readFileSync(adapterPath, "utf8");
    const presentationAdapter = readFileSync(
      presentationAdapterPath,
      "utf8",
    );
    const core = readFileSync(
      "src/lib/auth/session-subject-binding.ts",
      "utf8",
    );

    assert.match(adapter, /^import "server-only";/);
    assert.match(presentationAdapter, /^import "server-only";/);
    assert.match(adapter, /getAuthTransportRuntime/);
    assert.match(adapter, /auth\.getSession\(\)/);
    assert.match(adapter, /runtime\.state === "disabled"/);
    assert.match(adapter, /IDENTITY_PAIRING_EVIDENCE_HMAC_KEY/);
    assert.doesNotMatch(
      adapter,
      /@\/db|drizzle|DATABASE_URL|insert\s*\(|update\s*\(|delete\s*\(|console\.|Response|NextResponse|NextRequest/,
    );
    assert.doesNotMatch(
      core,
      /process\.env|@\/db|drizzle|fetch\s*\(|console\.|Response|NextResponse|NextRequest/,
    );

    const importers = collectSourceFiles("src")
      .filter((path) => path !== adapterPath)
      .filter((path) =>
        readFileSync(path, "utf8").includes(
          "private-session-subject-binding",
        ),
      );
    assert.deepEqual(importers, [presentationAdapterPath]);
  });

  it("keeps policy and output semantics exact", () => {
    assert.deepEqual(SESSION_SUBJECT_BINDING_POLICY, {
      policyId: "private_session_subject_binding_v1",
      provider: "neon_auth",
      subjectBindingVersion: "provider_subject_hmac_sha256_v1",
      subjectBindingPrefix: "hmac-sha256-v1:",
      verificationSource: "server_verified_session",
      hmacAlgorithm: "sha256",
      hmacKeyBytes: 32,
      hmacDomain:
        "varda.identity-pairing.provider-subject-hmac-sha256.v1",
      maxSubjectBytes: 255,
    });
  });
});

function mockPort(evidence) {
  return Object.freeze({
    async read() {
      return evidence;
    },
  });
}

function bind(subject, hmacKey) {
  return readSessionSubjectBinding({
    sessionPort: mockPort({
      state: "verified",
      provider: "neon_auth",
      subject,
      verificationSource: "server_verified_session",
    }),
    hmacKey,
  });
}

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}
