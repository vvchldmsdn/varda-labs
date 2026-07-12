import type {
  HistoricalEvidenceKind,
  HistoricalEvidenceRequirement,
} from "./historical-evidence-completeness.ts";
import type { HistoryAccount } from "./history-balance.ts";

export const HISTORY_EVIDENCE_MAPPING_POLICY = Object.freeze({
  version: "history_evidence_mapping_adapter_v1",
  consumer: "history",
  dateAxis: "caller_supplied_exact_dates_per_lane",
  balanceSource: "account_balance_snapshots",
  portfolioSource: "daily_portfolio_snapshots",
  allAccountMethodVersion: "history_all_account_sum_v1",
  valueWeightedCoverage: "not_defined",
  providerBackfill: "forbidden",
  displayEstimate: "forbidden",
  automaticDateExpansion: "forbidden",
  crossLaneDenominator: "forbidden",
} as const);

const NAMED_ACCOUNTS = ["brokerage", "isa", "irp"] as const;

export type HistoryBalanceEvidenceRow = Readonly<{
  balanceDate: string;
  cash: string | number | null;
  brokerage: string | number | null;
  isa: string | number | null;
  irp: string | number | null;
}>;

export type HistoryPortfolioEvidenceRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  totalMarketValue: string | number | null;
}>;

export function mapBalanceEvidenceRequirements(input: {
  account: HistoryAccount;
  requiredDates: readonly string[];
  rows: readonly HistoryBalanceEvidenceRow[];
}) {
  return input.requiredDates.map((date) =>
    mapBalanceRequirement({ date, account: input.account, rows: input.rows }),
  );
}

export function mapPortfolioEvidenceRequirements(input: {
  account: HistoryAccount;
  requiredDates: readonly string[];
  rows: readonly HistoryPortfolioEvidenceRow[];
}) {
  return input.requiredDates.map((date) =>
    mapPortfolioRequirement({ date, account: input.account, rows: input.rows }),
  );
}

function mapBalanceRequirement({
  date,
  account,
  rows,
}: {
  date: string;
  account: HistoryAccount;
  rows: readonly HistoryBalanceEvidenceRow[];
}): HistoricalEvidenceRequirement {
  const key = historyRequirementKey("balance", account, date);
  const matches = rows.filter((row) => row.balanceDate === date);
  if (matches.length === 0) {
    return gapRequirement(key, date, "missing", "balance_row_missing");
  }
  if (matches.length > 1) {
    return gapRequirement(
      key,
      date,
      "ambiguous",
      "duplicate_balance_date",
    );
  }

  const valueState = aggregateValueState(balanceValues(matches[0], account));
  if (valueState === "missing") {
    return gapRequirement(
      key,
      date,
      "missing",
      "balance_value_missing",
    );
  }
  if (valueState === "invalid") {
    return gapRequirement(
      key,
      date,
      "invalid",
      "balance_value_invalid",
    );
  }
  return observedRequirement(
    key,
    date,
    HISTORY_EVIDENCE_MAPPING_POLICY.balanceSource,
  );
}

function mapPortfolioRequirement({
  date,
  account,
  rows,
}: {
  date: string;
  account: HistoryAccount;
  rows: readonly HistoryPortfolioEvidenceRow[];
}): HistoricalEvidenceRequirement {
  const key = historyRequirementKey("portfolio", account, date);
  const dateRows = rows.filter((row) => row.snapshotDate === date);
  if (account !== "all") {
    return mapStoredPortfolioRequirement(
      key,
      date,
      dateRows.filter((row) => row.account === account),
    );
  }

  const storedAllRows = dateRows.filter((row) => row.account === "all");
  if (storedAllRows.length > 0) {
    return mapStoredPortfolioRequirement(key, date, storedAllRows);
  }

  const rowsByAccount = new Map(
    NAMED_ACCOUNTS.map((namedAccount) => [
      namedAccount,
      dateRows.filter((row) => row.account === namedAccount),
    ]),
  );
  if ([...rowsByAccount.values()].some((accountRows) => accountRows.length > 1)) {
    return gapRequirement(
      key,
      date,
      "ambiguous",
      "duplicate_named_portfolio_account",
    );
  }
  if ([...rowsByAccount.values()].some((accountRows) => accountRows.length === 0)) {
    return gapRequirement(
      key,
      date,
      "missing",
      "named_portfolio_account_missing",
    );
  }

  const completeRows = NAMED_ACCOUNTS.map(
    (namedAccount) => rowsByAccount.get(namedAccount)?.[0],
  ).filter((row): row is HistoryPortfolioEvidenceRow => row !== undefined);
  const sources = completeRows.map((row) => normalizeSource(row.source));
  if (sources.some((source) => source === null)) {
    return gapRequirement(
      key,
      date,
      "invalid",
      "portfolio_source_invalid",
    );
  }
  if (new Set(sources).size !== 1) {
    return gapRequirement(
      key,
      date,
      "ambiguous",
      "named_portfolio_source_mismatch",
    );
  }

  const valueState = aggregateValueState(
    completeRows.map((row) => row.totalMarketValue),
  );
  if (valueState === "missing") {
    return gapRequirement(
      key,
      date,
      "missing",
      "named_portfolio_value_missing",
    );
  }
  if (valueState === "invalid") {
    return gapRequirement(
      key,
      date,
      "invalid",
      "named_portfolio_value_invalid",
    );
  }

  return Object.freeze({
    key,
    evidenceKind: "reconstructed",
    source: portfolioSource(sources[0] ?? ""),
    asOfDate: date,
    sourceDates: Object.freeze([date]),
    methodVersion: HISTORY_EVIDENCE_MAPPING_POLICY.allAccountMethodVersion,
    reason: "stored_all_missing_complete_named_account_sum",
  });
}

function mapStoredPortfolioRequirement(
  key: string,
  date: string,
  rows: readonly HistoryPortfolioEvidenceRow[],
): HistoricalEvidenceRequirement {
  if (rows.length === 0) {
    return gapRequirement(key, date, "missing", "portfolio_row_missing");
  }
  if (rows.length > 1) {
    return gapRequirement(
      key,
      date,
      "ambiguous",
      "duplicate_portfolio_account_date",
    );
  }

  const row = rows[0];
  const source = normalizeSource(row.source);
  if (!source) {
    return gapRequirement(
      key,
      date,
      "invalid",
      "portfolio_source_invalid",
    );
  }
  const valueState = valueStateFor(row.totalMarketValue);
  if (valueState === "missing") {
    return gapRequirement(
      key,
      date,
      "missing",
      "portfolio_value_missing",
    );
  }
  if (valueState === "invalid") {
    return gapRequirement(
      key,
      date,
      "invalid",
      "portfolio_value_invalid",
    );
  }
  return observedRequirement(key, date, portfolioSource(source));
}

function observedRequirement(
  key: string,
  date: string,
  source: string,
): HistoricalEvidenceRequirement {
  return Object.freeze({
    key,
    evidenceKind: "observed",
    source,
    asOfDate: date,
    sourceDates: Object.freeze([date]),
    methodVersion: null,
    reason: null,
  });
}

function gapRequirement(
  key: string,
  date: string,
  evidenceKind: Extract<HistoricalEvidenceKind, "missing" | "ambiguous" | "invalid">,
  reason: string,
): HistoricalEvidenceRequirement {
  return Object.freeze({
    key,
    evidenceKind,
    source: null,
    asOfDate: date,
    sourceDates: Object.freeze([]),
    methodVersion: null,
    reason,
  });
}

function balanceValues(row: HistoryBalanceEvidenceRow, account: HistoryAccount) {
  if (account === "brokerage") return [row.brokerage];
  if (account === "isa") return [row.isa];
  if (account === "irp") return [row.irp];
  return [row.cash, row.brokerage, row.isa, row.irp];
}

function aggregateValueState(values: readonly (string | number | null)[]) {
  const states = values.map(valueStateFor);
  if (states.includes("invalid")) return "invalid" as const;
  if (states.includes("missing")) return "missing" as const;
  return "present" as const;
}

function valueStateFor(value: string | number | null) {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return "missing" as const;
  }
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? ("present" as const) : ("invalid" as const);
}

function historyRequirementKey(
  lane: "balance" | "portfolio",
  account: HistoryAccount,
  date: string,
) {
  return `${lane}/${account}/${date}`;
}

function portfolioSource(source: string) {
  return `${HISTORY_EVIDENCE_MAPPING_POLICY.portfolioSource}:${source}`;
}

function normalizeSource(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
