import { isRiskDate } from "./portfolio-risk-calendar.ts";

const LEGACY_SOURCE = "base44_import";
const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const CURRENT_RULE_VERSION = "varda-manual-daily-snapshot-v1";
const NAMED_ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"] as const);

type NamedAccount = (typeof NAMED_ACCOUNTS)[number];
type SourceRole = "legacy_display" | "current_writer" | "unknown";

export const INVESTMENT_LAB_SOURCE_SEGMENT_AUTHORITY_POLICY = Object.freeze({
  version: "investment_lab_source_segment_authority_v1",
  legacySegment: "display_only",
  currentWriterSegment:
    "calculation_candidate_only_for_an_entire_single_selected_segment",
  mixedSegmentCalculation: "forbidden",
  sourceRebase: "forbidden",
  implicitFallback: "forbidden",
  specialHoldingAuthority: "separate_gates",
} as const);

export type InvestmentLabSourceSegmentEvidenceRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabSourceSegmentAuthorityBlocker =
  | "source_axis_unavailable"
  | "source_axis_invalid"
  | "source_axis_incomplete"
  | "source_role_unrecognized"
  | "same_date_source_conflict"
  | "current_writer_provenance_invalid"
  | "legacy_segment_display_only"
  | "source_splice_forbidden";

export type InvestmentLabSourceSegmentAuthority = Readonly<{
  status: "eligible" | "blocked";
  decision:
    | "current_writer_calculation_candidate"
    | "legacy_display_only"
    | "blocked";
  policy: typeof INVESTMENT_LAB_SOURCE_SEGMENT_AUTHORITY_POLICY;
  coverage: Readonly<{
    namedSourceRows: number;
    observedDateCount: number;
    completeDateCount: number;
    incompleteDateCount: number;
    currentWriterDateCount: number;
    legacyDisplayDateCount: number;
    unknownSourceDateCount: number;
    conflictingSourceDateCount: number;
    sourceTransitionCount: number;
    invalidNamedRowCount: number;
  }>;
  blockers: readonly InvestmentLabSourceSegmentAuthorityBlocker[];
}>;

export function listInvestmentLabCompleteSnapshotDates(
  rows: readonly InvestmentLabSourceSegmentEvidenceRow[],
) {
  return Object.freeze(buildNamedAccountAxis(rows).completeDates);
}

export function resolveInvestmentLabSourceSegmentAuthority(
  rows: readonly InvestmentLabSourceSegmentEvidenceRow[],
): InvestmentLabSourceSegmentAuthority {
  const axis = buildNamedAccountAxis(rows);
  const blockers = new Set<InvestmentLabSourceSegmentAuthorityBlocker>();
  if (axis.invalidNamedRowCount > 0) blockers.add("source_axis_invalid");
  if (axis.observedDateCount === 0) blockers.add("source_axis_unavailable");
  if (axis.incompleteDateCount > 0) blockers.add("source_axis_incomplete");

  let currentWriterDateCount = 0;
  let legacyDisplayDateCount = 0;
  let unknownSourceDateCount = 0;
  let conflictingSourceDateCount = 0;
  const homogeneousRoles: SourceRole[] = [];

  for (const dateRows of axis.completeRowsByDate) {
    const roles = dateRows.map((row) => sourceRole(row.source));
    const roleSet = new Set(roles);
    if (roles.includes("unknown")) {
      unknownSourceDateCount += 1;
      blockers.add("source_role_unrecognized");
    }
    if (roleSet.size !== 1) {
      conflictingSourceDateCount += 1;
      blockers.add("same_date_source_conflict");
      continue;
    }

    const role = roles[0];
    homogeneousRoles.push(role);
    if (role === "legacy_display") legacyDisplayDateCount += 1;
    if (role === "current_writer") {
      currentWriterDateCount += 1;
      if (
        dateRows.some(
          (row) => stableText(row.ruleVersion) !== CURRENT_RULE_VERSION,
        )
      ) {
        blockers.add("current_writer_provenance_invalid");
      }
    }
  }

  const recognizedRoles = homogeneousRoles.filter(
    (role): role is Exclude<SourceRole, "unknown"> => role !== "unknown",
  );
  const sourceTransitionCount = recognizedRoles.reduce(
    (count, role, index) =>
      index > 0 && role !== recognizedRoles[index - 1] ? count + 1 : count,
    0,
  );
  const distinctRecognizedRoles = new Set(recognizedRoles);
  if (distinctRecognizedRoles.size > 1) {
    blockers.add("source_splice_forbidden");
  } else if (
    distinctRecognizedRoles.size === 1 &&
    distinctRecognizedRoles.has("legacy_display")
  ) {
    blockers.add("legacy_segment_display_only");
  }

  const eligible =
    blockers.size === 0 &&
    currentWriterDateCount === axis.completeDateCount &&
    currentWriterDateCount > 0;
  const decision = eligible
    ? "current_writer_calculation_candidate"
    : blockers.size === 1 && blockers.has("legacy_segment_display_only")
      ? "legacy_display_only"
      : "blocked";

  return Object.freeze({
    status: eligible ? "eligible" : "blocked",
    decision,
    policy: INVESTMENT_LAB_SOURCE_SEGMENT_AUTHORITY_POLICY,
    coverage: Object.freeze({
      namedSourceRows: axis.namedSourceRows,
      observedDateCount: axis.observedDateCount,
      completeDateCount: axis.completeDateCount,
      incompleteDateCount: axis.incompleteDateCount,
      currentWriterDateCount,
      legacyDisplayDateCount,
      unknownSourceDateCount,
      conflictingSourceDateCount,
      sourceTransitionCount,
      invalidNamedRowCount: axis.invalidNamedRowCount,
    }),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function buildNamedAccountAxis(
  rows: readonly InvestmentLabSourceSegmentEvidenceRow[],
) {
  const byDate = new Map<
    string,
    Map<NamedAccount, InvestmentLabSourceSegmentEvidenceRow[]>
  >();
  let namedSourceRows = 0;
  let invalidNamedRowCount = 0;

  for (const row of rows) {
    const account = stableText(row.account).toLowerCase();
    if (account === "all") continue;
    if (!isNamedAccount(account) || !isRiskDate(row.snapshotDate)) {
      invalidNamedRowCount += 1;
      continue;
    }

    namedSourceRows += 1;
    const accountRows = byDate.get(row.snapshotDate) ?? new Map();
    const matchingRows = accountRows.get(account) ?? [];
    matchingRows.push(row);
    accountRows.set(account, matchingRows);
    byDate.set(row.snapshotDate, accountRows);
  }

  const completeDates: string[] = [];
  const completeRowsByDate: InvestmentLabSourceSegmentEvidenceRow[][] = [];
  let incompleteDateCount = 0;
  for (const [snapshotDate, accountRows] of [...byDate].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const complete = NAMED_ACCOUNTS.every(
      (account) => accountRows.get(account)?.length === 1,
    );
    if (!complete) {
      incompleteDateCount += 1;
      continue;
    }
    completeDates.push(snapshotDate);
    completeRowsByDate.push(
      NAMED_ACCOUNTS.map((account) => accountRows.get(account)![0]),
    );
  }

  return {
    namedSourceRows,
    invalidNamedRowCount,
    observedDateCount: byDate.size,
    completeDateCount: completeDates.length,
    incompleteDateCount,
    completeDates,
    completeRowsByDate,
  } as const;
}

function sourceRole(value: string | null): SourceRole {
  const source = stableText(value);
  if (source === LEGACY_SOURCE) return "legacy_display";
  if (source === CURRENT_SOURCE) return "current_writer";
  return "unknown";
}

function isNamedAccount(value: string): value is NamedAccount {
  return NAMED_ACCOUNTS.some((account) => account === value);
}

function stableText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
