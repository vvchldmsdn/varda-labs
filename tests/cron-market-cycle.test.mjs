import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildCronMarketCyclePlan,
  CRON_MARKET_CYCLE_LIMITS,
} from "../src/lib/cron-market-cycle.ts";

describe("Cron market-cycle controller", () => {
  it("deduplicates owner-scoped close batches before one shared KIS sync", () => {
    const snapshotJob = job({
      targets: [
        target({
          batches: [
            batch("korea", "2026-08-03", ["069500", "0139P0"]),
            batch("us", "2026-08-01", ["VOO"]),
          ],
        }),
        target({
          batches: [
            batch("korea", "2026-08-03", ["0139P0", "395160"]),
            batch("us", "2026-08-01", ["VOO"]),
          ],
        }),
      ],
    });

    const plan = buildCronMarketCyclePlan({
      snapshotJob,
      kisCooldownActive: false,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.action, "sync_closes_then_snapshot");
    assert.equal(plan.closeTargetCount, 4);
    assert.deepEqual(plan.closeGroups, [
      {
        market: "us",
        expectedCloseDate: "2026-08-01",
        tickers: ["VOO"],
      },
      {
        market: "korea",
        expectedCloseDate: "2026-08-03",
        tickers: ["0139P0", "069500", "395160"],
      },
    ]);
  });

  it("blocks pending close work while the KIS cooldown is active", () => {
    const plan = buildCronMarketCyclePlan({
      snapshotJob: job({ targets: [target()] }),
      kisCooldownActive: true,
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.action, "blocked");
    assert.ok(plan.blockers.includes("kis_close_cooldown_active"));
  });

  it("does nothing when the current owner snapshots already exist", () => {
    const plan = buildCronMarketCyclePlan({
      snapshotJob: job({
        targets: [target({ missingCount: 0, batches: [], inserts: 0 })],
      }),
      kisCooldownActive: true,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.action, "no_action");
    assert.deepEqual(plan.blockers, []);
  });

  it("writes snapshots directly when close coverage is complete", () => {
    const plan = buildCronMarketCyclePlan({
      snapshotJob: job({
        targets: [target({ missingCount: 0, batches: [], inserts: 4 })],
      }),
      kisCooldownActive: true,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.action, "write_snapshot");
    assert.equal(plan.snapshotWriteNeeded, true);
  });

  it("preserves non-close snapshot blockers instead of forcing a write", () => {
    const plan = buildCronMarketCyclePlan({
      snapshotJob: job({
        targets: [
          target({
            missingCount: 0,
            batches: [],
            inserts: 4,
            writeReady: false,
            blockers: ["duplicate_portfolio_snapshot"],
          }),
        ],
      }),
      kisCooldownActive: false,
    });

    assert.equal(plan.ok, false);
    assert.ok(
      plan.blockers.includes(
        "snapshot_blocker:duplicate_portfolio_snapshot",
      ),
    );
    assert.ok(plan.blockers.includes("snapshot_not_write_ready"));
  });

  it("rejects close groups beyond the bounded internal batch limit", () => {
    const tickers = Array.from(
      { length: CRON_MARKET_CYCLE_LIMITS.maxCloseTargetsPerGroup + 1 },
      (_, index) => `T${String(index).padStart(3, "0")}`,
    );
    const plan = buildCronMarketCyclePlan({
      snapshotJob: job({
        targets: [target({ batches: [batch("us", "2026-08-01", tickers)] })],
      }),
      kisCooldownActive: false,
    });

    assert.equal(plan.ok, false);
    assert.ok(plan.blockers.includes("close_target_group_limit_exceeded"));
  });

  it("keeps the scheduled route disabled until an explicit env gate is set", () => {
    const route = read("src/app/api/cron/market-cycle/run/route.ts");
    const runner = read("src/lib/cron-market-cycle-runner.ts");
    const repository = read("src/lib/cron-market-cycle-run-repository.ts");
    const auth = read("src/lib/admin-auth.ts");
    const kis = read("src/lib/market-data/providers/kis.ts");
    const fxJob = read("src/lib/market-data/fx-refresh-job.ts");
    const manualFxRoute = read("src/app/api/admin/market/fx/sync/route.ts");
    const vercel = JSON.parse(read("vercel.json"));

    assert.match(route, /export async function GET/);
    assert.match(route, /isAuthorizedAdminJob/);
    assert.match(route, /MARKET_CYCLE_CRON_WRITE_ENABLED/);
    assert.match(route, /query_parameters_not_allowed/);
    assert.doesNotMatch(route, /confirmWrite|account=|snapshotDate=/);
    assert.match(runner, /acceptExistingVardaRow: true/);
    assert.match(runner, /mode: "close"/);
    assert.match(runner, /mode: "live"/);
    assert.match(runner, /live_quote_sync_incomplete/);
    assert.match(runner, /runDailySnapshotJob\(\{[\s\S]*now: new Date\(\)/);
    assert.match(repository, /pg_try_advisory_xact_lock/);
    assert.match(repository, /metadata_json ->> 'snapshotDate'/);
    assert.match(fxJob, /plannedWrite\.reason === "same_varda_row_value"/);
    assert.match(manualFxRoute, /result\.status === "blocked" \? 409 : 200/);
    assert.match(auth, /process\.env\.ADMIN_JOB_SECRET/);
    assert.match(auth, /process\.env\.CRON_SECRET/);
    assert.match(kis, /const session: KisProviderSession/);
    assert.match(kis, /getKisAccessToken\(config, session\)/);
    assert.doesNotMatch(kis, /@\/db\/|access_token.*insert|access_token.*update/is);
    assert.deepEqual(vercel.crons, [
      {
        path: "/api/cron/market-cycle/run",
        schedule: "0 22 * * *",
      },
    ]);
  });
});

function job({ targets }) {
  return {
    ok: targets.every(({ status }) => status !== "failed"),
    writeReady: targets.every(
      (entry) => entry.status !== "failed" && entry.result.writeReady,
    ),
    snapshotDate: "2026-08-03",
    targetCount: targets.length,
    failedCount: targets.filter(({ status }) => status === "failed").length,
    targets,
  };
}

function target({
  missingCount = 1,
  batches = [batch("korea", "2026-08-03", ["069500"])],
  inserts = 4,
  writeReady = missingCount === 0,
  blockers = [],
} = {}) {
  return {
    status: writeReady ? "ready" : "blocked",
    result: {
      writeReady,
      closeSyncPlan: {
        missingCount,
        staleCount: 0,
        suggestedKisBatches: batches,
      },
      plannedWrites: {
        dailyPortfolioSnapshots: counts(inserts),
        dailyPositionSnapshots: counts(inserts > 0 ? 17 : 0),
      },
      results: {
        brokerage: { blockers },
      },
    },
  };
}

function batch(market, expectedCloseDate, tickers) {
  return { market, expectedCloseDate, tickers };
}

function counts(insert) {
  return { insert, update: 0, skip: 0, blocked: 0 };
}

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
