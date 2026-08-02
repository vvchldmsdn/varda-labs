import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type TenantPositionSnapshotAccountRow = Readonly<{
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
}>;

export type TenantPositionSnapshotReadRow = Readonly<{
  snapshotDate: string;
  source: string;
  isSample: boolean;
  assetId: string | null;
  legacyAssetId: string;
  snapshotAccountId: string | null;
  ownedAccountId: string;
  accountCode: string;
  accountName: string;
  accountSortOrder: number;
  legacyAccountCode: string;
  assetName: string;
  ticker: string | null;
  assetType: string | null;
  market: string | null;
  currency: string | null;
  quantity: string | null;
  currentPrice: string | null;
  closePrice: string | null;
  marketValueKrw: string | null;
  currentWeight: string | null;
  targetWeight: string | null;
  belowMa: boolean;
  priceSource: string | null;
  priceBasis: string | null;
}>;

export type TenantPositionSnapshotDto = Readonly<{
  accountCode: NamedPortfolioAccount;
  accountName: string;
  assetName: string;
  ticker: string | null;
  assetType: string | null;
  market: string | null;
  currency: string | null;
  quantity: string | null;
  storedPrice: string | null;
  storedPriceKind: "current_price" | "close_price" | null;
  marketValueKrw: string | null;
  currentWeight: string | null;
  targetWeight: string | null;
  belowMa: boolean;
  priceSource: string | null;
  priceBasis: string | null;
  assetLinkStatus: "linked" | "historical_only";
}>;

export type TenantPositionSnapshotReadResult =
  | Readonly<{
      state: "ready" | "partial";
      scope: PortfolioAccountScope;
      snapshotDate: string;
      source: string;
      expectedAccounts: readonly NamedPortfolioAccount[];
      coveredAccounts: readonly NamedPortfolioAccount[];
      missingAccounts: readonly NamedPortfolioAccount[];
      positions: readonly TenantPositionSnapshotDto[];
      excludedPositionCount: number;
      linkedPositionCount: number;
      historicalOnlyPositionCount: number;
    }>
  | Readonly<{
      state: "no_data";
      scope: PortfolioAccountScope;
      snapshotDate: string | null;
      expectedAccounts: readonly NamedPortfolioAccount[];
    }>
  | Readonly<{
      state: "integrity_error";
      reason:
        | "invalid_account_metadata"
        | "duplicate_account_relation"
        | "account_scope_mismatch"
        | "invalid_account_relation"
        | "snapshot_date_mismatch"
        | "mixed_snapshot_sources"
        | "sample_row_admitted"
        | "duplicate_position_row";
    }>;

export function parseTenantPositionSnapshotDateQuery(
  value: string | readonly string[] | null | undefined,
): string | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    return value.length === 0 ? undefined : null;
  }

  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : null;
}

export function projectTenantPositionSnapshotRows({
  accountRows,
  rows,
  scope,
  snapshotDate,
}: {
  accountRows: readonly TenantPositionSnapshotAccountRow[];
  rows: readonly TenantPositionSnapshotReadRow[];
  scope: PortfolioAccountScope;
  snapshotDate: string | null;
}): TenantPositionSnapshotReadResult {
  const accountsById = new Map<
    string,
    TenantPositionSnapshotAccountRow & {
      accountCode: NamedPortfolioAccount;
    }
  >();
  const accountIdsByCode = new Map<NamedPortfolioAccount, string>();

  for (const account of accountRows) {
    if (
      !isCanonicalText(account.accountId) ||
      !isNamedPortfolioAccount(account.accountCode) ||
      account.accountCode.trim().toLowerCase() !== account.accountCode ||
      !isCanonicalText(account.accountName) ||
      !Number.isSafeInteger(account.accountSortOrder)
    ) {
      return integrityError("invalid_account_metadata");
    }
    if (scope !== "all" && account.accountCode !== scope) {
      return integrityError("account_scope_mismatch");
    }
    if (
      accountsById.has(account.accountId) ||
      accountIdsByCode.has(account.accountCode)
    ) {
      return integrityError("duplicate_account_relation");
    }

    accountsById.set(account.accountId, {
      ...account,
      accountCode: account.accountCode,
    });
    accountIdsByCode.set(account.accountCode, account.accountId);
  }

  const expectedAccounts = Object.freeze(
    [...accountRows]
      .sort(
        (left, right) =>
          left.accountSortOrder - right.accountSortOrder ||
          left.accountCode.localeCompare(right.accountCode),
      )
      .map((account) => account.accountCode as NamedPortfolioAccount),
  );

  if (rows.length === 0) {
    return Object.freeze({
      state: "no_data",
      scope,
      snapshotDate,
      expectedAccounts,
    });
  }
  if (snapshotDate === null) {
    return integrityError("snapshot_date_mismatch");
  }

  const seenPositionKeys = new Set<string>();
  const coveredAccountSet = new Set<NamedPortfolioAccount>();
  const sources = new Set<string>();
  const positions: Array<
    TenantPositionSnapshotDto & Readonly<{ accountSortOrder: number }>
  > = [];
  let excludedPositionCount = 0;
  let linkedPositionCount = 0;
  let historicalOnlyPositionCount = 0;

  for (const row of rows) {
    const ownedAccount = accountsById.get(row.ownedAccountId);
    if (
      ownedAccount === undefined ||
      row.snapshotAccountId === null ||
      row.snapshotAccountId !== row.ownedAccountId ||
      row.accountCode !== ownedAccount.accountCode ||
      row.accountName !== ownedAccount.accountName ||
      row.accountSortOrder !== ownedAccount.accountSortOrder ||
      row.legacyAccountCode !== ownedAccount.accountCode
    ) {
      return integrityError("invalid_account_relation");
    }
    if (scope !== "all" && row.accountCode !== scope) {
      return integrityError("account_scope_mismatch");
    }
    if (row.snapshotDate !== snapshotDate) {
      return integrityError("snapshot_date_mismatch");
    }
    if (row.isSample) return integrityError("sample_row_admitted");
    if (!isCanonicalText(row.source)) {
      return integrityError("mixed_snapshot_sources");
    }

    sources.add(row.source);
    if (sources.size > 1) return integrityError("mixed_snapshot_sources");
    coveredAccountSet.add(ownedAccount.accountCode);

    const identity = positionIdentity(row);
    if (identity === null || !hasValidDisplayEvidence(row)) {
      excludedPositionCount += 1;
      continue;
    }

    const positionKey = `${ownedAccount.accountCode}:${identity}`;
    if (seenPositionKeys.has(positionKey)) {
      return integrityError("duplicate_position_row");
    }
    seenPositionKeys.add(positionKey);

    const linked = row.assetId !== null;
    if (linked) linkedPositionCount += 1;
    else historicalOnlyPositionCount += 1;

    const storedPrice = row.currentPrice ?? row.closePrice;
    positions.push(
      Object.freeze({
        accountCode: ownedAccount.accountCode,
        accountName: ownedAccount.accountName,
        accountSortOrder: ownedAccount.accountSortOrder,
        assetName: row.assetName,
        ticker: row.ticker,
        assetType: row.assetType,
        market: row.market,
        currency: row.currency,
        quantity: row.quantity,
        storedPrice,
        storedPriceKind:
          row.currentPrice !== null
            ? "current_price"
            : row.closePrice !== null
              ? "close_price"
              : null,
        marketValueKrw: row.marketValueKrw,
        currentWeight: row.currentWeight,
        targetWeight: row.targetWeight,
        belowMa: row.belowMa,
        priceSource: row.priceSource,
        priceBasis: row.priceBasis,
        assetLinkStatus: linked ? "linked" : "historical_only",
      }),
    );
  }

  positions.sort(
    (left, right) =>
      left.accountSortOrder - right.accountSortOrder ||
      left.assetName.localeCompare(right.assetName) ||
      (left.ticker ?? "").localeCompare(right.ticker ?? ""),
  );

  const coveredAccounts = Object.freeze(
    expectedAccounts.filter((account) => coveredAccountSet.has(account)),
  );
  const missingAccounts = Object.freeze(
    expectedAccounts.filter((account) => !coveredAccountSet.has(account)),
  );

  return Object.freeze({
    state:
      excludedPositionCount === 0 && missingAccounts.length === 0
        ? "ready"
        : "partial",
    scope,
    snapshotDate,
    source: [...sources][0] ?? "",
    expectedAccounts,
    coveredAccounts,
    missingAccounts,
    positions: Object.freeze(positions.map(toPublicPosition)),
    excludedPositionCount,
    linkedPositionCount,
    historicalOnlyPositionCount,
  });
}

function positionIdentity(row: TenantPositionSnapshotReadRow) {
  if (row.assetId !== null) {
    return isCanonicalText(row.assetId) ? `asset:${row.assetId}` : null;
  }
  return /^[0-9a-f]{24}$/.test(row.legacyAssetId)
    ? `historical:${row.legacyAssetId}`
    : null;
}

function hasValidDisplayEvidence(row: TenantPositionSnapshotReadRow) {
  return (
    isCanonicalText(row.assetName) &&
    isOptionalCanonicalText(row.ticker) &&
    isOptionalCanonicalText(row.assetType) &&
    isOptionalCanonicalLowercaseText(row.market) &&
    isOptionalCanonicalUppercaseText(row.currency) &&
    isOptionalNonnegativeDecimal(row.quantity) &&
    isOptionalNonnegativeDecimal(row.currentPrice) &&
    isOptionalNonnegativeDecimal(row.closePrice) &&
    isOptionalNonnegativeDecimal(row.marketValueKrw) &&
    isOptionalNonnegativeDecimal(row.currentWeight) &&
    isOptionalNonnegativeDecimal(row.targetWeight) &&
    typeof row.belowMa === "boolean" &&
    isOptionalCanonicalText(row.priceSource) &&
    isOptionalCanonicalText(row.priceBasis)
  );
}

function toPublicPosition(
  position: TenantPositionSnapshotDto &
    Readonly<{ accountSortOrder: number }>,
): TenantPositionSnapshotDto {
  return Object.freeze({
    accountCode: position.accountCode,
    accountName: position.accountName,
    assetName: position.assetName,
    ticker: position.ticker,
    assetType: position.assetType,
    market: position.market,
    currency: position.currency,
    quantity: position.quantity,
    storedPrice: position.storedPrice,
    storedPriceKind: position.storedPriceKind,
    marketValueKrw: position.marketValueKrw,
    currentWeight: position.currentWeight,
    targetWeight: position.targetWeight,
    belowMa: position.belowMa,
    priceSource: position.priceSource,
    priceBasis: position.priceBasis,
    assetLinkStatus: position.assetLinkStatus,
  });
}

function isCanonicalText(value: string) {
  return value.length > 0 && value.trim() === value;
}

function isOptionalCanonicalText(value: string | null) {
  return value === null || isCanonicalText(value);
}

function isOptionalCanonicalLowercaseText(value: string | null) {
  return value === null ||
    (isCanonicalText(value) && value.toLowerCase() === value);
}

function isOptionalCanonicalUppercaseText(value: string | null) {
  return value === null ||
    (isCanonicalText(value) && value.toUpperCase() === value);
}

function isOptionalNonnegativeDecimal(value: string | null) {
  return value === null || /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}

function integrityError(
  reason: Extract<
    TenantPositionSnapshotReadResult,
    { state: "integrity_error" }
  >["reason"],
): TenantPositionSnapshotReadResult {
  return Object.freeze({ state: "integrity_error", reason });
}
