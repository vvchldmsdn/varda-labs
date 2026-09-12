/** Navigation intent only. This cookie never contains or authorizes portfolio data. */
export const PLAN_RETURN_COOKIE = "varda_plan_return";
export const PLAN_RETURN_PATH = "/plans";
export const PLAN_RETURN_CANCEL_PATH = "/try?mode=personal";
export const PLAN_RETURN_SOURCE_COOKIE = "varda_plan_source";
export function planReturnCancelDestination(source: unknown): "/try/analyze" | typeof PLAN_RETURN_CANCEL_PATH {
  return source === "quick" ? "/try/analyze" : PLAN_RETURN_CANCEL_PATH;
}
/** A fixed UI navigation hint, never a redirect URL, identity or authorization. */
export function planReturnIntentCookies(source: "quick" | "allocation", secure = false): string[] {
  const suffix = `; Path=/; Max-Age=86400; SameSite=Lax${secure ? "; Secure" : ""}`;
  return [`${PLAN_RETURN_COOKIE}=1${suffix}`, `${PLAN_RETURN_SOURCE_COOKIE}=${source}${suffix}`];
}
export function clearPlanReturnCookies(secure = false): string[] {
  const suffix = `=; Path=/; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`;
  return [PLAN_RETURN_COOKIE + suffix, PLAN_RETURN_SOURCE_COOKIE + suffix];
}

export function planReturnDestination(sessionState: string, cookieValue: unknown): typeof PLAN_RETURN_PATH | null {
  return sessionState === "authenticated" && cookieValue === "1" ? PLAN_RETURN_PATH : null;
}
