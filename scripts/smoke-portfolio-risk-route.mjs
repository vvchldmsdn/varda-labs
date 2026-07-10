import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
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
const scenarios = [
  {
    label: "brokerage_90_complete",
    path: "/portfolio/risk",
    expectedSections: FULL_SECTIONS,
    absentSections: ["standalone-summary"],
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
    minimumOverflowContainers: 2,
  },
  {
    label: "isa_252_complete",
    path: "/portfolio/risk?account=isa&window=252",
    expectedSections: FULL_SECTIONS,
    absentSections: ["standalone-summary"],
    minimumOverflowContainers: 3,
  },
];

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const unauthorized = await request("/portfolio/risk");
  assert.equal(unauthorized.status, 401, "no-auth request must return 401");

  const routeResults = [];
  for (const scenario of scenarios) {
    const response = await request(scenario.path, true);
    assert.equal(response.status, 200, `${scenario.label} must return 200`);
    assert.match(response.body, /data-page="portfolio-risk"/);
    assert.match(response.body, /포트폴리오 위험·분산/);
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
        noAuthStatus: unauthorized.status,
        authenticatedRoutes: routeResults,
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
      (select count(*)::int from fx_rates) as fx_rates
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
