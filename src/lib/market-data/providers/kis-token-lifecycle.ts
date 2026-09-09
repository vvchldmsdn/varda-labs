export type KisReusableTokenPolicy = "per_request" | "memory_cache";

export type KisReusableToken = Readonly<{
  accessToken: string;
  cacheKey: string;
  expiresAt: number;
}>;

export type KisTokenSession = {
  tokenCache: KisReusableToken | null;
  tokenFailure?: Readonly<{ cacheKey: string; retryAt: number }> | null;
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
const MINIMUM_FAILURE_COOLDOWN_MS = 60_000;
const MAXIMUM_FAILURE_COOLDOWN_MS = 60 * 60_000;
const memoryTokenCaches = new Map<string, KisReusableToken>();
const inFlightTokenRequests = new Map<string, Promise<KisReusableToken>>();
// Only retry timing is cached, never provider error bodies or credentials.
const memoryTokenFailures = new Map<string, number>();

export class KisTokenCooldownError extends Error {
  readonly code = "provider_token_cooldown";
  readonly retryAfterSeconds: number;
  constructor(retryAt: number, now: number) {
    super("KIS token issuance is temporarily cooling down");
    this.name = "KisTokenCooldownError";
    this.retryAfterSeconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
  }
}

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

    const retryAt = memoryTokenFailures.get(cacheKey);
    if (retryAt !== undefined) {
      if (retryAt > currentTime) throw new KisTokenCooldownError(retryAt, currentTime);
      memoryTokenFailures.delete(cacheKey);
    }
  }

  const previousFailure = session.tokenFailure;
  if (previousFailure?.cacheKey === cacheKey && previousFailure.retryAt > currentTime) {
    throw new KisTokenCooldownError(previousFailure.retryAt, currentTime);
  }
  session.tokenFailure = null;

  const request = Promise.resolve().then(issueToken).then((issued) => {
    const expiresInSeconds = Number.isFinite(issued.expiresInSeconds) &&
      issued.expiresInSeconds > 0
      ? issued.expiresInSeconds
      : 23 * 60 * 60;
    const token = Object.freeze({
      accessToken: issued.accessToken,
      cacheKey,
      expiresAt: now() + expiresInSeconds * 1000,
    });

    session.tokenFailure = null;
    if (policy === "memory_cache") {
      memoryTokenCaches.set(cacheKey, token);
      memoryTokenFailures.delete(cacheKey);
    }
    return token;
  }).catch((error: unknown) => {
    const requestedSeconds = typeof error === "object" && error !== null && "retryAfterSeconds" in error
      ? Number(error.retryAfterSeconds) : 0;
    const retryDelay = Math.min(MAXIMUM_FAILURE_COOLDOWN_MS, Math.max(MINIMUM_FAILURE_COOLDOWN_MS,
      Number.isFinite(requestedSeconds) && requestedSeconds > 0 ? requestedSeconds * 1000 : 0));
    const retryAt = now() + retryDelay;
    session.tokenFailure = Object.freeze({ cacheKey, retryAt });
    if (policy === "memory_cache") {
      // Expired failures are disposable. Keep the process-local safety net bounded
      // even if a future caller supplies many distinct credential scopes.
      for (const [key, expiration] of memoryTokenFailures) if (expiration <= now()) memoryTokenFailures.delete(key);
      memoryTokenFailures.set(cacheKey, retryAt);
      if (memoryTokenFailures.size > 64) memoryTokenFailures.delete(memoryTokenFailures.keys().next().value!);
    }
    throw error;
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
