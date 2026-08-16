export const ALL_SNAPSHOT_ACCOUNTS = "all" as const;

export type SnapshotAccount = string;

export type SnapshotAccountTargetResolution =
  | Readonly<{
      ok: true;
      targetAccounts: readonly string[];
    }>
  | Readonly<{
      ok: false;
      reason:
        | "invalid_account_catalog"
        | "no_open_investment_accounts"
        | "account_not_owned_or_inactive"
        | "account_has_no_open_investment_positions";
    }>;

export function resolveSnapshotAccountTargets({
  activeAccountCodes,
  openInvestmentAccountCodes,
  requestedAccount,
}: {
  activeAccountCodes: readonly string[];
  openInvestmentAccountCodes: ReadonlySet<string>;
  requestedAccount: SnapshotAccount;
}): SnapshotAccountTargetResolution {
  if (!isCanonicalAccountCatalog(activeAccountCodes)) {
    return Object.freeze({ ok: false, reason: "invalid_account_catalog" });
  }

  const activeAccounts = new Set(activeAccountCodes);
  const eligibleAccounts = Object.freeze(
    activeAccountCodes.filter((account) =>
      openInvestmentAccountCodes.has(account),
    ),
  );

  if (requestedAccount === ALL_SNAPSHOT_ACCOUNTS) {
    return eligibleAccounts.length > 0
      ? Object.freeze({ ok: true, targetAccounts: eligibleAccounts })
      : Object.freeze({
          ok: false,
          reason: "no_open_investment_accounts",
        });
  }

  if (!isCanonicalAccountCode(requestedAccount) || !activeAccounts.has(requestedAccount)) {
    return Object.freeze({
      ok: false,
      reason: "account_not_owned_or_inactive",
    });
  }
  if (!openInvestmentAccountCodes.has(requestedAccount)) {
    return Object.freeze({
      ok: false,
      reason: "account_has_no_open_investment_positions",
    });
  }

  return Object.freeze({
    ok: true,
    targetAccounts: Object.freeze([requestedAccount]),
  });
}

function isCanonicalAccountCatalog(accountCodes: readonly string[]) {
  const seen = new Set<string>();
  for (const accountCode of accountCodes) {
    if (!isCanonicalAccountCode(accountCode) || seen.has(accountCode)) {
      return false;
    }
    seen.add(accountCode);
  }
  return true;
}

function isCanonicalAccountCode(value: string) {
  return (
    value.length > 0 &&
    value.length <= 50 &&
    value === value.trim() &&
    value === value.toLowerCase() &&
    value !== ALL_SNAPSHOT_ACCOUNTS
  );
}
