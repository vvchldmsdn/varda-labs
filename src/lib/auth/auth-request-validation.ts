export const AUTH_MAX_REQUEST_BODY_BYTES = 4_096;

export function isSameOriginAuthRequest(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("sec-fetch-site") !== "cross-site"
  );
}

export async function readBoundedAuthBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > AUTH_MAX_REQUEST_BODY_BYTES)
  ) {
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > AUTH_MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
