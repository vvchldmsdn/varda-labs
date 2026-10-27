"use client";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { activityFeature } from "@/lib/member-activity";

// Internal member metrics: never send identity, portfolio input, query values or tokens.
export function MemberActivityTracker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const sample = pathname === "/try" && search.get("mode") !== "personal";
  const preview = search.has("preview");
  useEffect(() => {
    const feature = activityFeature(pathname ?? "");
    if (!feature || sample || preview) return;
    let lastSent = 0;
    let disposed = false;
    async function record() {
      if (disposed || document.visibilityState !== "visible" || Date.now() - lastSent < 60_000) return;
      lastSent = Date.now();
      try { await fetch("/api/member-activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature }), signal: AbortSignal.timeout(8000) }); } catch { /* Metrics never block the product. */ }
    }
    const timer = setTimeout(() => void record(), 800);
    const visible = () => { void record(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [pathname, sample, preview]);
  return null;
}
