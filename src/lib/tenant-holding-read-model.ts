import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type TenantHoldingReadRow = Readonly<{
  assetId: string;
  assetAccountId: string | null;
  ownedAccountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
  legacyAccountCode: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
  quantity: string;
  currentPrice: string;
  priceSource: string | null;
  priceAsOf: Date | null;
  priceStatus: string | null;
}>;

export type TenantHoldingDto = Readonly<{
  accountCode: NamedPortfolioAccount;
  accountName: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
  quantity: string;
  currentPrice: string;
  priceSource: string | null;
  priceAsOf: string | null;
  priceStatus: string | null;
}>;

export type TenantHoldingReadResult =
  | Readonly<{
      state: "ready";
      scope: PortfolioAccountScope;
      holdings: readonly TenantHoldingDto[];
      excludedHoldingCount: number;
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "invalid_account_relation"
        | "noncanonical_account_code"
        | "account_scope_mismatch"
        | "duplicate_asset_row";
    }>;

export function projectTenantHoldingRows(
  rows: readonly TenantHoldingReadRow[],
  scope: PortfolioAccountScope,
): TenantHoldingReadResult {
  const seenAssetIds = new Set<string>();
  const holdings: Array<
    TenantHoldingDto & Readonly<{ accountSortOrder: number }>
  > = [];
  let excludedHoldingCount = 0;

  for (const row of rows) {
    if (
      !isCanonicalText(row.assetId) ||
      row.assetAccountId === null ||
      row.assetAccountId !== row.ownedAccountId ||
      row.legacyAccountCode !== row.accountCode
    ) {
      return integrityError("invalid_account_relation");
    }
    if (
      !isNamedPortfolioAccount(row.accountCode) ||
      row.accountCode.trim().toLowerCase() !== row.accountCode
    ) {
      return integrityError("noncanonical_account_code");
    }
    if (scope !== "all" && row.accountCode !== scope) {
      return integrityError("account_scope_mismatch");
    }
    if (seenAssetIds.has(row.assetId)) {
      return integrityError("duplicate_asset_row");
    }
    if (
      !isCanonicalText(row.accountName) ||
      !isCanonicalText(row.name) ||
      !isOptionalCanonicalText(row.ticker) ||
      !isOptionalCanonicalText(row.assetType) ||
      !isCanonicalLowercaseText(row.market) ||
      !isCanonicalUppercaseText(row.currency) ||
      !isOptionalCanonicalText(row.priceSource) ||
      !isOptionalCanonicalText(row.priceStatus)
    ) {
      excludedHoldingCount += 1;
      continue;
    }
    if (
      !isCanonicalNonnegativeDecimal(row.quantity) ||
      !isCanonicalNonnegativeDecimal(row.currentPrice)
    ) {
      excludedHoldingCount += 1;
      continue;
    }
    if (
      row.priceAsOf !== null &&
      (!(row.priceAsOf instanceof Date) ||
        !Number.isFinite(row.priceAsOf.getTime()))
    ) {
      excludedHoldingCount += 1;
      continue;
    }

    seenAssetIds.add(row.assetId);
    holdings.push(
      Object.freeze({
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountSortOrder: row.accountSortOrder,
        name: row.name,
        ticker: row.ticker,
        assetType: row.assetType,
        market: row.market,
        currency: row.currency,
        quantity: row.quantity,
        currentPrice: row.currentPrice,
        priceSource: row.priceSource,
        priceAsOf: row.priceAsOf?.toISOString() ?? null,
        priceStatus: row.priceStatus,
      }),
    );
  }

  holdings.sort(
    (left, right) =>
      left.accountSortOrder - right.accountSortOrder ||
      left.accountCode.localeCompare(right.accountCode) ||
      left.name.localeCompare(right.name) ||
      (left.ticker ?? "").localeCompare(right.ticker ?? ""),
  );

  return Object.freeze({
    state: "ready",
    scope,
    holdings: Object.freeze(holdings.map(toPublicHolding)),
    excludedHoldingCount,
  });
}

function toPublicHolding(
  holding: TenantHoldingDto & Readonly<{ accountSortOrder: number }>,
): TenantHoldingDto {
  return Object.freeze({
    accountCode: holding.accountCode,
    accountName: holding.accountName,
    name: holding.name,
    ticker: holding.ticker,
    assetType: holding.assetType,
    market: holding.market,
    currency: holding.currency,
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    priceSource: holding.priceSource,
    priceAsOf: holding.priceAsOf,
    priceStatus: holding.priceStatus,
  });
}

function isCanonicalText(value: string) {
  return value.length > 0 && value.trim() === value;
}

function isOptionalCanonicalText(value: string | null) {
  return value === null || isCanonicalText(value);
}

function isCanonicalLowercaseText(value: string) {
  return isCanonicalText(value) && value.toLowerCase() === value;
}

function isCanonicalUppercaseText(value: string) {
  return isCanonicalText(value) && value.toUpperCase() === value;
}

function isCanonicalNonnegativeDecimal(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function integrityError(
  reason: Extract<
    TenantHoldingReadResult,
    { state: "integrity_error" }
  >["reason"],
): TenantHoldingReadResult {
  return Object.freeze({ state: "integrity_error", reason });
}
