import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("Simulation input readiness route boundary", () => {
  it("keeps the page server-rendered and the database adapter server-only", () => {
    const page = read("src/app/simulation/page.tsx");
    const query = read("src/db/queries/simulation-input-readiness.ts");
    const view = read(
      "src/components/simulation/simulation-input-readiness-view.tsx",
    );

    assert.doesNotMatch(page, /["']use client["']/);
    assert.doesNotMatch(view, /["']use client["']/);
    assert.doesNotMatch(`${page}\n${view}`, /\bfetch\s*\(|\/api\//);
    assert.match(query, /^import "server-only";/);
    assert.match(page, /endServiceDate: params\.end/);
    assert.doesNotMatch(page, /params\.end\[0\]/);
    assert.match(query, /resolveSimulationEndServiceDateSelection/);
    assert.match(query, /getReadOnlySimulationPeriodPreflightBatch/);
    assert.doesNotMatch(query, /endServiceDate\?\.trim\(\)/);
    assert.match(query, /ticker: "069500"/);
    assert.match(query, /ticker: "VOO"/);
    assert.doesNotMatch(
      query,
      /\.insert\(|\.update\(|\.delete\(|provider|cron|fetch\s*\(/i,
    );
  });

  it("exposes only readiness and protects the route with the existing access gate", () => {
    const view = read(
      "src/components/simulation/simulation-input-readiness-view.tsx",
    );
    const proxy = read("src/proxy.ts");
    const dashboard = read("src/components/portfolio-dashboard.tsx");

    assert.match(view, /data-page="simulation-input-readiness"/);
    assert.match(view, /data-readiness-status/);
    assert.match(view, /data-end-query-status/);
    assert.match(view, /data-invalid-end-query/);
    assert.match(view, /data-simulation-readiness-history/);
    assert.match(view, /최근 7개 기준일/);
    assert.match(view, /저장된 실행 기록이 아니라/);
    assert.match(view, /수익률 행/);
    assert.match(view, /시뮬레이션 실행, 미래 예측, 비중 추천 결과가 아닙니다/);
    assert.match(view, /과거\s*날짜로 자동 대체/);
    assert.doesNotMatch(
      view,
      /scenarioVectorHash|matrixRequestHash|inputMatrixHash|drawPlanHash|initialKrw|pathCount|optimizer/i,
    );
    assert.match(proxy, /"\/simulation"/);
    assert.match(proxy, /"\/simulation\/:path\*"/);
    assert.match(dashboard, /href: "\/simulation"/);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}
