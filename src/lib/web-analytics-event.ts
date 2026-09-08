import type { BeforeSendEvent } from "@vercel/analytics/next";

export function canTrackWebAnalyticsPath(pathname: string | null): boolean {
  if (!pathname) return false;
  try {
    const path = decodeURIComponent(pathname);
    return path !== "/auth" && !path.startsWith("/auth/");
  } catch {
    return false;
  }
}

/** Keep only the page path; financial inputs and identity selectors stay local. */
export function sanitizeWebAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password ||
      !canTrackWebAnalyticsPath(url.pathname)
    ) return null;
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}
