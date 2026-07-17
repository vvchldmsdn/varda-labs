import {
  closeCalendarReferenceDateForAsset,
  buildCycleForSnapshotDate,
} from "../../src/lib/snapshots/market-calendar.ts";
import { resolveInvestmentLabSpecialHoldingIdentity } from "../../src/lib/investment-lab-special-holding-authority.ts";

export const LEGACY_RECONSTRUCTION_CANDIDATE_POLICY = Object.freeze({
  version: "investment_lab_legacy_reconstructed_observed_candidate_v1",
  purpose: "select_only_evidence_verdict_not_actual_authority",
  source: "base44_imported_named_account_snapshots",
  accountAxis: Object.freeze(["brokerage", "isa", "irp"]),
  cycleBoundary: "07:00_Asia_Seoul_service_cycle",
  valuationFormula:
    "Math.round(max(0, quantity * exact_local_close * exact_fx + fractional_krw_value))",
  portfolioFormula: "Math.round(sum(unrounded_in_scope_position_values) + cash)",
  priorDatedFx:
    "allowed_only_when_description_date_and_value_bind_exactly_one_stored_ok_fx_rate",
  legacyFxReferenceDateField:
    "diagnostic_only_writer_stored_service_date_instead_of_source_date",
  fount: "exclude_on_same_account_date_source_axis_without_renormalization",
  krxGold: "blocked_until_instrument_keyed_official_close_authority_exists",
  output: "count_only",
});

export const LEGACY_RECONSTRUCTION_BLOCKERS = Object.freeze([
  "cycle_evidence_incomplete",
  "cycle_window_mismatch",
  "capture_outside_cycle",
  "portfolio_numeric_incomplete",
  "portfolio_membership_conflict",
  "position_identity_conflict",
  "position_numeric_incomplete",
  "fallback_price_marker",
  "listed_price_basis_not_close",
  "listed_reference_date_incomplete",
  "listed_reference_calendar_mismatch",
  "listed_price_evidence_missing",
  "listed_price_evidence_ambiguous",
  "listed_price_value_mismatch",
  "listed_price_source_mismatch",
  "krw_fx_not_one",
  "usd_fx_source_not_durable",
  "usd_fx_evidence_missing",
  "usd_fx_evidence_ambiguous",
  "usd_fx_value_mismatch",
  "position_formula_mismatch",
  "fount_exclusion_value_incomplete",
  "krx_gold_official_close_missing",
  "krx_gold_instrument_binding_unproven",
  "unknown_tickerless_holding",
  "portfolio_reconstruction_mismatch",
  "empty_candidate",
]);

const ACCOUNT_NAMES = LEGACY_RECONSTRUCTION_CANDIDATE_POLICY.accountAxis;
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildInvestmentLabLegacyReconstructionCandidateReport({ rows }) {
  const evidenceRows = Array.isArray(rows) ? rows : null;
  const groups = groupEvidenceRows(evidenceRows ?? []);
  const blockerCounts = Object.fromEntries(
    LEGACY_RECONSTRUCTION_BLOCKERS.map((blocker) => [blocker, 0]),
  );
  const byAccount = Object.fromEntries(
    ACCOUNT_NAMES.map((account) => [
      account,
      { accountDateGroups: 0, candidateGroups: 0, blockedGroups: 0 },
    ]),
  );
  const candidateAccountsByDate = new Map();
  const evidenceCounts = {
    positionRows: 0,
    includedRows: 0,
    listedRows: 0,
    exactPriceEvidenceRows: 0,
    priorDatedFxRows: 0,
    fountExcludedRows: 0,
    krxGoldRows: 0,
    unknownTickerlessRows: 0,
    fallbackPriceRows: 0,
    formulaMismatchRows: 0,
    legacyFxReferenceFieldMismatchRows: 0,
  };

  for (const group of groups) {
    const result = evaluateGroup(group, evidenceCounts);
    const accountCounts = byAccount[group.account];
    if (accountCounts) {
      accountCounts.accountDateGroups += 1;
      accountCounts[result.blockers.size === 0 ? "candidateGroups" : "blockedGroups"] += 1;
    }
    for (const blocker of result.blockers) blockerCounts[blocker] += 1;
    if (result.blockers.size === 0) {
      const accounts = candidateAccountsByDate.get(group.snapshotDate) ?? new Set();
      accounts.add(group.account);
      candidateAccountsByDate.set(group.snapshotDate, accounts);
    }
  }

  const candidateGroups = Object.values(byAccount).reduce(
    (sum, account) => sum + account.candidateGroups,
    0,
  );
  const completeNamedAccountDates = [...candidateAccountsByDate.values()].filter(
    (accounts) => ACCOUNT_NAMES.every((account) => accounts.has(account)),
  ).length;
  const status =
    groups.length === 0
      ? "unavailable"
      : candidateGroups === groups.length
        ? "candidate_evidence_available"
        : candidateGroups > 0
          ? "partial_candidate_evidence"
          : "blocked";

  return Object.freeze({
    audit: "investment_lab_legacy_reconstructed_observed_candidate",
    status,
    readOnly: true,
    policy: LEGACY_RECONSTRUCTION_CANDIDATE_POLICY,
    counts: Object.freeze({
      accountDateGroups: groups.length,
      candidateGroups,
      blockedGroups: groups.length - candidateGroups,
      completeNamedAccountDates,
      derivedAllCandidateDates: completeNamedAccountDates,
    }),
    byAccount: freezeNested(byAccount),
    evidence: Object.freeze(evidenceCounts),
    blockerGroups: Object.freeze(blockerCounts),
    authority: Object.freeze({
      valuationCandidateStatus: status,
      canonicalActualAuthority: "not_established",
      runtimeTrustStatus: "not_established",
      sameFlowCalculationAuthority: "blocked_event_timing_not_evaluated",
      historyStitching: "forbidden",
      currentWriterSplice: "forbidden",
    }),
    boundaries: Object.freeze({
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      runtimeImports: 0,
      pageOrUiChanges: 0,
      rawDatesOrValuesInOutput: 0,
    }),
  });
}

function groupEvidenceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const snapshotDate = stableText(row?.snapshot_date);
    const account = stableText(row?.account)?.toLowerCase();
    if (!snapshotDate || !ACCOUNT_NAMES.includes(account)) continue;
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

function evaluateGroup(group, evidenceCounts) {
  const blockers = new Set();
  const expectedCycle = buildCycleForSnapshotDate(
    group.snapshotDate,
    new Date(`${group.snapshotDate}T00:00:00.000Z`),
  );
  validateCycle(group.portfolio, "portfolio", expectedCycle, blockers);

  const portfolioTotal = finiteNumber(group.portfolio.portfolio_total_krw);
  const cash = finiteNumber(group.portfolio.cash_value_krw);
  const declaredAssetCount = nonNegativeInteger(group.portfolio.num_assets);
  if (portfolioTotal === null || cash === null) {
    blockers.add("portfolio_numeric_incomplete");
  }
  if (declaredAssetCount === null || declaredAssetCount !== group.positions.length) {
    blockers.add("portfolio_membership_conflict");
  }
  if (group.positions.length === 0) blockers.add("empty_candidate");

  const identityCounts = new Map();
  let rawIncludedTotal = 0;
  let fountStoredValue = 0;
  let includedRows = 0;

  for (const row of group.positions) {
    evidenceCounts.positionRows += 1;
    validateCycle(row, "position", expectedCycle, blockers);
    const legacyAssetId = stableText(row.legacy_asset_id);
    if (!legacyAssetId || nonNegativeInteger(row.identity_ticker_count) > 1) {
      blockers.add("position_identity_conflict");
    }
    if (legacyAssetId) {
      identityCounts.set(legacyAssetId, (identityCounts.get(legacyAssetId) ?? 0) + 1);
    }

    const identity = resolveInvestmentLabSpecialHoldingIdentity({
      ticker: stableText(row.effective_ticker),
      assetName: stableText(row.asset_name),
      account: group.account,
      source: stableText(group.portfolio.portfolio_source),
      market: stableText(row.market),
      currency: stableText(row.currency),
      assetType: stableText(row.asset_type),
    });
    const specialOutcome = identity.specialHoldingEvidence?.historicalAuthorityOutcome;
    const storedValue = finiteNumber(row.market_value_krw);

    if (specialOutcome === "intentionally_excluded") {
      evidenceCounts.fountExcludedRows += 1;
      if (storedValue === null) blockers.add("fount_exclusion_value_incomplete");
      else fountStoredValue += storedValue;
      continue;
    }

    includedRows += 1;
    evidenceCounts.includedRows += 1;
    const isGold = specialOutcome === "separate_valuation_model_required" &&
      identity.specialHoldingEvidence?.classification === "physical_commodity_position";
    const isUnknown = !identity.ticker && !isGold;
    if (isGold) {
      evidenceCounts.krxGoldRows += 1;
      const officialCandidate =
        stableText(row.price_source)?.toLowerCase() === "krx_open_api_gold_daily" &&
        stableText(row.price_basis)?.toLowerCase() === "official_close" &&
        stableText(row.reference_date) !== null;
      blockers.add(
        officialCandidate
          ? "krx_gold_instrument_binding_unproven"
          : "krx_gold_official_close_missing",
      );
    } else if (isUnknown) {
      evidenceCounts.unknownTickerlessRows += 1;
      blockers.add("unknown_tickerless_holding");
    } else {
      evidenceCounts.listedRows += 1;
      validateListedPrice(row, group.snapshotDate, blockers, evidenceCounts);
    }

    const formula = reconstructPosition(row, blockers, evidenceCounts);
    if (formula !== null) rawIncludedTotal += formula;
  }

  if ([...identityCounts.values()].some((count) => count > 1)) {
    blockers.add("position_identity_conflict");
  }
  if (includedRows === 0) blockers.add("empty_candidate");
  if (portfolioTotal !== null && cash !== null) {
    const candidateTotal = Math.round(rawIncludedTotal + cash);
    const storedScopeTotal = portfolioTotal - fountStoredValue;
    if (!nearlyEqual(candidateTotal, storedScopeTotal)) {
      blockers.add("portfolio_reconstruction_mismatch");
    }
  }

  return { blockers };
}

function validateCycle(row, prefix, expected, blockers) {
  const capturedAt = parseDate(row[`${prefix}_captured_at`]);
  const cycleStartAt = parseDate(row[`${prefix}_cycle_start_at`]);
  const cycleEndAt = parseDate(row[`${prefix}_cycle_end_at`]);
  if (!capturedAt || !cycleStartAt || !cycleEndAt) {
    blockers.add("cycle_evidence_incomplete");
    return;
  }
  if (
    cycleStartAt.getTime() !== expected.cycleStartAt.getTime() ||
    cycleEndAt.getTime() !== expected.cycleEndAt.getTime()
  ) {
    blockers.add("cycle_window_mismatch");
  }
  if (
    capturedAt.getTime() < cycleEndAt.getTime() ||
    capturedAt.getTime() >= cycleEndAt.getTime() + DAY_MS
  ) {
    blockers.add("capture_outside_cycle");
  }
}

function validateListedPrice(row, snapshotDate, blockers, evidenceCounts) {
  const basis = stableText(row.price_basis)?.toLowerCase();
  const source = stableText(row.price_source)?.toLowerCase();
  const description = stableText(row.position_description)?.toLowerCase() ?? "";
  if (
    basis?.includes("fallback") ||
    source?.includes("fallback") ||
    description.includes("fallback_current")
  ) {
    evidenceCounts.fallbackPriceRows += 1;
    blockers.add("fallback_price_marker");
  }
  if (basis !== "close") blockers.add("listed_price_basis_not_close");

  const referenceDate = stableText(row.reference_date);
  const priceDate = stableText(row.price_date);
  if (!referenceDate || !priceDate || referenceDate !== priceDate) {
    blockers.add("listed_reference_date_incomplete");
  } else {
    const expectedReference = closeCalendarReferenceDateForAsset(
      {
        market: stableText(row.market)?.toLowerCase() ?? "",
        currency: stableText(row.currency)?.toUpperCase() ?? "",
      },
      snapshotDate,
    );
    if (referenceDate !== expectedReference) {
      blockers.add("listed_reference_calendar_mismatch");
    }
  }

  const identityMatches = nonNegativeInteger(row.price_identity_match_count) ?? 0;
  const valueMatches = nonNegativeInteger(row.price_value_match_count) ?? 0;
  const sourceMatches = nonNegativeInteger(row.price_source_match_count) ?? 0;
  if (identityMatches === 0) blockers.add("listed_price_evidence_missing");
  else if (identityMatches > 1) blockers.add("listed_price_evidence_ambiguous");
  if (identityMatches === 1 && valueMatches !== 1) {
    blockers.add("listed_price_value_mismatch");
  }
  if (valueMatches === 1 && sourceMatches !== 1) {
    blockers.add("listed_price_source_mismatch");
  }
  if (identityMatches === 1 && valueMatches === 1 && sourceMatches === 1) {
    evidenceCounts.exactPriceEvidenceRows += 1;
  }
}

function reconstructPosition(row, blockers, evidenceCounts) {
  const quantity = finiteNumber(row.quantity);
  const closePrice = finiteNumber(row.close_price);
  const fractional = finiteNumber(row.fractional_krw_value);
  const storedValue = finiteNumber(row.market_value_krw);
  const currency = stableText(row.currency)?.toUpperCase();
  const storedFx = finiteNumber(row.fx_rate);
  if (
    quantity === null ||
    closePrice === null ||
    fractional === null ||
    storedValue === null ||
    !currency
  ) {
    blockers.add("position_numeric_incomplete");
    return null;
  }

  let fx = 1;
  if (currency === "USD") {
    fx = storedFx ?? 0;
    validateUsdFx(row, blockers, evidenceCounts);
  } else if (storedFx !== null && !nearlyEqual(storedFx, 1)) {
    blockers.add("krw_fx_not_one");
  }
  if (fx <= 0) {
    blockers.add("position_numeric_incomplete");
    return null;
  }

  const rawValue = Math.max(0, quantity * closePrice * fx + fractional);
  if (!nearlyEqual(Math.round(rawValue), storedValue)) {
    evidenceCounts.formulaMismatchRows += 1;
    blockers.add("position_formula_mismatch");
  }
  return rawValue;
}

function validateUsdFx(row, blockers, evidenceCounts) {
  const describedDate = stableText(row.described_fx_date);
  const snapshotDate = stableText(row.snapshot_date);
  const description = stableText(row.position_description) ?? "";
  if (!describedDate || !/fx_source=FxRate\(\d{4}-\d{2}-\d{2}\)/.test(description)) {
    blockers.add("usd_fx_source_not_durable");
    return;
  }
  if (snapshotDate && describedDate > snapshotDate) {
    blockers.add("usd_fx_source_not_durable");
  }
  if (describedDate < snapshotDate) evidenceCounts.priorDatedFxRows += 1;
  if (stableText(row.fx_reference_date) !== describedDate) {
    evidenceCounts.legacyFxReferenceFieldMismatchRows += 1;
  }

  const dateMatches = nonNegativeInteger(row.fx_date_match_count) ?? 0;
  const valueMatches = nonNegativeInteger(row.fx_value_match_count) ?? 0;
  const usableMatches = nonNegativeInteger(row.fx_usable_match_count) ?? 0;
  if (dateMatches === 0) blockers.add("usd_fx_evidence_missing");
  else if (dateMatches > 1 || usableMatches > 1) {
    blockers.add("usd_fx_evidence_ambiguous");
  }
  if (dateMatches > 0 && (valueMatches !== 1 || usableMatches !== 1)) {
    blockers.add("usd_fx_value_mismatch");
  }
}

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value) {
  const number = finiteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number >= 0
    ? number
    : null;
}

function stableText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseDate(value) {
  const text = stableText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= 0.000001;
}

function freezeNested(value) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, Object.freeze(nested)]),
    ),
  );
}
