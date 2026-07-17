import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const BASE_URL = readArgument("--base-url") ?? "http://127.0.0.1:3107";
const START_SERVICE_DATE = readArgument("--start");
const END_SERVICE_DATE = readArgument("--end");
const ACCOUNT = readArgument("--account") ?? "all";
const KODEX_WEIGHT = readArgument("--kodex-weight");
const BASKET_ANCHOR = readArgument("--basket-anchor");
const EXPECTED_PERIOD_STATUS =
  readArgument("--expect-period-status") ??
  (START_SERVICE_DATE || END_SERVICE_DATE ? "selected" : "full");
const EXPECTED_READ_MODEL_STATUS =
  readArgument("--expect-read-model-status") ??
  (START_SERVICE_DATE || END_SERVICE_DATE ? "ready" : "blocked");
const EXPECTED_SOURCE_AUTHORITY_STATUS =
  readArgument("--expect-source-authority-status") ??
  (START_SERVICE_DATE || END_SERVICE_DATE ? "eligible" : "blocked");
const EXPECTED_SOURCE_AUTHORITY_DECISION =
  readArgument("--expect-source-authority-decision") ??
  (EXPECTED_SOURCE_AUTHORITY_STATUS === "eligible"
    ? "current_writer_calculation_candidate"
    : "blocked");
const EXPECTED_FIXED_MIX_SELECTION_STATUS = fixedMixSelectionStatus();
const EXPECTED_FIXED_MIX_STATUS =
  readArgument("--expect-fixed-mix-status") ??
  (EXPECTED_READ_MODEL_STATUS === "ready" &&
    (EXPECTED_PERIOD_STATUS === "full" ||
      EXPECTED_PERIOD_STATUS === "selected") &&
    EXPECTED_FIXED_MIX_SELECTION_STATUS !== "invalid"
    ? "ready"
    : "unavailable");
const PASSWORD =
  process.env.VARDA_APP_PASSWORD?.trim() ||
  process.env.APP_ACCESS_PASSWORD?.trim();
const USERNAME = process.env.VARDA_APP_USER?.trim() || "varda";
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|assetId|ownerUserId|api[_-]?key|authorization|password|secret|token|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!PASSWORD) throw new Error("Dashboard access password is not configured");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
if (!["all", "brokerage", "isa", "irp"].includes(ACCOUNT)) {
  throw new Error(`Unsupported account scope: ${ACCOUNT}`);
}

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
  assert.equal(
    readStringAttribute(route.body, "data-account-scope"),
    ACCOUNT,
  );
  for (const marker of ["투자 랩", "과거 비교 구간", "구간 적용"]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }
  const periodStatus = readStringAttribute(route.body, "data-period-status");
  assert.equal(periodStatus, EXPECTED_PERIOD_STATUS);
  const readModelStatus = readStringAttribute(
    route.body,
    "data-read-model-status",
  );
  assert.equal(readModelStatus, EXPECTED_READ_MODEL_STATUS);
  const sourceAuthorityStatus = readStringAttribute(
    route.body,
    "data-source-authority-status",
  );
  const sourceAuthorityDecision = readStringAttribute(
    route.body,
    "data-source-authority-decision",
  );
  const sourceTransitionCount = readIntegerAttribute(
    route.body,
    "data-source-transition-count",
  );
  assert.equal(sourceAuthorityStatus, EXPECTED_SOURCE_AUTHORITY_STATUS);
  assert.ok(sourceTransitionCount >= 0);
  assert.equal(sourceAuthorityDecision, EXPECTED_SOURCE_AUTHORITY_DECISION);
  const cashComparisonStatus = readStringAttribute(
    route.body,
    "data-cash-comparison-status",
  );
  assert.match(route.body, /data-section="investment-lab-fixed-mix"/);
  assert.match(route.body, /data-section="investment-lab-anchor-basket"/);
  const anchorBasketStatus = readStringAttribute(
    route.body,
    "data-anchor-basket-status",
  );
  const anchorBasketCandidateDates = readIntegerAttribute(
    route.body,
    "data-anchor-basket-candidate-dates",
  );
  const anchorBasketSourceRows = readIntegerAttribute(
    route.body,
    "data-anchor-basket-source-rows",
  );
  const anchorBasketEconomicInstruments = readIntegerAttribute(
    route.body,
    "data-anchor-basket-economic-instruments",
  );
  const anchorBasketUnresolvedRows = readIntegerAttribute(
    route.body,
    "data-anchor-basket-unresolved-rows",
  );
  const anchorBasketComparisonDates = readIntegerAttribute(
    route.body,
    "data-anchor-basket-comparison-dates",
  );
  assert.ok(
    anchorBasketStatus === "ready" || anchorBasketStatus === "unavailable",
  );
  assert.ok(anchorBasketCandidateDates >= 0);
  assert.ok(anchorBasketSourceRows >= anchorBasketEconomicInstruments);
  if (anchorBasketStatus === "ready") {
    assert.equal(anchorBasketUnresolvedRows, 0);
    assert.ok(anchorBasketComparisonDates >= 2);
  } else {
    assert.equal(anchorBasketComparisonDates, 0);
  }
  let anchorSpecialHoldingRows = 0;
  let anchorSpecialHoldingResolved = 0;
  let anchorSpecialHoldingUnavailable = 0;
  let anchorSpecialHoldingEligible = 0;
  let anchorSpecialHoldingIntentionallyExcluded = 0;
  let anchorSpecialHoldingSeparateModel = 0;
  let anchorSpecialHoldingUnsupported = 0;
  if (
    route.body.includes(
      'data-section="investment-lab-anchor-special-holding-evidence"',
    )
  ) {
    anchorSpecialHoldingRows = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-rows",
    );
    anchorSpecialHoldingResolved = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-resolved",
    );
    anchorSpecialHoldingUnavailable = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-unavailable",
    );
    anchorSpecialHoldingEligible = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-eligible",
    );
    anchorSpecialHoldingIntentionallyExcluded = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-intentionally-excluded",
    );
    anchorSpecialHoldingSeparateModel = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-separate-model",
    );
    anchorSpecialHoldingUnsupported = readIntegerAttribute(
      route.body,
      "data-anchor-special-holding-unsupported",
    );
    assert.equal(
      anchorSpecialHoldingEligible +
        anchorSpecialHoldingIntentionallyExcluded +
        anchorSpecialHoldingSeparateModel +
        anchorSpecialHoldingUnsupported,
      anchorSpecialHoldingRows,
    );
    assert.ok(anchorSpecialHoldingEligible <= anchorSpecialHoldingResolved);
    assert.ok(
      anchorSpecialHoldingUnavailable <=
        anchorSpecialHoldingSeparateModel + anchorSpecialHoldingUnsupported,
    );
    if (anchorSpecialHoldingUnavailable > 0) {
      assert.match(route.body, /data-special-holding-status="unavailable"/);
    }
    if (anchorSpecialHoldingEligible > 0) {
      assert.match(route.body, /data-special-holding-status="resolved"/);
      assert.ok(route.body.includes("Base44 이관 포지션 ticker 합의"));
    }
    if (anchorSpecialHoldingIntentionallyExcluded > 0) {
      assert.match(route.body, /data-special-holding-status="not_required"/);
    }
  }
  const matrixExpected =
    readModelStatus === "ready" &&
    (periodStatus === "full" || periodStatus === "selected");
  let scenarioMatrixStatus = "not_rendered";
  let scenarioMatrixRows = 0;
  let scenarioMatrixReadyRows = 0;
  let scenarioMatrixUnavailableRows = 0;
  if (matrixExpected) {
    assert.match(
      route.body,
      /data-section="investment-lab-scenario-matrix"/,
    );
    scenarioMatrixStatus = readStringAttribute(
      route.body,
      "data-scenario-matrix-status",
    );
    scenarioMatrixRows = readIntegerAttribute(
      route.body,
      "data-scenario-matrix-rows",
    );
    scenarioMatrixReadyRows = readIntegerAttribute(
      route.body,
      "data-scenario-matrix-ready-rows",
    );
    scenarioMatrixUnavailableRows = readIntegerAttribute(
      route.body,
      "data-scenario-matrix-unavailable-rows",
    );
    assert.equal(scenarioMatrixStatus, "ready");
    assert.equal(scenarioMatrixRows, 6);
    assert.equal(
      scenarioMatrixReadyRows + scenarioMatrixUnavailableRows,
      scenarioMatrixRows,
    );
    for (const scenarioId of [
      "actual",
      "kodex200",
      "voo",
      "fixed_mix",
      "zero_return",
      "anchor_basket",
    ]) {
      assert.match(route.body, new RegExp(`data-scenario-row="${scenarioId}"`));
    }
    for (const marker of [
      "시나리오 한눈에 비교",
      "순위나 추천이 아니라",
      "KODEX 200 adjusted close",
      "VOO raw close",
      "초기 동일비중·이후 흐름 균등배분",
    ]) {
      assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
    }
  } else {
    assert.doesNotMatch(
      route.body,
      /data-section="investment-lab-scenario-matrix"/,
    );
  }
  const fixedMixStatus = readStringAttribute(
    route.body,
    "data-fixed-mix-status",
  );
  const fixedMixSelectionStatus = readStringAttribute(
    route.body,
    "data-fixed-mix-selection-status",
  );
  const fixedMixKodexWeightBps = readIntegerAttribute(
    route.body,
    "data-fixed-mix-kodex-weight-bps",
  );
  const fixedMixVooWeightBps = readIntegerAttribute(
    route.body,
    "data-fixed-mix-voo-weight-bps",
  );
  const fixedMixComparisonDates = readIntegerAttribute(
    route.body,
    "data-fixed-mix-comparison-dates",
  );
  const fixedMixFlowSources = readIntegerAttribute(
    route.body,
    "data-fixed-mix-flow-sources",
  );
  const fixedMixScenarioFlowLegs = readIntegerAttribute(
    route.body,
    "data-fixed-mix-scenario-flow-legs",
  );
  const fixedMixSplitExecutionDateRows = readIntegerAttribute(
    route.body,
    "data-fixed-mix-split-execution-date-rows",
  );
  const fixedMixReturnStatus = readStringAttribute(
    route.body,
    "data-fixed-mix-return-status",
  );
  const fixedMixContributionStatus = readStringAttribute(
    route.body,
    "data-contribution-fixed-mix-status",
  );
  const fixedMixContributionKodexWeightBps = readIntegerAttribute(
    route.body,
    "data-contribution-fixed-mix-kodex-weight-bps",
  );
  const fixedMixContributionVooWeightBps = readIntegerAttribute(
    route.body,
    "data-contribution-fixed-mix-voo-weight-bps",
  );
  assert.equal(fixedMixStatus, EXPECTED_FIXED_MIX_STATUS);
  assert.equal(
    fixedMixSelectionStatus,
    EXPECTED_FIXED_MIX_SELECTION_STATUS,
  );
  if (fixedMixStatus === "ready") {
    assert.equal(fixedMixReturnStatus, "ready");
    assert.equal(fixedMixKodexWeightBps + fixedMixVooWeightBps, 10_000);
    assert.ok(fixedMixKodexWeightBps > 0 && fixedMixVooWeightBps > 0);
    assert.ok(fixedMixComparisonDates >= 2);
    assert.equal(fixedMixScenarioFlowLegs, fixedMixFlowSources * 2);
    assert.ok(fixedMixSplitExecutionDateRows >= 0);
    assert.equal(fixedMixContributionStatus, "ready");
    assert.equal(
      fixedMixContributionKodexWeightBps,
      fixedMixKodexWeightBps,
    );
    assert.equal(fixedMixContributionVooWeightBps, fixedMixVooWeightBps);
    for (const marker of [
      "KODEX 200·VOO 고정 배분 실험",
      "중간 재리밸런싱은 하지 않습니다",
      "과거 연구 비교",
      "VOO 배당은 반영하지 않습니다",
      "정확한 일별 TWR 또는 총수익률을",
    ]) {
      assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
    }
  } else {
    assert.equal(fixedMixReturnStatus, "unavailable");
    assert.equal(fixedMixComparisonDates, 0);
    assert.equal(fixedMixContributionStatus, "unavailable");
    assert.equal(fixedMixContributionKodexWeightBps, 0);
    assert.equal(fixedMixContributionVooWeightBps, 0);
  }
  assert.match(
    route.body,
    /data-section="investment-lab-rolling-comparison"/,
  );
  const rollingStatus = readStringAttribute(route.body, "data-rolling-status");
  const rollingCandidateWindows = readIntegerAttribute(
    route.body,
    "data-rolling-candidate-windows",
  );
  const rollingCompleteWindows = readIntegerAttribute(
    route.body,
    "data-rolling-complete-windows",
  );
  const rollingExcludedWindows = readIntegerAttribute(
    route.body,
    "data-rolling-excluded-windows",
  );
  const rollingObservationCount = readIntegerAttribute(
    route.body,
    "data-rolling-observation-count",
  );
  assert.ok(rollingStatus === "ready" || rollingStatus === "unavailable");
  assert.equal(rollingObservationCount, 10);
  assert.equal(
    rollingCompleteWindows + rollingExcludedWindows,
    rollingCandidateWindows,
  );
  if (rollingStatus === "ready") {
    assert.ok(rollingCompleteWindows >= 2);
    for (const marker of [
      "과거 최고·최저 rolling 구간",
      "최저 구간",
      "최고 구간",
    ]) {
      assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
    }
  }
  assert.match(route.body, /data-section="investment-lab-etf-xray"/);
  const xrayStatus = readStringAttribute(route.body, "data-xray-status");
  const basePortfolioCoverage = readStringAttribute(
    route.body,
    "data-base-portfolio-coverage",
  );
  const exposureScope = readStringAttribute(route.body, "data-exposure-scope");
  const valuedHoldings = readIntegerAttribute(route.body, "data-valued-holdings");
  const excludedHoldings = readIntegerAttribute(
    route.body,
    "data-excluded-holdings",
  );
  const excludedEtfHoldings = readIntegerAttribute(
    route.body,
    "data-excluded-etf-holdings",
  );
  const valuedEtfs = readIntegerAttribute(route.body, "data-valued-etfs");
  const matchedValuedEtfs = readIntegerAttribute(
    route.body,
    "data-matched-valued-etfs",
  );
  const missingEtfReferences = readIntegerAttribute(
    route.body,
    "data-missing-valued-etf-references",
  );
  const ambiguousEtfReferences = readIntegerAttribute(
    route.body,
    "data-ambiguous-valued-etf-references",
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
    "data-valued-etf-weight",
  );
  const observedEtfExposure = readNumberAttribute(
    route.body,
    "data-observed-valued-subset-exposure",
  );
  const uncoveredEtfExposure = readNumberAttribute(
    route.body,
    "data-uncovered-valued-subset-exposure",
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
  assert.ok(
    basePortfolioCoverage === "complete" || basePortfolioCoverage === "partial",
  );
  assert.equal(
    exposureScope,
    basePortfolioCoverage === "complete" ? "whole_portfolio" : "valued_subset",
  );
  assert.ok(valuedHoldings >= valuedEtfs);
  assert.ok(excludedHoldings >= excludedEtfHoldings);
  assert.ok(valuedEtfs > 0, "ETF X-ray needs at least one valued ETF");
  assert.equal(
    matchedValuedEtfs + missingEtfReferences + ambiguousEtfReferences,
    valuedEtfs,
    "every valued ETF must have an explicit reference mapping state",
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
  assert.match(route.body, /data-section="investment-lab-etf-shock"/);
  const shockStatus = readStringAttribute(route.body, "data-shock-status");
  const shockPolicy = readStringAttribute(route.body, "data-shock-policy");
  const shockPersistence = readStringAttribute(
    route.body,
    "data-shock-persistence",
  );
  let shockSelectedSymbol = null;
  let shockThroughExposure = null;
  let shockDirectExposure = null;
  let shockCoveredExposure = null;
  let shockEstimatedChangeKrw = null;
  assert.equal(shockPolicy, "static_single_name_linear_shock_v1");
  assert.equal(shockPersistence, "none_client_memory_only");
  if (shockStatus === "ready") {
    shockSelectedSymbol = readNonEmptyAttribute(
      route.body,
      "data-shock-selected-symbol",
    );
    shockThroughExposure = readNumberAttribute(
      route.body,
      "data-shock-through-etf-exposure",
    );
    shockDirectExposure = readNumberAttribute(
      route.body,
      "data-shock-direct-exposure",
    );
    shockCoveredExposure = readNumberAttribute(
      route.body,
      "data-shock-covered-exposure",
    );
    shockEstimatedChangeKrw = readNumberAttribute(
      route.body,
      "data-shock-estimated-change-krw",
    );
    assert.ok(shockSelectedSymbol.length > 0);
    assert.ok(shockThroughExposure > 0);
    assert.ok(shockDirectExposure >= 0);
    assert.ok(
      Math.abs(
        shockCoveredExposure - shockThroughExposure - shockDirectExposure,
      ) < 0.00001,
    );
    assert.ok(shockEstimatedChangeKrw < 0, "default -10% shock must be negative");
  } else {
    assert.equal(shockStatus, "unavailable");
    assert.match(route.body, /data-shock-selected-symbol=""/);
    assert.match(route.body, /data-shock-through-etf-exposure=""/);
  }
  assert.doesNotMatch(route.body, LEAK_PATTERN);
  assert.doesNotMatch(
    route.body,
    /event_ledger_entries|daily_portfolio_snapshots|asset_price_snapshots/i,
  );
  assert.match(
    route.body,
    /data-section="investment-lab-small-adjustment"/,
  );
  const adjustmentAccountCount = readIntegerAttribute(
    route.body,
    "data-adjustment-account-count",
  );
  const adjustmentReadyAccounts = readIntegerAttribute(
    route.body,
    "data-adjustment-ready-accounts",
  );
  const adjustmentPolicy = readStringAttribute(
    route.body,
    "data-adjustment-policy",
  );
  const adjustmentPersistence = readStringAttribute(
    route.body,
    "data-persistence",
  );
  const expectedAdjustmentAccountCount = ACCOUNT === "all" ? 3 : 1;
  assert.equal(adjustmentAccountCount, expectedAdjustmentAccountCount);
  assert.ok(
    adjustmentReadyAccounts >= 0 &&
      adjustmentReadyAccounts <= expectedAdjustmentAccountCount,
  );
  assert.equal(
    adjustmentPolicy,
    "same_account_cash_neutral_direct_holdings_v1",
  );
  assert.equal(adjustmentPersistence, "none_client_memory_only");
  for (const marker of [
    "작은 조정 영향 실험",
    "외부 현금, 목표비중, 추천, 주문은 반영하지 않습니다",
  ]) {
    assert.ok(route.body.includes(marker), `route is missing marker: ${marker}`);
  }

  const countsAfter = await readCounts();
  assert.deepEqual(countsAfter, countsBefore, "route render changed DB row counts");
  if (
    readModelStatus === "blocked" ||
    periodStatus === "invalid" ||
    periodStatus === "unavailable"
  ) {
    assert.match(route.body, /data-return-status="unavailable"/);
    assert.equal(cashComparisonStatus, "unavailable");
    if (periodStatus === "invalid" || periodStatus === "unavailable") {
      assert.match(route.body, /data-period-reason="[a-z_]+"/);
    }
    assert.doesNotMatch(route.body, /평가액 경로 비교/);
    assert.doesNotMatch(
      route.body,
      /data-section="investment-lab-cash-comparison"/,
    );
    console.log(
      JSON.stringify(
        {
          smoke: "investment_lab_route",
          baseUrl: BASE_URL,
          routePath,
          periodStatus,
          readModelStatus,
          sourceAuthorityStatus,
          sourceAuthorityDecision,
          sourceTransitionCount,
          cashComparisonStatus,
          fixedMixStatus,
          fixedMixSelectionStatus,
          fixedMixKodexWeightBps,
          fixedMixVooWeightBps,
          fixedMixComparisonDates,
          fixedMixFlowSources,
          fixedMixScenarioFlowLegs,
          fixedMixSplitExecutionDateRows,
          fixedMixReturnStatus,
          anchorBasketStatus,
          anchorBasketCandidateDates,
          anchorBasketSourceRows,
          anchorBasketEconomicInstruments,
          anchorBasketUnresolvedRows,
          anchorBasketComparisonDates,
          anchorSpecialHoldingRows,
          anchorSpecialHoldingResolved,
          anchorSpecialHoldingUnavailable,
          anchorSpecialHoldingEligible,
          anchorSpecialHoldingSeparateModel,
          anchorSpecialHoldingUnsupported,
          scenarioMatrixStatus,
          scenarioMatrixRows,
          scenarioMatrixReadyRows,
          scenarioMatrixUnavailableRows,
          rollingStatus,
          rollingCandidateWindows,
          rollingCompleteWindows,
          rollingExcludedWindows,
          rollingObservationCount,
          xrayStatus,
          basePortfolioCoverage,
          exposureScope,
          valuedHoldings,
          excludedHoldings,
          excludedEtfHoldings,
          valuedEtfs,
          matchedValuedEtfs,
          missingEtfReferences,
          ambiguousEtfReferences,
          xrayAsOfDateCount,
          xrayComponentCount,
          xrayOverlapCount,
          xrayMixedAsOf,
          etfPortfolioWeight,
          observedEtfExposure,
          uncoveredEtfExposure,
          adjustmentAccountCount,
          adjustmentReadyAccounts,
          adjustmentPolicy,
          adjustmentPersistence,
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
    "전액 현금 기준선",
    "현재 현금 잔액이나 추가투입 분배 계산이 아닙니다",
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
  assert.match(
    route.body,
    /data-section="investment-lab-cash-comparison"/,
  );
  const cashPolicy = readStringAttribute(route.body, "data-cash-policy");
  const cashComparisonDates = readIntegerAttribute(
    route.body,
    "data-cash-comparison-dates",
  );
  const cashAppliedFlows = readIntegerAttribute(
    route.body,
    "data-cash-applied-flows",
  );
  const cashReturnStatus = readStringAttribute(
    route.body,
    "data-cash-return-status",
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
  assert.equal(cashComparisonStatus, "ready");
  assert.equal(cashPolicy, "zero_return_same_flow_cash_v1");
  assert.equal(cashComparisonDates, comparisonDates);
  assert.equal(cashAppliedFlows, appliedFlows);
  assert.equal(cashReturnStatus, "ready");
  const expectedScenarioMatrixReadyRows =
    2 +
    (vooComparisonStatus === "ready" ? 1 : 0) +
    (fixedMixStatus === "ready" ? 1 : 0) +
    (cashComparisonStatus === "ready" ? 1 : 0) +
    (anchorBasketStatus === "ready" ? 1 : 0);
  assert.equal(scenarioMatrixReadyRows, expectedScenarioMatrixReadyRows);
  assert.equal(
    scenarioMatrixUnavailableRows,
    scenarioMatrixRows - expectedScenarioMatrixReadyRows,
  );
  assert.ok(appliedFlows >= 0, "applied flow count must be non-negative");
  assert.ok(delayedExecutions >= 0, "delayed count must be non-negative");
  assert.ok(scenarioCloseRows >= 2, "scenario needs at least two close rows");
  assert.equal(pendingAtEnd, 0, "route must not publish an unfinished path");
  assert.ok(
    contributionScenarioCount >= 1 && contributionScenarioCount <= 3,
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
    assert.equal(
      contributionScenarioCount,
      fixedMixContributionStatus === "ready" ? 3 : 2,
    );
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
        cashComparisonStatus,
        cashPolicy,
        cashComparisonDates,
        cashAppliedFlows,
        cashReturnStatus,
        appliedFlows,
        delayedExecutions,
        scenarioCloseRows,
        pendingAtEnd,
        returnStatus: "ready",
        returnMethod: "modified_dietz_daily_weighted_eod_v1",
        fixedMixStatus,
        fixedMixSelectionStatus,
        fixedMixKodexWeightBps,
        fixedMixVooWeightBps,
        fixedMixComparisonDates,
        fixedMixFlowSources,
        fixedMixScenarioFlowLegs,
        fixedMixSplitExecutionDateRows,
        fixedMixReturnStatus,
        anchorBasketStatus,
        anchorBasketCandidateDates,
        anchorBasketSourceRows,
        anchorBasketEconomicInstruments,
        anchorBasketUnresolvedRows,
        anchorBasketComparisonDates,
        anchorSpecialHoldingRows,
        anchorSpecialHoldingResolved,
        anchorSpecialHoldingUnavailable,
        anchorSpecialHoldingEligible,
        anchorSpecialHoldingSeparateModel,
        anchorSpecialHoldingUnsupported,
        scenarioMatrixStatus,
        scenarioMatrixRows,
        scenarioMatrixReadyRows,
        scenarioMatrixUnavailableRows,
        fixedMixContributionStatus,
        fixedMixContributionKodexWeightBps,
        fixedMixContributionVooWeightBps,
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
        rollingStatus,
        rollingCandidateWindows,
        rollingCompleteWindows,
        rollingExcludedWindows,
        rollingObservationCount,
        xrayStatus,
        basePortfolioCoverage,
        exposureScope,
        valuedHoldings,
        excludedHoldings,
        excludedEtfHoldings,
        valuedEtfs,
        matchedValuedEtfs,
        missingEtfReferences,
        ambiguousEtfReferences,
        xrayAsOfDateCount,
        xrayComponentCount,
        xrayOverlapCount,
        xrayMixedAsOf,
        etfPortfolioWeight,
        observedEtfExposure,
        uncoveredEtfExposure,
        shockStatus,
        shockPolicy,
        shockPersistence,
        shockSelectedSymbol,
        shockThroughExposure,
        shockDirectExposure,
        shockCoveredExposure,
        shockEstimatedChangeKrw,
        adjustmentAccountCount,
        adjustmentReadyAccounts,
        adjustmentPolicy,
        adjustmentPersistence,
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
  const params = new URLSearchParams();
  if (ACCOUNT !== "all") params.set("account", ACCOUNT);
  if (START_SERVICE_DATE) params.set("start", START_SERVICE_DATE);
  if (END_SERVICE_DATE) params.set("end", END_SERVICE_DATE);
  if (KODEX_WEIGHT !== null) params.set("kodexWeight", KODEX_WEIGHT);
  if (BASKET_ANCHOR !== null) params.set("basketAnchor", BASKET_ANCHOR);
  const query = params.toString();
  return query ? `/investment-lab?${query}` : "/investment-lab";
}

function fixedMixSelectionStatus() {
  if (KODEX_WEIGHT === null) return "default";
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(KODEX_WEIGHT)) return "invalid";
  const weight = Number(KODEX_WEIGHT);
  return weight >= 1 && weight <= 99 ? "selected" : "invalid";
}

async function readCounts() {
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from event_ledger_entries) as event_ledger_entries,
      (select count(*)::int from daily_portfolio_snapshots) as portfolio_snapshots,
      (select count(*)::int from daily_position_snapshots) as position_snapshots,
      (select count(*)::int from asset_price_snapshots) as price_snapshots,
      (select count(*)::int from fx_rates) as fx_rates,
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

function readNonEmptyAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="([^"]+)"`));
  assert.ok(match, `route is missing non-empty attribute: ${name}`);
  return match[1];
}

function readNumberAttribute(html, name) {
  const match = html.match(new RegExp(`${name}="(-?\\d+(?:\\.\\d+)?)"`));
  assert.ok(match, `route is missing numeric attribute: ${name}`);
  return Number(match[1]);
}

await main();
