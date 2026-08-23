import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  portfolioDashboardBaselineWindowStart,
  selectLatestPortfolioDashboardBaselineRows,
} from "../src/lib/portfolio-dashboard-baseline.ts";

describe("portfolio dashboard movement baseline", () => {
  it("prefers the expected snapshot date when it is present", () => {
    const result = selectLatestPortfolioDashboardBaselineRows(
      [
        { id: "previous", snapshotDate: "2026-08-23" },
        { id: "current-a", snapshotDate: "2026-08-24" },
        { id: "current-b", snapshotDate: "2026-08-24" },
      ],
      "2026-08-24",
    );

    assert.equal(result.snapshotDate, "2026-08-24");
    assert.deepEqual(
      result.rows.map((row) => row.id),
      ["current-a", "current-b"],
    );
  });

  it("uses the immediately prior snapshot while the current cycle is delayed", () => {
    const result = selectLatestPortfolioDashboardBaselineRows(
      [
        { id: "older", snapshotDate: "2026-08-22" },
        { id: "previous", snapshotDate: "2026-08-23" },
      ],
      "2026-08-24",
    );

    assert.equal(result.snapshotDate, "2026-08-23");
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

    assert.equal(result.snapshotDate, null);
    assert.deepEqual(result.rows, []);
  });

  it("uses the same bounded window in the database read", () => {
    assert.equal(
      portfolioDashboardBaselineWindowStart("2026-08-24"),
      "2026-08-23",
    );

    const source = readFileSync(
      "src/db/queries/portfolio-dashboard.ts",
      "utf8",
    );
    assert.match(source, /gte\(dailyPositionSnapshots\.snapshotDate, baselineWindowStart\)/);
    assert.match(source, /lte\(dailyPositionSnapshots\.snapshotDate, snapshotDate\)/);
    assert.match(source, /selectLatestPortfolioDashboardBaselineRows/);
  });
});
