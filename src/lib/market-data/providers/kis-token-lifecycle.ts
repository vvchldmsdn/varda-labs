export type KisReusableTokenPolicy = "per_request" | "memory_cache";

export type KisReusableToken = Readonly<{
  accessToken: string;
  cacheKey: string;
  expiresAt: number;
}>;

export type KisTokenSession = {
  tokenCache: KisReusableToken | null;
  tokenRequest?: Readonly<{
    cacheKey: string;
    promise: Promise<KisReusableToken>;
  }> | null;
};

type IssuedKisToken = Readonly<{
  accessToken: string;
  expiresInSeconds: number;
}>;

const MINIMUM_REMAINING_VALIDITY_MS = 60_000;
const memoryTokenCaches = new Map<string, KisReusableToken>();
const inFlightTokenRequests = new Map<string, Promise<KisReusableToken>>();

export async function getReusableKisAccessToken({
  cacheKey,
  issueToken,
  now = Date.now,
  policy,
  session,
}: {
  cacheKey: string;
  issueToken: () => Promise<IssuedKisToken>;
  now?: () => number;
  policy: KisReusableTokenPolicy;
  session: KisTokenSession;
}) {
  const currentTime = now();
  const sessionToken = session.tokenCache;
  if (isUsableToken(sessionToken, cacheKey, currentTime)) {
    return sessionToken.accessToken;
  }

  const sessionRequest = session.tokenRequest;
  if (sessionRequest?.cacheKey === cacheKey) {
    const token = await sessionRequest.promise;
    session.tokenCache = token;
    return token.accessToken;
  }

  if (policy === "memory_cache") {
    const cached = memoryTokenCaches.get(cacheKey) ?? null;
    if (isUsableToken(cached, cacheKey, currentTime)) {
      session.tokenCache = cached;
      return cached.accessToken;
    }

    const inFlight = inFlightTokenRequests.get(cacheKey);
    if (inFlight) {
      const token = await inFlight;
      session.tokenCache = token;
      return token.accessToken;
    }
  }

  const request = issueToken().then((issued) => {
    const expiresInSeconds = Number.isFinite(issued.expiresInSeconds) &&
      issued.expiresInSeconds > 0
      ? issued.expiresInSeconds
      : 23 * 60 * 60;
    const token = Object.freeze({
      accessToken: issued.accessToken,
      cacheKey,
      expiresAt: now() + expiresInSeconds * 1000,
    });

    if (policy === "memory_cache") memoryTokenCaches.set(cacheKey, token);
    return token;
  });

  session.tokenRequest = Object.freeze({ cacheKey, promise: request });
  if (policy === "memory_cache") inFlightTokenRequests.set(cacheKey, request);

  try {
    const token = await request;
    session.tokenCache = token;
    return token.accessToken;
  } finally {
    if (session.tokenRequest?.promise === request) {
      session.tokenRequest = null;
    }
    if (inFlightTokenRequests.get(cacheKey) === request) {
      inFlightTokenRequests.delete(cacheKey);
    }
  }
}

function isUsableToken(
  token: KisReusableToken | null,
  cacheKey: string,
  now: number,
): token is KisReusableToken {
  return (
    token !== null &&
    token.cacheKey === cacheKey &&
    token.expiresAt > now + MINIMUM_REMAINING_VALIDITY_MS
  );
}
