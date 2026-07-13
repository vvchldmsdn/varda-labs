import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3100";
const END_SERVICE_DATE = readArgument("--end");
const EXPECT_READY = numberArgument("--expect-ready");
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
const simulationPath = END_SERVICE_DATE
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
  assert.match(simulation.body, /연구 입력 증거 준비도/);
  assert.match(simulation.body, /069500/);
  assert.match(simulation.body, /VOO/);
  assert.match(
    simulation.body,
    /시뮬레이션 실행, 미래 예측, 비중 추천 결과가 아닙니다/,
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
  assert.equal(inputCount, 2, "simulation must render two independent inputs");
  assert.equal(statuses.length, 2, "simulation must render two readiness states");
  if (EXPECT_READY !== null) {
    assert.equal(readyCount, EXPECT_READY, "unexpected ready input count");
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
