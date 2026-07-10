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

const scenarios = [
  {
    label: "all_lanes",
    path: "/history",
    expectedSections: ["balance", "portfolio"],
    absentSections: [],
    expectedText: [
      "히스토리",
      "잔액 기준일",
      "스냅샷 저장일",
      "저장값",
      "표시용 합산",
    ],
    minimumOverflowContainers: 2,
  },
  {
    label: "brokerage_balance",
    path: "/history?account=brokerage&lane=balance",
    expectedSections: ["balance"],
    absentSections: ["portfolio"],
    expectedText: ["증권", "잔액 기준일"],
    minimumOverflowContainers: 1,
  },
  {
    label: "isa_portfolio",
    path: "/history?account=isa&lane=portfolio",
    expectedSections: ["portfolio"],
    absentSections: ["balance"],
    expectedText: ["ISA", "스냅샷 저장일", "저장값"],
    minimumOverflowContainers: 1,
  },
  {
    label: "all_portfolio_derived",
    path: "/history?account=all&lane=portfolio",
    expectedSections: ["portfolio"],
    absentSections: ["balance"],
    expectedText: ["표시용 합산", 'data-history-row-kind="derived"'],
    minimumOverflowContainers: 1,
  },
];

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const unauthorizedHistory = await request("/history");
  const unauthorizedDashboard = await request("/");
  assert.equal(
    unauthorizedHistory.status,
    401,
    "no-auth history request must return 401",
  );
  assert.equal(
    unauthorizedDashboard.status,
    401,
    "no-auth dashboard request must return 401",
  );

  const dashboard = await request("/", true);
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.match(dashboard.body, /href="\/portfolio\/risk"/);
  assert.match(dashboard.body, /href="\/history"/);
  assert.match(dashboard.body, /히스토리/);
  assert.ok(
    dashboard.body.indexOf('href="/portfolio/risk"') <
      dashboard.body.indexOf('href="/history"'),
    "history navigation must follow risk navigation",
  );
  assert.doesNotMatch(dashboard.body, LEAK_PATTERN);

  const routeResults = [];
  for (const scenario of scenarios) {
    const response = await request(scenario.path, true);
    assert.equal(response.status, 200, `${scenario.label} must return 200`);
    assert.match(response.body, /data-page="history"/);
    assert.match(
      response.body,
      /data-history-semantic="stored-evidence-not-recomputed"/,
    );
    assert.match(response.body, /overflow-x-hidden/);
    assert.doesNotMatch(response.body, LEAK_PATTERN);
    assert.doesNotMatch(
      response.body,
      /account_balance_snapshots|daily_portfolio_snapshots/i,
    );

    for (const section of scenario.expectedSections) {
      assert.match(
        response.body,
        new RegExp(`data-history-section="${section}"`),
        `${scenario.label} is missing ${section}`,
      );
    }
    for (const section of scenario.absentSections) {
      assert.doesNotMatch(
        response.body,
        new RegExp(`data-history-section="${section}"`),
        `${scenario.label} unexpectedly rendered ${section}`,
      );
    }
    for (const expectedText of scenario.expectedText) {
      assert.ok(
        response.body.includes(expectedText),
        `${scenario.label} is missing expected text: ${expectedText}`,
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
  assert.deepEqual(countsAfter, countsBefore, "history render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "history_route",
        baseUrl: BASE_URL,
        noAuthStatus: {
          dashboard: unauthorizedDashboard.status,
          history: unauthorizedHistory.status,
        },
        dashboard: {
          status: dashboard.status,
          historyLink: true,
          navigationOrder: "risk_then_history",
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
      (select count(*)::int from account_balance_snapshots) as balance_snapshots,
      (select count(*)::int from daily_portfolio_snapshots) as portfolio_snapshots
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
