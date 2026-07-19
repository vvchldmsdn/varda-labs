import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Simulation input readiness route boundary", () => {
  it("keeps the page server-rendered and the database adapter server-only", () => {
    const page = read("src/app/simulation/page.tsx");
    const query = read("src/db/queries/simulation-input-readiness.ts");
    const selection = read("src/lib/kodex-voo-fixed-mix-selection.ts");
    const view = readSimulationView();

    assert.doesNotMatch(page, /["']use client["']/);
    assert.doesNotMatch(view, /["']use client["']/);
    assert.doesNotMatch(`${page}\n${view}`, /\bfetch\s*\(|\/api\//);
    assert.match(query, /^import "server-only";/);
    assert.match(page, /endServiceDate: params\.end/);
    assert.match(page, /kodexWeight: params\.kodexWeight/);
    assert.doesNotMatch(page, /params\.end\[0\]/);
    assert.match(query, /resolveSimulationEndServiceDateSelection/);
    assert.match(query, /getReadOnlySimulationPeriodPreflightBatch/);
    assert.match(query, /buildFixedResearchSimulation/);
    assert.match(query, /prepareFixedMixResearchContext/);
    assert.match(query, /buildFixedMixResearchSimulationFromContext/);
    assert.match(query, /buildFixedMixResearchComparisonFromContext/);
    assert.match(query, /resolveKodexVooFixedMixSelection/);
    assert.match(query, /matrix: comparisonPreflight\.matrixArtifact/);
    assert.match(query, /candidates: INPUTS\.map\(candidate\)/);
    assert.match(query, /\.\.\.independentRequests, comparisonRequest/);
    assert.doesNotMatch(query, /endServiceDate\?\.trim\(\)/);
    assert.match(selection, /typeof value !== "string"/);
    assert.match(selection, /minimumComponentWeightPct: 1/);
    assert.match(selection, /maximumComponentWeightPct: 99/);
    assert.match(query, /ticker: "069500"/);
    assert.match(query, /ticker: "VOO"/);
    assert.doesNotMatch(
      query,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
  });

  it("exposes readiness and fixed research output behind the existing access gate", () => {
    const view = readSimulationView();
    const proxy = read("src/proxy.ts");
    const dashboard = read("src/components/portfolio-dashboard.tsx");

    assert.match(view, /data-page="simulation-input-readiness"/);
    assert.match(view, /data-readiness-status/);
    assert.match(view, /data-end-query-status/);
    assert.match(view, /data-invalid-end-query/);
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
    assert.match(view, /data-fixed-mix-comparison-pairing/);
    assert.match(view, /data-fixed-mix-comparison-scenario/);
    assert.match(view, /고정 비중 3안 공통 경로 비교/);
    assert.match(view, /성과 순위·추천 아님/);
    assert.match(view, /3개월 연구 시뮬레이션/);
    assert.match(view, /명시 비중 공동 포트폴리오 연구/);
    assert.match(view, /KODEX 200 최초 비중/);
    assert.match(view, /이 비중으로 계산/);
    assert.match(view, /같은 기준일 수익률 쌍/);
    assert.match(view, /리밸런싱하지\s*않아/);
    assert.match(view, /연구용 · 저장 안 함 · 예측 아님/);
    assert.match(view, /63거래일 경로 500개/);
    assert.match(view, /stationary\s+bootstrap/);
    assert.match(view, /같은 입력 행렬,/);
    assert.match(view, /엔진 정책, 고정 seed에서만 결과가 동일합니다/);
    assert.match(view, /regime\s+bootstrap 모델은 아닙니다/);
    assert.match(view, /P10~P90/);
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
    "src/components/simulation/fixed-research-execution-section.tsx",
    "src/components/simulation/research-fan-chart.tsx",
    "src/components/simulation/observed-return-alignment-evidence-panel.tsx",
    "src/components/simulation/observed-return-comparison-panel.tsx",
    "src/components/simulation/observed-return-series-panel.tsx",
  ]
    .map(read)
    .join("\n");
}
