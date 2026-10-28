export type BetaCurrency = "KRW" | "USD";
export type FixtureScope = "all" | "fixture-account-a" | "fixture-long-term";
export type FixtureCase = "standard" | "empty" | "partial" | "large";
export type BetaContext = { currency: BetaCurrency; scope: string; fixture: FixtureCase; mode?: "domain"; cashAmountKrw?: string | string[]; excludeSell?: string | string[]; analysis?: string | string[]; window?: string | string[]; horizon?: string | string[]; end?: string | string[]; run?: string | string[] };
const originalPaths = new Set(["/", "/history", "/today", "/portfolio/structure", "/portfolio/targets",
  "/portfolio/risk", "/etfs", "/market", "/additional-contribution", "/simulation", "/investment-lab",
  "/plans", "/portfolio/ledger", "/portfolio/onboarding", "/portfolio/accounts", "/portfolio/holdings", "/portfolio/holdings/new", "/portfolio/groups", "/portfolio/events",
  "/portfolio/portfolio-snapshots", "/portfolio/position-snapshots", "/auth/session"]);

export function normalizeBetaContext(params: Record<string, string | string[] | undefined>): BetaContext {
  return {
    currency: params.currency === "USD" ? "USD" : "KRW",
    scope: params.scope === "fixture-account-a" || params.scope === "fixture-long-term" ? params.scope : "all",
    fixture: params.fixture === "empty" || params.fixture === "partial" || params.fixture === "large" ? params.fixture : "standard",
  };
}

export function normalizeBetaQuery(query: string): BetaContext {
  const search = new URLSearchParams(query);
  const params: Record<string, string | string[] | undefined> = {};
  for (const key of ["currency", "scope", "fixture"]) {
    const values = search.getAll(key);
    params[key] = values.length === 1 ? values[0] : values.length ? values : undefined;
  }
  return normalizeBetaContext(params);
}

// The fixture catalog has no authority over real account/group UUIDs.
// Only 'all' is transferable; original pages still perform owner admission.
export function originalHref(path: string, context: Pick<BetaContext, "currency" | "scope" | "mode" | "cashAmountKrw" | "excludeSell" | "window" | "horizon" | "end">) {
  if (!originalPaths.has(path)) throw new Error("Unknown original destination");
  const query = new URLSearchParams({ scope: context.mode === "domain" ? context.scope : "all", currency: context.currency === "USD" ? "USD" : "KRW" });
  if (path === "/simulation" && context.mode === "domain") for (const key of ["horizon", "end"] as const) { const raw=context[key]; if(raw !== undefined) for(const value of Array.isArray(raw)?raw:[raw]) query.append(key,value); }
  if (path === "/portfolio/risk" && typeof context.window === "string" && ["30","90","252"].includes(context.window)) query.set("window", context.window);
  if (path === "/additional-contribution" && context.mode === "domain" && typeof context.cashAmountKrw === "string" && /^[1-9][0-9]*$/.test(context.cashAmountKrw) && Number(context.cashAmountKrw) <= 100_000_000_000) query.set("amount", context.cashAmountKrw);
  if(path==="/additional-contribution"&&context.mode==="domain"&&context.currency==="KRW"&&context.excludeSell!==undefined)for(const key of Array.isArray(context.excludeSell)?context.excludeSell:[context.excludeSell])query.append("excludeSell",key);
  return `${path}?${query}`;
}

export function betaHref(path: "/beta/portfolio/targets" | "/beta" | "/beta/history" | "/beta/portfolio/structure" | "/beta/analysis" | "/beta/simulation", context: BetaContext) {
  const query = new URLSearchParams(context.mode === "domain" ? {mode: "domain", scope: context.scope, currency: context.currency} : {scope: context.scope, currency: context.currency, fixture: context.fixture});
  if (context.mode === "domain" && context.cashAmountKrw !== undefined) {
    for (const value of Array.isArray(context.cashAmountKrw) ? context.cashAmountKrw : [context.cashAmountKrw]) query.append("cashAmountKrw", value);
  }
  if (context.mode === "domain" && context.excludeSell!==undefined) for(const key of Array.isArray(context.excludeSell)?context.excludeSell:[context.excludeSell])query.append("excludeSell",key);
  if (context.mode === "domain") for (const key of ["analysis", "window"] as const) { const raw=context[key]; if(raw !== undefined) for(const value of Array.isArray(raw)?raw:[raw]) query.append(key,value); }
  if (context.mode === "domain" && path === "/beta/simulation") for (const key of ["horizon", "end", "run"] as const) { const raw=context[key]; if(raw !== undefined) for(const value of Array.isArray(raw)?raw:[raw]) query.append(key,value); }
  return `${path}?${query}`;
}

// Internal continuations carry freshness in search, independently of the fragment.
// This marker never supplies session or ownership authority.
export function betaReadHref(href: string, epoch?: string | null) {
  const url = new URL(href, "https://beta.invalid");
  if (!href.startsWith("/beta") || url.origin !== "https://beta.invalid" || !["/beta", "/beta/history", "/beta/portfolio/structure", "/beta/analysis", "/beta/simulation", "/beta/history/events", "/beta/history/snapshots", "/beta/history/position-snapshots", "/beta/etfs", "/beta/investment-lab", "/beta/portfolio/holdings", "/beta/portfolio/accounts", "/beta/portfolio/accounts/manage", "/beta/portfolio/holdings/manage", "/beta/portfolio/groups", "/beta/portfolio/holdings/new", "/beta/portfolio/targets", "/beta/portfolio/ledger", "/beta/plans"].includes(url.pathname)) throw new Error("Unknown beta destination");
  if (epoch && url.searchParams.get("mode") === "domain") url.searchParams.set("_betaRead", epoch);
  return url.pathname + url.search + url.hash;
}

export const purposeDestinations = [
  { label: "홈", icon: "75-319-f7a36.svg", beta: "/beta", original: "/" },
  { label: "자산", icon: "75-319-75146.svg", beta: "/beta/portfolio/structure", original: "/portfolio/holdings" },
  { label: "분석", icon: "75-319-ca38b.svg", beta: "/beta/analysis", original: "/portfolio/risk" },
  { label: "계획", icon: "75-319-47bce.svg", beta: "/beta", hash: "#beta-contribution", original: "/additional-contribution" },
  { label: "기록", icon: "75-319-ee2bf.svg", beta: "/beta/history", original: "/portfolio/events" },
] as const;
