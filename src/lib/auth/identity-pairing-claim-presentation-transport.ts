export const IDENTITY_PAIRING_CLAIM_PRESENTATION_PATH =
  "/api/identity/bootstrap-claim/present";
export const IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN =
  "https://varda-labs.vercel.app";
export const IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES = 1_024;

const CLAIM_PATTERN =
  /^varda-bootstrap-claim-v1\.[A-Za-z0-9_-]{43}$/;

export type IdentityPairingClaimPresentationBlockReason =
  | "method_not_allowed"
  | "query_not_allowed"
  | "origin_not_allowed"
  | "cross_site_request"
  | "content_type_not_allowed"
  | "content_length_invalid"
  | "body_too_large"
  | "body_unreadable"
  | "body_not_json"
  | "body_shape_invalid"
  | "claim_format_invalid";

export type IdentityPairingClaimPresentationMetadataResult =
  | Readonly<{ state: "accepted" }>
  | Readonly<{
      state: "blocked";
      reason: IdentityPairingClaimPresentationBlockReason;
    }>;

export type IdentityPairingClaimPresentationBodyResult =
  | Readonly<{ state: "accepted"; claim: string }>
  | Readonly<{
      state: "blocked";
      reason: IdentityPairingClaimPresentationBlockReason;
    }>;

export function validateIdentityPairingClaimPresentationMetadata(
  request: Request,
): IdentityPairingClaimPresentationMetadataResult {
  if (request.method !== "POST") return blocked("method_not_allowed");

  const url = new URL(request.url);
  if (url.search !== "") return blocked("query_not_allowed");
  if (
    request.headers.get("origin") !==
    IDENTITY_PAIRING_CLAIM_PRESENTATION_PRODUCTION_ORIGIN
  ) {
    return blocked("origin_not_allowed");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return blocked("cross_site_request");
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return blocked("content_type_not_allowed");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
      return blocked("content_length_invalid");
    }
    if (
      Number(contentLength) >
      IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES
    ) {
      return blocked("body_too_large");
    }
  }

  return Object.freeze({ state: "accepted" });
}

export async function readIdentityPairingClaimPresentationBody(
  request: Request,
): Promise<IdentityPairingClaimPresentationBodyResult> {
  const bytes = await readBodyWithinLimit(request);
  if (bytes.state === "blocked") return bytes;

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
  } catch {
    return blocked("body_unreadable");
  }

  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return blocked("body_not_json");
  }

  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return blocked("body_shape_invalid");
  }

  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "claim") {
    return blocked("body_shape_invalid");
  }

  const claim = (input as { claim?: unknown }).claim;
  if (typeof claim !== "string" || !CLAIM_PATTERN.test(claim)) {
    return blocked("claim_format_invalid");
  }

  return Object.freeze({ state: "accepted", claim });
}

export function createDisabledIdentityPairingClaimPresentationResponse() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readBodyWithinLimit(
  request: Request,
): Promise<
  | Readonly<{ state: "accepted"; value: Uint8Array }>
  | Readonly<{
      state: "blocked";
      reason: IdentityPairingClaimPresentationBlockReason;
    }>
> {
  if (!request.body) return blocked("body_not_json");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel();
        return blocked("body_unreadable");
      }

      totalBytes += value.byteLength;
      if (
        totalBytes >
        IDENTITY_PAIRING_CLAIM_PRESENTATION_MAX_BODY_BYTES
      ) {
        await reader.cancel();
        return blocked("body_too_large");
      }
      chunks.push(value.slice());
    }
  } catch {
    return blocked("body_unreadable");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return Object.freeze({ state: "accepted", value: body });
}

function blocked(
  reason: IdentityPairingClaimPresentationBlockReason,
): Readonly<{
  state: "blocked";
  reason: IdentityPairingClaimPresentationBlockReason;
}> {
  return Object.freeze({ state: "blocked", reason });
}

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json";
}
