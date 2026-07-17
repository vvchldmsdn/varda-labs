import { buildCycleForSnapshotDate } from "../../src/lib/snapshots/market-calendar.ts";

export const LEGACY_CYCLE_PROVENANCE_CLASSES = Object.freeze([
  "consistent",
  "late_or_replayed",
  "timezone_normalization_conflict",
  "writer_contract_variant",
  "metadata_missing",
  "contradictory",
]);

export const LEGACY_CYCLE_PROVENANCE_POLICY = Object.freeze({
  version: "investment_lab_legacy_cycle_provenance_classification_v1",
  purpose: "snapshot_native_evidence_classification_not_timestamp_repair",
  expectedBoundary: "07:00_Asia_Seoul_service_cycle",
  lifecycleToleranceMinutes: 15,
  interpretation:
    "mutually_exclusive_evidence_class_not_confirmed_historical_root_cause",
  noDateMutation: true,
  output: "count_only",
});

const ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"]);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const LIFECYCLE_TOLERANCE_MS =
  LEGACY_CYCLE_PROVENANCE_POLICY.lifecycleToleranceMinutes * MINUTE_MS;

export function buildInvestmentLabLegacyCycleProvenanceReport({ rows }) {
  const evidenceRows = Array.isArray(rows) ? rows : null;
  const groups = groupRows(evidenceRows ?? []);
  const classes = Object.fromEntries(
    LEGACY_CYCLE_PROVENANCE_CLASSES.map((name) => [name, 0]),
  );
  const byAccount = Object.fromEntries(
    ACCOUNTS.map((account) => [
      account,
      Object.fromEntries(LEGACY_CYCLE_PROVENANCE_CLASSES.map((name) => [name, 0])),
    ]),
  );
  const diagnostics = {
    exactExpectedWindowGroups: 0,
    replayLifecycleEvidenceGroups: 0,
    shiftedNineHourWindowGroups: 0,
    shiftedWholeDayWindowGroups: 0,
    shiftedOtherWindowGroups: 0,
    internallyMixedWindowGroups: 0,
    missingLifecycleMetadataGroups: 0,
    missingCycleTimestampGroups: 0,
    missingBase44LifecycleGroups: 0,
    missingPositionSourceCreatedGroups: 0,
    missingWriterRuleGroups: 0,
    missingWriterDescriptionGroups: 0,
    writerRuleConflictGroups: 0,
    capturedBeforeStoredEndGroups: 0,
    capturedAfterStoredCycleGroups: 0,
  };

  for (const group of groups) {
    const result = classifyGroup(group);
    classes[result.classification] += 1;
    byAccount[group.account][result.classification] += 1;
    for (const diagnostic of result.diagnostics) diagnostics[diagnostic] += 1;
  }

  const classifiedGroups = Object.values(classes).reduce(
    (sum, count) => sum + count,
    0,
  );
  return Object.freeze({
    status:
      evidenceRows !== null && groups.length > 0 && classifiedGroups === groups.length
        ? "classified"
        : "unavailable",
    policy: LEGACY_CYCLE_PROVENANCE_POLICY,
    counts: Object.freeze({
      accountDateGroups: groups.length,
      classifiedGroups,
    }),
    classes: Object.freeze(classes),
    byAccount: freezeNested(byAccount),
    diagnostics: Object.freeze(diagnostics),
    authorityEffect: Object.freeze({
      canonicalActualAuthority: "none",
      timestampRepairAuthority: "none",
      sourceTransitionStatus: "remains_contradictory",
      consistentSegmentEligibility:
        "requires_separate_contiguous_single_writer_evidence_review",
    }),
  });
}

function classifyGroup(group) {
  const diagnostics = new Set();
  const records = [
    portfolioRecord(group.portfolio),
    ...group.positions.map(positionRecord),
  ];
  const expected = buildCycleForSnapshotDate(
    group.snapshotDate,
    new Date(`${group.snapshotDate}T00:00:00.000Z`),
  );
  recordStructuralDiagnostics(records, expected, diagnostics);
  const provenance = inspectWriterProvenance(
    group.portfolio,
    group.positions,
    group.snapshotDate,
    diagnostics,
  );

  if (
    records.some(hasMissingRequiredMetadata) ||
    provenance === "missing"
  ) {
    diagnostics.add("missingLifecycleMetadataGroups");
    return result("metadata_missing", diagnostics);
  }
  if (provenance === "conflict") return result("contradictory", diagnostics);

  const starts = records.map((record) => record.cycleStartAt.getTime());
  const ends = records.map((record) => record.cycleEndAt.getTime());
  const captures = records.map((record) => record.capturedAt.getTime());
  const singleWindow = allEqual(starts) && allEqual(ends);
  const captureSpread = Math.max(...captures) - Math.min(...captures);
  const duration = ends[0] - starts[0];
  if (!singleWindow) diagnostics.add("internallyMixedWindowGroups");
  if (
    !singleWindow ||
    captureSpread > LIFECYCLE_TOLERANCE_MS ||
    duration !== DAY_MS ||
    !lifecycleTimesCoherent(records)
  ) {
    return result("contradictory", diagnostics);
  }

  const storedEnd = ends[0];
  const earliestCapture = Math.min(...captures);
  const latestCapture = Math.max(...captures);
  const windowOffset = storedEnd - expected.cycleEndAt.getTime();
  const replayEvidence =
    latestCapture >= expected.cycleEndAt.getTime() + DAY_MS ||
    records.some(hasReplayLifecycleEvidence);
  const capturedInsideStoredCycle =
    earliestCapture >= storedEnd && latestCapture < storedEnd + DAY_MS;

  if (replayEvidence) diagnostics.add("replayLifecycleEvidenceGroups");

  if (replayEvidence) return result("late_or_replayed", diagnostics);
  if (!capturedInsideStoredCycle) return result("contradictory", diagnostics);
  if (windowOffset === 0) return result("consistent", diagnostics);
  if (Math.abs(windowOffset) === 9 * HOUR_MS) {
    return result("timezone_normalization_conflict", diagnostics);
  }
  return result("writer_contract_variant", diagnostics);
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const snapshotDate = stableText(row?.snapshot_date);
    const account = stableText(row?.account)?.toLowerCase();
    if (!snapshotDate || !ACCOUNTS.includes(account)) continue;
    const key = `${snapshotDate}\u0000${account}`;
    const group = groups.get(key) ?? {
      snapshotDate,
      account,
      portfolio: row,
      positions: [],
    };
    if (stableText(row?.position_legacy_id) || stableText(row?.legacy_asset_id)) {
      group.positions.push(row);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function portfolioRecord(row) {
  return {
    capturedAt: parseDate(row?.portfolio_captured_at),
    cycleStartAt: parseDate(row?.portfolio_cycle_start_at),
    cycleEndAt: parseDate(row?.portfolio_cycle_end_at),
    sourceCreatedAt: null,
    base44CreatedAt: parseDate(row?.portfolio_base44_created_at),
    base44UpdatedAt: parseDate(row?.portfolio_base44_updated_at),
  };
}

function positionRecord(row) {
  return {
    capturedAt: parseDate(row?.position_captured_at),
    cycleStartAt: parseDate(row?.position_cycle_start_at),
    cycleEndAt: parseDate(row?.position_cycle_end_at),
    sourceCreatedAt: parseDate(row?.position_source_created_at),
    base44CreatedAt: parseDate(row?.position_base44_created_at),
    base44UpdatedAt: parseDate(row?.position_base44_updated_at),
  };
}

function hasMissingRequiredMetadata(record) {
  return !record.capturedAt || !record.cycleStartAt || !record.cycleEndAt ||
    !record.base44CreatedAt || !record.base44UpdatedAt;
}

function inspectWriterProvenance(
  portfolio,
  positions,
  snapshotDate,
  diagnostics,
) {
  const ruleVersion = stableText(portfolio?.portfolio_rule_version);
  const portfolioDescription = stableText(portfolio?.portfolio_description) ?? "";
  let missing = false;
  if (!ruleVersion) {
    diagnostics.add("missingWriterRuleGroups");
    missing = true;
  } else if (ruleVersion !== `cycle-v2-${snapshotDate}`) {
    diagnostics.add("writerRuleConflictGroups");
    return "conflict";
  }
  if (
    !portfolioDescription.includes("snapshot_status=complete") ||
    !portfolioDescription.includes("valuation_basis=close_price") ||
    !portfolioDescription.includes("fx_source=")
  ) {
    diagnostics.add("missingWriterDescriptionGroups");
    missing = true;
  }
  for (const row of positions) {
    const description = stableText(row?.position_description) ?? "";
    if (parseDate(row?.position_source_created_at) === null) {
      diagnostics.add("missingPositionSourceCreatedGroups");
      missing = true;
    }
    if (
      !description.includes("price_basis=") ||
      !description.includes("price_source=") ||
      !description.includes("fx_source=")
    ) {
      diagnostics.add("missingWriterDescriptionGroups");
      missing = true;
    }
  }
  return missing ? "missing" : "complete";
}

function recordStructuralDiagnostics(records, expected, diagnostics) {
  const missingCycle = records.some(
    (record) => !record.capturedAt || !record.cycleStartAt || !record.cycleEndAt,
  );
  const missingBase44 = records.some(
    (record) => !record.base44CreatedAt || !record.base44UpdatedAt,
  );
  if (missingCycle) diagnostics.add("missingCycleTimestampGroups");
  if (missingBase44) diagnostics.add("missingBase44LifecycleGroups");
  if (missingCycle) return;

  const starts = records.map((record) => record.cycleStartAt.getTime());
  const ends = records.map((record) => record.cycleEndAt.getTime());
  const captures = records.map((record) => record.capturedAt.getTime());
  if (!allEqual(starts) || !allEqual(ends)) {
    diagnostics.add("internallyMixedWindowGroups");
    return;
  }

  const storedEnd = ends[0];
  const offset = storedEnd - expected.cycleEndAt.getTime();
  if (offset === 0) diagnostics.add("exactExpectedWindowGroups");
  else if (Math.abs(offset) === 9 * HOUR_MS) {
    diagnostics.add("shiftedNineHourWindowGroups");
  } else if (offset % DAY_MS === 0) {
    diagnostics.add("shiftedWholeDayWindowGroups");
  } else {
    diagnostics.add("shiftedOtherWindowGroups");
  }

  if (Math.min(...captures) < storedEnd) {
    diagnostics.add("capturedBeforeStoredEndGroups");
  }
  if (Math.max(...captures) >= storedEnd + DAY_MS) {
    diagnostics.add("capturedAfterStoredCycleGroups");
  }
}

function lifecycleTimesCoherent(records) {
  return records.every((record) => {
    if (record.base44UpdatedAt.getTime() < record.base44CreatedAt.getTime()) {
      return false;
    }
    if (
      record.sourceCreatedAt &&
      Math.abs(record.sourceCreatedAt.getTime() - record.capturedAt.getTime()) >
        LIFECYCLE_TOLERANCE_MS
    ) {
      return false;
    }
    return true;
  });
}

function hasReplayLifecycleEvidence(record) {
  const capture = record.capturedAt.getTime();
  const created = record.base44CreatedAt.getTime();
  const updated = record.base44UpdatedAt.getTime();
  return (
    Math.abs(updated - capture) <= LIFECYCLE_TOLERANCE_MS &&
    capture - created >= DAY_MS
  );
}

function result(classification, diagnostics) {
  return { classification, diagnostics };
}

function allEqual(values) {
  return values.every((value) => value === values[0]);
}

function stableText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseDate(value) {
  const text = stableText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function freezeNested(value) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, Object.freeze(nested)]),
    ),
  );
}
