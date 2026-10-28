export const PORTFOLIO_ANALYSIS_SCOPE_POLICY = Object.freeze({
  version: "portfolio_analysis_scope_v1",
  canonicalQueryParameter: "scope",
  legacyQueryParameter: "account",
  allScopeKey: "all",
  accountScopePrefix: "account:",
  portfolioGroupScopePrefix: "portfolio:",
  catalogAuthority: "owner_scoped_active_rows",
  unknownScopeBehavior: "blocked_without_fallback",
} as const);

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PortfolioAnalysisScopeKey =
  | "all"
  | `account:${string}`
  | `portfolio:${string}`;

export type PortfolioAnalysisScope =
  | Readonly<{
      kind: "all";
      key: "all";
      label: string;
    }>
  | Readonly<{
      kind: "account";
      key: `account:${string}`;
      label: string;
      accountId: string;
      accountCode: string;
    }>
  | Readonly<{
      kind: "portfolio_group";
      key: `portfolio:${string}`;
      label: string;
      portfolioGroupId: string;
    }>;

export type PortfolioAnalysisAccountCandidate = Readonly<{
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}>;

export type PortfolioAnalysisGroupCandidate = Readonly<{
  id: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}>;

export type PortfolioAnalysisScopeCatalog = Readonly<{
  state: "ready";
  scopes: readonly PortfolioAnalysisScope[];
}>;

export type PortfolioAnalysisScopeCatalogError = Readonly<{
  state: "integrity_error";
  reason:
    | "invalid_account_candidate"
    | "invalid_portfolio_group_candidate"
    | "duplicate_account_id"
    | "duplicate_account_code"
    | "duplicate_portfolio_group_id";
}>;

export type PortfolioAnalysisScopeCatalogResult =
  | PortfolioAnalysisScopeCatalog
  | PortfolioAnalysisScopeCatalogError;

export type PortfolioAnalysisScopeResolution =
  | Readonly<{
      state: "resolved";
      source: "canonical" | "default_all" | "legacy_compatibility";
      scope: PortfolioAnalysisScope;
    }>
  | Readonly<{
      state: "blocked";
      reason:
        | PortfolioAnalysisScopeCatalogError["reason"]
        | "conflicting_scope_parameters"
        | "multiple_scope_values"
        | "multiple_legacy_account_values"
        | "invalid_scope_format"
        | "scope_not_found"
        | "legacy_account_not_found";
    }>;

export type PortfolioAnalysisScopeQuery = Readonly<
  Record<string, string | readonly string[] | null | undefined>
>;

export function buildPortfolioAnalysisScopeCatalog({
  accounts,
  allLabel = "전체",
  portfolioGroups,
}: {
  accounts: readonly PortfolioAnalysisAccountCandidate[];
  allLabel?: string;
  portfolioGroups: readonly PortfolioAnalysisGroupCandidate[];
}): PortfolioAnalysisScopeCatalogResult {
  const accountIds = new Set<string>();
  const accountCodes = new Set<string>();
  const groupIds = new Set<string>();

  for (const account of accounts) {
    if (!isValidAccountCandidate(account)) {
      return Object.freeze({
        state: "integrity_error",
        reason: "invalid_account_candidate",
      });
    }
    if (accountIds.has(account.id)) {
      return Object.freeze({
        state: "integrity_error",
        reason: "duplicate_account_id",
      });
    }
    const comparableCode = account.code.toLowerCase();
    if (accountCodes.has(comparableCode)) {
      return Object.freeze({
        state: "integrity_error",
        reason: "duplicate_account_code",
      });
    }
    accountIds.add(account.id);
    accountCodes.add(comparableCode);
  }

  for (const group of portfolioGroups) {
    if (!isValidPortfolioGroupCandidate(group)) {
      return Object.freeze({
        state: "integrity_error",
        reason: "invalid_portfolio_group_candidate",
      });
    }
    if (groupIds.has(group.id)) {
      return Object.freeze({
        state: "integrity_error",
        reason: "duplicate_portfolio_group_id",
      });
    }
    groupIds.add(group.id);
  }

  const scopes: PortfolioAnalysisScope[] = [
    Object.freeze({ kind: "all", key: "all", label: allLabel }),
    ...portfolioGroups
      .filter((group) => group.isActive)
      .toSorted(compareScopeCandidates)
      .map((group) =>
        Object.freeze({
          kind: "portfolio_group" as const,
          key: `portfolio:${group.id}` as const,
          label: group.name,
          portfolioGroupId: group.id,
        }),
      ),
    ...accounts
      .filter((account) => account.isActive)
      .toSorted(compareScopeCandidates)
      .map((account) =>
        Object.freeze({
          kind: "account" as const,
          key: `account:${account.id}` as const,
          label: account.name,
          accountId: account.id,
          accountCode: account.code,
        }),
      ),
  ];

  return Object.freeze({
    state: "ready",
    scopes: Object.freeze(scopes),
  });
}

export function resolvePortfolioAnalysisScope({
  account: legacyAccount,
  catalog,
  scope,
}: {
  account?: string | readonly string[] | null;
  catalog: PortfolioAnalysisScopeCatalogResult;
  scope?: string | readonly string[] | null;
}): PortfolioAnalysisScopeResolution {
  if (catalog.state === "integrity_error") {
    return Object.freeze({
      state: "blocked",
      reason: catalog.reason,
    });
  }

  const canonicalValue = parseSingleQueryValue(scope);
  if (canonicalValue.state === "multiple") {
    return Object.freeze({
      state: "blocked",
      reason: "multiple_scope_values",
    });
  }
  const legacyValue = parseSingleQueryValue(legacyAccount);
  if (legacyValue.state === "multiple") {
    return Object.freeze({
      state: "blocked",
      reason: "multiple_legacy_account_values",
    });
  }
  if (canonicalValue.value !== null && legacyValue.value !== null) {
    return Object.freeze({
      state: "blocked",
      reason: "conflicting_scope_parameters",
    });
  }

  if (canonicalValue.value !== null) {
    return resolveCanonicalScope(canonicalValue.value, catalog.scopes);
  }
  if (legacyValue.value !== null) {
    return resolveLegacyAccountScope(legacyValue.value, catalog.scopes);
  }

  return Object.freeze({
    state: "resolved",
    source: "default_all",
    scope: catalog.scopes[0],
  });
}

export function buildPortfolioAnalysisScopeHref(
  basePath: string,
  scope: PortfolioAnalysisScopeKey,
  query: PortfolioAnalysisScopeQuery = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (
      key === PORTFOLIO_ANALYSIS_SCOPE_POLICY.canonicalQueryParameter ||
      key === PORTFOLIO_ANALYSIS_SCOPE_POLICY.legacyQueryParameter ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) params.append(key, item);
  }
  params.set(PORTFOLIO_ANALYSIS_SCOPE_POLICY.canonicalQueryParameter, scope);
  return `${basePath}?${params.toString()}`;
}

function resolveCanonicalScope(
  value: string,
  scopes: readonly PortfolioAnalysisScope[],
): PortfolioAnalysisScopeResolution {
  if (value === "all") {
    return Object.freeze({
      state: "resolved",
      source: "canonical",
      scope: scopes[0],
    });
  }
  if (!isCanonicalScopeKey(value)) {
    return Object.freeze({
      state: "blocked",
      reason: "invalid_scope_format",
    });
  }

  const matchingScope = scopes.find((candidate) => candidate.key === value);
  if (matchingScope) {
    return Object.freeze({
      state: "resolved",
      source: "canonical",
      scope: matchingScope,
    });
  }

  return Object.freeze({
    state: "blocked",
    reason: "scope_not_found",
  });
}

function resolveLegacyAccountScope(
  value: string,
  scopes: readonly PortfolioAnalysisScope[],
): PortfolioAnalysisScopeResolution {
  const normalized = value.toLowerCase();
  if (normalized === "all") {
    return Object.freeze({
      state: "resolved",
      source: "legacy_compatibility",
      scope: scopes[0],
    });
  }

  const matchingScope = scopes.find(
    (candidate) =>
      candidate.kind === "account" &&
      candidate.accountCode.toLowerCase() === normalized,
  );
  if (!matchingScope) {
    return Object.freeze({
      state: "blocked",
      reason: "legacy_account_not_found",
    });
  }

  return Object.freeze({
    state: "resolved",
    source: "legacy_compatibility",
    scope: matchingScope,
  });
}

function parseSingleQueryValue(
  value: string | readonly string[] | null | undefined,
): Readonly<
  | { state: "single"; value: string | null }
  | { state: "multiple"; value: null }
> {
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return Object.freeze({ state: "multiple", value: null });
    }
    return parseSingleQueryValue(value[0]);
  }
  if (typeof value !== "string") {
    return Object.freeze({ state: "single", value: null });
  }
  const normalized = value.trim();
  return Object.freeze({
    state: "single",
    value: normalized.length > 0 ? normalized : null,
  });
}

function isCanonicalScopeKey(value: string): value is PortfolioAnalysisScopeKey {
  const separator = value.indexOf(":");
  if (separator < 1 || value.indexOf(":", separator + 1) !== -1) return false;
  const prefix = value.slice(0, separator);
  const id = value.slice(separator + 1);
  return (
    (prefix === "account" || prefix === "portfolio") &&
    CANONICAL_UUID_PATTERN.test(id)
  );
}

function isValidAccountCandidate(
  candidate: PortfolioAnalysisAccountCandidate,
) {
  return (
    CANONICAL_UUID_PATTERN.test(candidate.id) &&
    isCanonicalText(candidate.code) &&
    !candidate.code.includes(":") &&
    isCanonicalText(candidate.name) &&
    typeof candidate.isActive === "boolean" &&
    Number.isSafeInteger(candidate.sortOrder)
  );
}

function isValidPortfolioGroupCandidate(
  candidate: PortfolioAnalysisGroupCandidate,
) {
  return (
    CANONICAL_UUID_PATTERN.test(candidate.id) &&
    isCanonicalText(candidate.name) &&
    typeof candidate.isActive === "boolean" &&
    Number.isSafeInteger(candidate.sortOrder)
  );
}

function isCanonicalText(value: string) {
  return value.length > 0 && value === value.trim();
}

function compareScopeCandidates(
  left: Readonly<{ name: string; sortOrder: number }>,
  right: Readonly<{ name: string; sortOrder: number }>,
) {
  if (left.sortOrder !== right.sortOrder) {
    return left.sortOrder - right.sortOrder;
  }
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}
