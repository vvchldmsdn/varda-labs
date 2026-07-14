import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3107";
const START_SERVICE_DATE = readArgument("--start");
const END_SERVICE_DATE = readArgument("--end");
const EXPECTED_PERIOD_STATUS =
  readArgument("--expect-period-status") ??
  (START_SERVICE_DATE || END_SERVICE_DATE ? "selected" : "full");
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

  const routePath = investmentLabRoutePath();
  const route = await request(routePath, true);
  assert.equal(route.status, 200, "authenticated route must return 200");
  assert.match(route.body, /data-page="investment-lab"/);
  for (const marker of ["투자 랩", "과거 비교 구간", "구간 적용"]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }
  const periodStatus = readStringAttribute(route.body, "data-period-status");
  assert.equal(periodStatus, EXPECTED_PERIOD_STATUS);
  assert.match(route.body, /data-section="investment-lab-etf-xray"/);
  const xrayStatus = readStringAttribute(route.body, "data-xray-status");
  const heldEtfs = readIntegerAttribute(route.body, "data-held-etfs");
  const matchedEtfs = readIntegerAttribute(route.body, "data-matched-etfs");
  const missingEtfReferences = readIntegerAttribute(
    route.body,
    "data-missing-etf-references",
  );
  const ambiguousEtfReferences = readIntegerAttribute(
    route.body,
    "data-ambiguous-etf-references",
  );
  const xrayAsOfDateCount = readIntegerAttribute(
    route.body,
    "data-xray-as-of-date-count",
  );
  const xrayComponentCount = readIntegerAttribute(
    route.body,
    "data-xray-component-count",
  );
  const xrayOverlapCount = readIntegerAttribute(
    route.body,
    "data-xray-overlap-count",
  );
  const xrayMixedAsOf = readStringAttribute(
    route.body,
    "data-xray-mixed-as-of",
  );
  const etfPortfolioWeight = readNumberAttribute(
    route.body,
    "data-etf-portfolio-weight",
  );
  const observedEtfExposure = readNumberAttribute(
    route.body,
    "data-observed-etf-exposure",
  );
  const uncoveredEtfExposure = readNumberAttribute(
    route.body,
    "data-uncovered-etf-exposure",
  );
  assert.ok(
    [
      "complete_common_date",
      "complete_mixed_dates",
      "partial",
      "unavailable",
    ].includes(xrayStatus),
    "ETF X-ray status must be explicit",
  );
  assert.ok(heldEtfs > 0, "ETF X-ray needs at least one held ETF");
  assert.equal(
    matchedEtfs + missingEtfReferences + ambiguousEtfReferences,
    heldEtfs,
    "every held ETF must have an explicit reference mapping state",
  );
  assert.ok(xrayAsOfDateCount >= 1, "ETF X-ray needs dated evidence");
  assert.ok(xrayComponentCount >= xrayOverlapCount);
  assert.ok(xrayMixedAsOf === "true" || xrayMixedAsOf === "false");
  assert.ok(
    Math.abs(
      etfPortfolioWeight - observedEtfExposure - uncoveredEtfExposure,
    ) < 0.00001,
    "observed and uncovered ETF exposure must reconcile without normalization",
  );
  assert.doesNotMatch(route.body, LEAK_PATTERN);
  assert.doesNotMatch(
    route.body,
    /event_ledger_entries|daily_portfolio_snapshots|asset_price_snapshots/i,
  );

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");
  if (periodStatus === "invalid" || periodStatus === "unavailable") {
    assert.match(route.body, /data-return-status="unavailable"/);
    assert.match(route.body, /data-period-reason="[a-z_]+"/);
    assert.doesNotMatch(route.body, /평가액 경로 비교/);
    console.log(
      JSON.stringify(
        {
          smoke: "investment_lab_route",
          baseUrl: BASE_URL,
          routePath,
          periodStatus,
          xrayStatus,
          heldEtfs,
          matchedEtfs,
          missingEtfReferences,
          ambiguousEtfReferences,
          xrayAsOfDateCount,
          xrayComponentCount,
          xrayOverlapCount,
          xrayMixedAsOf,
          etfPortfolioWeight,
          observedEtfExposure,
          uncoveredEtfExposure,
          noAuthStatus: unauthorized.status,
          authenticatedStatus: route.status,
          dashboardLink: true,
          leakPatternMatches: 0,
          databaseSideEffects: false,
          counts: countsAfter,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const marker of [
    "전액 KODEX 200",
    "평가액 경로 비교",
    "KODEX 200 종가",
    "종료 시 대기 거래",
    "현금흐름 조정 추정수익률",
    "Modified Dietz",
    "정확한 일별 TWR 또는 총수익률을 의미하지 않습니다",
    "전액 VOO 비교",
    "소수점 수량을 허용해 잔여 현금을 만들지 않으며",
    "보유 수량을 넘는 매도는 축소·차입 없이 전체 시나리오를 차단합니다",
  ]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }
  assert.match(route.body, /data-return-status="ready"/);
  if (periodStatus === "selected") {
    assert.ok(route.body.includes("선택 구간"));
    assert.ok(route.body.includes("다시 계산했습니다"));
  }
  assert.ok(
    route.body.includes("과거 추가 투입 효과 실험"),
    "route is missing the historical contribution experiment",
  );
  assert.match(
    route.body,
    /data-contribution-experiment="ephemeral_client_only"/,
  );
  assert.match(
    route.body,
    /data-return-method="modified_dietz_daily_weighted_eod_v1"/,
  );
  assert.match(route.body, /overflow-x-auto/);
  assert.match(route.body, /viewBox="0 0 1000 340"/);
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
  const vooComparisonStatus = readStringAttribute(
    route.body,
    "data-voo-comparison-status",
  );
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
  const vooSnapshotFxProvenance = readIntegerAttribute(
    route.body,
    "data-voo-snapshot-fx-provenance-ready",
  );
  const vooRelevantFlows = readIntegerAttribute(
    route.body,
    "data-voo-relevant-flows",
  );
  const vooExecutionFx = readIntegerAttribute(
    route.body,
    "data-voo-execution-fx-ready",
  );
  const vooComparisonDates = readIntegerAttribute(
    route.body,
    "data-voo-comparison-dates",
  );
  const vooAppliedFlows = readIntegerAttribute(
    route.body,
    "data-voo-applied-flows",
  );
  const vooDelayedExecutions = readIntegerAttribute(
    route.body,
    "data-voo-delayed-executions",
  );
  const vooReturnStatus = readStringAttribute(
    route.body,
    "data-voo-return-status",
  );
  const vooReturnMethod = readStringAttribute(
    route.body,
    "data-voo-return-method",
  );
  const contributionScenarioCount = readIntegerAttribute(
    route.body,
    "data-contribution-scenarios",
  );

  assert.ok(comparisonDates >= 2, "comparison path needs at least two dates");
  assert.ok(appliedFlows >= 0, "applied flow count must be non-negative");
  assert.ok(delayedExecutions >= 0, "delayed count must be non-negative");
  assert.ok(scenarioCloseRows >= 2, "scenario needs at least two close rows");
  assert.equal(pendingAtEnd, 0, "route must not publish an unfinished path");
  assert.ok(
    contributionScenarioCount >= 1 && contributionScenarioCount <= 2,
    "contribution experiment must expose only complete fixed scenarios",
  );
  assert.ok(
    vooReadiness === "ready" || vooReadiness === "unavailable",
    "VOO readiness must be explicit",
  );
  assert.equal(vooServiceDates, comparisonDates);
  assert.ok(vooValuationPrices <= vooServiceDates);
  assert.ok(vooSnapshotFx <= vooServiceDates);
  assert.ok(vooSnapshotFxProvenance <= vooServiceDates);
  assert.ok(vooExecutionFx <= vooRelevantFlows);
  if (vooReadiness === "ready") {
    assert.equal(vooValuationPrices, vooServiceDates);
    assert.equal(vooSnapshotFx, vooServiceDates);
    assert.equal(vooSnapshotFxProvenance, vooServiceDates);
    assert.equal(vooExecutionFx, vooRelevantFlows);
    assert.equal(vooComparisonStatus, "ready");
    assert.equal(vooComparisonDates, comparisonDates);
    assert.equal(vooAppliedFlows, vooRelevantFlows);
    assert.ok(vooDelayedExecutions >= 0);
    assert.equal(vooReturnStatus, "ready");
    assert.equal(vooReturnMethod, "modified_dietz_daily_weighted_eod_v1");
    assert.equal(contributionScenarioCount, 2);
  }

  console.log(
    JSON.stringify(
      {
        smoke: "investment_lab_route",
        baseUrl: BASE_URL,
        routePath,
        periodStatus,
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
        vooComparisonStatus,
        vooServiceDates,
        vooValuationPrices,
        vooSnapshotFx,
        vooSnapshotFxProvenance,
        vooRelevantFlows,
        vooExecutionFx,
        vooComparisonDates,
        vooAppliedFlows,
        vooDelayedExecutions,
        vooReturnStatus,
        vooReturnMethod,
        contributionScenarioCount,
        xrayStatus,
        heldEtfs,
        matchedEtfs,
        missingEtfReferences,
        ambiguousEtfReferences,
        xrayAsOfDateCount,
        xrayComponentCount,
        xrayOverlapCount,
        xrayMixedAsOf,
        etfPortfolioWeight,
        observedEtfExposure,
        uncoveredEtfExposure,
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

function investmentLabRoutePath() {
  if (!START_SERVICE_DATE && !END_SERVICE_DATE) return "/investment-lab";
  const params = new URLSearchParams();
  if (START_SERVICE_DATE) params.set("start", START_SERVICE_DATE);
  if (END_SERVICE_DATE) params.set("end", END_SERVICE_DATE);
  return `/investment-lab?${params}`;
}

async function readCounts() {
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from event_ledger_entries) as event_ledger_entries,
      (select count(*)::int from daily_portfolio_snapshots) as portfolio_snapshots,
      (select count(*)::int from asset_price_snapshots) as price_snapshots,
      (select count(*)::int from etf_masters) as etf_masters,
      (select count(*)::int from etf_holdings) as etf_holdings
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
  const match = html.match(new RegExp(`${name}="([a-z0-9_]+)"`));
  assert.ok(match, `route is missing string attribute: ${name}`);
  return match[1];
}

function readNumberAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="(-?\\d+(?:\\.\\d+)?)"`));
  assert.ok(match, `route is missing numeric attribute: ${name}`);
  return Number(match[1]);
}

await main();
