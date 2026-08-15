import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const SESSION_COOKIE =
  readArgument("--session-cookie") ??
  process.env.VARDA_SESSION_COOKIE?.trim() ??
  null;
const EXPECT_HISTORY_UNAVAILABLE = process.argv.includes(
  "--expect-history-unavailable",
);
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|api[_-]?key|authorization|password|secret|token|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

const FULL_SECTIONS = [
  "analysis-basis",
  "portfolio-summary",
  "instrument-risk",
  "correlation-matrix",
  "stress-correlation",
  "data-health",
];
const baseScenarios = [
  {
    label: "brokerage_90_complete",
    path: "/portfolio/risk",
    expectedSections: FULL_SECTIONS,
    absentSections: ["standalone-summary"],
    expectedText: [],
    absentText: ["종목 수 부족"],
    minimumOverflowContainers: 4,
  },
  {
    label: "brokerage_252_unavailable",
    path: "/portfolio/risk?window=252",
    expectedSections: ["analysis-basis", "data-health"],
    absentSections: [
      "portfolio-summary",
      "standalone-summary",
      "instrument-risk",
      "correlation-matrix",
      "stress-correlation",
    ],
    expectedText: [],
    absentText: [],
    minimumOverflowContainers: 1,
  },
  {
    label: "irp_90_standalone",
    path: "/portfolio/risk?account=irp",
    expectedSections: [
      "analysis-basis",
      "standalone-summary",
      "instrument-risk",
      "data-health",
    ],
    absentSections: [
      "portfolio-summary",
      "correlation-matrix",
      "stress-correlation",
    ],
    expectedText: ["종목 수 부족"],
    absentText: [],
    minimumOverflowContainers: 2,
  },
  {
    label: "isa_252_complete",
    path: "/portfolio/risk?account=isa&window=252",
    expectedSections: FULL_SECTIONS,
    absentSections: ["standalone-summary"],
    expectedText: [],
    absentText: ["종목 수 부족"],
    minimumOverflowContainers: 3,
  },
];
const scenarios = EXPECT_HISTORY_UNAVAILABLE
  ? baseScenarios.map((scenario) => ({
      ...scenario,
      expectedSections: ["analysis-basis", "data-health"],
      absentSections: [
        "portfolio-summary",
        "standalone-summary",
        "instrument-risk",
        "correlation-matrix",
        "stress-correlation",
      ],
      expectedText: [],
      absentText: [],
      minimumOverflowContainers: 0,
    }))
  : baseScenarios;

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

async function main() {
  const boundary = await request("/portfolio/risk");
  assert.equal(
    boundary.status,
    200,
    "signed-out risk shell must return 200",
  );
  assert.match(boundary.body, /Portfolio risk/);
  assert.match(boundary.body, /Portfolio user link/);
  assert.match(boundary.body, /Product database read/);
  assert.match(boundary.body, /Not attempted/);
  assert.match(boundary.body, /href="\/auth\/sign-in"/);
  assert.doesNotMatch(boundary.body, /data-page="portfolio-risk"/);
  assert.doesNotMatch(boundary.body, LEAK_PATTERN);

  if (!SESSION_COOKIE) {
    console.log(
      JSON.stringify(
        {
          status: "portfolio_risk_session_boundary_verified",
          databaseReadAttempted: false,
          leakPatternMatches: 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!sql) throw new Error("DATABASE_URL is required for session-bound smoke");
  const countsBefore = await readCounts();
  const signedOutDashboard = await request("/");
  assert.equal(
    signedOutDashboard.status,
    200,
    "signed-out dashboard shell must return 200",
  );
  assert.match(signedOutDashboard.body, /Portfolio user link/);
  assert.match(signedOutDashboard.body, /Product database read/);
  assert.match(signedOutDashboard.body, /Not attempted/);
  assert.doesNotMatch(signedOutDashboard.body, LEAK_PATTERN);

  const dashboard = await request("/", SESSION_COOKIE);
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.match(dashboard.body, /href="\/portfolio\/structure"/);
  assert.match(dashboard.body, /href="\/portfolio\/risk"/);
  assert.match(dashboard.body, /자산 배분/);
  assert.match(dashboard.body, /위험·분산/);
  assert.ok(
    dashboard.body.indexOf('href="/portfolio/structure"') <
      dashboard.body.indexOf('href="/portfolio/risk"'),
    "risk navigation must follow allocation navigation",
  );
  assert.doesNotMatch(dashboard.body, LEAK_PATTERN);

  const routeResults = [];
  for (const scenario of scenarios) {
    const response = await request(scenario.path, SESSION_COOKIE);
    assert.equal(response.status, 200, `${scenario.label} must return 200`);
    if (EXPECT_HISTORY_UNAVAILABLE) {
      assert.match(
        response.body,
        /data-historical-price-admission="unavailable"/,
        `${scenario.label} must explain the admitted-history boundary`,
      );
    }
    assert.match(response.body, /data-page="portfolio-risk"/);
    assert.match(response.body, /포트폴리오 위험·분산/);
    assert.match(response.body, /리스크 계산 대상/);
    assert.match(response.body, /무위험 수익률 \(가정\)/);
    assert.match(response.body, /overflow-x-hidden/);
    assert.doesNotMatch(response.body, LEAK_PATTERN);

    for (const section of scenario.expectedSections) {
      assert.match(
        response.body,
        new RegExp(`data-risk-section="${section}"`),
        `${scenario.label} is missing ${section}`,
      );
    }
    for (const section of scenario.absentSections) {
      assert.doesNotMatch(
        response.body,
        new RegExp(`data-risk-section="${section}"`),
        `${scenario.label} unexpectedly rendered ${section}`,
      );
    }
    for (const expectedText of scenario.expectedText) {
      assert.ok(
        response.body.includes(expectedText),
        `${scenario.label} is missing expected text: ${expectedText}`,
      );
    }
    for (const absentText of scenario.absentText) {
      assert.ok(
        !response.body.includes(absentText),
        `${scenario.label} unexpectedly rendered text: ${absentText}`,
      );
    }
    const overflowContainers =
      response.body.match(/overflow-x-auto/g)?.length ?? 0;
    assert.ok(
      overflowContainers >= scenario.minimumOverflowContainers,
      `${scenario.label} is missing table overflow containers`,
    );

    routeResults.push({
      label: scenario.label,
      status: response.status,
      expectedSections: scenario.expectedSections.length,
      absentSections: scenario.absentSections.length,
      overflowContainers,
      leakPatternMatches: 0,
    });
  }

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "portfolio_risk_route",
        baseUrl: BASE_URL,
        signedOutStatus: {
          dashboard: signedOutDashboard.status,
          portfolioRisk: boundary.status,
        },
        dashboard: {
          status: dashboard.status,
          allocationLink: true,
          riskLink: true,
          navigationOrder: "allocation_then_risk",
        },
        authenticatedRoutes: routeResults,
        databaseSideEffects: false,
        counts: countsAfter,
      },
      null,
      2,
    ),
  );
}

async function request(path, cookie = null) {
  const response = await fetch(new URL(path, BASE_URL), {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

async function readCounts() {
  assert.ok(sql, "DATABASE_URL is required for count verification");
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from asset_price_snapshots) as price_snapshots,
      (select count(*)::int from fx_rates) as fx_rates
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
