import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FOUNT_BINDING_DISCOVERY_SQL,
  FOUNT_BINDING_EVENT_SQL,
  FOUNT_BINDING_POSITION_SQL,
  FOUNT_EVENT_EVIDENCE_SQL,
  FOUNT_PORTFOLIO_EVIDENCE_SQL,
  FOUNT_POSITION_EVIDENCE_SQL,
  FOUNT_SERVICE_DATES_SQL,
  loadInvestmentLabFountReadinessEvidence,
} from "../scripts/lib/investment-lab-fount-readiness-data.mjs";
import { buildInvestmentLabFountReadinessReport } from "../scripts/lib/investment-lab-fount-readiness-report.mjs";

const FOUNT_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";
const DECISION = Object.freeze({
  assetName: "Fount retirement service",
  account: "irp",
  market: "korea",
  currency: "KRW",
  assetType: "etf",
});

describe("investment lab Fount readiness audit", () => {
  it("reports SELECT-only readiness without exposing identity or adjusted values", () => {
    const report = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence: readyEvidence(),
    });

    assert.equal(report.status, "ready");
    assert.equal(
      report.readinessStatus,
      "select_only_evidence_ready_runtime_unbound",
    );
    assert.equal(report.binding.exactBindingResolved, true);
    assert.equal(report.binding.positionRows, 2);
    assert.equal(report.binding.metadataCollisionRows, 0);
    assert.equal(report.axis.serviceDateCount, 2);
    assert.equal(report.transformer.status, "ready");
    assert.equal(report.transformer.coverage.reconciledAllRowCount, 2);
    assert.equal(report.transformer.coverage.derivedAllRowCount, 2);
    assert.equal(report.transformer.coverage.storedAllRowCount, 2);
    assert.equal(report.transformer.coverage.sourceTransitionCount, 0);
    assert.equal(report.transformer.coverage.sourceTransitionDateCount, 0);
    assert.equal(report.transformer.scenarioInitialCapitalBound, true);

    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(FOUNT_ID), false);
    assert.equal(serialized.includes("1400.000000"), false);
    assert.equal(serialized.includes("scopeAdjustedObservedPath"), false);
    assert.equal(serialized.includes("scenarioInitialCapitalKrw"), false);
  });

  it("blocks missing, ambiguous, and invalid binding candidates", () => {
    for (const candidateRows of [
      [],
      [candidate(FOUNT_ID), candidate(OTHER_ID)],
      [candidate("not-a-legacy-id")],
    ]) {
      const report = buildInvestmentLabFountReadinessReport({
        decision: DECISION,
        evidence: {
          candidateRows,
          bindingPositionRows: null,
          bindingEventRows: null,
          serviceDateRows: null,
          portfolioRows: null,
          positionRows: null,
          eventRows: null,
        },
      });

      assert.equal(report.status, "blocked");
      assert.equal(report.transformer.status, "not_run");
      assert.equal(report.binding.exactBindingResolved, false);
    }
  });

  it("blocks all-history metadata reuse and discovery count mismatches", () => {
    const collision = readyEvidence();
    collision.bindingPositionRows[1] = {
      ...collision.bindingPositionRows[1],
      market: "us",
    };
    const collisionReport = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence: collision,
    });

    assert.equal(collisionReport.status, "blocked");
    assert.equal(collisionReport.binding.metadataCollisionRows, 1);
    assert.equal(
      collisionReport.blockers.includes("binding_metadata_collision"),
      true,
    );
    assert.equal(collisionReport.transformer.status, "not_run");

    const mismatch = readyEvidence();
    mismatch.candidateRows[0] = { ...mismatch.candidateRows[0], row_count: 1 };
    const mismatchReport = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence: mismatch,
    });
    assert.equal(
      mismatchReport.blockers.includes("binding_history_count_mismatch"),
      true,
    );
  });

  it("blocks event metadata reuse before transformation", () => {
    const evidence = readyEvidence();
    evidence.bindingEventRows.push({
      legacy_asset_id: FOUNT_ID,
      event_date: "2026-01-02",
      account: "brokerage",
      asset_name: DECISION.assetName,
    });

    const report = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence,
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.binding.eventMetadataCollisionRows, 1);
    assert.equal(report.transformer.status, "not_run");
  });

  it("surfaces only reason codes when selected-window events block the transform", () => {
    const evidence = readyEvidence();
    evidence.bindingEventRows.push({
      legacy_asset_id: FOUNT_ID,
      event_date: "2026-01-02",
      account: DECISION.account,
      asset_name: DECISION.assetName,
    });
    evidence.eventRows.push({
      event_date: "2026-01-02",
      legacy_asset_id: FOUNT_ID,
    });

    const report = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence,
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.transformer.status, "blocked");
    assert.deepEqual(report.transformer.blockers, [
      "excluded_holding_event_present",
    ]);
    assert.equal(JSON.stringify(report).includes(FOUNT_ID), false);
  });

  it("keeps production-style source transitions blocked and aggregate-only", () => {
    const evidence = readyEvidence();
    evidence.bindingPositionRows[1] = {
      ...evidence.bindingPositionRows[1],
      source: "replacement_source",
    };
    evidence.portfolioRows = evidence.portfolioRows.map((row) =>
      row.snapshot_date === "2026-01-03" && row.account === "irp"
        ? { ...row, source: "replacement_source" }
        : row,
    );
    evidence.positionRows[1] = {
      ...evidence.positionRows[1],
      source: "replacement_source",
    };

    const report = buildInvestmentLabFountReadinessReport({
      decision: DECISION,
      evidence,
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.transformer.status, "blocked");
    assert.deepEqual(report.transformer.blockers, [
      "portfolio_source_transition_unproven",
    ]);
    assert.equal(report.transformer.coverage.sourceTransitionCount, 1);
    assert.equal(report.transformer.coverage.sourceTransitionDateCount, 1);
    assert.equal(JSON.stringify(report).includes(FOUNT_ID), false);
  });

  it("loads only parameterized SELECT evidence and keeps the identity internal", async () => {
    const fixture = readyEvidence();
    const rowsByQuery = new Map([
      [FOUNT_BINDING_DISCOVERY_SQL, fixture.candidateRows],
      [FOUNT_BINDING_POSITION_SQL, fixture.bindingPositionRows],
      [FOUNT_BINDING_EVENT_SQL, fixture.bindingEventRows],
      [FOUNT_SERVICE_DATES_SQL, fixture.serviceDateRows],
      [FOUNT_PORTFOLIO_EVIDENCE_SQL, fixture.portfolioRows],
      [FOUNT_POSITION_EVIDENCE_SQL, fixture.positionRows],
      [FOUNT_EVENT_EVIDENCE_SQL, fixture.eventRows],
    ]);
    const calls = [];
    const sql = {
      query(query, params) {
        calls.push({ query, params });
        return Promise.resolve(rowsByQuery.get(query));
      },
    };

    const evidence = await loadInvestmentLabFountReadinessEvidence(
      sql,
      DECISION,
    );

    assert.equal(calls.length, 7);
    assert.deepEqual(calls[0].params, [
      DECISION.assetName,
      DECISION.account,
      DECISION.market,
      DECISION.currency,
      DECISION.assetType,
    ]);
    assert.deepEqual(calls[1].params, [FOUNT_ID]);
    assert.deepEqual(calls[2].params, [FOUNT_ID]);
    assert.equal("candidateId" in evidence, false);

    for (const call of calls) {
      const normalized = call.query.trim().toLowerCase();
      assert.equal(
        normalized.startsWith("select") || normalized.startsWith("with"),
        true,
      );
      assert.equal(
        /\b(insert|update|delete|alter|drop|truncate|create)\b/.test(
          normalized,
        ),
        false,
      );
      assert.equal(call.query.includes(FOUNT_ID), false);
    }
  });

  it("stays outside page, runtime, provider, and write boundaries", () => {
    const sources = [
      "scripts/lib/investment-lab-fount-readiness-data.mjs",
      "scripts/lib/investment-lab-fount-readiness-report.mjs",
      "scripts/audit-investment-lab-fount-readiness.mjs",
    ].map((path) => readFileSync(path, "utf8"));
    const runtimeSources = [
      "src/lib/investment-lab-counterfactual-read-loader.ts",
      "src/lib/investment-lab-anchor-basket-read-loader.ts",
      "src/db/queries/investment-lab.ts",
      "src/app/investment-lab/page.tsx",
    ].map((path) => readFileSync(path, "utf8"));

    assert.equal(sources.some((source) => source.includes("fetch(")), false);
    assert.equal(sources.some((source) => source.includes("process.env.KIS")), false);
    assert.equal(
      runtimeSources.some((source) =>
        source.includes("investment-lab-fount-readiness"),
      ),
      false,
    );
  });
});

function readyEvidence() {
  return {
    candidateRows: [candidate(FOUNT_ID)],
    bindingPositionRows: [
      bindingPosition("2026-01-02"),
      bindingPosition("2026-01-03"),
    ],
    bindingEventRows: [],
    serviceDateRows: [
      { service_date: "2026-01-02" },
      { service_date: "2026-01-03" },
    ],
    portfolioRows: [
      ...portfolioDate("2026-01-02", 1000, 200, 300),
      ...portfolioDate("2026-01-03", 1100, 200, 350),
    ],
    positionRows: [
      position("2026-01-02", "100.000000"),
      position("2026-01-03", "120.000000"),
    ],
    eventRows: [],
  };
}

function candidate(id) {
  return {
    legacy_asset_id: id,
    row_count: 2,
    start_date: "2026-01-02",
    end_date: "2026-01-03",
  };
}

function bindingPosition(snapshotDate) {
  return {
    legacy_asset_id: FOUNT_ID,
    snapshot_date: snapshotDate,
    account: DECISION.account,
    source: "stored",
    asset_name: DECISION.assetName,
    market: DECISION.market,
    currency: DECISION.currency,
    asset_type: DECISION.assetType,
  };
}

function portfolioDate(snapshotDate, brokerage, isa, irp) {
  const source = "stored";
  return [
    {
      snapshot_date: snapshotDate,
      account: "brokerage",
      source,
      total_market_value_krw: `${brokerage}.000000`,
    },
    {
      snapshot_date: snapshotDate,
      account: "isa",
      source,
      total_market_value_krw: `${isa}.000000`,
    },
    {
      snapshot_date: snapshotDate,
      account: "irp",
      source,
      total_market_value_krw: `${irp}.000000`,
    },
    {
      snapshot_date: snapshotDate,
      account: "all",
      source,
      total_market_value_krw: `${brokerage + isa + irp}.000000`,
    },
  ];
}

function position(snapshotDate, marketValueKrw) {
  return {
    snapshot_date: snapshotDate,
    account: DECISION.account,
    source: "stored",
    legacy_asset_id: FOUNT_ID,
    market_value_krw: marketValueKrw,
  };
}
