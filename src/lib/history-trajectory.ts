import {
  historyBalanceValueForAccount,
  type BalanceHistoryValueRow,
  type HistoryAccount,
  type PortfolioHistoryDisplayRow,
} from "./history-balance.ts";

export const HISTORY_TRAJECTORY_POLICY = Object.freeze({
  version: "stored_history_amount_trajectory_v1",
  laneAxes: "separate",
  continuity:
    "same_source_same_row_kind_consecutive_calendar_dates_only",
  interpolation: "none",
  flatCarry: "none",
  returnTwrMddOrRanking: "excluded",
} as const);

export type HistoryTrajectoryLane = "balance" | "portfolio";
export type HistoryTrajectoryRowKind = "stored" | "derived";

export type HistoryTrajectoryPoint = Readonly<{
  date: string;
  valueKrw: number;
  source: string;
  rowKind: HistoryTrajectoryRowKind;
}>;

export type HistoryTrajectorySegment = Readonly<{
  key: string;
  source: string;
  rowKind: HistoryTrajectoryRowKind;
  startDate: string;
  endDate: string;
  points: readonly HistoryTrajectoryPoint[];
}>;

export type HistoryTrajectoryEvidenceGroup = Readonly<{
  source: string;
  rowKind: HistoryTrajectoryRowKind;
  pointCount: number;
  segmentCount: number;
  minDate: string;
  maxDate: string;
}>;

export type HistoryTrajectoryModel = Readonly<{
  policy: typeof HISTORY_TRAJECTORY_POLICY;
  lane: HistoryTrajectoryLane;
  account: HistoryAccount;
  status: "ready" | "unavailable";
  reason: "ready" | "no_valid_stored_points";
  inputRowCount: number;
  pointCount: number;
  segmentCount: number;
  sourceCount: number;
  derivedPointCount: number;
  excludedPointCount: number;
  ambiguousPointCount: number;
  disconnectedGapCount: number;
  minDate: string | null;
  maxDate: string | null;
  minValueKrw: number | null;
  maxValueKrw: number | null;
  segments: readonly HistoryTrajectorySegment[];
  evidenceGroups: readonly HistoryTrajectoryEvidenceGroup[];
}>;

type Candidate = HistoryTrajectoryPoint & { timestamp: number };

export function buildBalanceHistoryTrajectory({
  rows,
  account,
}: {
  rows: readonly BalanceHistoryValueRow[];
  account: HistoryAccount;
}): HistoryTrajectoryModel {
  return buildHistoryTrajectory({
    lane: "balance",
    account,
    inputRowCount: rows.length,
    candidates: rows.map((row) => ({
      date: row.balanceDate,
      valueKrw: historyBalanceValueForAccount(row, account),
      source: "stored_balance_record",
      rowKind: "stored" as const,
    })),
  });
}

export function buildPortfolioHistoryTrajectory({
  rows,
  account,
}: {
  rows: readonly PortfolioHistoryDisplayRow[];
  account: HistoryAccount;
}): HistoryTrajectoryModel {
  return buildHistoryTrajectory({
    lane: "portfolio",
    account,
    inputRowCount: rows.length,
    candidates: rows.map((row) => ({
      date: row.snapshotDate,
      valueKrw: row.totalMarketValue,
      source: row.source,
      rowKind: row.rowKind,
    })),
  });
}

function buildHistoryTrajectory({
  lane,
  account,
  inputRowCount,
  candidates,
}: {
  lane: HistoryTrajectoryLane;
  account: HistoryAccount;
  inputRowCount: number;
  candidates: readonly {
    date: string;
    valueKrw: number | null;
    source: string;
    rowKind: HistoryTrajectoryRowKind;
  }[];
}): HistoryTrajectoryModel {
  let invalidPointCount = 0;
  const validCandidates: Candidate[] = [];

  for (const candidate of candidates) {
    const timestamp = strictDateTimestamp(candidate.date);
    const source = candidate.source.trim();
    if (
      timestamp === null ||
      !source ||
      !isFiniteFinancialValue(candidate.valueKrw)
    ) {
      invalidPointCount += 1;
      continue;
    }
    validCandidates.push({
      date: candidate.date,
      valueKrw: candidate.valueKrw,
      source,
      rowKind: candidate.rowKind,
      timestamp,
    });
  }

  const candidatesByIdentity = new Map<string, Candidate[]>();
  for (const candidate of validCandidates) {
    const identity = pointIdentity(candidate);
    const group = candidatesByIdentity.get(identity);
    if (group) group.push(candidate);
    else candidatesByIdentity.set(identity, [candidate]);
  }

  let ambiguousPointCount = 0;
  const unambiguous = [...candidatesByIdentity.values()].flatMap((group) => {
    if (group.length === 1) return group;
    ambiguousPointCount += group.length;
    return [];
  });

  const candidatesByEvidence = new Map<string, Candidate[]>();
  for (const candidate of unambiguous) {
    const key = evidenceKey(candidate);
    const group = candidatesByEvidence.get(key);
    if (group) group.push(candidate);
    else candidatesByEvidence.set(key, [candidate]);
  }

  let disconnectedGapCount = 0;
  const segments: HistoryTrajectorySegment[] = [];
  const evidenceGroups: HistoryTrajectoryEvidenceGroup[] = [];

  for (const [key, group] of [...candidatesByEvidence.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const sorted = [...group].sort(compareCandidates);
    const groupSegments: HistoryTrajectorySegment[] = [];
    let current: Candidate[] = [];

    for (const point of sorted) {
      const previous = current.at(-1);
      if (previous && point.timestamp - previous.timestamp !== DAY_MS) {
        groupSegments.push(materializeSegment(key, groupSegments.length, current));
        current = [];
        disconnectedGapCount += 1;
      }
      current.push(point);
    }
    if (current.length > 0) {
      groupSegments.push(materializeSegment(key, groupSegments.length, current));
    }

    segments.push(...groupSegments);
    evidenceGroups.push(
      Object.freeze({
        source: sorted[0]!.source,
        rowKind: sorted[0]!.rowKind,
        pointCount: sorted.length,
        segmentCount: groupSegments.length,
        minDate: sorted[0]!.date,
        maxDate: sorted.at(-1)!.date,
      }),
    );
  }

  segments.sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.key.localeCompare(right.key),
  );
  const points = segments.flatMap((segment) => segment.points);
  const dates = points.map((point) => point.date).sort();
  const values = points.map((point) => point.valueKrw);
  const ready = points.length > 0;

  return Object.freeze({
    policy: HISTORY_TRAJECTORY_POLICY,
    lane,
    account,
    status: ready ? "ready" : "unavailable",
    reason: ready ? "ready" : "no_valid_stored_points",
    inputRowCount,
    pointCount: points.length,
    segmentCount: segments.length,
    sourceCount: new Set(points.map((point) => point.source)).size,
    derivedPointCount: points.filter((point) => point.rowKind === "derived")
      .length,
    excludedPointCount: invalidPointCount + ambiguousPointCount,
    ambiguousPointCount,
    disconnectedGapCount,
    minDate: dates[0] ?? null,
    maxDate: dates.at(-1) ?? null,
    minValueKrw: ready ? Math.min(...values) : null,
    maxValueKrw: ready ? Math.max(...values) : null,
    segments: Object.freeze(segments),
    evidenceGroups: Object.freeze(evidenceGroups),
  });
}

function materializeSegment(
  evidence: string,
  index: number,
  candidates: readonly Candidate[],
): HistoryTrajectorySegment {
  const points = candidates.map((candidate) =>
    Object.freeze({
      date: candidate.date,
      valueKrw: candidate.valueKrw,
      source: candidate.source,
      rowKind: candidate.rowKind,
    }),
  );
  return Object.freeze({
    key: `${evidence}:${index}`,
    source: points[0]!.source,
    rowKind: points[0]!.rowKind,
    startDate: points[0]!.date,
    endDate: points.at(-1)!.date,
    points: Object.freeze(points),
  });
}

function pointIdentity(candidate: Candidate) {
  return `${evidenceKey(candidate)}|${candidate.date}`;
}

function evidenceKey(candidate: Candidate) {
  return `${candidate.source}|${candidate.rowKind}`;
}

function compareCandidates(left: Candidate, right: Candidate) {
  return left.timestamp - right.timestamp;
}

function strictDateTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function isFiniteFinancialValue(value: number | null): value is number {
  return (
    value !== null &&
    Number.isFinite(value) &&
    Math.abs(value) <= Number.MAX_SAFE_INTEGER
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
