"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";

export function ServiceSpeedInsights() {
  const pathname = usePathname();
  if (pathname.startsWith("/auth/")) return null;
  return (
    <SpeedInsights
      beforeSend={(event) => {
        const url = new URL(event.url);
        if (url.pathname.startsWith("/auth/")) return null;
        url.search = "";
        url.hash = "";
        return { ...event, url: url.toString() };
      }}
    />
  );
}
