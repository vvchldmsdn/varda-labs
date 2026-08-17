import type { PortfolioAnalysisScope } from "./portfolio-analysis-scope.ts";

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
  averageCost: string | null;
  currentPrice: string;
  priceSource: string | null;
  priceAsOf: Date | null;
  priceStatus: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}>;

export type TenantHoldingDto = Readonly<{
  holdingId: string;
  accountCode: string;
  accountName: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
  quantity: string;
  averageCost: string | null;
  currentPrice: string;
  priceSource: string | null;
  priceAsOf: string | null;
  priceStatus: string | null;
  archivedAt: string | null;
  updatedAt: string;
}>;

export type TenantHoldingReadResult =
  | Readonly<{
      state: "ready" | "partial";
      holdings: readonly TenantHoldingDto[];
      excludedHoldingCount: number;
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "invalid_account_relation"
        | "invalid_account_code"
        | "account_scope_mismatch"
        | "duplicate_asset_row";
    }>;

export function projectTenantHoldingRows(
  rows: readonly TenantHoldingReadRow[],
  scope: PortfolioAnalysisScope,
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
    if (!isCanonicalText(row.accountCode) || row.accountCode.includes(":")) {
      return integrityError("invalid_account_code");
    }
    if (scope.kind === "account" && row.ownedAccountId !== scope.accountId) {
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
      !isOptionalCanonicalText(row.priceStatus) ||
      (row.averageCost !== null &&
        !isCanonicalNonnegativeDecimal(row.averageCost))
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
      (row.priceAsOf !== null &&
        (!(row.priceAsOf instanceof Date) ||
          !Number.isFinite(row.priceAsOf.getTime()))) ||
      (row.archivedAt !== null &&
        (!(row.archivedAt instanceof Date) ||
          !Number.isFinite(row.archivedAt.getTime()))) ||
      !(row.updatedAt instanceof Date) ||
      !Number.isFinite(row.updatedAt.getTime())
    ) {
      excludedHoldingCount += 1;
      continue;
    }

    seenAssetIds.add(row.assetId);
    holdings.push(
      Object.freeze({
        holdingId: row.assetId,
        accountCode: row.accountCode,
        accountName: row.accountName,
        accountSortOrder: row.accountSortOrder,
        name: row.name,
        ticker: row.ticker,
        assetType: row.assetType,
        market: row.market,
        currency: row.currency,
        quantity: row.quantity,
        averageCost: row.averageCost,
        currentPrice: row.currentPrice,
        priceSource: row.priceSource,
        priceAsOf: row.priceAsOf?.toISOString() ?? null,
        priceStatus: row.priceStatus,
        archivedAt: row.archivedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
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
    state: excludedHoldingCount === 0 ? "ready" : "partial",
    holdings: Object.freeze(holdings.map(toPublicHolding)),
    excludedHoldingCount,
  });
}

function toPublicHolding(
  holding: TenantHoldingDto & Readonly<{ accountSortOrder: number }>,
): TenantHoldingDto {
  return Object.freeze({
    holdingId: holding.holdingId,
    accountCode: holding.accountCode,
    accountName: holding.accountName,
    name: holding.name,
    ticker: holding.ticker,
    assetType: holding.assetType,
    market: holding.market,
    currency: holding.currency,
    quantity: holding.quantity,
    averageCost: holding.averageCost,
    currentPrice: holding.currentPrice,
    priceSource: holding.priceSource,
    priceAsOf: holding.priceAsOf,
    priceStatus: holding.priceStatus,
    archivedAt: holding.archivedAt,
    updatedAt: holding.updatedAt,
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
