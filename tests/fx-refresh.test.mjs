import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FX_REFRESH_DRY_RUN_CONTRACT,
  parseExchangeRateOpenAccessUsdKrwResponse,
  parseFrankfurterUsdKrwResponse,
  planFxRateWrite,
} from "../src/lib/market-data/fx-refresh.ts";

const fetchedAt = new Date("2026-07-08T10:00:00.000Z");

function candidate(overrides = {}) {
  return {
    provider: "er-api-open",
    pair: "USD/KRW",
    rateDate: "2026-07-07",
    usdKrw: "1531.72",
    source: "er-api_open_access",
    status: "ok",
    fetchedAt: fetchedAt.toISOString(),
    providerTimestamp: "2026-07-07T00:00:01.000Z",
    ...overrides,
  };
}

function existingRow(overrides = {}) {
  return {
    id: "fx-row-1",
    rateDate: "2026-07-07",
    usdKrw: "1531.72",
    source: "er-api_open_access",
    status: "ok",
    legacyBase44Id: null,
    ...overrides,
  };
}

describe("FX refresh provider parsing", () => {
  it("parses an ExchangeRate-API Open Access USD/KRW response", () => {
    const parsed = parseExchangeRateOpenAccessUsdKrwResponse(
      {
        result: "success",
        time_last_update_utc: "Tue, 07 Jul 2026 00:00:01 +0000",
        base_code: "USD",
        rates: {
          KRW: 1531.722979,
        },
      },
      { fetchedAt },
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.candidate.provider, "er-api-open");
    assert.equal(parsed.candidate.rateDate, "2026-07-07");
    assert.equal(parsed.candidate.usdKrw, "1531.722979");
    assert.equal(parsed.candidate.source, "er-api_open_access");
    assert.equal(parsed.candidate.fetchedAt, fetchedAt.toISOString());
  });

  it("parses a Frankfurter latest USD/KRW response", () => {
    const parsed = parseFrankfurterUsdKrwResponse(
      {
        amount: 1,
        base: "USD",
        date: "2026-07-07",
        rates: {
          KRW: 1530.45,
        },
      },
      { fetchedAt },
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.candidate.provider, "frankfurter");
    assert.equal(parsed.candidate.rateDate, "2026-07-07");
    assert.equal(parsed.candidate.usdKrw, "1530.45");
    assert.equal(parsed.candidate.source, "frankfurter");
  });

  it("parses the latest valid Frankfurter time-series date", () => {
    const parsed = parseFrankfurterUsdKrwResponse(
      {
        base: "USD",
        rates: {
          "2026-07-06": { KRW: 1528.1 },
          "2026-07-07": { KRW: 1531.2 },
        },
      },
      { fetchedAt },
    );

    assert.equal(parsed.ok, true);
    assert.equal(parsed.candidate.rateDate, "2026-07-07");
    assert.equal(parsed.candidate.usdKrw, "1531.2");
  });

  it("rejects malformed, empty, and non-positive provider rates", () => {
    const malformed = parseExchangeRateOpenAccessUsdKrwResponse(
      { result: "success", base_code: "USD", rates: {} },
      { fetchedAt },
    );
    const empty = parseFrankfurterUsdKrwResponse(
      { base: "USD", rates: {} },
      { fetchedAt },
    );
    const nonPositive = parseFrankfurterUsdKrwResponse(
      { base: "USD", date: "2026-07-07", rates: { KRW: 0 } },
      { fetchedAt },
    );

    assert.equal(malformed.ok, false);
    assert.equal(malformed.error, "missing_or_invalid_usdkrw");
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "missing_or_invalid_usdkrw");
    assert.equal(nonPositive.ok, false);
    assert.equal(nonPositive.error, "missing_or_invalid_usdkrw");
  });
});

describe("FX refresh row policy", () => {
  it("keeps dry-run scoped to no database writes", () => {
    assert.deepEqual(FX_REFRESH_DRY_RUN_CONTRACT.dryRunWrites, []);
    assert.equal(FX_REFRESH_DRY_RUN_CONTRACT.writesRunMetadataOnDryRun, false);
    assert.deepEqual(FX_REFRESH_DRY_RUN_CONTRACT.actualWriteTables, [
      "fx_rates",
    ]);
    assert.ok(
      FX_REFRESH_DRY_RUN_CONTRACT.forbiddenWriteTables.includes("assets"),
    );
    assert.ok(
      FX_REFRESH_DRY_RUN_CONTRACT.forbiddenWriteTables.includes(
        "daily_position_snapshots",
      ),
    );
  });

  it("plans an insert when no row exists for the provider date", () => {
    const plan = planFxRateWrite(candidate(), []);

    assert.equal(plan.action, "planned_insert");
    assert.equal(plan.reason, "new_varda_row");
    assert.deepEqual(plan.plannedWrites, {
      insert: 1,
      update: 0,
      skip: 0,
      blocked: 0,
    });
  });

  it("skips a same-date varda row with the same value", () => {
    const plan = planFxRateWrite(candidate(), [existingRow()]);

    assert.equal(plan.action, "planned_skip");
    assert.equal(plan.reason, "same_varda_row_value");
    assert.equal(plan.existingRowId, "fx-row-1");
  });

  it("plans an update for a same-date varda row with changed value", () => {
    const plan = planFxRateWrite(candidate({ usdKrw: "1532.00" }), [
      existingRow({ usdKrw: "1531.72" }),
    ]);

    assert.equal(plan.action, "planned_update");
    assert.equal(plan.reason, "varda_row_value_changed");
    assert.equal(plan.plannedWrites.update, 1);
  });

  it("skips same-date imported legacy rows", () => {
    const plan = planFxRateWrite(candidate({ usdKrw: "1532.00" }), [
      existingRow({ legacyBase44Id: "69a30bcb124f6c24a3519588" }),
    ]);

    assert.equal(plan.action, "planned_skip");
    assert.equal(plan.reason, "imported_legacy_row_preserved");
    assert.equal(plan.plannedWrites.skip, 1);
  });

  it("blocks duplicate date groups instead of guessing", () => {
    const plan = planFxRateWrite(candidate(), [
      existingRow({ id: "fx-row-1" }),
      existingRow({ id: "fx-row-2" }),
    ]);

    assert.equal(plan.action, "blocked");
    assert.equal(plan.reason, "duplicate_rate_date_rows");
    assert.equal(plan.plannedWrites.blocked, 1);
  });

  it("does not plan writes for provider failures", () => {
    const parsed = parseExchangeRateOpenAccessUsdKrwResponse(
      {
        result: "error",
        base_code: "USD",
        rates: { KRW: 1531.72 },
      },
      { fetchedAt },
    );

    assert.equal(parsed.ok, false);
    assert.equal(parsed.error, "provider_status_not_success");
  });
});
