import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildCoreMarketFactorRows } from "../src/lib/market-data/core-market-factor-metrics.ts";
import {
  CORE_MARKET_FACTOR_DEFINITIONS,
  CORE_MARKET_FACTOR_REFRESH_POLICY,
} from "../src/lib/market-data/core-market-factor-policy.ts";
import {
  buildFredSeriesCsvUrl,
  parseFredSeriesCsv,
} from "../src/lib/market-data/core-market-factor-source.ts";

describe("core market factor refresh", () => {
  it("parses the official FRED graph CSV and skips missing observations", () => {
    const rows = parseFredSeriesCsv(
      [
        "observation_date,DGS10",
        "2026-08-27,4.67",
        "2026-08-28,.",
        "2026-08-31,4.75",
      ].join("\n"),
      "DGS10",
    );

    assert.deepEqual(rows, [
      { date: "2026-08-27", value: 4.67 },
      { date: "2026-08-31", value: 4.75 },
    ]);
    const url = new URL(
      buildFredSeriesCsvUrl("DGS10", "2026-08-01", "2026-08-31"),
    );
    assert.equal(url.hostname, "fred.stlouisfed.org");
    assert.equal(url.searchParams.get("id"), "DGS10");
    assert.equal(url.searchParams.get("cosd"), "2026-08-01");
    assert.equal(url.searchParams.get("coed"), "2026-08-31");
  });

  it("derives bounded metrics from real observations without filling dates", () => {
    const observations = Array.from({ length: 220 }, (_, index) => ({
      date: shiftDate("2025-01-01", index),
      value: 1_300 + index * 0.4 + Math.sin(index / 7),
    }));
    const rows = buildCoreMarketFactorRows({
      definition: CORE_MARKET_FACTOR_DEFINITIONS[0],
      observations,
      observedAt: new Date("2026-09-01T22:00:00.000Z"),
      writeFromDate: observations[180].date,
    });

    assert.equal(rows.length, 40);
    assert.equal(rows[0].factorDate, observations[180].date);
    assert.equal(rows[0].sourceSeriesId, "FRANKFURTER_USD_KRW");
    assert.ok(Number(rows[0].volatility20dPct) >= 0);
    assert.ok(Number(rows[0].volatility60dPct) >= 0);
    assert.ok(Number(rows[0].percentile1y) >= 0);
    assert.ok(Number(rows[0].percentile1y) <= 100);
    assert.equal(rows[0].releaseDate, rows[0].factorDate);
    assert.equal(
      rows[0].derivedMetricsJson.calculationVersion,
      CORE_MARKET_FACTOR_REFRESH_POLICY.version,
    );
  });

  it("keeps the writer idempotent and the cron integration non-blocking", () => {
    const job = read("src/lib/market-data/core-market-factor-refresh-job.ts");
    const runner = read("src/lib/cron-market-cycle-runner.ts");
    const schema = read("src/db/schema.ts");

    assert.match(job, /^import "server-only";/);
    assert.match(job, /onConflictDoNothing/);
    assert.match(job, /factorKey[\s\S]*factorDate/);
    assert.doesNotMatch(job, /canonicalOwnerUserId|ownerUserId|tenantContext/);
    assert.match(runner, /try \{[\s\S]*runCoreMarketFactorRefreshJob/);
    assert.match(runner, /catch \{[\s\S]*status: "failed"/);
    assert.match(
      schema,
      /global_market_factors_factor_key_date_unique/,
    );
  });
});

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
