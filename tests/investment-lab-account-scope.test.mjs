import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInvestmentLabCounterfactualReadModel } from "../src/lib/investment-lab-counterfactual-read-model.ts";
import {
  listInvestmentLabCompleteSnapshotDates,
  resolveInvestmentLabSourceSegmentAuthority,
} from "../src/lib/investment-lab-source-segment-authority.ts";
import {
  buildPortfolioAccountScopeHref,
  normalizePortfolioAccountScope,
} from "../src/lib/portfolio-account-scope.ts";

describe("investment lab account scope", () => {
  it("normalizes account params and keeps the selected scope in URL state", () => {
    assert.equal(normalizePortfolioAccountScope("ISA"), "isa");
    assert.equal(normalizePortfolioAccountScope(["irp"]), "irp");
    assert.equal(normalizePortfolioAccountScope(["isa", "irp"]), "all");
    assert.equal(normalizePortfolioAccountScope("unknown", "brokerage"), "brokerage");
    assert.equal(
      buildPortfolioAccountScopeHref("/investment-lab", "isa", {
        account: "brokerage",
        start: "2026-01-02",
        tag: ["one", "two"],
      }),
      "/investment-lab?start=2026-01-02&tag=one&tag=two&account=isa",
    );
  });

  it("admits a selected account independently of other account gaps", () => {
    const rows = [
      snapshot("2026-01-02", "brokerage", 500),
      snapshot("2026-01-05", "brokerage", 520),
      snapshot("2026-01-02", "isa", 300, "base44_import", null),
    ];

    assert.deepEqual(
      listInvestmentLabCompleteSnapshotDates(rows, "brokerage"),
      ["2026-01-02", "2026-01-05"],
    );
    const authority = resolveInvestmentLabSourceSegmentAuthority(
      rows,
      "brokerage",
    );
    assert.equal(authority.status, "eligible");
    assert.equal(authority.coverage.completeDateCount, 2);
    assert.deepEqual(authority.blockers, []);
  });

  it("isolates selected snapshots and event flows", () => {
    const source = fixture();
    source.snapshotRows = source.snapshotRows.filter(
      (row) => row.account !== "irp",
    );
    const result = buildInvestmentLabCounterfactualReadModel(source, {
      account: "brokerage",
    });

    assert.equal(result.status, "ready");
    assert.equal(result.scenario.account, "brokerage");
    assert.equal(result.summary.actualEndValueKrw, 540);
    assert.equal(result.coverage.snapshotSourceRows, 3);
    assert.equal(result.coverage.eventSourceRows, 1);
    assert.equal(result.coverage.eligibleFlowRows, 1);
    assert.equal(result.returnEstimate.status, "ready");
    assert.equal(result.vooComparison.status, "ready");
  });

  it("fails closed when an economic event cannot be assigned to an account", () => {
    const source = fixture();
    source.eventRows.push(event(null, "2026-01-04", 3, "buy", 50));
    const result = buildInvestmentLabCounterfactualReadModel(source, {
      account: "brokerage",
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["event_account_unresolved"]);
  });
});

function fixture() {
  return {
    snapshotRows: [
      ...snapshotDate("2026-01-02", [500, 300, 200]),
      ...snapshotDate("2026-01-05", [520, 310, 210]),
      ...snapshotDate("2026-01-06", [540, 320, 220]),
    ],
    eventRows: [
      event("brokerage", "2026-01-03", 0, "buy", 100),
      event("isa", "2026-01-03", 1, "buy", 900),
      event(null, "2026-01-04", 2, "asset_added", null),
    ],
    closeRows: [
      price("2026-01-01", 100),
      price("2026-01-05", 110),
      price("2026-01-06", 120),
    ],
    vooCloseRows: [
      price("2025-12-31", 100),
      price("2026-01-02", 101),
      price("2026-01-05", 102),
    ],
    fxRows: [
      {
        rateDate: "2026-01-05",
        usdKrw: 1_300,
        source: "fx_fixture",
        status: "ok",
      },
    ],
  };
}

function snapshotDate(snapshotDate, values) {
  return ["brokerage", "isa", "irp"].map((account, index) =>
    snapshot(snapshotDate, account, values[index]),
  );
}

function snapshot(
  snapshotDate,
  account,
  totalMarketValue,
  source = "varda_manual_daily_snapshot",
  ruleVersion = "varda-manual-daily-snapshot-v1",
) {
  return {
    snapshotDate,
    account,
    cashValue: 0,
    totalMarketValue,
    usdKrw: 1_300,
    source,
    ruleVersion,
  };
}

function event(account, eventDate, sequence, eventType, amountKrw) {
  return {
    account,
    eventDate,
    eventType,
    sequence,
    amountKrw,
    quantityDelta: null,
    price: null,
    fxRate: null,
    assetCurrency: "KRW",
    isCorrection: false,
  };
}

function price(priceDate, value) {
  return {
    priceDate,
    closePrice: value,
    adjustedClosePrice: value,
    source: "price_fixture",
  };
}
