import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type TenantAccountReadRow = Readonly<{
  code: string;
  name: string;
  accountType: string;
  currency: string;
  sortOrder: number;
}>;

export type TenantAccountDto = Readonly<{
  code: NamedPortfolioAccount;
  name: string;
  accountType: string;
  currency: string;
}>;

export type TenantAccountReadResult =
  | Readonly<{
      state: "ready";
      scope: PortfolioAccountScope;
      accounts: readonly TenantAccountDto[];
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "noncanonical_account_code"
        | "duplicate_account_code"
        | "invalid_account_metadata";
    }>;

export function projectTenantAccountRows(
  rows: readonly TenantAccountReadRow[],
  scope: PortfolioAccountScope,
): TenantAccountReadResult {
  const seen = new Set<NamedPortfolioAccount>();
  const sortOrderByCode = new Map<NamedPortfolioAccount, number>();
  const accounts: TenantAccountDto[] = [];

  for (const row of rows) {
    if (
      !isNamedPortfolioAccount(row.code) ||
      row.code.trim().toLowerCase() !== row.code
    ) {
      return integrityError("noncanonical_account_code");
    }
    if (seen.has(row.code)) {
      return integrityError("duplicate_account_code");
    }
    if (
      !isCanonicalText(row.name) ||
      !isCanonicalText(row.accountType) ||
      !isCanonicalText(row.currency)
    ) {
      return integrityError("invalid_account_metadata");
    }

    seen.add(row.code);
    sortOrderByCode.set(row.code, row.sortOrder);
    if (scope === "all" || row.code === scope) {
      accounts.push(
        Object.freeze({
          code: row.code,
          name: row.name,
          accountType: row.accountType,
          currency: row.currency,
        }),
      );
    }
  }

  accounts.sort(
    (left, right) =>
      (sortOrderByCode.get(left.code) ?? 0) -
        (sortOrderByCode.get(right.code) ?? 0) ||
      left.code.localeCompare(right.code),
  );

  return Object.freeze({
    state: "ready",
    scope,
    accounts: Object.freeze(accounts),
  });
}

function isCanonicalText(value: string) {
  return value.length > 0 && value.trim() === value;
}

function integrityError(
  reason: Extract<
    TenantAccountReadResult,
    { state: "integrity_error" }
  >["reason"],
): TenantAccountReadResult {
  return Object.freeze({ state: "integrity_error", reason });
}
