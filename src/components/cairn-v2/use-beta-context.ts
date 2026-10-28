"use client";
import { domainQueryContext } from "@/lib/cairn-v2/read-service";
import { useBetaReadFreshness } from "./beta-provider";
import { useEffect, useMemo, useCallback, useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { betaReadHref, betaHref, normalizeBetaQuery, normalizeBetaContext, type BetaContext } from "@/lib/cairn-v2/navigation";

// The URL owns the fixture context. Layout preferences stay mounted independently.
export function useBetaContext(initialContext: BetaContext) {
  const router = useRouter();
  const freshness = useBetaReadFreshness();
  const pathname = usePathname() as "/beta" | "/beta/history" | "/beta/portfolio/structure" | "/beta/analysis" | "/beta/simulation";
  const search = useSearchParams();
  const query = search?.toString();
  const context = useMemo(() => query === undefined ? initialContext : new URLSearchParams(query).has("mode") ? domainQueryContext(query) : normalizeBetaQuery(query), [query, initialContext]);
  const [optimisticContext, selectPendingContext] = useOptimistic(context, (_previous: BetaContext, next: BetaContext) => next);
  const [, startTransition] = useTransition();
  const href = betaHref(pathname, context);
  useEffect(() => {
    if (context.mode !== "domain" && query !== undefined && `${pathname}?${query}` !== href) router.replace(href, { scroll: false });
  }, [context.mode, href, pathname, query, router]);
  const setContext = useCallback((requested: BetaContext) => {
    const next=requested.scope!==context.scope?{...requested,excludeSell:undefined}:requested;
    startTransition(() => {
      if (next.mode === "domain") selectPendingContext(next);
      const destination = betaHref(pathname, next.mode === "domain" ? next : normalizeBetaContext(next));
      const pendingEpoch = next.mode === "domain" ? freshness?.store.pendingEpoch() : null;
      router.push(betaReadHref(destination, pendingEpoch), { scroll: false });
    });
  }, [pathname, router, selectPendingContext, freshness, context.scope]);
  return [optimisticContext, setContext] as const;
}
