import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  portfolioDashboardBaselineWindowStart,
  resolvePortfolioDashboardBaselineWindow,
  selectLatestPortfolioDashboardBaselineRows,
} from "../src/lib/portfolio-dashboard-baseline.ts";

describe("portfolio dashboard movement baseline", () => {
  it("maps the service-date storage row to the prior-day baseline", () => {
    const result = selectLatestPortfolioDashboardBaselineRows(
      [
        { id: "previous", snapshotDate: "2026-08-23" },
        { id: "current-a", snapshotDate: "2026-08-24" },
        { id: "current-b", snapshotDate: "2026-08-24" },
      ],
      "2026-08-24",
    );

    assert.equal(result.storageSnapshotDate, "2026-08-24");
    assert.equal(result.baselineReferenceDate, "2026-08-23");
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ["current-a", "current-b"],
    );
  });

  it("falls back exactly one logical day when the current cycle is delayed", () => {
    const result = selectLatestPortfolioDashboardBaselineRows(
      [
        { id: "older", snapshotDate: "2026-08-22" },
        { id: "previous", snapshotDate: "2026-08-23" },
      ],
      "2026-08-24",
    );

    assert.equal(result.storageSnapshotDate, "2026-08-23");
    assert.equal(result.baselineReferenceDate, "2026-08-22");
    assert.deepEqual(result.rows.map((row) => row.id), ["previous"]);
  });

  it("rejects future and older evidence instead of hiding a prolonged gap", () => {
    const result = selectLatestPortfolioDashboardBaselineRows(
      [
        { id: "older", snapshotDate: "2026-08-22" },
        { id: "future", snapshotDate: "2026-08-25" },
      ],
      "2026-08-24",
    );

    assert.equal(result.storageSnapshotDate, null);
    assert.equal(result.baselineReferenceDate, null);
    assert.deepEqual(result.rows, []);
  });

  it("keeps service, logical baseline, and storage dates explicit", () => {
    assert.deepEqual(resolvePortfolioDashboardBaselineWindow("2026-08-24"), {
      serviceDate: "2026-08-24",
      expectedReferenceDate: "2026-08-23",
      fallbackReferenceDate: "2026-08-22",
      storageWindowStart: "2026-08-23",
      storageWindowEnd: "2026-08-24",
    });
    assert.deepEqual(resolvePortfolioDashboardBaselineWindow("2027-01-01"), {
      serviceDate: "2027-01-01",
      expectedReferenceDate: "2026-12-31",
      fallbackReferenceDate: "2026-12-30",
      storageWindowStart: "2026-12-31",
      storageWindowEnd: "2027-01-01",
    });
    assert.equal(
      portfolioDashboardBaselineWindowStart("2026-08-24"),
      "2026-08-23",
    );
  });

  it("uses the same bounded physical window in the database read", () => {
    const querySource = readFileSync(
      "src/db/queries/portfolio-dashboard.ts",
      "utf8",
    );
    assert.match(querySource, /gte\(dailyPositionSnapshots\.snapshotDate, baselineWindowStart\)/);
    assert.match(querySource, /lte\(dailyPositionSnapshots\.snapshotDate, serviceDate\)/);
    assert.match(querySource, /selectLatestPortfolioDashboardBaselineRows/);
    assert.match(querySource, /baselineReferenceDate/);

    const dashboardSource = readFileSync(
      "src/lib/portfolio-dashboard.ts",
      "utf8",
    );
    assert.match(
      dashboardSource,
      /const movementBaselineDate = baselineReferenceDate/,
    );
    assert.match(dashboardSource, /baselineDate: movementBaselineDate/);
    assert.match(dashboardSource, /referenceDate: movementBaselineDate/);
  });
});
