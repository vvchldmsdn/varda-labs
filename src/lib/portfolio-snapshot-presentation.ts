export function formatPortfolioRuleVersions(
  values: readonly (string | null)[],
) {
  if (values.length === 0) return "-";
  return values.map((value) => value ?? "Unversioned").join(", ");
}

export function formatPortfolioAccounts(accounts: readonly string[]) {
  return accounts.length === 0 ? "none" : accounts.join(", ");
}

export function formatPortfolioKrw(value: string | null) {
  if (value === null) return "-";
  return `KRW ${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(Number(value))}`;
}

export function formatPortfolioPercent(value: string | null) {
  if (value === null) return "-";
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value))}%`;
}

export function formatPortfolioCapturedAt(value: string | null) {
  if (value === null) return "No capture time";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
