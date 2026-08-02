import {
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import {
  fixedPercent,
  isNonnegativeFixedDecimal,
  isSignedFixedDecimal,
  sumNullableFixedDecimals,
  sumNullableSafeIntegers,
} from "./fixed-decimal-evidence.ts";
import type {
  TenantPortfolioSnapshotAccountRow,
  TenantPortfolioSnapshotAggregate,
  TenantPortfolioSnapshotDto,
  TenantPortfolioSnapshotReadResult,
  TenantPortfolioSnapshotReadRow,
} from "./tenant-portfolio-snapshot-contract.ts";

export type {
  TenantPortfolioSnapshotAccountRow,
  TenantPortfolioSnapshotAggregate,
  TenantPortfolioSnapshotDto,
  TenantPortfolioSnapshotReadResult,
  TenantPortfolioSnapshotReadRow,
} from "./tenant-portfolio-snapshot-contract.ts";

export function projectTenantPortfolioSnapshotRows({
  accountRows,
  rows,
  scope,
  snapshotDate,
}: {
  accountRows: readonly TenantPortfolioSnapshotAccountRow[];
  rows: readonly TenantPortfolioSnapshotReadRow[];
  scope: PortfolioAccountScope;
  snapshotDate: string | null;
}): TenantPortfolioSnapshotReadResult {
  const accountsById = new Map<
    string,
    TenantPortfolioSnapshotAccountRow & {
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
  if (snapshotDate === null) return integrityError("snapshot_date_mismatch");

  const seenAccounts = new Set<NamedPortfolioAccount>();
  const coveredAccountSet = new Set<NamedPortfolioAccount>();
  const sources = new Set<string>();
  const ruleVersionKeys = new Set<string>();
  const snapshots: Array<
    TenantPortfolioSnapshotDto & Readonly<{ accountSortOrder: number }>
  > = [];
  let excludedSnapshotCount = 0;
  let incompleteCoreSnapshotCount = 0;

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
    if (seenAccounts.has(ownedAccount.accountCode)) {
      return integrityError("duplicate_account_snapshot");
    }
    seenAccounts.add(ownedAccount.accountCode);

    if (!hasValidDisplayEvidence(row)) {
      excludedSnapshotCount += 1;
      continue;
    }

    coveredAccountSet.add(ownedAccount.accountCode);
    ruleVersionKeys.add(row.ruleVersion ?? "");
    if (hasIncompleteCoreEvidence(row)) incompleteCoreSnapshotCount += 1;

    snapshots.push(
      Object.freeze({
        accountCode: ownedAccount.accountCode,
        accountName: ownedAccount.accountName,
        accountSortOrder: ownedAccount.accountSortOrder,
        ruleVersion: row.ruleVersion,
        cashValue: row.cashValue,
        investedAmount: row.investedAmount,
        totalCost: row.totalCost,
        totalMarketValue: row.totalMarketValue,
        totalPnl: row.totalPnl,
        totalReturnPct: row.totalReturnPct,
        fxRate: row.fxRate,
        usdKrw: row.usdKrw,
        krWeight: row.krWeight,
        usWeight: row.usWeight,
        usdExposurePct: row.usdExposurePct,
        numAssets: row.numAssets,
        numGroups: row.numGroups,
        topHoldingName: row.topHoldingName,
        topHoldingWeight: row.topHoldingWeight,
        capturedAt: row.capturedAt?.toISOString() ?? null,
      }),
    );
  }

  snapshots.sort(
    (left, right) =>
      left.accountSortOrder - right.accountSortOrder ||
      left.accountCode.localeCompare(right.accountCode),
  );

  const coveredAccounts = Object.freeze(
    expectedAccounts.filter((account) => coveredAccountSet.has(account)),
  );
  const missingAccounts = Object.freeze(
    expectedAccounts.filter((account) => !coveredAccountSet.has(account)),
  );
  const ruleVersions = Object.freeze(
    [...ruleVersionKeys]
      .sort((left, right) => left.localeCompare(right))
      .map((value) => (value === "" ? null : value)),
  );
  const hasMixedRuleVersions = ruleVersions.length > 1;
  const ready =
    excludedSnapshotCount === 0 &&
    incompleteCoreSnapshotCount === 0 &&
    missingAccounts.length === 0 &&
    !hasMixedRuleVersions;
  const publicSnapshots = Object.freeze(snapshots.map(toPublicSnapshot));

  return Object.freeze({
    state: ready ? "ready" : "partial",
    scope,
    snapshotDate,
    source: [...sources][0] ?? "",
    ruleVersions,
    expectedAccounts,
    coveredAccounts,
    missingAccounts,
    snapshots: publicSnapshots,
    aggregate: buildAggregate(publicSnapshots, ready),
    excludedSnapshotCount,
    incompleteCoreSnapshotCount,
    hasMixedRuleVersions,
  });
}

function hasValidDisplayEvidence(row: TenantPortfolioSnapshotReadRow) {
  return (
    isOptionalCanonicalText(row.ruleVersion) &&
    isOptionalNonnegativeDecimal(row.cashValue) &&
    isOptionalNonnegativeDecimal(row.investedAmount) &&
    isOptionalNonnegativeDecimal(row.totalCost) &&
    isOptionalNonnegativeDecimal(row.totalMarketValue) &&
    isOptionalSignedDecimal(row.totalPnl) &&
    isOptionalSignedDecimal(row.totalReturnPct) &&
    isOptionalPositiveDecimal(row.fxRate) &&
    isOptionalPositiveDecimal(row.usdKrw) &&
    isOptionalPercent(row.krWeight) &&
    isOptionalPercent(row.usWeight) &&
    isOptionalPercent(row.usdExposurePct) &&
    isOptionalNonnegativeInteger(row.numAssets) &&
    isOptionalNonnegativeInteger(row.numGroups) &&
    isOptionalCanonicalText(row.topHoldingName) &&
    isOptionalPercent(row.topHoldingWeight) &&
    isOptionalValidDate(row.capturedAt)
  );
}

function hasIncompleteCoreEvidence(row: TenantPortfolioSnapshotReadRow) {
  return (
    row.investedAmount === null ||
    row.totalCost === null ||
    row.totalMarketValue === null ||
    row.totalPnl === null
  );
}

function buildAggregate(
  snapshots: readonly TenantPortfolioSnapshotDto[],
  complete: boolean,
): TenantPortfolioSnapshotAggregate | null {
  if (snapshots.length === 0) return null;

  const investedAmount = sumNullableFixedDecimals(
    snapshots.map((snapshot) => snapshot.investedAmount),
  );
  const totalPnl = sumNullableFixedDecimals(
    snapshots.map((snapshot) => snapshot.totalPnl),
  );

  return Object.freeze({
    evidenceKind: complete ? "complete_total" : "available_subtotal",
    accountCount: snapshots.length,
    cashValue: sumNullableFixedDecimals(
      snapshots.map((snapshot) => snapshot.cashValue),
    ),
    investedAmount,
    totalCost: sumNullableFixedDecimals(
      snapshots.map((snapshot) => snapshot.totalCost),
    ),
    totalMarketValue: sumNullableFixedDecimals(
      snapshots.map((snapshot) => snapshot.totalMarketValue),
    ),
    totalPnl,
    totalReturnPct:
      snapshots.length === 1
        ? snapshots[0]?.totalReturnPct ?? null
        : fixedPercent(totalPnl, investedAmount),
    numAssets: sumNullableSafeIntegers(
      snapshots.map((snapshot) => snapshot.numAssets),
    ),
  });
}

function toPublicSnapshot(
  snapshot: TenantPortfolioSnapshotDto & Readonly<{ accountSortOrder: number }>,
): TenantPortfolioSnapshotDto {
  return Object.freeze({
    accountCode: snapshot.accountCode,
    accountName: snapshot.accountName,
    ruleVersion: snapshot.ruleVersion,
    cashValue: snapshot.cashValue,
    investedAmount: snapshot.investedAmount,
    totalCost: snapshot.totalCost,
    totalMarketValue: snapshot.totalMarketValue,
    totalPnl: snapshot.totalPnl,
    totalReturnPct: snapshot.totalReturnPct,
    fxRate: snapshot.fxRate,
    usdKrw: snapshot.usdKrw,
    krWeight: snapshot.krWeight,
    usWeight: snapshot.usWeight,
    usdExposurePct: snapshot.usdExposurePct,
    numAssets: snapshot.numAssets,
    numGroups: snapshot.numGroups,
    topHoldingName: snapshot.topHoldingName,
    topHoldingWeight: snapshot.topHoldingWeight,
    capturedAt: snapshot.capturedAt,
  });
}

function isCanonicalText(value: string) {
  return value.length > 0 && value.trim() === value;
}

function isOptionalCanonicalText(value: string | null) {
  return value === null || isCanonicalText(value);
}

function isOptionalSignedDecimal(value: string | null) {
  return value === null || isSignedFixedDecimal(value);
}

function isOptionalNonnegativeDecimal(value: string | null) {
  return value === null || isNonnegativeFixedDecimal(value);
}

function isOptionalPositiveDecimal(value: string | null) {
  if (value === null) return true;
  return isOptionalNonnegativeDecimal(value) && Number(value) > 0;
}

function isOptionalPercent(value: string | null) {
  if (value === null || !isOptionalSignedDecimal(value)) return value === null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}

function isOptionalNonnegativeInteger(value: number | null) {
  return value === null || (Number.isSafeInteger(value) && value >= 0);
}

function isOptionalValidDate(value: Date | null) {
  return value === null || Number.isFinite(value.getTime());
}

function integrityError(
  reason: Extract<
    TenantPortfolioSnapshotReadResult,
    { state: "integrity_error" }
  >["reason"],
): TenantPortfolioSnapshotReadResult {
  return Object.freeze({ state: "integrity_error", reason });
}
