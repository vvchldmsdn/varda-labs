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
    "KODEX 200 종가",
    "종료 시 대기 거래",
    "현금흐름 조정 추정수익률",
    "Modified Dietz",
    "정확한 일별 TWR 또는 총수익률을 의미하지 않습니다",
    "전액 VOO 비교 준비도",
    "준비 전에는 부분 경로나 추정값을 표시하지 않습니다",
  ]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }
  assert.match(route.body, /data-return-status="ready"/);
  assert.match(
    route.body,
    /data-return-method="modified_dietz_daily_weighted_eod_v1"/,
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
  const comparisonDates = readIntegerAttribute(
    route.body,
    "data-comparison-dates",
  );
  const appliedFlows = readIntegerAttribute(route.body, "data-applied-flows");
  const delayedExecutions = readIntegerAttribute(
    route.body,
    "data-delayed-executions",
  );
  const scenarioCloseRows = readIntegerAttribute(
    route.body,
    "data-scenario-close-rows",
  );
  const pendingAtEnd = readIntegerAttribute(route.body, "data-pending-at-end");
  const vooReadiness = readStringAttribute(route.body, "data-voo-readiness");
  const vooServiceDates = readIntegerAttribute(
    route.body,
    "data-voo-service-dates",
  );
  const vooValuationPrices = readIntegerAttribute(
    route.body,
    "data-voo-valuation-price-ready",
  );
  const vooSnapshotFx = readIntegerAttribute(
    route.body,
    "data-voo-snapshot-fx-ready",
  );
  const vooRelevantFlows = readIntegerAttribute(
    route.body,
    "data-voo-relevant-flows",
  );
  const vooExecutionFx = readIntegerAttribute(
    route.body,
    "data-voo-execution-fx-ready",
  );

  assert.ok(comparisonDates >= 2, "comparison path needs at least two dates");
  assert.ok(appliedFlows >= 0, "applied flow count must be non-negative");
  assert.ok(delayedExecutions >= 0, "delayed count must be non-negative");
  assert.ok(scenarioCloseRows >= 2, "scenario needs at least two close rows");
  assert.equal(pendingAtEnd, 0, "route must not publish an unfinished path");
  assert.ok(
    vooReadiness === "ready" || vooReadiness === "unavailable",
    "VOO readiness must be explicit",
  );
  assert.equal(vooServiceDates, comparisonDates);
  assert.ok(vooValuationPrices <= vooServiceDates);
  assert.ok(vooSnapshotFx <= vooServiceDates);
  assert.ok(vooExecutionFx <= vooRelevantFlows);
  if (vooReadiness === "ready") {
    assert.equal(vooValuationPrices, vooServiceDates);
    assert.equal(vooSnapshotFx, vooServiceDates);
    assert.equal(vooExecutionFx, vooRelevantFlows);
  }

  console.log(
    JSON.stringify(
      {
        smoke: "investment_lab_route",
        baseUrl: BASE_URL,
        noAuthStatus: unauthorized.status,
        authenticatedStatus: route.status,
        dashboardLink: true,
        comparisonDates,
        appliedFlows,
        delayedExecutions,
        scenarioCloseRows,
        pendingAtEnd,
        returnStatus: "ready",
        returnMethod: "modified_dietz_daily_weighted_eod_v1",
        vooReadiness,
        vooServiceDates,
        vooValuationPrices,
        vooSnapshotFx,
        vooRelevantFlows,
        vooExecutionFx,
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

function readIntegerAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="(\\d+)"`));
  assert.ok(match, `route is missing numeric attribute: ${name}`);
  return Number(match[1]);
}

function readStringAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="([a-z_]+)"`));
  assert.ok(match, `route is missing string attribute: ${name}`);
  return match[1];
}

await main();
