"use client";

import { Analytics } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";
import { canTrackWebAnalyticsPath, sanitizeWebAnalyticsEvent } from "@/lib/web-analytics-event";

export function ServiceWebAnalytics() {
  const pathname = usePathname();
  if (!canTrackWebAnalyticsPath(pathname)) return null;
  // The event guard remains effective after the SDK has loaded and a SPA enters auth.
  return <Analytics beforeSend={sanitizeWebAnalyticsEvent} />;
}
