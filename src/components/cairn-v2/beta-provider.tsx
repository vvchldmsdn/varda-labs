"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createBetaReadFreshness } from "@/lib/cairn-v2/read-freshness";

type Preferences = {
  metric: "value" | "return"; setMetric: (value: "value" | "return") => void;
  period: "1M" | "3M" | "6M" | "ALL"; setPeriod: (value: "1M" | "3M" | "6M" | "ALL") => void;
  selected: string; setSelected: (value: string) => void;
  structureView: "ring" | "map"; setStructureView: (value: "ring" | "map") => void;
  reduceEffects: boolean; setReduceEffects: (value: boolean) => void;
  historyDate: string | null; setHistoryDate: (value: string | null) => void;
};
const BetaPreferences = createContext<Preferences | null>(null);
const BetaExistingCrud = createContext(false);
export function useBetaExistingCrudAvailable() { return useContext(BetaExistingCrud); }
type ReadFreshness = { epoch: number; store: ReturnType<typeof createBetaReadFreshness>; observed: (receipt?: string, readEpoch?: string, displayBinding?: string) => void };
const BetaReadFreshness = createContext<ReadFreshness | null>(null);
const domainRoots = () => document.querySelectorAll<HTMLElement>('[data-beta-root][data-read-mode="domain"]');
function maskDomainRoots(masked: boolean) {
  const roots = masked ? domainRoots() : document.querySelectorAll<HTMLElement>("[data-beta-freshness-mask]");
  roots.forEach(root => {
    if (masked) { root.dataset.betaFreshnessMask = "true"; root.style.visibility = "hidden"; }
    else { delete root.dataset.betaFreshnessMask; root.style.removeProperty("visibility"); }
  });
}
export function useBetaReadFreshness() { return useContext(BetaReadFreshness); }
export function BetaProvider({ children, existingCrudAvailable = false }: { children: ReactNode; existingCrudAvailable?: boolean }) {
  const router = useRouter();
  const [store] = useState(createBetaReadFreshness);
  const [epoch, setEpoch] = useState(0);
  const accessPending = useRef(false);
  const committedRead = useRef<string | undefined>(undefined);
  const committedBinding = useRef<string | undefined>(undefined);
  const observed = useCallback((receipt?: string, readEpoch?: string, displayBinding?: string) => {
    committedRead.current = receipt ? `${receipt}:${readEpoch ?? ""}` : undefined;
    committedBinding.current = displayBinding;
    if (store.accept(receipt, readEpoch)) setEpoch(value => value + 1);
    else store.observe(receipt);
    // Called after the new/blank view committed, never before a cached financial view is masked.
    // A late RSC response cannot reopen a financial view while the independent
    // session check is still pending (or while the tab is suspended).
    maskDomainRoots(accessPending.current);
  }, [store]);
  useEffect(() => {
    let suspended = false;
    let checkGeneration = 0;
    let refreshTimer: number | undefined;
    const recheck = () => {
      checkGeneration++;
      accessPending.current = false;
      if (!domainRoots().length) return;
      maskDomainRoots(true);
      const readEpoch = crypto.randomUUID();
      store.begin(readEpoch);
      setEpoch(value => value + 1);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      // Let Next finish its popstate restoration before replacing that restored URL with a fresh read request.
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        const url = new URL(window.location.href);
        if (!(url.pathname === "/beta" || url.pathname.startsWith("/beta/")) || !url.searchParams.has("mode")) return;
        url.searchParams.set("_betaRead", readEpoch);
        // This echo is only a freshness marker. The server still resolves the real session and owned scope.
        router.replace(url.pathname + url.search + url.hash, { scroll: false });
      }, 0);
    };
    const resume = async () => {
      const displayBinding = committedBinding.current;
      if (!displayBinding) { recheck(); return; }
      const generation = ++checkGeneration;
      const href = window.location.href;
      const roots = [...domainRoots()];
      const read = committedRead.current;
      try {
        const response = await fetch("/api/portfolio/read-session", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000) });
        const result = response.ok ? await response.json() : null;
        if (generation !== checkGeneration || document.visibilityState !== "visible" || window.location.href !== href || roots.some(root => !root.isConnected) || roots.length !== domainRoots().length) return;
        if (read !== committedRead.current || displayBinding !== committedBinding.current) { recheck(); return; }
        if (result?.binding === displayBinding) { accessPending.current = false; maskDomainRoots(false); }
        // Reload all server layouts after an ownership/role change. The marker
        // belongs to the committed financial read, never to a cached layout.
        else if (response.ok) window.location.reload();
        else recheck();
      } catch {
        if (generation === checkGeneration && document.visibilityState === "visible" && window.location.href === href) recheck();
      }
    };
    const suspend = () => { checkGeneration++; if (domainRoots().length) { suspended = true; accessPending.current = true; maskDomainRoots(true); } };
    const visible = () => { if (document.visibilityState === "hidden") suspend(); else if (suspended) { suspended = false; void resume(); } };
    const focus = () => { if (suspended && document.visibilityState === "visible") { suspended = false; void resume(); } };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { suspended = false; recheck(); } };
    // Capture before the router restores a cached page. Keep preferences mounted; only read data is withheld.
    window.addEventListener("popstate", recheck, true);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", restored);
    window.addEventListener("blur", suspend);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      checkGeneration++;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.removeEventListener("popstate", recheck, true);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", restored);
      window.removeEventListener("blur", suspend);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
      maskDomainRoots(false);
    };
  }, [router, store]);
  const [metric, setMetric] = useState<"value" | "return">("value");
  const [period, setPeriod] = useState<"1M" | "3M" | "6M" | "ALL">("3M");
  const [selected, setSelected] = useState("VOO");
  const [structureView, setStructureView] = useState<"ring" | "map">("ring");
  const [reduceEffects, setReduceEffects] = useState(false);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  return <BetaExistingCrud.Provider value={existingCrudAvailable}><BetaReadFreshness.Provider value={{epoch,store,observed}}><BetaPreferences.Provider value={{ metric, setMetric, period, setPeriod, selected, setSelected, structureView, setStructureView, reduceEffects, setReduceEffects, historyDate, setHistoryDate }}>{children}</BetaPreferences.Provider></BetaReadFreshness.Provider></BetaExistingCrud.Provider>;
}
export function useBetaPreferences() {
  const value = useContext(BetaPreferences);
  if (!value) throw new Error("Beta preferences require the dedicated beta layout");
  return value;
}
