export const NAMED_PORTFOLIO_ACCOUNTS = Object.freeze([
  "brokerage",
  "isa",
  "irp",
] as const);

export const PORTFOLIO_ACCOUNT_SCOPES = Object.freeze([
  ...NAMED_PORTFOLIO_ACCOUNTS,
  "all",
] as const);

export type NamedPortfolioAccount =
  (typeof NAMED_PORTFOLIO_ACCOUNTS)[number];
export type PortfolioAccountScope =
  (typeof PORTFOLIO_ACCOUNT_SCOPES)[number];

export type PortfolioAccountScopeQuery = Readonly<
  Record<string, string | readonly string[] | null | undefined>
>;

export function normalizePortfolioAccountScope(
  value: string | readonly string[] | null | undefined,
  fallback: PortfolioAccountScope = "all",
): PortfolioAccountScope {
  const raw = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value;
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return isPortfolioAccountScope(normalized) ? normalized : fallback;
}

export function isPortfolioAccountScope(
  value: string,
): value is PortfolioAccountScope {
  return PORTFOLIO_ACCOUNT_SCOPES.some((account) => account === value);
}

export function isNamedPortfolioAccount(
  value: string,
): value is NamedPortfolioAccount {
  return NAMED_PORTFOLIO_ACCOUNTS.some((account) => account === value);
}

export function accountsForPortfolioScope(
  scope: PortfolioAccountScope,
): readonly NamedPortfolioAccount[] {
  return scope === "all" ? NAMED_PORTFOLIO_ACCOUNTS : Object.freeze([scope]);
}

export function buildPortfolioAccountScopeHref(
  basePath: string,
  account: PortfolioAccountScope,
  query: PortfolioAccountScopeQuery = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "account" || value === null || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) params.append(key, item);
  }
  params.set("account", account);
  return `${basePath}?${params.toString()}`;
}
