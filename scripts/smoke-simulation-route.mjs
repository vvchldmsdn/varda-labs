import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const END_SERVICE_DATE = readArgument("--end");
const RAW_QUERY = readArgument("--raw-query");
const EXPECT_READY = numberArgument("--expect-ready");
const EXPECT_RESEARCH_READY = numberArgument("--expect-research-ready");
const EXPECT_JOINT_RESEARCH_READY = numberArgument(
  "--expect-joint-research-ready",
);
const EXPECT_FIXED_MIX_COMPARISON_READY = numberArgument(
  "--expect-fixed-mix-comparison-ready",
);
const EXPECT_REGIME_READY = numberArgument("--expect-regime-ready");
const EXPECT_KODEX_WEIGHT_PCT = numberArgument("--expect-kodex-weight");
const EXPECT_INVALID_QUERY = process.argv.includes("--expect-invalid-query");
const EXPECT_INVALID_WEIGHT = process.argv.includes("--expect-invalid-weight");
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|assetId|ownerUser|api[_-]?key|authorization|password|secret|token|scenarioVectorHash|matrixRequestHash|inputMatrixHash|drawPlanHash|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
const simulationPath =
  RAW_QUERY !== null
    ? `/simulation?${RAW_QUERY}`
    : END_SERVICE_DATE
      ? `/simulation?end=${encodeURIComponent(END_SERVICE_DATE)}`
      : "/simulation";

async function main() {
  const countsBefore = await readCounts();
  const unauthorized = await request(simulationPath);
  const unauthorizedDashboard = await request("/");
  assert.equal(unauthorized.status, 401, "no-auth simulation must return 401");
  assert.equal(
    unauthorizedDashboard.status,
    401,
    "no-auth dashboard must return 401",
  );

  const dashboard = await request("/", true);
  const simulation = await request(simulationPath, true);
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.equal(simulation.status, 200, "authenticated simulation must return 200");
  assert.match(dashboard.body, /href="\/simulation"/);
  assert.match(simulation.body, /data-page="simulation-input-readiness"/);
  assert.match(simulation.body, /data-runtime-trust-status="not_established"/);
  if (EXPECT_INVALID_QUERY) {
    assert.match(simulation.body, /data-end-query-status="invalid"/);
    assert.match(simulation.body, /data-invalid-end-query/);
  } else {
    assert.match(simulation.body, /data-end-query-status="valid"/);
    assert.match(simulation.body, /data-simulation-readiness-history/);
  }
  assert.match(simulation.body, /연구 입력 증거 준비도/);
  assert.match(simulation.body, /data-fixed-research-execution/);
  assert.match(simulation.body, /data-fixed-mix-research-execution/);
  assert.match(simulation.body, /data-fixed-mix-research-comparison/);
  assert.match(simulation.body, /data-regime-bootstrap-research/);
  assert.match(simulation.body, /data-regime-bootstrap-status="(?:ready|unavailable)"/);
  assert.match(simulation.body, /data-regime-fallback="forbidden"/);
  assert.match(simulation.body, /3개월 연구 시뮬레이션/);
  assert.match(simulation.body, /명시 비중 공동 포트폴리오 연구/);
  assert.match(simulation.body, /KODEX 200 최초 비중/);
  assert.match(simulation.body, /stationary bootstrap/);
  assert.match(simulation.body, /069500/);
  assert.match(simulation.body, /VOO/);
  assert.match(
    simulation.body,
    /결과는 미래 예측, 비중 추천 또는 주문 근거가 아닙니다/,
  );
  assert.doesNotMatch(simulation.body, LEAK_PATTERN);

  const inputCount =
    simulation.body.match(/data-simulation-input="(?:kodex200|voo)"/g)
      ?.length ?? 0;
  const statuses = [
    ...simulation.body.matchAll(
      /data-readiness-status="(matrix_ready|unavailable)"/g,
    ),
  ].map((match) => match[1]);
  const readyCount = statuses.filter((status) => status === "matrix_ready").length;
  const researchStatuses = [
    ...simulation.body.matchAll(
      /data-research-execution-status="(ready|unavailable)"/g,
    ),
  ].map((match) => match[1]);
  const researchReadyCount = researchStatuses.filter(
    (status) => status === "ready",
  ).length;
  const jointResearchStatus = simulation.body.match(
    /data-joint-research-execution-status="(ready|unavailable)"/,
  )?.[1];
  const jointResearchReadyCount = jointResearchStatus === "ready" ? 1 : 0;
  const fixedMixComparisonStatus = simulation.body.match(
    /data-fixed-mix-research-comparison-status="(ready|unavailable)"/,
  )?.[1];
  const fixedMixComparisonReadyCount =
    fixedMixComparisonStatus === "ready" ? 1 : 0;
  const jointSelectionStatus = simulation.body.match(
    /data-joint-research-selection-status="(default|selected|invalid)"/,
  )?.[1];
  const regimeStatus = simulation.body.match(
    /data-regime-bootstrap-status="(ready|unavailable)"/,
  )?.[1];
  const regimeReadyCount =
    simulation.body.match(/data-regime-scenario-status="ready"/g)?.length ?? 0;
  const regimeFactorCount =
    simulation.body.match(/data-regime-factor-key="[^"]+"/g)?.length ?? 0;
  const expectedJointSelectionStatus = EXPECT_INVALID_WEIGHT
    ? "invalid"
    : EXPECT_KODEX_WEIGHT_PCT === null
      ? "default"
      : "selected";
  const historyRowCount =
    simulation.body.match(/data-readiness-history-row="\d{4}-\d{2}-\d{2}"/g)
      ?.length ?? 0;
  const observedReturnSeriesCount =
    simulation.body.match(
      /data-observed-return-series="(?:kodex200|voo)"/g,
    )?.length ?? 0;
  const observedReturnComparisonStatus = simulation.body.match(
    /data-observed-return-comparison="(ready|unavailable)"/,
  )?.[1];
  const crossMarketAlignmentStatus = simulation.body.match(
    /data-cross-market-alignment="(ready|unavailable)"/,
  )?.[1];
  const priceCarryCounts = [
    ...simulation.body.matchAll(/data-price-carry-count="(\d+)"/g),
  ].map((match) => Number(match[1]));
  const fxCarryCounts = [
    ...simulation.body.matchAll(/data-fx-carry-count="(\d+)"/g),
  ].map((match) => Number(match[1]));
  assert.equal(inputCount, 2, "simulation must render two independent inputs");
  assert.equal(statuses.length, 2, "simulation must render two readiness states");
  assert.equal(
    researchStatuses.length,
    2,
    "simulation must render two independent research execution states",
  );
  assert.ok(
    jointResearchStatus,
    "simulation must render one joint research execution state",
  );
  assert.ok(
    fixedMixComparisonStatus,
    "simulation must render one fixed-mix comparison state",
  );
  assert.ok(regimeStatus, "simulation must render regime research state");
  assert.equal(
    jointSelectionStatus,
    expectedJointSelectionStatus,
    "simulation rendered an unexpected joint weight selection state",
  );
  if (EXPECT_INVALID_WEIGHT) {
    assert.match(
      simulation.body,
      /data-joint-research-unavailable-reason="invalid_weight_selection"/,
    );
  }
  assert.equal(
    historyRowCount,
    EXPECT_INVALID_QUERY ? 0 : 7,
    "simulation rendered an unexpected history row count",
  );
  assert.equal(
    observedReturnSeriesCount,
    readyCount,
    "only ready inputs may render a complete observed return series",
  );
  if (observedReturnSeriesCount > 0) {
    assert.match(simulation.body, /data-return-row-count="90"/);
    assert.match(simulation.body, /예측·시뮬레이션 경로 아님/);
  }
  assert.equal(
    observedReturnComparisonStatus,
    readyCount === 2 ? "ready" : "unavailable",
    "comparison must render only when both independent inputs are ready",
  );
  assert.equal(
    crossMarketAlignmentStatus,
    observedReturnComparisonStatus,
    "alignment evidence must follow the complete comparison boundary",
  );
  if (observedReturnComparisonStatus === "ready") {
    assert.match(simulation.body, /data-comparison-axis-status="aligned"/);
    assert.match(simulation.body, /data-comparison-point-count="91"/);
    assert.match(simulation.body, /data-comparison-series-count="2"/);
    assert.match(simulation.body, /data-return-scale-mode="shared"/);
    assert.match(simulation.body, /data-alignment-service-date-count="91"/);
    assert.equal(
      simulation.body.match(
        /data-alignment-instrument="(?:kodex200|voo)"/g,
      )?.length ?? 0,
      2,
      "alignment evidence must contain two minimized instrument rows",
    );
    assert.equal(
      priceCarryCounts.length,
      2,
      "alignment evidence must summarize price carry for both inputs",
    );
    assert.equal(
      fxCarryCounts.length,
      2,
      "alignment evidence must summarize FX carry without raw values",
    );
  }
  if (EXPECT_READY !== null) {
    assert.equal(readyCount, EXPECT_READY, "unexpected ready input count");
  }
  if (EXPECT_RESEARCH_READY !== null) {
    assert.equal(
      researchReadyCount,
      EXPECT_RESEARCH_READY,
      "unexpected ready research execution count",
    );
  }
  if (EXPECT_JOINT_RESEARCH_READY !== null) {
    assert.equal(
      jointResearchReadyCount,
      EXPECT_JOINT_RESEARCH_READY,
      "unexpected ready joint research execution count",
    );
  }
  if (EXPECT_FIXED_MIX_COMPARISON_READY !== null) {
    assert.equal(
      fixedMixComparisonReadyCount,
      EXPECT_FIXED_MIX_COMPARISON_READY,
      "unexpected fixed-mix comparison readiness",
    );
  }
  if (EXPECT_REGIME_READY !== null) {
    assert.equal(
      regimeReadyCount,
      EXPECT_REGIME_READY,
      "unexpected ready regime scenario count",
    );
  }
  if (regimeStatus === "ready") {
    assert.equal(regimeReadyCount, 3, "ready regime model must render three scenarios");
    assert.equal(regimeFactorCount, 3, "ready regime model must show three factor sources");
    assert.match(simulation.body, /data-regime-bootstrap-engine="regime_bootstrap_research_v1"/);
    assert.match(simulation.body, /data-regime-scenario-kodex-weight-bps="/);
    assert.match(simulation.body, /data-regime-scenario-voo-weight-bps="/);
  }
  if (researchReadyCount > 0) {
    assert.equal(
      simulation.body.match(/data-research-fan-chart="(?:kodex200|voo)"/g)
        ?.length ?? 0,
      researchReadyCount,
      "each ready research execution must render one fan chart",
    );
    assert.match(simulation.body, /data-research-horizon="63"/);
    assert.match(simulation.body, /data-research-path-count="500"/);
  }
  if (jointResearchStatus === "ready") {
    assert.match(
      simulation.body,
      /data-research-fan-chart="kodex200-voo-explicit-mix"/,
    );
    assert.match(
      simulation.body,
      /data-joint-sampling="paired_cross_market_rows_same_draw_plan"/,
    );
    assert.match(simulation.body, /data-joint-rebalancing="none"/);
    assert.match(simulation.body, /data-joint-research-horizon="63"/);
    assert.match(simulation.body, /data-joint-research-path-count="500"/);
    if (EXPECT_KODEX_WEIGHT_PCT !== null) {
      assert.match(
        simulation.body,
        new RegExp(
          `data-joint-research-kodex-weight-bps="${EXPECT_KODEX_WEIGHT_PCT * 100}"`,
        ),
      );
      assert.match(
        simulation.body,
        new RegExp(
          `data-joint-research-voo-weight-bps="${(100 - EXPECT_KODEX_WEIGHT_PCT) * 100}"`,
        ),
      );
    }
  }
  if (fixedMixComparisonStatus === "ready") {
    assert.match(
      simulation.body,
      /data-fixed-mix-comparison-pairing="single_prepared_draw_plan_and_gross_growth_reused_pathwise"/,
    );
    assert.match(
      simulation.body,
      /data-fixed-mix-comparison-scenario-count="3"/,
    );
    assert.equal(
      simulation.body.match(
        /data-fixed-mix-comparison-scenario="(?:25-75|50-50|75-25)"/g,
      )?.length ?? 0,
      3,
      "comparison must render all three fixed mixes without ranking",
    );
    assert.equal(
      simulation.body.match(
        /data-research-fan-chart="kodex-(?:25-voo-75|50-voo-50|75-voo-25)"/g,
      )?.length ?? 0,
      3,
      "comparison must render one fan chart for each fixed mix",
    );
  }

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "simulation_input_readiness_route",
        baseUrl: BASE_URL,
        path: simulationPath,
        noAuthStatus: {
          dashboard: unauthorizedDashboard.status,
          simulation: unauthorized.status,
        },
        authStatus: {
          dashboard: dashboard.status,
          simulation: simulation.status,
        },
        inputCount,
        statuses,
        readyCount,
        researchStatuses,
        researchReadyCount,
        jointResearchStatus,
        jointResearchReadyCount,
        fixedMixComparisonStatus,
        fixedMixComparisonReadyCount,
        jointSelectionStatus,
        regimeStatus,
        regimeReadyCount,
        regimeFactorCount,
        historyRowCount,
        observedReturnSeriesCount,
        observedReturnComparisonStatus,
        crossMarketAlignmentStatus,
        priceCarryCounts,
        fxCarryCounts,
        databaseSideEffects: false,
        counts: countsAfter,
      },
      null,
      2,
    ),
  );
}

async function request(path, authenticated = false) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: authenticated ? { authorization } : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

async function readCounts() {
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from asset_price_snapshots) as price_snapshots,
      (select count(*)::int from fx_rates) as fx_rates,
      (select count(*)::int from simulation_scenario_approval_revisions) as approval_revisions
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function numberArgument(name) {
  const raw = readArgument(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

await main();
