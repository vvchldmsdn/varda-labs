export const AUTH_TRANSPORT_STRIPPED_CREDENTIAL_HEADERS = Object.freeze([
  "authorization",
  "proxy-authorization",
] as const);

export function createAuthTransportUpstreamHeaders(headers: HeadersInit) {
  const sanitizedHeaders = new Headers(headers);

  for (const header of AUTH_TRANSPORT_STRIPPED_CREDENTIAL_HEADERS) {
    sanitizedHeaders.delete(header);
  }

  return sanitizedHeaders;
}

export function createAuthTransportUpstreamRequest(request: Request) {
  return new Request(request, {
    headers: createAuthTransportUpstreamHeaders(request.headers),
  });
}
