import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3107";
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|assetId|ownerUserId|api[_-]?key|authorization|password|secret|token|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const unauthorized = await request("/investment-lab");
  assert.equal(unauthorized.status, 401, "no-auth route must return 401");

  const dashboard = await request("/", true);
  assert.equal(dashboard.status, 200, "authenticated dashboard must return 200");
  assert.match(dashboard.body, /href="\/investment-lab"/);
  assert.doesNotMatch(dashboard.body, LEAK_PATTERN);

  const route = await request("/investment-lab", true);
  assert.equal(route.status, 200, "authenticated route must return 200");
  assert.match(route.body, /data-page="investment-lab"/);
  for (const marker of [
    "투자 랩",
    "전액 KODEX 200",
    "평가액 경로 비교",
    "27개 평가일",
    "KODEX 200 종가",
    "911행",
    "종료 시 대기 거래",
    "0건",
  ]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }
  assert.match(
    route.body,
    /기간 내 반영 거래(?:\s|<!-- -->)*38(?:\s|<!-- -->)*건/,
  );
  assert.match(
    route.body,
    /지연 체결(?:\s|<!-- -->)*5(?:\s|<!-- -->)*건/,
  );
  assert.match(route.body, /overflow-x-auto/);
  assert.match(route.body, /viewBox="0 0 1000 340"/);
  assert.doesNotMatch(route.body, LEAK_PATTERN);
  assert.doesNotMatch(
    route.body,
    /event_ledger_entries|daily_portfolio_snapshots|asset_price_snapshots/i,
  );

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "investment_lab_route",
        baseUrl: BASE_URL,
        noAuthStatus: unauthorized.status,
        authenticatedStatus: route.status,
        dashboardLink: true,
        comparisonDates: 27,
        appliedFlows: 38,
        delayedExecutions: 5,
        scenarioCloseRows: 911,
        pendingAtEnd: 0,
        leakPatternMatches: 0,
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
      (select count(*)::int from event_ledger_entries) as event_ledger_entries,
      (select count(*)::int from daily_portfolio_snapshots) as portfolio_snapshots,
      (select count(*)::int from asset_price_snapshots) as price_snapshots
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

await main();
