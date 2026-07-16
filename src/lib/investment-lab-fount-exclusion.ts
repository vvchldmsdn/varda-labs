import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  INVESTMENT_LAB_FOUNT_ACCOUNTS,
  INVESTMENT_LAB_FOUNT_BLOCKER_ORDER,
  INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY,
  type InvestmentLabFountAdjustedAccountRow,
  type InvestmentLabFountAdjustedPathRow,
  type InvestmentLabFountDecimalInput,
  type InvestmentLabFountEventRow,
  type InvestmentLabFountExclusionBlocker,
  type InvestmentLabFountExclusionCoverage,
  type InvestmentLabFountExclusionResult,
  type InvestmentLabFountNamedAccount,
  type InvestmentLabFountPortfolioRow,
  type InvestmentLabFountPositionRow,
  type InvestmentLabFountStaticBinding,
} from "./investment-lab-fount-exclusion-contract.ts";

export { INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY };
export type {
  InvestmentLabFountAdjustedAccountRow,
  InvestmentLabFountAdjustedPathRow,
  InvestmentLabFountDecimalInput,
  InvestmentLabFountEventRow,
  InvestmentLabFountExclusionBlocker,
  InvestmentLabFountExclusionCoverage,
  InvestmentLabFountExclusionResult,
  InvestmentLabFountNamedAccount,
  InvestmentLabFountPortfolioRow,
  InvestmentLabFountPositionRow,
  InvestmentLabFountStaticBinding,
};

const BIGINT_ZERO = BigInt(0);
const DECIMAL_SCALE = BigInt(1_000_000);
const MAX_SCALED_KRW = BigInt(10) ** BigInt(24) - BigInt(1);
const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;

type ParsedPortfolioRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  totalMarketValueKrw: bigint;
}>;

type ParsedPositionRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string;
  marketValueKrw: bigint | null;
}>;

export function buildInvestmentLabFountScopeAdjustment(input: Readonly<{
  staticBinding: InvestmentLabFountStaticBinding;
  serviceDates: readonly string[];
  portfolioRows: readonly InvestmentLabFountPortfolioRow[];
  positionRows: readonly InvestmentLabFountPositionRow[];
  eventRows: readonly InvestmentLabFountEventRow[];
}>): InvestmentLabFountExclusionResult {
  const blockers = new Set<InvestmentLabFountExclusionBlocker>();
  const validDates = validateServiceDates(input.serviceDates, blockers);
  const bindingValid = validateBinding(input.staticBinding);
  if (!bindingValid) blockers.add("invalid_static_exclusion_binding");

  const eventCoverage = inspectEvents({
    rows: input.eventRows,
    serviceDates: validDates,
    excludedLegacyAssetId: bindingValid
      ? input.staticBinding.snapshotLegacyAssetId
      : null,
    blockers,
  });
  const parsedPortfolioRows = parsePortfolioRows(
    input.portfolioRows,
    validDates,
    blockers,
  );
  const exactPositionRows = bindingValid
    ? parseExactPositionRows(
        input.positionRows,
        validDates,
        input.staticBinding.snapshotLegacyAssetId,
        blockers,
      )
    : [];

  const accountRows: InvestmentLabFountAdjustedAccountRow[] = [];
  const pathRows: InvestmentLabFountAdjustedPathRow[] = [];
  const previousSourceByAccount = new Map<
    InvestmentLabFountNamedAccount,
    string
  >();
  const sourceTransitionDates = new Set<string>();
  let derivedAllRowCount = 0;
  let storedAllRowCount = 0;
  let reconciledAllRowCount = 0;
  let sourceTransitionCount = 0;

  if (validDates !== null && bindingValid) {
    for (const serviceDate of validDates) {
      const portfolioForDate = parsedPortfolioRows.filter(
        (row) => row.snapshotDate === serviceDate,
      );
      const namedRows = new Map<
        InvestmentLabFountNamedAccount,
        ParsedPortfolioRow
      >();

      for (const account of INVESTMENT_LAB_FOUNT_ACCOUNTS) {
        const matches = portfolioForDate.filter(
          (row) => row.account === account,
        );
        if (matches.length === 0) {
          blockers.add("portfolio_evidence_incomplete");
        } else if (matches.length > 1) {
          blockers.add("portfolio_evidence_duplicate");
        } else {
          namedRows.set(account, matches[0]);
        }
      }

      const allRows = portfolioForDate.filter((row) => row.account === "all");
      if (allRows.length > 1) blockers.add("portfolio_evidence_duplicate");
      if (allRows.length === 1) storedAllRowCount += 1;

      if (namedRows.size !== INVESTMENT_LAB_FOUNT_ACCOUNTS.length) continue;

      for (const account of INVESTMENT_LAB_FOUNT_ACCOUNTS) {
        const source = namedRows.get(account)!.source;
        const previousSource = previousSourceByAccount.get(account);
        if (previousSource !== undefined && previousSource !== source) {
          sourceTransitionCount += 1;
          sourceTransitionDates.add(serviceDate);
          blockers.add("portfolio_source_transition_unproven");
        }
        previousSourceByAccount.set(account, source);
      }

      const originalTotal = sumExact(
        INVESTMENT_LAB_FOUNT_ACCOUNTS.map(
          (account) => namedRows.get(account)!.totalMarketValueKrw,
        ),
      );
      if (originalTotal === null) {
        blockers.add("aggregate_value_overflow");
        continue;
      }
      derivedAllRowCount += 1;

      let storedAllReconciliation: "matched" | "not_present" = "not_present";
      if (allRows.length === 1) {
        if (allRows[0].totalMarketValueKrw !== originalTotal) {
          blockers.add("portfolio_all_reconciliation_mismatch");
        } else {
          reconciledAllRowCount += 1;
          storedAllReconciliation = "matched";
        }
      }

      const positionsForDate = exactPositionRows.filter(
        (row) => row.snapshotDate === serviceDate,
      );
      if (positionsForDate.length === 0) {
        blockers.add("exclusion_evidence_missing");
        continue;
      }
      if (positionsForDate.length > 1) {
        blockers.add("exclusion_evidence_duplicate");
        continue;
      }

      const excludedPosition = positionsForDate[0];
      const excludedAccountRow = namedRows.get(input.staticBinding.account)!;
      if (
        excludedPosition.account !== input.staticBinding.account ||
        excludedPosition.source !== excludedAccountRow.source
      ) {
        blockers.add("exclusion_axis_mismatch");
        continue;
      }
      if (excludedPosition.marketValueKrw === null) continue;
      if (excludedPosition.marketValueKrw < BIGINT_ZERO) {
        blockers.add("invalid_exclusion_value");
        continue;
      }
      if (
        excludedPosition.marketValueKrw >
        excludedAccountRow.totalMarketValueKrw
      ) {
        blockers.add("exclusion_value_exceeds_account_total");
        continue;
      }

      const adjustedTotal = originalTotal - excludedPosition.marketValueKrw;
      for (const account of INVESTMENT_LAB_FOUNT_ACCOUNTS) {
        const sourceRow = namedRows.get(account)!;
        const excludedValue =
          account === input.staticBinding.account
            ? excludedPosition.marketValueKrw
            : BIGINT_ZERO;
        accountRows.push(
          Object.freeze({
            serviceDate,
            account,
            source: sourceRow.source,
            originalTotalMarketValueKrw: formatFixed(sourceRow.totalMarketValueKrw),
            excludedMarketValueKrw: formatFixed(excludedValue),
            adjustedTotalMarketValueKrw: formatFixed(
              sourceRow.totalMarketValueKrw - excludedValue,
            ),
          }),
        );
      }
      pathRows.push(
        Object.freeze({
          serviceDate,
          aggregateProvenance: "derived_named_account_sum",
          storedAllReconciliation,
          originalTotalMarketValueKrw: formatFixed(originalTotal),
          excludedMarketValueKrw: formatFixed(excludedPosition.marketValueKrw),
          adjustedTotalMarketValueKrw: formatFixed(adjustedTotal),
        }),
      );
    }
  }

  const coverageBase = {
    serviceDateCount: validDates?.length ?? 0,
    sourcePortfolioRowCount: input.portfolioRows.length,
    sourcePositionRowCount: input.positionRows.length,
    inWindowEventRowCount: eventCoverage.inWindow,
    excludedHoldingEventRowCount: eventCoverage.excluded,
    unattributedEventRowCount: eventCoverage.unattributed,
    derivedAllRowCount,
    storedAllRowCount,
    reconciledAllRowCount,
    sourceTransitionCount,
    sourceTransitionDateCount: sourceTransitionDates.size,
  };

  if (
    blockers.size > 0 ||
    validDates === null ||
    pathRows.length !== validDates.length
  ) {
    return blockedResult(
      blockers,
      Object.freeze({ ...coverageBase, adjustedDateCount: 0 }),
    );
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY,
    runtimeTrustStatus: "not_established",
    readinessStatus: "pure_result_ready_runtime_unbound",
    scenarioInitialCapitalKrw: pathRows[0].adjustedTotalMarketValueKrw,
    accountRows: Object.freeze(accountRows),
    scopeAdjustedObservedPath: Object.freeze(pathRows),
    coverage: Object.freeze({
      ...coverageBase,
      adjustedDateCount: pathRows.length,
    }),
    blockers: [] as const,
  });
}

function validateBinding(binding: InvestmentLabFountStaticBinding) {
  return (
    binding?.selectorBasis ===
      INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.selectorBasis &&
    isLegacyId(binding.snapshotLegacyAssetId) &&
    isNamedAccount(binding.account)
  );
}

function validateServiceDates(
  dates: readonly string[],
  blockers: Set<InvestmentLabFountExclusionBlocker>,
) {
  if (!Array.isArray(dates) || dates.length === 0) {
    blockers.add("invalid_service_date_axis");
    return null;
  }
  for (let index = 0; index < dates.length; index += 1) {
    if (
      !isRiskDate(dates[index]) ||
      (index > 0 && dates[index - 1] >= dates[index])
    ) {
      blockers.add("invalid_service_date_axis");
      return null;
    }
  }
  return Object.freeze([...dates]);
}

function parsePortfolioRows(
  rows: readonly InvestmentLabFountPortfolioRow[],
  serviceDates: readonly string[] | null,
  blockers: Set<InvestmentLabFountExclusionBlocker>,
) {
  if (!serviceDates) return [];
  const dateSet = new Set(serviceDates);
  const parsed: ParsedPortfolioRow[] = [];
  for (const row of rows) {
    const value = parseFixed(row.totalMarketValueKrw);
    if (
      !dateSet.has(row.snapshotDate) ||
      (!isNamedAccount(row.account) && row.account !== "all") ||
      !isStableSource(row.source) ||
      value === null ||
      value < BIGINT_ZERO
    ) {
      blockers.add("invalid_portfolio_evidence");
      continue;
    }
    parsed.push(
      Object.freeze({
        snapshotDate: row.snapshotDate,
        account: row.account,
        source: row.source,
        totalMarketValueKrw: value,
      }),
    );
  }
  return parsed;
}

function parseExactPositionRows(
  rows: readonly InvestmentLabFountPositionRow[],
  serviceDates: readonly string[] | null,
  excludedLegacyAssetId: string,
  blockers: Set<InvestmentLabFountExclusionBlocker>,
) {
  if (!serviceDates) return [];
  const dateSet = new Set(serviceDates);
  const parsed: ParsedPositionRow[] = [];
  for (const row of rows) {
    if (!dateSet.has(row.snapshotDate) || !isLegacyId(row.snapshotLegacyAssetId)) {
      blockers.add("invalid_position_identity_evidence");
      continue;
    }
    if (row.snapshotLegacyAssetId !== excludedLegacyAssetId) continue;

    const value = parseFixed(row.marketValueKrw);
    if (value === null) blockers.add("invalid_exclusion_value");
    parsed.push(
      Object.freeze({
        snapshotDate: row.snapshotDate,
        account: row.account,
        source: row.source,
        marketValueKrw: value,
      }),
    );
  }
  return parsed;
}

function inspectEvents(input: {
  rows: readonly InvestmentLabFountEventRow[];
  serviceDates: readonly string[] | null;
  excludedLegacyAssetId: string | null;
  blockers: Set<InvestmentLabFountExclusionBlocker>;
}) {
  if (!input.serviceDates) {
    return { inWindow: 0, excluded: 0, unattributed: 0 };
  }
  const startDate = input.serviceDates[0];
  const endDate = input.serviceDates.at(-1)!;
  let inWindow = 0;
  let excluded = 0;
  let unattributed = 0;

  for (const row of input.rows) {
    if (!isRiskDate(row.eventDate)) {
      input.blockers.add("invalid_event_evidence");
      continue;
    }
    if (row.eventDate < startDate || row.eventDate > endDate) continue;
    inWindow += 1;

    if (!isLegacyId(row.legacyAssetId)) {
      unattributed += 1;
      input.blockers.add("unattributed_event_present");
    } else if (row.legacyAssetId === input.excludedLegacyAssetId) {
      excluded += 1;
      input.blockers.add("excluded_holding_event_present");
    }
  }
  return { inWindow, excluded, unattributed };
}

function parseFixed(value: InvestmentLabFountDecimalInput) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return null;
    const scaled = BigInt(value) * DECIMAL_SCALE;
    return scaled <= MAX_SCALED_KRW && scaled >= -MAX_SCALED_KRW
      ? scaled
      : null;
  }
  if (typeof value !== "string" || value !== value.trim()) return null;

  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const magnitude = BigInt(match[2]) * DECIMAL_SCALE + BigInt(fraction || "0");
  const scaled = match[1] === "-" ? -magnitude : magnitude;
  return scaled <= MAX_SCALED_KRW && scaled >= -MAX_SCALED_KRW
    ? scaled
    : null;
}

function formatFixed(value: bigint) {
  const sign = value < BIGINT_ZERO ? "-" : "";
  const magnitude = value < BIGINT_ZERO ? -value : value;
  const integer = magnitude / DECIMAL_SCALE;
  const fraction = String(magnitude % DECIMAL_SCALE).padStart(6, "0");
  return `${sign}${integer}.${fraction}`;
}

function sumExact(values: readonly bigint[]) {
  let total = BIGINT_ZERO;
  for (const value of values) {
    total += value;
    if (total > MAX_SCALED_KRW || total < -MAX_SCALED_KRW) return null;
  }
  return total;
}

function isNamedAccount(value: string): value is InvestmentLabFountNamedAccount {
  return INVESTMENT_LAB_FOUNT_ACCOUNTS.some((account) => account === value);
}

function isLegacyId(value: string | null | undefined): value is string {
  return typeof value === "string" && LEGACY_ID_PATTERN.test(value);
}

function isStableSource(value: string) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim()
  );
}

function blockedResult(
  blockers: Set<InvestmentLabFountExclusionBlocker>,
  coverage: InvestmentLabFountExclusionCoverage,
): InvestmentLabFountExclusionResult {
  const ordered = INVESTMENT_LAB_FOUNT_BLOCKER_ORDER.filter((blocker) =>
    blockers.has(blocker),
  );
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY,
    runtimeTrustStatus: "not_established",
    readinessStatus: "not_ready",
    scenarioInitialCapitalKrw: null,
    accountRows: [] as const,
    scopeAdjustedObservedPath: [] as const,
    coverage,
    blockers: Object.freeze(ordered),
  });
}
