import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HISTORY_EVIDENCE_MAPPING_POLICY,
  buildHistoryEvidenceMapping,
} from "../src/lib/history-evidence-mapping.ts";
import {
  balanceRow,
  completeNamedPortfolioRows,
  portfolioRow,
} from "./fixtures/history-evidence-mapping.mjs";

describe("History evidence mapping adapter v1", () => {
  it("prefers one stored all row over named-account evidence", () => {
    const result = build({
      account: "all",
      portfolioRows: [
        portfolioRow({ account: "all", totalMarketValue: "1900" }),
        portfolioRow({ account: "brokerage" }),
      ],
    });
    const lane = result.lanes.portfolio;

    assert.equal(lane.status, "ready");
    assert.equal(lane.coverage.observedCount, 1);
    assert.equal(lane.coverage.displayableCount, 1);
    assert.equal(lane.reconstructedRowCount, 0);
    assert.equal(lane.rows[0].effectiveEvidenceKind, "observed");
    assert.equal(
      lane.rows[0].lineage.source,
      "daily_portfolio_snapshots:base44_import",
    );
  });

  it("maps a complete same-source named-account sum as reconstructed", () => {
    const result = build({
      account: "all",
      portfolioRows: completeNamedPortfolioRows(),
    });
    const lane = result.lanes.portfolio;

    assert.equal(lane.status, "partial");
    assert.equal(lane.coverage.observedCount, 0);
    assert.equal(lane.coverage.displayableCount, 1);
    assert.equal(lane.coverage.observedCoveragePct, 0);
    assert.equal(lane.coverage.displayCoveragePct, 100);
    assert.equal(lane.reconstructedRowCount, 1);
    assert.equal(lane.rows[0].effectiveEvidenceKind, "reconstructed");
    assert.equal(
      lane.rows[0].lineage.methodVersion,
      "history_all_account_sum_v1",
    );
  });

  it("keeps partial named accounts missing instead of deriving all", () => {
    const result = build({
      account: "all",
      portfolioRows: [
        portfolioRow({ account: "brokerage" }),
        portfolioRow({ account: "isa" }),
      ],
    });
    const lane = result.lanes.portfolio;

    assert.equal(lane.status, "unavailable");
    assert.equal(lane.coverage.requiredCount, 1);
    assert.equal(lane.coverage.displayableCount, 0);
    assert.deepEqual(lane.missingRequirementKeys, [
      "portfolio/all/2026-07-01",
    ]);
    assert.equal(
      lane.rows[0].lineage.reason,
      "named_portfolio_account_missing",
    );
  });

  it("marks duplicate named-account and stored-all evidence ambiguous", () => {
    const duplicateNamed = build({
      account: "all",
      portfolioRows: [
        ...completeNamedPortfolioRows(),
        portfolioRow({ account: "brokerage", source: "other_source" }),
      ],
    });
    const duplicateAll = build({
      account: "all",
      portfolioRows: [
        portfolioRow({ account: "all" }),
        portfolioRow({ account: "all", source: "other_source" }),
      ],
    });

    assert.deepEqual(
      duplicateNamed.lanes.portfolio.ambiguousRequirementKeys,
      ["portfolio/all/2026-07-01"],
    );
    assert.equal(
      duplicateNamed.lanes.portfolio.rows[0].lineage.reason,
      "duplicate_named_portfolio_account",
    );
    assert.deepEqual(duplicateAll.lanes.portfolio.ambiguousRequirementKeys, [
      "portfolio/all/2026-07-01",
    ]);
    assert.equal(
      duplicateAll.lanes.portfolio.rows[0].lineage.reason,
      "duplicate_portfolio_account_date",
    );
  });

  it("does not combine named accounts from mismatched sources", () => {
    const result = build({
      account: "all",
      portfolioRows: [
        portfolioRow({ account: "brokerage", source: "source_a" }),
        portfolioRow({ account: "isa", source: "source_a" }),
        portfolioRow({ account: "irp", source: "source_b" }),
      ],
    });

    assert.deepEqual(result.lanes.portfolio.ambiguousRequirementKeys, [
      "portfolio/all/2026-07-01",
    ]);
    assert.equal(
      result.lanes.portfolio.rows[0].lineage.reason,
      "named_portfolio_source_mismatch",
    );
  });

  it("treats stored zero as observed and null as missing", () => {
    const zero = build({
      account: "isa",
      balanceRows: [balanceRow({ isa: "0" })],
      portfolioRows: [portfolioRow({ account: "isa", totalMarketValue: 0 })],
    });
    const missing = build({
      account: "isa",
      balanceRows: [balanceRow({ isa: null })],
      portfolioRows: [portfolioRow({ account: "isa", totalMarketValue: null })],
    });

    assert.equal(zero.lanes.balance.rows[0].effectiveEvidenceKind, "observed");
    assert.equal(zero.lanes.portfolio.rows[0].effectiveEvidenceKind, "observed");
    assert.equal(missing.lanes.balance.rows[0].effectiveEvidenceKind, "missing");
    assert.equal(
      missing.lanes.portfolio.rows[0].effectiveEvidenceKind,
      "missing",
    );
  });

  it("keeps balance and portfolio date axes and denominators separate", () => {
    const result = buildHistoryEvidenceMapping({
      account: "brokerage",
      requiredDates: {
        balance: ["2026-06-30", "2026-07-01"],
        portfolio: ["2026-07-01", "2026-07-02", "2026-07-03"],
      },
      balanceRows: [balanceRow()],
      portfolioRows: [portfolioRow()],
    });

    assert.equal(result.lanes.balance.coverage.requiredCount, 2);
    assert.equal(result.lanes.portfolio.coverage.requiredCount, 3);
    assert.deepEqual(result.lanes.balance.requiredDates, [
      "2026-06-30",
      "2026-07-01",
    ]);
    assert.deepEqual(result.lanes.portfolio.requiredDates, [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    assert.equal(Object.hasOwn(result, "combinedCoverage"), false);
  });

  it("does not deduplicate caller-supplied date requirements", () => {
    const result = buildHistoryEvidenceMapping({
      account: "brokerage",
      requiredDates: {
        balance: [],
        portfolio: ["2026-07-01", "2026-07-01"],
      },
      balanceRows: [],
      portfolioRows: [portfolioRow()],
    });

    assert.equal(result.lanes.portfolio.status, "unavailable");
    assert.equal(result.lanes.portfolio.coverage.requiredCount, 2);
    assert.equal(result.lanes.portfolio.coverage.displayableCount, 0);
    assert.equal(result.lanes.portfolio.invalidRequirementKeys.length, 2);
    assert.ok(
      result.lanes.portfolio.rows.every((row) =>
        row.issues.includes("duplicate_requirement_key"),
      ),
    );
  });

  it("returns evidence metadata without financial values or runtime I/O", () => {
    const result = build({
      account: "all",
      balanceRows: [balanceRow({ cash: "987654321" })],
      portfolioRows: [
        portfolioRow({ account: "all", totalMarketValue: "123456789" }),
      ],
    });
    const serialized = JSON.stringify(result);
    const source = [
      "src/lib/history-evidence-mapping.ts",
      "src/lib/history-evidence-requirements.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.equal(
      HISTORY_EVIDENCE_MAPPING_POLICY.valueWeightedCoverage,
      "not_defined",
    );
    assert.doesNotMatch(serialized, /987654321|123456789/);
    assert.doesNotMatch(
      source,
      /drizzle|neon|server-only|fetch\s*\(|\/api\/|insert\s*\(|update\s*\(|delete\s*\(/i,
    );
  });
});

function build({
  account = "brokerage",
  balanceRows = [],
  portfolioRows = [],
}) {
  return buildHistoryEvidenceMapping({
    account,
    requiredDates: {
      balance: ["2026-07-01"],
      portfolio: ["2026-07-01"],
    },
    balanceRows,
    portfolioRows,
  });
}
