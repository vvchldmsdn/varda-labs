import { buildInvestmentLabFountScopeAdjustment } from "../../src/lib/investment-lab-fount-exclusion.ts";

const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;

export const INVESTMENT_LAB_FOUNT_READINESS_AUDIT_POLICY = Object.freeze({
  version: "investment_lab_fount_scope_adjustment_readiness_v1",
  bindingDiscovery:
    "reviewed_metadata_candidate_then_exact_snapshot_legacy_identity",
  bindingScope: "all_stored_position_dates_accounts_and_sources",
  eventScope: "all_binding_events_plus_selected_window_invariant",
  output: "aggregate_diagnostics_only",
  rawIdentityExposure: "forbidden",
  adjustedPathExposure: "forbidden",
  runtimeIntegration: "not_established",
});

export function buildInvestmentLabFountReadinessReport(input) {
  const blockers = [];
  const candidates = arrayOrEmpty(input.evidence?.candidateRows);
  const candidate = candidates.length === 1 ? candidates[0] : null;
  const candidateId = candidate?.legacy_asset_id;

  if (candidates.length === 0) blockers.push("binding_candidate_missing");
  if (candidates.length > 1) blockers.push("binding_candidate_ambiguous");
  if (candidate && !isLegacyId(candidateId)) {
    blockers.push("binding_candidate_invalid");
  }

  const bindingPositionRows = nullableArray(
    input.evidence?.bindingPositionRows,
  );
  const bindingEventRows = nullableArray(input.evidence?.bindingEventRows);
  const serviceDateRows = nullableArray(input.evidence?.serviceDateRows);
  const portfolioRows = nullableArray(input.evidence?.portfolioRows);
  const positionRows = nullableArray(input.evidence?.positionRows);
  const eventRows = nullableArray(input.evidence?.eventRows);
  const dependentEvidence = [
    bindingPositionRows,
    bindingEventRows,
    serviceDateRows,
    portfolioRows,
    positionRows,
    eventRows,
  ];

  if (candidate && dependentEvidence.some((rows) => rows === null)) {
    blockers.push("binding_or_axis_evidence_unavailable");
  }

  const bindingRows = bindingPositionRows ?? [];
  const bindingEvents = bindingEventRows ?? [];
  const metadataCollisionRows = isLegacyId(candidateId)
    ? bindingRows.filter(
        (row) =>
          row.legacy_asset_id !== candidateId ||
          !matchesPositionDecision(row, input.decision) ||
          !isStableText(row.source),
      ).length
    : 0;
  const eventMetadataCollisionRows = isLegacyId(candidateId)
    ? bindingEvents.filter(
        (row) =>
          row.legacy_asset_id !== candidateId ||
          !matchesEventDecision(row, input.decision),
      ).length
    : 0;

  if (candidate && bindingPositionRows?.length === 0) {
    blockers.push("binding_history_missing");
  }
  if (
    candidate &&
    bindingPositionRows &&
    (!isSafeCount(candidate.row_count) ||
      Number(candidate.row_count) !== bindingPositionRows.length)
  ) {
    blockers.push("binding_history_count_mismatch");
  }
  if (metadataCollisionRows > 0) blockers.push("binding_metadata_collision");
  if (eventMetadataCollisionRows > 0) {
    blockers.push("binding_event_metadata_collision");
  }

  const bindingReady =
    isLegacyId(candidateId) &&
    bindingPositionRows !== null &&
    bindingPositionRows.length > 0 &&
    metadataCollisionRows === 0 &&
    eventMetadataCollisionRows === 0 &&
    !blockers.includes("binding_history_count_mismatch") &&
    dependentEvidence.every((rows) => rows !== null);

  const transformerResult = bindingReady
    ? buildInvestmentLabFountScopeAdjustment({
        staticBinding: {
          selectorBasis: "exact_snapshot_legacy_asset_id",
          snapshotLegacyAssetId: candidateId,
          account: input.decision.account,
        },
        serviceDates: serviceDateRows.map((row) => row.service_date),
        portfolioRows: portfolioRows.map((row) => ({
          snapshotDate: row.snapshot_date,
          account: row.account,
          source: row.source,
          totalMarketValueKrw: row.total_market_value_krw,
        })),
        positionRows: positionRows.map((row) => ({
          snapshotDate: row.snapshot_date,
          account: row.account,
          source: row.source,
          snapshotLegacyAssetId: row.legacy_asset_id,
          marketValueKrw: row.market_value_krw,
        })),
        eventRows: eventRows.map((row) => ({
          eventDate: row.event_date,
          legacyAssetId: row.legacy_asset_id,
        })),
      })
    : null;

  if (transformerResult?.status === "blocked") {
    blockers.push("scope_adjustment_transform_blocked");
  }

  const serviceDates = (serviceDateRows ?? [])
    .map((row) => row.service_date)
    .filter((value) => typeof value === "string");
  const accountKeys = uniqueStable(
    bindingRows.map((row) => normalizeText(row.account)),
  );
  const sourceKeys = uniqueStable(
    bindingRows.map((row) => normalizeText(row.source)),
  );
  const uniqueBlockers = Object.freeze([...new Set(blockers)].sort());

  return Object.freeze({
    audit: "investment_lab_fount_scope_adjustment_readiness",
    status: uniqueBlockers.length === 0 ? "ready" : "blocked",
    readOnly: true,
    policy: INVESTMENT_LAB_FOUNT_READINESS_AUDIT_POLICY,
    runtimeTrustStatus: "not_established",
    readinessStatus:
      uniqueBlockers.length === 0
        ? "select_only_evidence_ready_runtime_unbound"
        : "not_ready",
    binding: Object.freeze({
      candidateCount: candidates.length,
      exactBindingResolved: bindingReady,
      positionRows: bindingRows.length,
      eventRows: bindingEvents.length,
      distinctAccounts: accountKeys.length,
      distinctSources: sourceKeys.length,
      metadataCollisionRows,
      eventMetadataCollisionRows,
      startDate: firstStableDate(bindingRows, "snapshot_date"),
      endDate: lastStableDate(bindingRows, "snapshot_date"),
    }),
    axis: Object.freeze({
      serviceDateCount: serviceDates.length,
      startDate: serviceDates.at(0) ?? null,
      endDate: serviceDates.at(-1) ?? null,
    }),
    transformer: Object.freeze({
      status: transformerResult?.status ?? "not_run",
      blockers:
        transformerResult?.status === "blocked"
          ? transformerResult.blockers
          : Object.freeze([]),
      coverage: transformerResult?.coverage ?? null,
      scenarioInitialCapitalBound: transformerResult?.status === "ready",
    }),
    blockers: uniqueBlockers,
    boundaries: Object.freeze({
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      pageOrRuntimeImports: 0,
    }),
  });
}

function matchesPositionDecision(row, decision) {
  return (
    equalText(row.asset_name, decision.assetName) &&
    equalText(row.account, decision.account) &&
    equalText(row.market, decision.market) &&
    equalText(row.currency, decision.currency, true) &&
    equalText(row.asset_type, decision.assetType)
  );
}

function matchesEventDecision(row, decision) {
  return (
    equalText(row.asset_name, decision.assetName) &&
    equalText(row.account, decision.account)
  );
}

function equalText(left, right, upper = false) {
  const normalize = upper
    ? (value) => normalizeText(value).toUpperCase()
    : (value) => normalizeText(value).toLowerCase();
  return normalize(left) !== "" && normalize(left) === normalize(right);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isStableText(value) {
  return normalizeText(value) !== "" && value === value.trim();
}

function isLegacyId(value) {
  return typeof value === "string" && LEGACY_ID_PATTERN.test(value);
}

function isSafeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nullableArray(value) {
  return Array.isArray(value) ? value : null;
}

function uniqueStable(values) {
  return [...new Set(values.filter((value) => value !== ""))].sort();
}

function firstStableDate(rows, key) {
  const values = rows
    .map((row) => row[key])
    .filter((value) => typeof value === "string")
    .sort();
  return values.at(0) ?? null;
}

function lastStableDate(rows, key) {
  const values = rows
    .map((row) => row[key])
    .filter((value) => typeof value === "string")
    .sort();
  return values.at(-1) ?? null;
}
