export const NAVER_AUTH_BASE_PATH = "/api/oauth";
export const NAVER_AUTH_SESSION_COOKIE = "__Host-varda.naver.session-token";
export const NAVER_AUTH_SESSION_MAX_AGE = 60 * 60 * 8;

export type NaverAuthEnvironment = Readonly<{
  VERCEL_ENV?: string;
  VARDA_AUTH_NAVER_ENABLED?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
  NAVER_AUTH_SECRET?: string;
  NAVER_AUTH_ORIGIN?: string;
}>;

export function assessNaverAuthEnvironment(environment: NaverAuthEnvironment) {
  if (
    environment.VERCEL_ENV !== "production" ||
    environment.VARDA_AUTH_NAVER_ENABLED !== "true"
  )
    return { state: "disabled" } as const;
  if (
    !environment.NAVER_CLIENT_ID?.trim() ||
    !environment.NAVER_CLIENT_SECRET?.trim() ||
    !environment.NAVER_AUTH_SECRET ||
    environment.NAVER_AUTH_SECRET.trim().length < 32 ||
    !canonicalNaverAuthOrigin(environment.NAVER_AUTH_ORIGIN)
  )
    return { state: "misconfigured" } as const;
  return { state: "ready" } as const;
}

export function canonicalNaverAuthOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !value.startsWith("https://")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isNaverAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://nid.naver.com" &&
      url.pathname === "/oauth2.0/authorize" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
