import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const END_SERVICE_DATE = readArgument("--end");
const RAW_QUERY = readArgument("--raw-query");
const RAW_QUERY_PARAMS =
  RAW_QUERY === null ? null : new URLSearchParams(RAW_QUERY);
const EXPECT_RESEARCH_UNIVERSE_SELECTION =
  readArgument("--expect-research-universe-selection") ??
  (RAW_QUERY_PARAMS?.has("researchUniverse") ? "valid" : "not_requested");
const EXPECT_READY = numberArgument("--expect-ready");
const EXPECT_RESEARCH_READY = numberArgument("--expect-research-ready");
const EXPECT_JOINT_RESEARCH_READY = numberArgument(
  "--expect-joint-research-ready",
);
const EXPECT_FIXED_MIX_COMPARISON_READY = numberArgument(
  "--expect-fixed-mix-comparison-ready",
);
const EXPECT_WALK_FORWARD_READY = numberArgument(
  "--expect-walk-forward-ready",
);
const EXPECT_WALK_FORWARD_STABILITY_READY = numberArgument(
  "--expect-walk-forward-stability-ready",
);
const EXPECT_REGIME_READY = numberArgument("--expect-regime-ready");
const EXPECT_REGIME_HISTORICAL_READY = numberArgument(
  "--expect-regime-historical-ready",
);
const EXPECT_HORIZON = numberArgument("--expect-horizon") ?? 63;
const EXPECT_KODEX_WEIGHT_PCT = numberArgument("--expect-kodex-weight");
const EXPECT_INVALID_QUERY = process.argv.includes("--expect-invalid-query");
const EXPECT_INVALID_WEIGHT = process.argv.includes("--expect-invalid-weight");
const USE_REMOTE_DATABASE_EVIDENCE = process.argv.includes(
  "--remote-db-evidence",
);
const HAS_EXPLICIT_END =
  END_SERVICE_DATE !== null ||
  RAW_QUERY_PARAMS?.has("end");
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|assetId|ownerUser|api[_-]?key|authorization|password|secret|token|scenarioVectorHash|matrixRequestHash|inputMatrixHash|drawPlanHash|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!USE_REMOTE_DATABASE_EVIDENCE && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required unless --remote-db-evidence is enabled",
  );
}
if (![63, 126].includes(EXPECT_HORIZON)) {
  throw new Error("--expect-horizon must be 63 or 126");
}
if (
  !["not_requested", "valid", "invalid"].includes(
    EXPECT_RESEARCH_UNIVERSE_SELECTION,
  )
) {
  throw new Error(
    "--expect-research-universe-selection must be not_requested, valid, or invalid",
  );
}

const sql = USE_REMOTE_DATABASE_EVIDENCE
  ? null
  : neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;
const simulationPath =
  RAW_QUERY !== null
    ? `/simulation?${RAW_QUERY}`
    : END_SERVICE_DATE
      ? `/simulation?end=${encodeURIComponent(END_SERVICE_DATE)}`
      : "/simulation";

async function main() {
  if (USE_REMOTE_DATABASE_EVIDENCE) {
    const unauthorizedEvidence = await request(
      "/admin/preview-db-evidence",
    );
    assert.equal(
      unauthorizedEvidence.status,
      401,
      "no-auth Preview database evidence must return 401",
    );
  }
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
  assert.match(simulation.body, /data-research-universe-preflight/);
  const researchUniverseSelectionStatus = simulation.body.match(
    /data-research-universe-selection="([^"]+)"/,
  )?.[1];
  const researchUniverseStatus = simulation.body.match(
    /data-research-universe-status="([^"]+)"/,
  )?.[1];
  const researchUniverseInstrumentStatuses = [
    ...simulation.body.matchAll(
      /data-research-universe-instrument-status="([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  assert.equal(
    researchUniverseSelectionStatus,
    EXPECT_RESEARCH_UNIVERSE_SELECTION,
    "research universe selection status did not match the requested smoke case",
  );
  let researchUniversePreservedLinkCount = 0;
  if (EXPECT_RESEARCH_UNIVERSE_SELECTION === "valid") {
    const requestedResearchUniverse =
      RAW_QUERY_PARAMS?.get("researchUniverse") ?? null;
    assert.ok(
      requestedResearchUniverse,
      "valid research universe smoke requires an explicit query value",
    );
    assert.match(
      researchUniverseStatus ?? "",
      /^(?:stored_evidence_ready_for_separate_review|partial_diagnostics_only|diagnostics_only)$/,
    );
    assert.ok(
      researchUniverseInstrumentStatuses.length > 0,
      "valid research universe must preserve per-instrument diagnostics",
    );
    const simulationHrefs = [
      ...simulation.body.matchAll(/href="(\/simulation\?[^"]+)"/g),
    ].map((match) => match[1].replaceAll("&amp;", "&"));
    assert.ok(
      simulationHrefs.length > 0,
      "valid research universe must render internal simulation state links",
    );
    for (const href of simulationHrefs) {
      assert.equal(
        new URL(href, BASE_URL).searchParams.get("researchUniverse"),
        requestedResearchUniverse,
        `simulation state link dropped researchUniverse: ${href}`,
      );
    }
    researchUniversePreservedLinkCount = simulationHrefs.length;
    assert.ok(
      (simulation.body.match(/name="researchUniverse"/g)?.length ?? 0) >= 2,
      "research universe must remain in both its input and the fixed-mix form",
    );
  }
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
  assert.match(simulation.body, /data-walk-forward-min-volatility/);
  assert.match(
    simulation.body,
    /data-walk-forward-min-volatility-status="(?:ready|unavailable)"/,
  );
  assert.match(simulation.body, /data-walk-forward-stability-history/);
  assert.match(
    simulation.body,
    /data-walk-forward-stability-status="(?:ready|partial|unavailable)"/,
  );
  assert.match(simulation.body, /data-fan-band-validation/);
  assert.match(
    simulation.body,
    /data-fan-band-validation-status="(?:ready|partial|unavailable)"/,
  );
  assert.match(simulation.body, /data-downside-outcome-validation/);
  assert.match(
    simulation.body,
    /data-downside-outcome-validation-status="(?:ready|partial|unavailable)"/,
  );
  assert.match(simulation.body, /data-regime-bootstrap-research/);
  assert.match(simulation.body, /data-regime-bootstrap-status="(?:ready|unavailable)"/);
  assert.match(simulation.body, /data-regime-fallback="forbidden"/);
  assert.match(simulation.body, /data-regime-fixed-mix-comparison/);
  assert.match(
    simulation.body,
    /data-regime-fixed-mix-comparison-status="(?:ready|unavailable)"/,
  );
  assert.match(simulation.body, /data-regime-readiness-history/);
  assert.match(
    simulation.body,
    /data-regime-historical-outcome-validation/,
  );
  assert.match(
    simulation.body,
    /data-regime-historical-outcome-validation-status="(?:ready|partial|unavailable)"/,
  );
  assert.match(
    simulation.body,
    /data-regime-historical-outcome-point-in-time="not_established"/,
  );
  assert.match(
    simulation.body,
    /data-regime-historical-outcome-scenario="kodex200-50-voo-50-buy-and-hold"/,
  );
  assert.match(
    simulation.body,
    /KODEX 200 50% \+ VOO 50%, 최초 배분 후\s*리밸런싱 없음/,
  );
  assert.match(simulation.body, /data-regime-safe-date-count="0"/);
  assert.match(simulation.body, /연구 시뮬레이션/);
  assert.match(simulation.body, /명시 비중 공동 포트폴리오 연구/);
  assert.match(simulation.body, /KODEX 200 최초 비중/);
  assert.match(simulation.body, /stationary bootstrap/);
  assert.match(simulation.body, /종료 손실확률·최대낙폭 검증/);
  assert.match(
    simulation.body,
    new RegExp(`data-simulation-research-horizon="${EXPECT_HORIZON}"`),
  );
  assert.match(
    simulation.body,
    new RegExp(
      `data-fan-band-validation-horizon(?:="${EXPECT_HORIZON}"|\\\\":${EXPECT_HORIZON})`,
    ),
  );
  assert.match(
    simulation.body,
    new RegExp(
      `data-downside-outcome-validation-horizon(?:="${EXPECT_HORIZON}"|\\\\":${EXPECT_HORIZON})`,
    ),
  );
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
  const walkForwardStatus = simulation.body.match(
    /data-walk-forward-min-volatility-status="(ready|unavailable)"/,
  )?.[1];
  const walkForwardReadyCount = walkForwardStatus === "ready" ? 1 : 0;
  const walkForwardStabilityStatus = simulation.body.match(
    /data-walk-forward-stability-status="(ready|partial|unavailable)"/,
  )?.[1];
  const walkForwardStabilityRows = [
    ...simulation.body.matchAll(
      /data-walk-forward-stability-row="(\d{4}-\d{2}-\d{2})"/g,
    ),
  ].map((match) => match[1]);
  const walkForwardStabilityReadyCount =
    simulation.body.match(
      /data-walk-forward-stability-ready-count="(\d+)"/,
    )?.[1];
  const parsedWalkForwardStabilityReadyCount = Number(
    walkForwardStabilityReadyCount ?? 0,
  );
  const fanBandValidationStatus = simulation.body.match(
    /data-fan-band-validation-status="(ready|partial|unavailable)"/,
  )?.[1];
  const fanBandValidationRows = [
    ...simulation.body.matchAll(
      /data-fan-band-validation-row="(\d{4}-\d{2}-\d{2})"/g,
    ),
  ].map((match) => match[1]);
  const fanBandValidationReadyCount = Number(
    simulation.body.match(
      /data-fan-band-validation-ready-count="(\d+)"/,
    )?.[1] ?? 0,
  );
  const downsideOutcomeValidationStatus = simulation.body.match(
    /data-downside-outcome-validation-status="(ready|partial|unavailable)"/,
  )?.[1];
  const downsideOutcomeValidationRows = [
    ...simulation.body.matchAll(
      /data-downside-outcome-validation-row="(\d{4}-\d{2}-\d{2})"/g,
    ),
  ].map((match) => match[1]);
  const downsideOutcomeValidationReadyCount = Number(
    simulation.body.match(
      /data-downside-outcome-validation-ready-count="(\d+)"/,
    )?.[1] ?? 0,
  );
  const jointSelectionStatus = simulation.body.match(
    /data-joint-research-selection-status="(default|selected|invalid)"/,
  )?.[1];
  const regimeStatus = simulation.body.match(
    /data-regime-bootstrap-status="(ready|unavailable)"/,
  )?.[1];
  const regimeReadyCount =
    simulation.body.match(/data-regime-scenario-status="ready"/g)?.length ?? 0;
  const regimeFixedMixReadyCount =
    simulation.body.match(
      /data-regime-fixed-mix-scenario-status="ready"/g,
    )?.length ?? 0;
  const regimeSelectedScenarioCount =
    simulation.body.match(/data-regime-scenario-selected="true"/g)?.length ?? 0;
  const regimeFactorCount =
    simulation.body.match(/data-regime-factor-key="[^"]+"/g)?.length ?? 0;
  const regimeHistoryRowCount =
    simulation.body.match(/data-regime-history-date="\d{4}-\d{2}-\d{2}"/g)
      ?.length ?? 0;
  const regimeHistoricalOutcomeStatus = simulation.body.match(
    /data-regime-historical-outcome-validation-status="(ready|partial|unavailable)"/,
  )?.[1];
  const regimeHistoricalOutcomeRows =
    simulation.body.match(
      /data-regime-historical-outcome-row="\d{4}-\d{2}-\d{2}"/g,
    )?.length ?? 0;
  const regimeHistoricalOutcomeReadyCount = Number(
    simulation.body.match(
      /data-regime-historical-outcome-ready-count="(\d+)"/,
    )?.[1],
  );
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
  assert.ok(
    walkForwardStatus,
    "simulation must render one walk-forward minimum-volatility state",
  );
  assert.ok(
    walkForwardStabilityStatus,
    "simulation must render one walk-forward stability state",
  );
  assert.ok(
    fanBandValidationStatus,
    "simulation must render one fan-band validation state",
  );
  assert.ok(
    downsideOutcomeValidationStatus,
    "simulation must render one downside outcome validation state",
  );
  assert.equal(
    downsideOutcomeValidationStatus,
    fanBandValidationStatus,
    "shared historical outcome sections must expose one status",
  );
  assert.deepEqual(
    downsideOutcomeValidationRows,
    fanBandValidationRows,
    "shared historical outcome sections must expose the same endpoints",
  );
  assert.equal(
    downsideOutcomeValidationReadyCount,
    fanBandValidationReadyCount,
    "shared historical outcome sections must expose one ready count",
  );
  assert.ok(regimeStatus, "simulation must render regime research state");
  assert.ok(
    regimeHistoricalOutcomeStatus,
    "simulation must render retrospective regime outcome validation state",
  );
  assert.ok(
    Number.isInteger(regimeHistoricalOutcomeReadyCount),
    "simulation must expose retrospective regime outcome ready count",
  );
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
    regimeHistoryRowCount,
    EXPECT_INVALID_QUERY ? 0 : 7,
    "simulation rendered an unexpected regime readiness history row count",
  );
  assert.equal(
    regimeHistoricalOutcomeRows,
    EXPECT_INVALID_QUERY || !HAS_EXPLICIT_END ? 0 : 7,
    "simulation rendered an unexpected retrospective regime outcome row count",
  );
  if (EXPECT_INVALID_QUERY || !HAS_EXPLICIT_END) {
    assert.equal(
      regimeHistoricalOutcomeReadyCount,
      0,
      "a request without a valid explicit end date must not render ready retrospective regime outcomes",
    );
  } else if (EXPECT_REGIME_HISTORICAL_READY !== null) {
    assert.equal(
      regimeHistoricalOutcomeReadyCount,
      EXPECT_REGIME_HISTORICAL_READY,
      "unexpected ready retrospective regime outcome count",
    );
  } else {
    assert.ok(
      regimeHistoricalOutcomeReadyCount > 0,
      "valid deployment smoke must not pass with every retrospective regime outcome unavailable",
    );
  }
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
  if (EXPECT_WALK_FORWARD_READY !== null) {
    assert.equal(
      walkForwardReadyCount,
      EXPECT_WALK_FORWARD_READY,
      "unexpected walk-forward minimum-volatility readiness",
    );
  }
  if (walkForwardStatus === "ready") {
    assert.match(simulation.body, /data-walk-forward-fold-count="3"/);
    assert.equal(
      simulation.body.match(/data-walk-forward-fold="[123]"/g)?.length ?? 0,
      3,
      "ready walk-forward research must render three folds",
    );
    assert.match(simulation.body, /data-simulation-path-comparison-chart/);
  }
  if (
    walkForwardStabilityStatus === "ready" ||
    walkForwardStabilityStatus === "partial"
  ) {
    assert.equal(
      walkForwardStabilityRows.length,
      7,
      "available walk-forward stability history must retain seven endpoint rows",
    );
    assert.ok(
      parsedWalkForwardStabilityReadyCount > 0,
      "available walk-forward stability history must contain a ready endpoint",
    );
  }
  if (EXPECT_WALK_FORWARD_STABILITY_READY !== null) {
    assert.equal(
      walkForwardStabilityRows.length,
      7,
      "expected walk-forward stability smoke requires seven endpoint rows",
    );
    assert.equal(
      parsedWalkForwardStabilityReadyCount,
      EXPECT_WALK_FORWARD_STABILITY_READY,
      "unexpected ready walk-forward stability endpoint count",
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
    const expectedRegimeScenarioCount =
      EXPECT_KODEX_WEIGHT_PCT !== null &&
      ![25, 50, 75].includes(EXPECT_KODEX_WEIGHT_PCT)
        ? 6
        : 5;
    assert.equal(
      regimeReadyCount,
      expectedRegimeScenarioCount,
      "ready regime model must render references, three presets, and an optional custom mix",
    );
    assert.equal(
      regimeFixedMixReadyCount,
      3,
      "ready regime model must render all three shared-draw fixed mixes",
    );
    assert.equal(
      regimeSelectedScenarioCount,
      EXPECT_INVALID_WEIGHT ? 0 : 1,
      "a valid current weight input must mark exactly one regime scenario",
    );
    assert.equal(regimeFactorCount, 3, "ready regime model must show three factor sources");
    assert.match(simulation.body, /data-regime-bootstrap-engine="regime_bootstrap_research_v2"/);
    assert.match(simulation.body, /data-regime-scenario-kodex-weight-bps="/);
    assert.match(simulation.body, /data-regime-scenario-voo-weight-bps="/);
    assert.match(
      simulation.body,
      /data-regime-fixed-mix-pairing="shared_regime_state_and_draw_plan_verified"/,
    );
    assert.match(simulation.body, /data-regime-fixed-mix-scenario-count="3"/);
    assert.match(simulation.body, /data-regime-fixed-mix-rebalancing="none"/);
    assert.match(simulation.body, /국면별 고정 비중 3안 공통 경로/);
    assert.match(simulation.body, /성과 순위·추천 아님/);
  }
  if (researchReadyCount > 0) {
    assert.equal(
      simulation.body.match(/data-research-fan-chart="(?:kodex200|voo)"/g)
        ?.length ?? 0,
      researchReadyCount,
      "each ready research execution must render one fan chart",
    );
    assert.match(
      simulation.body,
      new RegExp(`data-research-horizon="${EXPECT_HORIZON}"`),
    );
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
    assert.match(
      simulation.body,
      new RegExp(`data-joint-research-horizon="${EXPECT_HORIZON}"`),
    );
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
        horizon: EXPECT_HORIZON,
        researchUniverseSelectionStatus,
        researchUniverseStatus,
        researchUniverseInstrumentStatuses,
        researchUniversePreservedLinkCount,
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
        walkForwardStatus,
        walkForwardReadyCount,
        walkForwardStabilityStatus,
        walkForwardStabilityRowCount: walkForwardStabilityRows.length,
        walkForwardStabilityReadyCount:
          parsedWalkForwardStabilityReadyCount,
        fanBandValidationStatus,
        fanBandValidationRowCount: fanBandValidationRows.length,
        fanBandValidationReadyCount,
        downsideOutcomeValidationStatus,
        downsideOutcomeValidationRowCount:
          downsideOutcomeValidationRows.length,
        downsideOutcomeValidationReadyCount,
        jointSelectionStatus,
        regimeStatus,
        regimeReadyCount,
        regimeFixedMixReadyCount,
        regimeSelectedScenarioCount,
        regimeFactorCount,
        regimeHistoryRowCount,
        regimeHistoricalOutcomeStatus,
        regimeHistoricalOutcomeRows,
        regimeHistoricalOutcomeReadyCount,
        historyRowCount,
        observedReturnSeriesCount,
        observedReturnComparisonStatus,
        crossMarketAlignmentStatus,
        priceCarryCounts,
        fxCarryCounts,
        databaseSideEffects: false,
        databaseEvidenceSource: USE_REMOTE_DATABASE_EVIDENCE
          ? "preview_runtime_route"
          : "local_database_url",
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
  if (USE_REMOTE_DATABASE_EVIDENCE) {
    const response = await request("/admin/preview-db-evidence", true);
    assert.equal(
      response.status,
      200,
      "authenticated Preview database evidence must return 200",
    );
    const evidence = JSON.parse(response.body);
    assert.equal(evidence.evidenceVersion, "preview_database_evidence_v2");
    assert.equal(evidence.status, "operational_guard_passed");
    assert.equal(
      evidence.endpointProjectBinding,
      "external_vercel_neon_integration_control",
    );
    assert.equal(evidence.catalogStatus, "reviewed_0019_present");
    assert.equal(evidence.latestReviewedMigration, "0019_lush_maddog");
    assert.match(evidence.targetFingerprint, /^sha256:[0-9a-f]{64}$/);
    return {
      assets: evidence.rowCounts.assets,
      price_snapshots: evidence.rowCounts.priceSnapshots,
      fx_rates: evidence.rowCounts.fxRates,
      approval_revisions: evidence.rowCounts.approvalRevisions,
      target_fingerprint: evidence.targetFingerprint,
    };
  }

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
