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
const scenarios = [
  { label: "brokerage", path: "/portfolio/structure" },
  { label: "isa", path: "/portfolio/structure?account=isa" },
  { label: "irp", path: "/portfolio/structure?account=irp" },
  { label: "all", path: "/portfolio/structure?account=all" },
];

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const authorization = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`;

async function main() {
  const countsBefore = await readCounts();
  const unauthorized = await request("/portfolio/structure");
  assert.equal(unauthorized.status, 401, "no-auth route must return 401");

  const routeResults = [];
  for (const scenario of scenarios) {
    const response = await request(scenario.path, true);
    assert.equal(response.status, 200, `${scenario.label} must return 200`);
    assert.match(response.body, /data-page="portfolio-structure"/);
    assert.match(response.body, /data-section="direct-holdings-baseline"/);
    assert.match(response.body, /data-section="portfolio-fx-shock"/);
    assert.match(
      response.body,
      /data-fx-shock-policy="static_usdkrw_direct_holdings_shock_v1"/,
    );
    assert.match(
      response.body,
      /data-fx-shock-persistence="browser_memory_only"/,
    );
    assert.ok(response.body.includes("직접 보유 USD 환율 충격 실험"));
    assert.ok(response.body.includes("원화 상장 ETF의 해외 구성 종목은 추정하지 않습니다"));
    assert.doesNotMatch(response.body, LEAK_PATTERN);

    const selectedAccount = readStringAttribute(
      response.body,
      "data-fx-shock-selected-account",
    );
    const status = readStringAttribute(response.body, "data-fx-shock-status");
    const reason = readStringAttribute(response.body, "data-fx-shock-reason");
    const appliedAssetCount = readIntegerAttribute(
      response.body,
      "data-applied-asset-count",
    );
    const evaluatedAssetCount = readIntegerAttribute(
      response.body,
      "data-evaluated-asset-count",
    );
    const excludedEvidenceCount = readIntegerAttribute(
      response.body,
      "data-excluded-evidence-count",
    );
    assert.equal(selectedAccount, scenario.label);
    assert.ok(["ready", "unavailable", "blocked"].includes(status));
    assert.ok(evaluatedAssetCount >= appliedAssetCount);
    assert.ok(excludedEvidenceCount >= 0);

    if (status === "ready") {
      const shockPct = readNumberAttribute(response.body, "data-shock-pct");
      const subsetValue = readNumberAttribute(
        response.body,
        "data-evaluated-subset-value-krw",
      );
      const usdValue = readNumberAttribute(
        response.body,
        "data-usd-exposure-value-krw",
      );
      const usdWeight = readNumberAttribute(
        response.body,
        "data-usd-exposure-weight-pct",
      );
      const estimatedChange = readNumberAttribute(
        response.body,
        "data-estimated-change-krw",
      );
      const estimatedChangePctPoints = readNumberAttribute(
        response.body,
        "data-estimated-change-pct-points",
      );
      const postShockValue = readNumberAttribute(
        response.body,
        "data-post-shock-subset-value-krw",
      );
      assert.equal(reason, "ready");
      assert.equal(shockPct, 5);
      assert.ok(appliedAssetCount > 0);
      assert.ok(usdValue > 0 && subsetValue >= usdValue);
      assertClose(estimatedChange, usdValue * (shockPct / 100));
      assertClose(
        estimatedChangePctPoints,
        usdWeight * (shockPct / 100),
      );
      assertClose(postShockValue, subsetValue + estimatedChange);
    } else {
      assert.notEqual(reason, "ready");
      assert.equal(
        readOptionalNumberAttribute(response.body, "data-estimated-change-krw"),
        null,
      );
      assert.equal(
        readOptionalNumberAttribute(
          response.body,
          "data-post-shock-subset-value-krw",
        ),
        null,
      );
    }

    routeResults.push({
      account: selectedAccount,
      status,
      reason,
      appliedAssetCount,
      evaluatedAssetCount,
      excludedEvidenceCount,
    });
  }

  assert.equal(
    routeResults.find((row) => row.account === "brokerage")?.status,
    "ready",
    "the current brokerage fixture must retain explicit USD exposure",
  );
  assert.equal(
    routeResults.find((row) => row.account === "all")?.status,
    "ready",
    "the current all-account fixture must retain explicit USD exposure",
  );

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");

  console.log(
    JSON.stringify(
      {
        smoke: "portfolio_structure_route",
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
      (select count(*)::int from asset_groups) as asset_groups,
      (select count(*)::int from asset_group_members) as asset_group_members,
      (select count(*)::int from live_price_quotes) as live_price_quotes,
      (select count(*)::int from fx_rates) as fx_rates
  `);
  return row;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readIntegerAttribute(html, name) {
  const value = readNumberAttribute(html, name);
  assert.ok(Number.isInteger(value), `${name} must be an integer`);
  return value;
}

function readStringAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="([a-z0-9_]+)"`));
  assert.ok(match, `route is missing string attribute: ${name}`);
  return match[1];
}

function readNumberAttribute(html, name) {
  const value = readOptionalNumberAttribute(html, name);
  assert.notEqual(value, null, `route is missing numeric attribute: ${name}`);
  return value;
}

function readOptionalNumberAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="(-?\\d+(?:\\.\\d+)?)"`));
  return match ? Number(match[1]) : null;
}

function assertClose(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

await main();
