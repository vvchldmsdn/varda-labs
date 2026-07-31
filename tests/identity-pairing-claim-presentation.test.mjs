import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_PATH,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN,
  createDisabledIdentityPairingClaimPresentationResponse,
  createInvalidIdentityPairingClaimPresentationResponse,
  createProcessedIdentityPairingClaimPresentationResponse,
  createUnavailableIdentityPairingClaimPresentationResponse,
  readIdentityPairingClaimPresentationBody,
  validateIdentityPairingClaimPresentationMetadata,
} from "../src/lib/auth/identity-pairing-claim-presentation-transport.ts";
import {
  assessIdentityPairingClaimPresentationEnvironment,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_DEFAULT_MODE,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_ENABLED_MODE,
} from "../src/lib/auth/identity-pairing-claim-presentation-policy.ts";

describe("identity pairing claim presentation transport", () => {
  it("keeps the runtime disabled by default and enables only exact production configuration", () => {
    assert.equal(IDENTITY_PAIRING_CLAIM_PRESENTATION_DEFAULT_MODE, "disabled");
    assert.equal(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_ENABLED_MODE,
      "enabled_v1",
    );
    assert.deepEqual(
      assessIdentityPairingClaimPresentationEnvironment({}),
      { state: "disabled" },
    );
    assert.deepEqual(
      assessIdentityPairingClaimPresentationEnvironment({
        VERCEL_ENV: "production",
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE: "disabled",
      }),
      { state: "disabled" },
    );
    for (const environment of [
      {
        VERCEL_ENV: "preview",
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE: "enabled_v1",
      },
      {
        VERCEL_ENV: "production",
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE: "true",
      },
      {
        VERCEL_ENV: "production",
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE: "   ",
      },
    ]) {
      assert.deepEqual(
        assessIdentityPairingClaimPresentationEnvironment(environment),
        { state: "misconfigured" },
      );
    }
    assert.deepEqual(
      assessIdentityPairingClaimPresentationEnvironment({
        VERCEL_ENV: "production",
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE: "enabled_v1",
      }),
      { state: "enabled" },
    );
  });

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

  it("rejects a noncanonical base64url alias", async () => {
    const canonicalClaim = syntheticClaim();
    const noncanonicalAlias = `${canonicalClaim.slice(0, -1)}B`;
    assert.equal(
      Buffer.from(noncanonicalAlias.split(".")[1], "base64url").equals(
        Buffer.alloc(32),
      ),
      true,
    );

    assert.deepEqual(
      await readIdentityPairingClaimPresentationBody(
        presentationRequest(
          JSON.stringify({ claim: noncanonicalAlias }),
        ),
      ),
      { state: "blocked", reason: "claim_format_invalid" },
    );
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

  it("rejects duplicate keys and non-canonical JSON", async () => {
    const claim = syntheticClaim();
    for (const body of [
      `{"claim":"not-a-claim","claim":${JSON.stringify(claim)}}`,
      `{ "claim": ${JSON.stringify(claim)} }`,
    ]) {
      assert.deepEqual(
        await readIdentityPairingClaimPresentationBody(
          presentationRequest(body),
        ),
        { state: "blocked", reason: "body_not_canonical" },
      );
    }
  });

  it("rejects a raw UTF-8 BOM before decoding", async () => {
    const canonicalBody = new TextEncoder().encode(
      JSON.stringify({ claim: syntheticClaim() }),
    );
    const bodyWithBom = new Uint8Array(canonicalBody.byteLength + 3);
    bodyWithBom.set([0xef, 0xbb, 0xbf]);
    bodyWithBom.set(canonicalBody, 3);

    assert.deepEqual(
      await readIdentityPairingClaimPresentationBody(
        presentationRequest(bodyWithBom),
      ),
      { state: "blocked", reason: "body_not_canonical" },
    );

    const transport = readFileSync(
      "src/lib/auth/identity-pairing-claim-presentation-transport.ts",
      "utf8",
    );
    assert.ok(
      transport.indexOf("hasUtf8Bom(bytes.value)") <
        transport.indexOf('new TextDecoder("utf-8"'),
      "raw UTF-8 BOM must be checked before decoding",
    );
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
    assert.deepEqual(
      await readIdentityPairingClaimPresentationBody(
        presentationRequest(new Uint8Array([0xc3, 0x28])),
      ),
      { state: "blocked", reason: "body_unreadable" },
    );
  });

  it("keeps non-POST methods disabled and gates POST before sensitive work", async () => {
    const response =
      createDisabledIdentityPairingClaimPresentationResponse();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "Not found");

    const route = readFileSync(
      "src/app/api/identity/bootstrap-claim/present/route.ts",
      "utf8",
    );
    assert.match(route, /^import "server-only";/);
    assert.match(route, /export const runtime = "nodejs"/);
    for (const method of [
      "GET",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]) {
      assert.match(
        route,
        new RegExp(`export async function ${method}\\(\\)`),
      );
    }
    assert.match(
      route,
      /createDisabledIdentityPairingClaimPresentationResponse\(\)/,
    );
    const gateIndex = route.indexOf(
      "assessIdentityPairingClaimPresentationEnvironment",
    );
    const metadataIndex = route.indexOf(
      "validateIdentityPairingClaimPresentationMetadata(request)",
    );
    const bodyIndex = route.indexOf(
      "readIdentityPairingClaimPresentationBody(request)",
    );
    const adapterIndex = route.indexOf(
      '"@/lib/auth/private-cross-process-claim-presentation"',
    );
    assert.ok(gateIndex !== -1);
    assert.ok(metadataIndex > gateIndex);
    assert.ok(bodyIndex > metadataIndex);
    assert.ok(adapterIndex > bodyIndex);
    assert.doesNotMatch(
      route,
      /getSession|verified-neon-subject|DATABASE_URL|IDENTITY_PAIRING_EVIDENCE_HMAC_KEY/,
    );
  });

  it("uses generic no-store responses without claim outcome details", async () => {
    for (const [response, status, body] of [
      [
        createInvalidIdentityPairingClaimPresentationResponse(),
        400,
        "Invalid request",
      ],
      [
        createUnavailableIdentityPairingClaimPresentationResponse(),
        503,
        "Service unavailable",
      ],
    ]) {
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(await response.text(), body);
    }

    const processed =
      createProcessedIdentityPairingClaimPresentationResponse();
    assert.equal(processed.status, 204);
    assert.equal(processed.headers.get("cache-control"), "no-store");
    assert.equal(processed.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await processed.text(), "");
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

  it("keeps transport parsing separate from auth and persistence", () => {
    const transport = readFileSync(
      "src/lib/auth/identity-pairing-claim-presentation-transport.ts",
      "utf8",
    );
    assert.doesNotMatch(
      transport,
      /@\/db|drizzle|neon|getSession|verified-neon-subject|consumeIdentity|process\.env|IDENTITY_PAIRING_EVIDENCE_HMAC_KEY/,
    );
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
  return `varda-bootstrap-claim-v1.${"A".repeat(43)}`;
}
