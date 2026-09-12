/** Navigation intent only. This cookie never contains or authorizes portfolio data. */
export const PLAN_RETURN_COOKIE = "varda_plan_return";
export const PLAN_RETURN_PATH = "/plans";
export const PLAN_RETURN_CANCEL_PATH = "/try?mode=personal";

export function planReturnDestination(sessionState: string, cookieValue: unknown): typeof PLAN_RETURN_PATH | null {
  return sessionState === "authenticated" && cookieValue === "1" ? PLAN_RETURN_PATH : null;
}
