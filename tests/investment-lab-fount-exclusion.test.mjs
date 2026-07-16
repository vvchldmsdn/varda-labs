import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY,
  buildInvestmentLabFountScopeAdjustment,
} from "../src/lib/investment-lab-fount-exclusion.ts";

const FOUNT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("investment lab Fount scope adjustment", () => {
  it("creates a separate exact-decimal path without mutating the source rows", () => {
    const input = fixture();
    const original = structuredClone(input);
    const result = buildInvestmentLabFountScopeAdjustment(input);

    assert.equal(result.status, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.readinessStatus, "pure_result_ready_runtime_unbound");
    assert.equal(result.scenarioInitialCapitalKrw, "1400.050000");
    assert.deepEqual(result.scopeAdjustedObservedPath, [
      {
        serviceDate: "2026-01-02",
        aggregateProvenance: "derived_named_account_sum",
        storedAllReconciliation: "matched",
        originalTotalMarketValueKrw: "1500.100000",
        excludedMarketValueKrw: "100.050000",
        adjustedTotalMarketValueKrw: "1400.050000",
      },
      {
        serviceDate: "2026-01-03",
        aggregateProvenance: "derived_named_account_sum",
        storedAllReconciliation: "matched",
        originalTotalMarketValueKrw: "1650.200000",
        excludedMarketValueKrw: "120.010000",
        adjustedTotalMarketValueKrw: "1530.190000",
      },
    ]);
    assert.deepEqual(
      result.accountRows.filter((row) => row.account === "irp"),
      [
        {
          serviceDate: "2026-01-02",
          account: "irp",
          source: "stored",
          originalTotalMarketValueKrw: "300.000000",
          excludedMarketValueKrw: "100.050000",
          adjustedTotalMarketValueKrw: "199.950000",
        },
        {
          serviceDate: "2026-01-03",
          account: "irp",
          source: "stored",
          originalTotalMarketValueKrw: "350.000000",
          excludedMarketValueKrw: "120.010000",
          adjustedTotalMarketValueKrw: "229.990000",
        },
      ],
    );
    assert.equal(result.coverage.reconciledAllRowCount, 2);
    assert.equal(result.coverage.derivedAllRowCount, 2);
    assert.equal(result.coverage.storedAllRowCount, 2);
    assert.equal(result.coverage.sourceTransitionCount, 0);
    assert.equal(result.coverage.sourceTransitionDateCount, 0);
    assert.equal(result.coverage.adjustedDateCount, 2);
    assert.deepEqual(input, original);
    assert.equal(Object.isFrozen(result.scopeAdjustedObservedPath), true);
    assert.equal("snapshotLegacyAssetId" in result, false);
  });

  it("uses only the exact snapshot identity and never display fallbacks", () => {
    const input = fixture();
    input.positionRows = input.positionRows.map((row) => ({
      ...row,
      snapshotLegacyAssetId: OTHER_ID,
      assetName: "Fount",
      ticker: "Fount",
    }));

    const result = buildInvestmentLabFountScopeAdjustment(input);

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["exclusion_evidence_missing"]);
    assert.deepEqual(result.scopeAdjustedObservedPath, []);
  });

  it("fails closed for duplicate, wrong-account, or source-mismatched evidence", () => {
    const duplicate = fixture();
    duplicate.positionRows.push({ ...duplicate.positionRows[0] });
    assert.deepEqual(
      buildInvestmentLabFountScopeAdjustment(duplicate).blockers,
      ["exclusion_evidence_duplicate"],
    );

    const wrongAccount = fixture();
    wrongAccount.positionRows[0] = {
      ...wrongAccount.positionRows[0],
      account: "brokerage",
    };
    assert.deepEqual(
      buildInvestmentLabFountScopeAdjustment(wrongAccount).blockers,
      ["exclusion_axis_mismatch"],
    );

    const wrongSource = fixture();
    wrongSource.positionRows[0] = {
      ...wrongSource.positionRows[0],
      source: "other_source",
    };
    assert.deepEqual(
      buildInvestmentLabFountScopeAdjustment(wrongSource).blockers,
      ["exclusion_axis_mismatch"],
    );
  });

  it("blocks unproven source transitions across the selected service axis", () => {
    const input = fixture();
    input.portfolioRows = input.portfolioRows.map((row) =>
      row.snapshotDate === "2026-01-03" && row.account === "irp"
        ? { ...row, source: "replacement_source" }
        : row,
    );
    input.positionRows = input.positionRows.map((row) =>
      row.snapshotDate === "2026-01-03" &&
      row.snapshotLegacyAssetId === FOUNT_ID
        ? { ...row, source: "replacement_source" }
        : row,
    );

    const result = buildInvestmentLabFountScopeAdjustment(input);

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      "portfolio_source_transition_unproven",
    ]);
    assert.equal(result.coverage.sourceTransitionCount, 1);
    assert.equal(result.coverage.sourceTransitionDateCount, 1);
    assert.deepEqual(result.scopeAdjustedObservedPath, []);
  });

  it("keeps missing stored all rows explicit instead of relabeling a derived sum", () => {
    const input = fixture();
    input.portfolioRows = input.portfolioRows.filter(
      (row) => row.account !== "all",
    );

    const result = buildInvestmentLabFountScopeAdjustment(input);

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.derivedAllRowCount, 2);
    assert.equal(result.coverage.storedAllRowCount, 0);
    assert.equal(result.coverage.reconciledAllRowCount, 0);
    assert.deepEqual(
      result.scopeAdjustedObservedPath.map((row) => ({
        aggregateProvenance: row.aggregateProvenance,
        storedAllReconciliation: row.storedAllReconciliation,
      })),
      [
        {
          aggregateProvenance: "derived_named_account_sum",
          storedAllReconciliation: "not_present",
        },
        {
          aggregateProvenance: "derived_named_account_sum",
          storedAllReconciliation: "not_present",
        },
      ],
    );
  });

  it("fails closed for missing or inconsistent aggregate evidence", () => {
    const missing = fixture();
    missing.portfolioRows = missing.portfolioRows.filter(
      (row) => !(row.snapshotDate === "2026-01-02" && row.account === "isa"),
    );
    const missingResult = buildInvestmentLabFountScopeAdjustment(missing);
    assert.equal(missingResult.status, "blocked");
    assert.deepEqual(missingResult.blockers, ["portfolio_evidence_incomplete"]);
    assert.deepEqual(missingResult.accountRows, []);

    const mismatch = fixture();
    mismatch.portfolioRows = mismatch.portfolioRows.map((row) =>
      row.snapshotDate === "2026-01-02" && row.account === "all"
        ? { ...row, totalMarketValueKrw: "1500.100001" }
        : row,
    );
    assert.deepEqual(
      buildInvestmentLabFountScopeAdjustment(mismatch).blockers,
      ["portfolio_all_reconciliation_mismatch"],
    );
  });

  it("rejects inexact numbers, negative values, overflow, and over-subtraction", () => {
    const inexact = fixture();
    inexact.positionRows[0] = {
      ...inexact.positionRows[0],
      marketValueKrw: 100.05,
    };
    assert.deepEqual(buildInvestmentLabFountScopeAdjustment(inexact).blockers, [
      "invalid_exclusion_value",
    ]);

    const negative = fixture();
    negative.positionRows[0] = {
      ...negative.positionRows[0],
      marketValueKrw: "-0.000001",
    };
    assert.deepEqual(buildInvestmentLabFountScopeAdjustment(negative).blockers, [
      "invalid_exclusion_value",
    ]);

    const overSubtract = fixture();
    overSubtract.positionRows[0] = {
      ...overSubtract.positionRows[0],
      marketValueKrw: "300.000001",
    };
    assert.deepEqual(
      buildInvestmentLabFountScopeAdjustment(overSubtract).blockers,
      ["exclusion_value_exceeds_account_total"],
    );

    const overflow = fixture();
    overflow.portfolioRows = overflow.portfolioRows.filter(
      (row) => row.account !== "all",
    );
    overflow.portfolioRows = overflow.portfolioRows.map((row) => ({
      ...row,
      totalMarketValueKrw: "999999999999999999.999999",
    }));
    assert.equal(
      buildInvestmentLabFountScopeAdjustment(overflow).blockers.includes(
        "aggregate_value_overflow",
      ),
      true,
    );
  });

  it("blocks excluded or unattributed events inside the selected window", () => {
    const related = fixture();
    related.eventRows = [
      { eventDate: "2026-01-02", legacyAssetId: FOUNT_ID },
      { eventDate: "2026-01-02", legacyAssetId: OTHER_ID },
    ];
    const relatedResult = buildInvestmentLabFountScopeAdjustment(related);
    assert.equal(relatedResult.status, "blocked");
    assert.deepEqual(relatedResult.blockers, [
      "excluded_holding_event_present",
    ]);
    assert.equal(relatedResult.coverage.excludedHoldingEventRowCount, 1);

    const unattributed = fixture();
    unattributed.eventRows = [
      { eventDate: "2026-01-03", legacyAssetId: null },
    ];
    const unattributedResult =
      buildInvestmentLabFountScopeAdjustment(unattributed);
    assert.deepEqual(unattributedResult.blockers, [
      "unattributed_event_present",
    ]);
    assert.equal(unattributedResult.coverage.unattributedEventRowCount, 1);

    const outside = fixture();
    outside.eventRows = [
      { eventDate: "2026-01-01", legacyAssetId: FOUNT_ID },
      { eventDate: "2026-01-04", legacyAssetId: null },
    ];
    assert.equal(buildInvestmentLabFountScopeAdjustment(outside).status, "ready");
  });

  it("requires a strictly ordered date axis and a valid static binding", () => {
    const dates = fixture();
    dates.serviceDates = ["2026-01-03", "2026-01-02"];
    assert.deepEqual(buildInvestmentLabFountScopeAdjustment(dates).blockers, [
      "invalid_service_date_axis",
    ]);

    const binding = fixture();
    binding.staticBinding = {
      ...binding.staticBinding,
      snapshotLegacyAssetId: "not-an-object-id",
    };
    assert.deepEqual(buildInvestmentLabFountScopeAdjustment(binding).blockers, [
      "invalid_static_exclusion_binding",
    ]);
  });

  it("stays pure and detached from DB, provider, loader, and UI boundaries", () => {
    const source = readFileSync(
      "src/lib/investment-lab-fount-exclusion.ts",
      "utf8",
    );
    const runtimeSources = [
      "src/lib/investment-lab-counterfactual-read-loader.ts",
      "src/lib/investment-lab-anchor-basket-read-loader.ts",
      "src/db/queries/investment-lab.ts",
      "src/app/investment-lab/page.tsx",
    ].map((path) => readFileSync(path, "utf8"));

    assert.equal(source.includes("src/db"), false);
    assert.equal(source.includes("process.env"), false);
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("assetName"), false);
    assert.equal(source.includes("ticker"), false);
    assert.equal(
      runtimeSources.some((runtimeSource) =>
        runtimeSource.includes("investment-lab-fount-exclusion"),
      ),
      false,
    );
    assert.equal(
      INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.originalAggregateMutation,
      "forbidden",
    );
    assert.equal(
      INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.remainingHoldingRenormalization,
      "forbidden",
    );
    assert.equal(
      INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.aggregateConstruction,
      "derived_named_account_sum",
    );
    assert.equal(
      INVESTMENT_LAB_FOUNT_EXCLUSION_POLICY.storedAllRole,
      "optional_reconciliation_evidence_only",
    );
  });
});

function fixture() {
  return {
    staticBinding: {
      selectorBasis: "exact_snapshot_legacy_asset_id",
      snapshotLegacyAssetId: FOUNT_ID,
      account: "irp",
    },
    serviceDates: ["2026-01-02", "2026-01-03"],
    portfolioRows: [
      portfolio("2026-01-02", "brokerage", "1000.1"),
      portfolio("2026-01-02", "isa", "200"),
      portfolio("2026-01-02", "irp", "300"),
      portfolio("2026-01-02", "all", "1500.1"),
      portfolio("2026-01-03", "brokerage", "1100.2"),
      portfolio("2026-01-03", "isa", "200"),
      portfolio("2026-01-03", "irp", "350"),
      portfolio("2026-01-03", "all", "1650.2"),
    ],
    positionRows: [
      position("2026-01-02", FOUNT_ID, "100.05"),
      position("2026-01-02", OTHER_ID, "50"),
      position("2026-01-03", FOUNT_ID, "120.01"),
      position("2026-01-03", OTHER_ID, "55"),
    ],
    eventRows: [],
  };
}

function portfolio(snapshotDate, account, totalMarketValueKrw) {
  return {
    snapshotDate,
    account,
    source: "stored",
    totalMarketValueKrw,
  };
}

function position(snapshotDate, snapshotLegacyAssetId, marketValueKrw) {
  return {
    snapshotDate,
    account: "irp",
    source: "stored",
    snapshotLegacyAssetId,
    marketValueKrw,
  };
}
