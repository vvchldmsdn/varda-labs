import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCronPreflightResponse,
  parseCronPreflightQuery,
} from "../src/lib/cron-preflight.ts";

describe("cron preflight helpers", () => {
  it("accepts only the read-only preflight query contract", () => {
    assert.deepEqual(
      parseCronPreflightQuery(
        new URLSearchParams({
          date: "2026-07-08",
          account: "brokerage",
          mode: "preflight",
        }),
      ),
      {
        ok: true,
        snapshotDate: "2026-07-08",
        account: "brokerage",
        mode: "preflight",
      },
    );
  });

  it("rejects write-shaped or secret-shaped query parameters", () => {
    assert.equal(
      parseCronPreflightQuery(new URLSearchParams({ confirmWrite: "true" })).ok,
      false,
    );
    assert.equal(
      parseCronPreflightQuery(new URLSearchParams({ dryRun: "false" })).ok,
      false,
    );
    const sensitiveResult = parseCronPreflightQuery(
      new URLSearchParams({ kis_token: "value" }),
    );
    assert.equal(sensitiveResult.ok, false);
    assert.equal(sensitiveResult.error, "sensitive_query");
    assert.doesNotMatch(sensitiveResult.message, /token/i);
    assert.equal(
      parseCronPreflightQuery(new URLSearchParams({ provider: "kis" })).ok,
      false,
    );
  });

  it("summarizes missing close coverage without exposing actual-write params", () => {
    const response = buildCronPreflightResponse({
      snapshot: snapshotResult({
        ok: false,
        writeReady: false,
        missingCount: 1,
        staleCount: 0,
        suggestedKisBatches: [
          {
            market: "korea",
            expectedCloseDate: "2026-07-07",
            tickers: ["069500"],
            count: 1,
            maxBatchSize: 5,
            dryRunQuery:
              "/api/admin/market/prices/sync?provider=kis&mode=close&dryRun=true&market=korea&date=2026-07-07&tickers=069500&limit=1",
            manualWriteRequired: true,
            writeRequiresConfirmWrite: true,
            suggestedWriteParams: {
              provider: "kis",
              mode: "close",
              market: "korea",
              date: "2026-07-07",
              tickers: ["069500"],
              limit: 1,
            },
          },
        ],
      }),
      cronScheduleUtc: "10 22 * * 1-5",
    });

    const serialized = JSON.stringify(response);

    assert.equal(response.wouldWrite, false);
    assert.equal(response.secretsIncluded, false);
    assert.equal(response.closeCoverage.missingCount, 1);
    assert.equal(
      response.nextRecommendedAction,
      "manual_kis_close_dry_run_required",
    );
    assert.match(
      response.closeSyncPlan.suggestedBatches[0].dryRunQuery ?? "",
      /dryRun=true/,
    );
    assert.doesNotMatch(serialized, /confirmWrite=true/);
    assert.doesNotMatch(serialized, /dryRun=false/);
    assert.doesNotMatch(serialized, /suggestedWriteParams/);
    assert.doesNotMatch(serialized, /targets/);
  });

  it("returns no_action_required for update-only covered snapshots", () => {
    const response = buildCronPreflightResponse({
      snapshot: snapshotResult({
        ok: true,
        writeReady: true,
        portfolioWrites: { insert: 0, update: 4, skip: 0, blocked: 0 },
        positionWrites: { insert: 0, update: 17, skip: 0, blocked: 0 },
      }),
      cronScheduleUtc: null,
    });

    assert.equal(response.nextRecommendedAction, "no_action_required");
    assert.deepEqual(response.blockingReasons, []);
  });
});

function snapshotResult(overrides = {}) {
  const missingCount = overrides.missingCount ?? 0;
  const staleCount = overrides.staleCount ?? 0;
  const suggestedKisBatches = overrides.suggestedKisBatches ?? [];
  const portfolioWrites = overrides.portfolioWrites ?? {
    insert: missingCount > 0 ? 4 : 0,
    update: 0,
    skip: 0,
    blocked: 0,
  };
  const positionWrites = overrides.positionWrites ?? {
    insert: missingCount > 0 ? 17 : 0,
    update: 0,
    skip: 0,
    blocked: 0,
  };

  return {
    ok: overrides.ok ?? missingCount === 0,
    dryRun: true,
    writeReady: overrides.writeReady ?? missingCount === 0,
    snapshotDate: "2026-07-08",
    requestedAccount: "all",
    accounts: ["brokerage", "isa", "irp"],
    cycle: {
      snapshotDate: "2026-07-08",
      capturedAt: "2026-07-07T22:10:00.000Z",
      cycleStartAt: "2026-07-06T22:00:00.000Z",
      cycleEndAt: "2026-07-07T22:00:00.000Z",
    },
    closeReferences: [
      {
        market: "korea",
        requiredCount: 1,
        requiredTickerCount: 1,
        calendarReferenceDate: "2026-07-07",
        expectedCloseDate: "2026-07-07",
        status: missingCount > 0 ? "missing" : "ready",
        reason: missingCount > 0 ? "missing_reference" : "ready",
      },
    ],
    freshClose: {
      requiredCount: 1,
      satisfiedCount: missingCount > 0 ? 0 : 1,
      missingCount,
      rowsUsedCount: missingCount > 0 ? 0 : 1,
      coverage: [
        {
          ticker: "069500",
          name: "KODEX 200",
          account: "brokerage",
          market: "korea",
          currency: "KRW",
          expectedCloseDate: "2026-07-07",
          selectedCloseDate: missingCount > 0 ? null : "2026-07-07",
          selectedSource: missingCount > 0 ? null : "kis_domestic_itemchartprice",
          status: missingCount > 0 ? "missing" : "satisfied",
          reason: missingCount > 0 ? "missing_close" : "fresh_close",
        },
      ],
      missing:
        missingCount > 0
          ? [
              {
                ticker: "069500",
                name: "KODEX 200",
                account: "brokerage",
                market: "korea",
                expectedCloseDate: "2026-07-07",
                actualCloseDate: null,
                reason: "missing_close",
              },
            ]
          : [],
    },
    closeSyncPlan: {
      canProceedToSnapshotWrite: missingCount === 0 && staleCount === 0,
      requiredCount: 1,
      coveredCount: missingCount > 0 ? 0 : 1,
      missingCount,
      staleCount,
      manualCurrentNotSyncableCount: 0,
      markets: [
        {
          market: "korea",
          expectedCloseDate: "2026-07-07",
          requiredCount: 1,
          requiredTickerCount: 1,
          coveredCount: missingCount > 0 ? 0 : 1,
          missingCount,
          staleCount,
          targets: [
            {
              ticker: "069500",
            },
          ],
        },
      ],
      suggestedKisBatches,
    },
    plannedWrites: {
      dailyPortfolioSnapshots: portfolioWrites,
      dailyPositionSnapshots: positionWrites,
    },
    results: {
      brokerage: { status: "planned", reason: null, blockers: [] },
    },
    warnings: [],
  };
}
