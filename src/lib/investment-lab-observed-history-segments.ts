import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  INVESTMENT_LAB_CURRENT_SNAPSHOT_SOURCE,
  INVESTMENT_LAB_LEGACY_SNAPSHOT_SOURCE,
  isInvestmentLabCurrentSnapshotRuleVersion,
} from "./investment-lab-source-segment-authority.ts";
import {
  accountsForPortfolioScope,
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_OBSERVED_HISTORY_POLICY = Object.freeze({
  version: "investment_lab_observed_history_segments_v2",
  valueAuthority: "stored_named_account_portfolio_observations",
  currentWriterRuleAuthority: "source_segment_authority_allowlist",
  sourceTransitions: "render_as_disconnected_segments",
  missingDates: "omit_without_interpolation",
  providerBackfill: "not_requested",
  calculationAuthority: "display_only",
} as const);

export type InvestmentLabObservedHistorySourceRole =
  | "legacy_display"
  | "current_writer";

export type InvestmentLabObservedHistoryBlocker =
  | "fount_scope_adjustment_blocked"
  | "invalid_snapshot_date"
  | "invalid_named_account"
  | "incomplete_account_axis"
  | "duplicate_account_row"
  | "same_date_source_conflict"
  | "unrecognized_source"
  | "current_writer_provenance_invalid"
  | "invalid_market_value";

export type InvestmentLabObservedHistoryRow = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

export type InvestmentLabObservedHistorySegment = Readonly<{
  role: InvestmentLabObservedHistorySourceRole;
  startServiceDate: string;
  endServiceDate: string;
  observationCount: number;
  rows: readonly InvestmentLabObservedHistoryRow[];
}>;

export type InvestmentLabObservedHistory = Readonly<{
  status: "ready" | "partial" | "unavailable";
  account: PortfolioAccountScope;
  policy: typeof INVESTMENT_LAB_OBSERVED_HISTORY_POLICY;
  segments: readonly InvestmentLabObservedHistorySegment[];
  coverage: Readonly<{
    sourceRows: number;
    observedDateCount: number;
    admittedDateCount: number;
    skippedDateCount: number;
    segmentCount: number;
    legacyDateCount: number;
    currentWriterDateCount: number;
  }>;
  blockers: readonly InvestmentLabObservedHistoryBlocker[];
}>;

export type InvestmentLabObservedHistoryInputRow = Readonly<{
  snapshotDate: string;
  account: string;
  totalMarketValue: string | number | null;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabObservedHistoryOptions = Readonly<{
  forcedGapServiceDates?: readonly string[];
  additionalBlockers?: readonly InvestmentLabObservedHistoryBlocker[];
}>;

type MutableSegment = {
  role: InvestmentLabObservedHistorySourceRole;
  rows: InvestmentLabObservedHistoryRow[];
};

export function buildInvestmentLabObservedHistory(
  rows: readonly InvestmentLabObservedHistoryInputRow[],
  account: PortfolioAccountScope = "all",
  options: InvestmentLabObservedHistoryOptions = {},
): InvestmentLabObservedHistory {
  const selectedAccounts = accountsForPortfolioScope(account);
  const selectedAccountSet = new Set<NamedPortfolioAccount>(selectedAccounts);
  const blockers = new Set<InvestmentLabObservedHistoryBlocker>(
    options.additionalBlockers,
  );
  const forcedGapServiceDates = new Set(options.forcedGapServiceDates);
  const rowsByDate = new Map<
    string,
    Map<NamedPortfolioAccount, InvestmentLabObservedHistoryInputRow[]>
  >();
  let sourceRows = 0;

  for (const row of rows) {
    const normalizedAccount = stableText(row.account).toLowerCase();
    if (normalizedAccount === "all") continue;
    if (!isNamedPortfolioAccount(normalizedAccount)) {
      if (account === "all") blockers.add("invalid_named_account");
      continue;
    }
    if (!selectedAccountSet.has(normalizedAccount)) continue;
    sourceRows += 1;
    if (!isRiskDate(row.snapshotDate)) {
      blockers.add("invalid_snapshot_date");
      continue;
    }
    const accountRows = rowsByDate.get(row.snapshotDate) ?? new Map();
    const matchingRows = accountRows.get(normalizedAccount) ?? [];
    matchingRows.push(row);
    accountRows.set(normalizedAccount, matchingRows);
    rowsByDate.set(row.snapshotDate, accountRows);
  }

  const mutableSegments: MutableSegment[] = [];
  let activeSegment: MutableSegment | null = null;
  let admittedDateCount = 0;
  let legacyDateCount = 0;
  let currentWriterDateCount = 0;

  for (const [snapshotDate, accountRows] of [...rowsByDate].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const dateRows: InvestmentLabObservedHistoryInputRow[] = [];
    let dateBlocked = false;
    for (const selectedAccount of selectedAccounts) {
      const matchingRows = accountRows.get(selectedAccount) ?? [];
      if (matchingRows.length === 0) {
        blockers.add("incomplete_account_axis");
        dateBlocked = true;
      } else if (matchingRows.length > 1) {
        blockers.add("duplicate_account_row");
        dateBlocked = true;
      } else {
        dateRows.push(matchingRows[0]);
      }
    }
    if (dateBlocked) {
      activeSegment = null;
      continue;
    }
    if (forcedGapServiceDates.has(snapshotDate)) {
      activeSegment = null;
      continue;
    }

    const roles = dateRows.map((row) => sourceRole(row.source));
    if (roles.some((role) => role === null)) {
      blockers.add("unrecognized_source");
      activeSegment = null;
      continue;
    }
    const roleSet = new Set(roles);
    if (roleSet.size !== 1) {
      blockers.add("same_date_source_conflict");
      activeSegment = null;
      continue;
    }
    const role = roles[0]!;
    if (
      role === "current_writer" &&
      dateRows.some(
        (row) => !isInvestmentLabCurrentSnapshotRuleVersion(row.ruleVersion),
      )
    ) {
      blockers.add("current_writer_provenance_invalid");
      activeSegment = null;
      continue;
    }

    const values = dateRows.map((row) => finiteNonNegative(row.totalMarketValue));
    const admittedValues = values.filter(
      (value): value is number => value !== null,
    );
    if (admittedValues.length !== values.length) {
      blockers.add("invalid_market_value");
      activeSegment = null;
      continue;
    }
    const totalMarketValueKrw = admittedValues.reduce(
      (sum, value) => sum + value,
      0,
    );
    if (!Number.isSafeInteger(Math.round(totalMarketValueKrw))) {
      blockers.add("invalid_market_value");
      activeSegment = null;
      continue;
    }

    if (!activeSegment || activeSegment.role !== role) {
      activeSegment = { role, rows: [] };
      mutableSegments.push(activeSegment);
    }
    activeSegment.rows.push(
      Object.freeze({ serviceDate: snapshotDate, totalMarketValueKrw }),
    );
    admittedDateCount += 1;
    if (role === "legacy_display") legacyDateCount += 1;
    else currentWriterDateCount += 1;
  }

  const segments = Object.freeze(
    mutableSegments.map((segment) => freezeSegment(segment)),
  );
  const observedDateCount = rowsByDate.size;
  const skippedDateCount = Math.max(observedDateCount - admittedDateCount, 0);
  const status =
    segments.length === 0
      ? "unavailable"
      : blockers.size > 0 || skippedDateCount > 0
        ? "partial"
        : "ready";

  return Object.freeze({
    status,
    account,
    policy: INVESTMENT_LAB_OBSERVED_HISTORY_POLICY,
    segments,
    coverage: Object.freeze({
      sourceRows,
      observedDateCount,
      admittedDateCount,
      skippedDateCount,
      segmentCount: segments.length,
      legacyDateCount,
      currentWriterDateCount,
    }),
    blockers: Object.freeze([...blockers].sort()),
  });
}

export function unavailableInvestmentLabObservedHistory(
  account: PortfolioAccountScope,
  blocker: InvestmentLabObservedHistoryBlocker,
): InvestmentLabObservedHistory {
  return Object.freeze({
    status: "unavailable",
    account,
    policy: INVESTMENT_LAB_OBSERVED_HISTORY_POLICY,
    segments: Object.freeze([]),
    coverage: Object.freeze({
      sourceRows: 0,
      observedDateCount: 0,
      admittedDateCount: 0,
      skippedDateCount: 0,
      segmentCount: 0,
      legacyDateCount: 0,
      currentWriterDateCount: 0,
    }),
    blockers: Object.freeze([blocker]),
  });
}

function freezeSegment(segment: MutableSegment): InvestmentLabObservedHistorySegment {
  const rows = Object.freeze([...segment.rows]);
  return Object.freeze({
    role: segment.role,
    startServiceDate: rows[0].serviceDate,
    endServiceDate: rows.at(-1)!.serviceDate,
    observationCount: rows.length,
    rows,
  });
}

function sourceRole(
  value: string | null,
): InvestmentLabObservedHistorySourceRole | null {
  const source = stableText(value);
  if (source === INVESTMENT_LAB_LEGACY_SNAPSHOT_SOURCE) {
    return "legacy_display";
  }
  if (source === INVESTMENT_LAB_CURRENT_SNAPSHOT_SOURCE) {
    return "current_writer";
  }
  return null;
}

function finiteNonNegative(value: string | number | null) {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function stableText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
