import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createOneTimeIdentityBootstrapClaim } from "../scripts/lib/identity-bootstrap-claim-issuer.mjs";
import {
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_PATH,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN,
  createDisabledIdentityPairingClaimPresentationResponse,
  readIdentityPairingClaimPresentationBody,
  validateIdentityPairingClaimPresentationMetadata,
} from "../src/lib/auth/identity-pairing-claim-presentation-transport.ts";

describe("disabled identity pairing claim presentation transport", () => {
  it("accepts only the reviewed same-origin POST metadata", () => {
    const request = presentationRequest(
      JSON.stringify({ claim: syntheticClaim() }),
    );
    assert.deepEqual(
      validateIdentityPairingClaimPresentationMetadata(request),
      { state: "accepted" },
    );

    for (const [changed, reason] of [
      [{ method: "GET" }, "method_not_allowed"],
      [{ url: `${presentationUrl()}?claim=forbidden` }, "query_not_allowed"],
      [{ origin: "https://example.invalid" }, "origin_not_allowed"],
      [{ origin: null }, "origin_not_allowed"],
      [{ fetchSite: "cross-site" }, "cross_site_request"],
      [{ contentType: "text/plain" }, "content_type_not_allowed"],
      [{ contentLength: "not-a-number" }, "content_length_invalid"],
      [
        {
          contentLength: String(
            IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES + 1,
          ),
        },
        "body_too_large",
      ],
    ]) {
      assert.deepEqual(
        validateIdentityPairingClaimPresentationMetadata(
          presentationRequest("{}", changed),
        ),
        { state: "blocked", reason },
      );
    }
  });

  it("reads a canonical claim from an exact JSON body", async () => {
    const claim = syntheticClaim();
    const result = await readIdentityPairingClaimPresentationBody(
      presentationRequest(JSON.stringify({ claim })),
    );
    assert.deepEqual(result, { state: "accepted", claim });
  });

  it("rejects malformed JSON, extra fields, and invalid claims", async () => {
    for (const [body, reason] of [
      ["{", "body_not_json"],
      [JSON.stringify([]), "body_shape_invalid"],
      [
        JSON.stringify({ claim: syntheticClaim(), target: "forbidden" }),
        "body_shape_invalid",
      ],
      [JSON.stringify({ claim: "not-a-claim" }), "claim_format_invalid"],
    ]) {
      assert.deepEqual(
        await readIdentityPairingClaimPresentationBody(
          presentationRequest(body),
        ),
        { state: "blocked", reason },
      );
    }
  });

  it("enforces the body cap while streaming", async () => {
    const chunk = new Uint8Array(600);
    const request = presentationRequest(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    );

    assert.deepEqual(
      await readIdentityPairingClaimPresentationBody(request),
      { state: "blocked", reason: "body_too_large" },
    );
  });

  it("rejects invalid UTF-8 without reflecting body bytes", async () => {
    const request = presentationRequest(
      new Uint8Array([0xc3, 0x28]),
    );
    assert.deepEqual(
      await readIdentityPairingClaimPresentationBody(request),
      { state: "blocked", reason: "body_unreadable" },
    );
  });

  it("keeps the deployed route disabled before any sensitive work", async () => {
    const response =
      createDisabledIdentityPairingClaimPresentationResponse();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Not found");

    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );
    assert.match(route, /^import "server-only";/);
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /export async function POST\(\)/);
    assert.match(
      route,
      /createDisabledIdentityPairingClaimPresentationResponse\(\)/,
    );
    assert.doesNotMatch(
      route,
      /request\.|getSession|verified-neon-subject|consumeIdentity|DATABASE_URL|process\.env|IDENTITY_PAIRING_EVIDENCE_HMAC_KEY/,
    );
  });

  it("keeps the exact route behind Basic Auth", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    assert.match(
      proxy,
      /"\/api\/identity\/bootstrap-claim\/present"/,
    );
    assert.equal(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_PATH,
      "/api/identity/bootstrap-claim/present",
    );
  });

  it("uses a dedicated server-only HMAC key loader", () => {
    const loader = readFileSync(
      "src/lib/auth/identity-pairing-evidence-hmac-key.ts",
      "utf8",
    );
    assert.match(loader, /^import "server-only";/);
    assert.match(loader, /IDENTITY_PAIRING_EVIDENCE_HMAC_KEY/);
    assert.match(loader, /base64url/);
    assert.match(loader, /byteLength !==/);
    assert.doesNotMatch(
      loader,
      /NEON_AUTH_COOKIE_SECRET|VARDA_APP_PASSWORD|APP_ACCESS_PASSWORD|console\.|logger/,
    );
  });

  it("does not expose the generic subject port to runtime consumers", () => {
    const runtimeFiles = [
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "src/lib/auth/identity-pairing-claim-presentation-transport.ts",
      "src/lib/auth/identity-pairing-evidence-hmac-key.ts",
    ];
    for (const file of runtimeFiles) {
      assert.doesNotMatch(
        readFileSync(file, "utf8"),
        /verified-neon-subject-port/,
      );
    }
  });
});

function presentationUrl() {
  return `${IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN}${IDENTITY_PAIRING_CLAIM_PRESENTATION_PATH}`;
}

function presentationRequest(
  body,
  {
    method = "POST",
    url = presentationUrl(),
    origin = IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN,
    fetchSite = "same-origin",
    contentType = "application/json; charset=utf-8",
    contentLength = null,
  } = {},
) {
  const headers = new Headers();
  if (origin !== null) headers.set("origin", origin);
  if (fetchSite !== null) headers.set("sec-fetch-site", fetchSite);
  if (contentType !== null) headers.set("content-type", contentType);
  if (contentLength !== null) {
    headers.set("content-length", contentLength);
  }

  const options = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    options.body = body;
    if (body instanceof ReadableStream) options.duplex = "half";
  }
  return new Request(url, options);
}

function syntheticClaim() {
  return createOneTimeIdentityBootstrapClaim(
    () => Buffer.alloc(32, 9),
  ).rawClaim;
}
