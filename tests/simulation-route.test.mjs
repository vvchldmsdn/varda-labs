import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Simulation input readiness route boundary", () => {
  it("keeps the page server-rendered and the database adapter server-only", () => {
    const page = read("src/app/simulation/page.tsx");
    const query = read("src/db/queries/simulation-input-readiness.ts");
    const historicalOutcomeQuery = read(
      "src/db/queries/simulation-historical-outcome-validation.ts",
    );
    const regimeQuery = read("src/db/queries/simulation-regime-bootstrap.ts");
    const regimeEvidenceQuery = read(
      "src/db/queries/simulation-regime-evidence.ts",
    );
    const regimeHistoricalOutcomeQuery = read(
      "src/db/queries/simulation-regime-historical-outcome-validation.ts",
    );
    const researchUniverseQuery = read(
      "src/db/queries/simulation-research-universe-preflight.ts",
    );
    const sectionErrorBoundary = read(
      "src/components/simulation/simulation-section-error-boundary.tsx",
    );
    const selection = read("src/lib/kodex-voo-fixed-mix-selection.ts");
    const view = readSimulationView();

    assert.doesNotMatch(page, /["']use client["']/);
    assert.doesNotMatch(view, /["']use client["']/);
    assert.doesNotMatch(`${page}\n${view}`, /\bfetch\s*\(|\/api\//);
    assert.match(query, /^import "server-only";/);
    assert.match(historicalOutcomeQuery, /^import "server-only";/);
    assert.match(regimeQuery, /^import "server-only";/);
    assert.match(regimeEvidenceQuery, /^import "server-only";/);
    assert.match(regimeHistoricalOutcomeQuery, /^import "server-only";/);
    assert.match(researchUniverseQuery, /^import "server-only";/);
    assert.match(page, /endServiceDate: params\.end/);
    assert.match(page, /horizon: params\.horizon/);
    assert.match(page, /kodexWeight: params\.kodexWeight/);
    assert.match(
      page,
      /researchUniverse: params\.researchUniverse/,
    );
    assert.match(page, /getReadOnlySimulationRegimeBootstrap/);
    assert.match(
      page,
      /getReadOnlySimulationRegimeHistoricalOutcomeValidation/,
    );
    assert.match(page, /getReadOnlySimulationHistoricalOutcomeValidation/);
    assert.equal(
      page.match(/<SimulationSectionErrorBoundary/g)?.length,
      4,
      "each independent simulation query section must have its own error boundary",
    );
    assert.match(sectionErrorBoundary, /^"use client";/);
    assert.match(sectionErrorBoundary, /unstable_catchError/);
    assert.match(sectionErrorBoundary, /unstable_retry/);
    assert.doesNotMatch(sectionErrorBoundary, /error\.message|error\.digest/);
    assert.match(page, /historicalOutcomeValidationPromise/);
    assert.match(page, /FanBandValidationSection/);
    assert.match(page, /DownsideOutcomeValidationSection/);
    assert.match(
      page,
      /<Suspense fallback=\{<HistoricalOutcomeValidationSkeleton \/>\}>/,
    );
    assert.match(page, /regimePromise/);
    assert.match(page, /RegimeReadinessHistoryPanel/);
    assert.match(page, /RegimeHistoricalOutcomeValidationSection/);
    assert.match(page, /regimeHistoricalOutcomeValidationPromise/);
    assert.match(
      page,
      /<RegimeHistoricalOutcomeValidationSkeleton \/>/,
    );
    assert.match(page, /RegimeBootstrapResearchSection/);
    assert.match(page, /<Suspense fallback=\{<RegimeBootstrapSkeleton \/>\}>/);
    assert.doesNotMatch(page, /params\.end\[0\]/);
    assert.match(query, /resolveSimulationEndServiceDateSelection/);
    assert.match(query, /getReadOnlySimulationPeriodPreflightBatch/);
    assert.match(query, /buildFixedResearchSimulation/);
    assert.match(query, /prepareFixedMixResearchContext/);
    assert.match(query, /buildFixedMixResearchSimulationFromContext/);
    assert.match(query, /buildFixedMixResearchComparisonFromContext/);
    assert.match(query, /buildSimulationWalkForwardMinimumVolatility/);
    assert.match(query, /buildSimulationWalkForwardStabilityHistory/);
    assert.match(query, /resolveKodexVooFixedMixSelection/);
    assert.match(query, /resolveSimulationResearchHorizon/);
    assert.match(query, /horizon: researchHorizon/);
    assert.match(query, /matrix: comparisonPreflight\.matrixArtifact/);
    assert.match(query, /walkForwardMinimumVolatility/);
    assert.match(query, /walkForwardStabilityHistory/);
    assert.match(query, /candidates: INPUTS\.map\(candidate\)/);
    assert.match(query, /comparisonDates = explicitEndServiceDate/);
    assert.match(query, /\.\.\.independentRequests, \.\.\.comparisonRequests/);
    assert.doesNotMatch(query, /endServiceDate\?\.trim\(\)/);
    assert.match(selection, /typeof value !== "string"/);
    assert.match(selection, /minimumComponentWeightPct: 1/);
    assert.match(selection, /maximumComponentWeightPct: 99/);
    assert.match(query, /ticker: "069500"/);
    assert.match(query, /ticker: "VOO"/);
    assert.match(regimeQuery, /getReadOnlySimulationPeriodPreflightBatch/);
    assert.match(regimeQuery, /buildSimulationRegimeReadinessHistoryDates/);
    assert.match(regimeQuery, /buildSimulationRegimeReadinessHistory/);
    assert.match(regimeQuery, /loadRegimeFactorRows/);
    assert.match(regimeQuery, /Promise\.all/);
    assert.match(regimeQuery, /returnStepCount:/);
    assert.match(regimeEvidenceQuery, /cache\(/);
    assert.match(
      regimeEvidenceQuery,
      /globalMarketFactors\.releaseDate/,
    );
    assert.match(
      regimeHistoricalOutcomeQuery,
      /buildSimulationRegimeHistoricalOutcomeValidation/,
    );
    assert.match(
      regimeHistoricalOutcomeQuery,
      /SIMULATION_REGIME_HISTORICAL_OUTCOME_VALIDATION_POLICY/,
    );
    assert.match(
      regimeHistoricalOutcomeQuery,
      /getReadOnlySimulationPeriodPreflightBatch/,
    );
    assert.match(regimeHistoricalOutcomeQuery, /loadRegimeFactorRows/);
    assert.match(regimeHistoricalOutcomeQuery, /Promise\.all/);
    assert.match(
      historicalOutcomeQuery,
      /buildSimulationHistoricalOutcomeValidation/,
    );
    assert.match(historicalOutcomeQuery, /buildSimulationInputReadinessDates/);
    assert.match(historicalOutcomeQuery, /90 \+ horizon|returnStepCount:/);
    assert.match(
      historicalOutcomeQuery,
      /resolveSimulationResearchHorizon/,
    );
    assert.match(
      historicalOutcomeQuery,
      /getReadOnlySimulationPeriodPreflightBatch/,
    );
    assert.doesNotMatch(
      query,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
    assert.doesNotMatch(
      regimeQuery,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
    assert.doesNotMatch(
      regimeEvidenceQuery,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
    assert.doesNotMatch(
      regimeHistoricalOutcomeQuery,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
    assert.doesNotMatch(
      historicalOutcomeQuery,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
    assert.doesNotMatch(
      researchUniverseQuery,
      /\.insert\(|\.update\(|\.delete\(|cron|fetch\s*\(/i,
    );
    assert.match(
      researchUniverseQuery,
      /Promise\.all\(\[\s*loadPriceRows/,
    );
    assert.match(
      researchUniverseQuery,
      /buildSimulationResearchUniversePreflight/,
    );
  });

  it("exposes readiness and fixed research output behind the existing access gate", () => {
    const view = readSimulationView();
    const proxy = read("src/proxy.ts");
    const dashboard = read("src/components/portfolio-dashboard.tsx");
    const smoke = read("scripts/smoke-simulation-route.mjs");

    assert.match(view, /data-page="simulation-input-readiness"/);
    assert.match(view, /data-readiness-status/);
    assert.match(view, /data-end-query-status/);
    assert.match(view, /data-invalid-end-query/);
    assert.match(view, /data-invalid-horizon-query/);
    assert.match(view, /data-simulation-research-horizon/);
    assert.match(view, /data-simulation-readiness-history/);
    assert.match(view, /data-fixed-research-execution/);
    assert.match(view, /data-research-execution-status/);
    assert.match(view, /data-research-fan-chart/);
    assert.match(view, /data-fixed-mix-research-execution/);
    assert.match(view, /data-joint-research-execution-status/);
    assert.match(view, /data-joint-sampling/);
    assert.match(view, /data-joint-rebalancing="none"/);
    assert.match(view, /data-joint-research-selection-status/);
    assert.match(view, /data-joint-research-kodex-weight-bps/);
    assert.match(view, /data-fixed-mix-research-comparison/);
    assert.match(view, /data-fixed-mix-research-comparison-status/);
    assert.match(view, /data-walk-forward-min-volatility/);
    assert.match(view, /data-walk-forward-min-volatility-status/);
    assert.match(view, /data-walk-forward-fold-count/);
    assert.match(view, /data-walk-forward-fold/);
    assert.match(view, /data-simulation-path-comparison-chart/);
    assert.match(view, /data-walk-forward-stability-history/);
    assert.match(view, /data-walk-forward-stability-status/);
    assert.match(view, /data-walk-forward-stability-ready-count/);
    assert.match(view, /data-walk-forward-stability-row/);
    assert.match(view, /data-walk-forward-stability-row-status/);
    assert.match(view, /data-fan-band-validation/);
    assert.match(view, /data-fan-band-validation-status/);
    assert.match(view, /data-fan-band-validation-horizon/);
    assert.match(view, /data-fan-band-validation-ready-count/);
    assert.match(view, /data-fan-band-validation-row/);
    assert.match(view, /data-fan-band-validation-row-status/);
    assert.match(view, /data-downside-outcome-validation/);
    assert.match(view, /data-downside-outcome-validation-status/);
    assert.match(view, /data-downside-outcome-validation-horizon/);
    assert.match(view, /data-downside-outcome-validation-ready-count/);
    assert.match(view, /data-downside-outcome-validation-row/);
    assert.match(view, /data-downside-outcome-validation-row-status/);
    assert.match(view, /data-regime-bootstrap-research/);
    assert.match(view, /data-regime-bootstrap-status/);
    assert.match(view, /data-regime-bootstrap-engine/);
    assert.match(view, /data-regime-fallback="forbidden"/);
    assert.match(view, /data-regime-historical-outcome-validation/);
    assert.match(
      view,
      /data-regime-historical-outcome-validation-status/,
    );
    assert.match(view, /data-regime-historical-outcome-ready-count/);
    assert.match(
      view,
      /data-regime-historical-outcome-point-in-time/,
    );
    assert.match(
      view,
      /data-regime-historical-outcome-scenario="kodex200-50-voo-50-buy-and-hold"/,
    );
    assert.match(view, /data-regime-historical-outcome-row/);
    assert.match(view, /data-regime-historical-outcome-row-status/);
    assert.match(view, /data-regime-readiness-history/);
    assert.match(view, /data-regime-point-in-time-status/);
    assert.match(view, /data-regime-safe-date-count/);
    assert.match(view, /data-regime-history-date/);
    assert.match(view, /data-regime-factor-key/);
    assert.match(view, /data-regime-scenario-status/);
    assert.match(view, /data-regime-fixed-mix-comparison/);
    assert.match(view, /data-regime-fixed-mix-comparison-status/);
    assert.match(view, /data-regime-fixed-mix-pairing/);
    assert.match(view, /data-regime-fixed-mix-scenario/);
    assert.match(view, /data-regime-fixed-mix-rebalancing="none"/);
    assert.match(view, /data-research-universe-preflight/);
    assert.match(view, /data-research-universe-selection/);
    assert.match(view, /data-research-universe-instrument/);
    assert.match(view, /data-research-universe-result-boundary/);
    assert.match(view, /name="researchUniverse"/);
    assert.match(view, /시뮬레이션은 실행하지 않습니다/);
    assert.match(view, /비중을 다시 나누거나 전체 포트폴리오 결과로 표시하지 않습니다/);
    assert.match(view, /data-regime-scenario-selected/);
    assert.match(view, /data-fixed-mix-comparison-pairing/);
    assert.match(view, /data-fixed-mix-comparison-scenario/);
    assert.match(view, /고정 비중 3안 공통 경로 비교/);
    assert.match(view, /워크포워드 최소변동성 연구/);
    assert.match(view, /직전 60개/);
    assert.match(view, /다음 10개/);
    assert.match(view, /미래 예측·추천 아님/);
    assert.match(view, /표본 공분산은 10% 대각 축소/);
    assert.match(view, /워크포워드 기준일 안정성/);
    assert.match(view, /직전 6개 날짜/);
    assert.match(view, /가장 좋은 날짜나 설정을 고르는 기능이 아닙니다/);
    assert.match(view, /서로 독립된 7번의/);
    assert.match(view, /성과 순위를 만들지 않습니다/);
    assert.match(view, /성과 순위·추천 아님/);
    assert.match(
      view,
      /서비스 기준일 수익률 \{researchHorizon\}단계 연구 시뮬레이션/,
    );
    assert.match(view, /명시 비중 공동 포트폴리오 연구/);
    assert.match(view, /KODEX 200 최초 비중/);
    assert.match(view, /이 비중으로 계산/);
    assert.match(view, /같은 기준일 수익률 쌍/);
    assert.match(view, /리밸런싱하지\s*않아/);
    assert.match(view, /연구용 · 저장 안 함 · 예측 아님/);
    assert.match(view, /서비스 기준일 수익률 \{researchHorizon\}단계/);
    assert.match(view, /stationary\s+bootstrap/);
    assert.match(view, /같은 입력 행렬,/);
    assert.match(view, /엔진 정책, 고정 seed에서만 결과가 동일합니다/);
    assert.match(view, /regime\s+bootstrap 모델은 아닙니다/);
    assert.match(view, /체제 데이터 시점 검증/);
    assert.match(view, /엄격한 시점 검증 미확립/);
    assert.match(view, /공개시각과 revision vintage/);
    assert.match(view, /시점 안전 날짜/);
    assert.match(view, /자동으로 되돌리지 않으며/);
    assert.match(view, /시장 국면 사후 연구/);
    assert.match(view, /국면별 고정 비중 3안 공통 경로/);
    assert.match(view, /같은 시장 상태·과거 후보·500개 추출/);
    assert.match(view, /비중 순서 · 성과 순위·추천 아님/);
    assert.match(view, /stationary\s*bootstrap 결과와 합산하거나 승패를 판정하지 않습니다/);
    assert.match(view, /단일 종목·직접 입력 참고 경로/);
    assert.match(view, /기존 stationary\s+bootstrap의 결손을 대신하지 않습니다/);
    assert.match(view, /자동 fallback 없음/);
    assert.match(view, /DB 적재시각은\s*과거 공개시점으로 간주하지 않습니다/);
    assert.match(view, /현재 보유,\s*계좌, Fount, 금현물/);
    assert.match(
      view,
      /고정 연구 시나리오: KODEX 200 50% \+ VOO 50%, 최초 배분 후\s*리밸런싱 없음/,
    );
    assert.match(view, /P10~P90/);
    assert.match(view, /P5 종료수익률/);
    assert.match(view, /종료수익률 하위 5% 평균/);
    assert.match(view, /최근 7개 기준일/);
    assert.match(view, /저장된 실행 기록이 아니라/);
    assert.match(view, /수익률 행/);
    assert.match(view, /data-observed-return-series/);
    assert.match(view, /data-observed-return-comparison/);
    assert.match(view, /data-comparison-axis-status/);
    assert.match(view, /data-comparison-point-count/);
    assert.match(view, /data-cross-market-alignment/);
    assert.match(view, /data-alignment-service-date-count/);
    assert.match(view, /data-price-carry-count/);
    assert.match(view, /data-fx-carry-count/);
    assert.match(view, /90개 관측구간 누적지수 비교/);
    assert.match(view, /교차시장 정렬 근거/);
    assert.match(view, /가격은 최대 7일/);
    assert.match(view, /USD\/KRW는\s*최대 3일/);
    assert.match(view, /가격 직전값 적용/);
    assert.match(view, /환율 직전값 적용/);
    assert.match(view, /시작 100으로 누적/);
    assert.match(view, /두 입력 공통/);
    assert.match(view, /\{rows\.length\}개 관측 수익률/);
    assert.match(view, /전체 \{rows\.length\}개 수익률 표 보기/);
    assert.match(view, /예측·시뮬레이션 경로 아님/);
    assert.match(view, /결과는 미래 예측, 비중 추천 또는 주문 근거가 아닙니다/);
    assert.match(view, /과거\s*날짜로 자동 대체/);
    assert.doesNotMatch(
      view,
      /scenarioVectorHash|matrixRequestHash|inputMatrixHash|drawPlanHash|initialKrw|optimizer|adjustedClosePrice|usdKrw|sourcePriceDate|sourceFxDate/i,
    );
    assert.match(proxy, /"\/simulation"/);
    assert.match(proxy, /"\/simulation\/:path\*"/);
    assert.match(dashboard, /href: "\/simulation"/);
    assert.match(
      smoke,
      /data-regime-historical-outcome-point-in-time="not_established"/,
    );
    assert.match(smoke, /EXPECT_REGIME_HISTORICAL_READY/);
    assert.match(smoke, /HAS_EXPLICIT_END/);
    assert.match(
      smoke,
      /regimeHistoricalOutcomeReadyCount > 0/,
    );
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function readSimulationView() {
  return [
    "src/components/simulation/simulation-input-readiness-view.tsx",
    "src/components/simulation/fixed-mix-research-execution-section.tsx",
    "src/components/simulation/fixed-mix-research-comparison-section.tsx",
    "src/components/simulation/walk-forward-min-volatility-section.tsx",
    "src/components/simulation/walk-forward-stability-history-section.tsx",
    "src/components/simulation/fan-band-validation-section.tsx",
    "src/components/simulation/downside-outcome-validation-section.tsx",
    "src/components/simulation/historical-validation-ui.tsx",
    "src/components/simulation/simulation-path-comparison-chart.tsx",
    "src/components/simulation/fixed-research-execution-section.tsx",
    "src/components/simulation/regime-bootstrap-research-section.tsx",
    "src/components/simulation/regime-historical-outcome-validation-section.tsx",
    "src/components/simulation/regime-fixed-mix-comparison-panel.tsx",
    "src/components/simulation/regime-readiness-history-panel.tsx",
    "src/components/simulation/regime-scenario-card.tsx",
    "src/components/simulation/research-universe-preflight-section.tsx",
    "src/components/simulation/simulation-terminal-risk-metrics.tsx",
    "src/components/simulation/research-fan-chart.tsx",
    "src/components/simulation/observed-return-alignment-evidence-panel.tsx",
    "src/components/simulation/observed-return-comparison-panel.tsx",
    "src/components/simulation/observed-return-series-panel.tsx",
  ]
    .map(read)
    .join("\n");
}
