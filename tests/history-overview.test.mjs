import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHistoryOverview,
  HISTORY_OVERVIEW_POLICY,
} from "../src/lib/history-overview.ts";

describe("history overview", () => {
  it("selects the current stored source before imported and derived alternatives", () => {
    const model = buildHistoryOverview({
      rows: [
        row("2026-07-01", 100, {
          source: "base44_import",
          rowKind: "stored",
        }),
        row("2026-07-01", 110, {
          source: "varda_manual_daily_snapshot",
          rowKind: "stored",
        }),
        row("2026-07-01", 120, {
          source: "varda_manual_daily_snapshot",
          rowKind: "derived",
        }),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.latestValueKrw, 110);
    assert.equal(model.excludedAlternativeRowCount, 2);
    assert.equal(
      model.policy.rowAuthority,
      "stored_before_derived_before_partial_then_varda_before_base44",
    );
  });

  it("keeps missing dates as gaps while calculating point-to-point valuation movement", () => {
    const model = buildHistoryOverview({
      rows: [
        row("2026-07-01", 100),
        row("2026-07-03", 120),
        row("2026-07-04", 90),
        row("2026-07-05", 95),
      ],
    });

    assert.equal(HISTORY_OVERVIEW_POLICY.missingDates, "not_interpolated_or_carried");
    assert.equal(model.pointCount, 4);
    assert.equal(model.points[1].gapDays, 2);
    assert.equal(model.points[1].movementKrw, 20);
    assert.equal(model.valuationChangeKrw, -5);
    assert.equal(model.bestMovement?.date, "2026-07-03");
    assert.equal(model.worstMovement?.date, "2026-07-04");
    assert.equal(model.maxDrawdownKrw, -30);
    assert.equal(model.longestGainStreak, 1);
    assert.equal(model.longestLossStreak, 1);
  });

  it("attaches same-date events as context without changing valuations", () => {
    const model = buildHistoryOverview({
      rows: [row("2026-07-01", 100), row("2026-07-02", 130)],
      events: [
        {
          eventDate: "2026-07-02",
          eventType: "buy",
          assetName: "KODEX 200",
          accountName: "Brokerage",
          amountKrw: 20,
          quantityDelta: 1,
        },
      ],
    });

    assert.equal(model.eventCount, 1);
    assert.equal(model.points[1].events.length, 1);
    assert.equal(model.points[1].events[0].assetName, "KODEX 200");
    assert.equal(model.points[1].movementKrw, 30);
    assert.equal(
      model.policy.eventMeaning,
      "same_calendar_date_context_not_causal_attribution",
    );
  });

  it("preserves stored risk evidence but does not require it", () => {
    const model = buildHistoryOverview({
      rows: [
        row("2026-07-01", 100),
        row("2026-07-02", 110, {
          avgCorrelation: 0.42,
          enb: 4.3,
          portfolioVolatility: 12.6,
          regimeLabel: "stable",
          regimeScore: 71,
        }),
      ],
    });

    assert.equal(model.riskPointCount, 1);
    assert.equal(model.points[0].risk, null);
    assert.equal(model.points[1].risk?.enb, 4.3);
  });

  it("excludes conflicting rows with the same authority instead of guessing", () => {
    const model = buildHistoryOverview({
      rows: [
        row("2026-07-01", 100),
        row("2026-07-01", 200),
        row("2026-07-02", 220),
      ],
    });

    assert.equal(model.pointCount, 1);
    assert.equal(model.ambiguousDateCount, 1);
    assert.equal(model.excludedInvalidRowCount, 2);
  });
});

function row(snapshotDate, totalMarketValue, overrides = {}) {
  return {
    snapshotDate,
    account: "brokerage",
    source: "varda_manual_daily_snapshot",
    rowKind: "stored",
    derivedFromAccounts: [],
    cashValue: 10,
    investedAmount: 90,
    totalCost: 80,
    totalMarketValue,
    totalPnl: totalMarketValue - 80,
    totalReturnPct: ((totalMarketValue - 80) / 80) * 100,
    ...overrides,
  };
}
