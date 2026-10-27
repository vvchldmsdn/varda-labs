"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/tests/cairn-close-gaps/coverage.test.ts
var import_strict = __toESM(require("node:assert/strict"));

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/snapshots/market-calendar.ts
function resolveSnapshotCycle(now2 = /* @__PURE__ */ new Date()) {
  const kst = new Date(now2.getTime() + 9 * 60 * 60 * 1e3);
  const date = kst.toISOString().slice(0, 10);
  const hour = kst.getUTCHours();
  return {
    snapshotDate: hour >= 7 ? date : shiftDate(date, -1)
  };
}
function closeCalendarReferenceDateForAsset(asset, snapshotDate) {
  const candidate = shiftDate(snapshotDate, -1);
  if (isUsdListedAsset(asset)) return previousUsTradingDayOnOrBefore(candidate);
  if (asset.market === "korea") return previousKoreaTradingDayOnOrBefore(candidate);
  return previousWeekdayOnOrBefore(candidate);
}
function isUsdListedAsset(asset) {
  return asset.market === "us";
}
function previousWeekdayOnOrBefore(date) {
  let current = date;
  while (isWeekend(current)) current = shiftDate(current, -1);
  return current;
}
function previousKoreaTradingDayOnOrBefore(date) {
  let current = date;
  while (!isKoreaTradingDay(current)) current = shiftDate(current, -1);
  return current;
}
function previousUsTradingDayOnOrBefore(date) {
  let current = date;
  while (!isUsTradingDay(current)) current = shiftDate(current, -1);
  return current;
}
function isKoreaTradingDay(date) {
  return Boolean(date) && !isWeekend(date) && !koreaMarketHolidays(Number(date.slice(0, 4))).has(date);
}
function isUsTradingDay(date) {
  return Boolean(date) && !isWeekend(date) && !usMarketHolidays(Number(date.slice(0, 4))).has(date);
}
function koreaMarketHolidays(year) {
  const holidays = /* @__PURE__ */ new Set([
    ...koreaFixedHolidayDates(year, 1, 1),
    ...koreaFixedHolidayDates(year, 3, 1, true),
    `${year}-05-01`,
    ...koreaFixedHolidayDates(year, 5, 5, true),
    `${year}-06-06`,
    ...year >= 2026 ? koreaFixedHolidayDates(year, 7, 17, true) : [],
    ...koreaFixedHolidayDates(year, 8, 15, true),
    ...koreaFixedHolidayDates(year, 10, 3, true),
    ...koreaFixedHolidayDates(year, 10, 9, true),
    ...koreaFixedHolidayDates(year, 12, 25, true),
    koreaYearEndMarketHoliday(year),
    ...KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR[year] ?? []
  ]);
  return holidays;
}
function koreaFixedHolidayDates(year, month, day, hasWeekendSubstitute = false) {
  const actual = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!hasWeekendSubstitute || !isWeekend(actual)) return [actual];
  let substitute = shiftDate(actual, 1);
  while (isWeekend(substitute)) substitute = shiftDate(substitute, 1);
  return [actual, substitute];
}
var KOREA_LUNAR_AND_ELECTION_MARKET_HOLIDAYS_BY_YEAR = {
  2024: ["2024-09-16", "2024-09-17", "2024-09-18"],
  2025: [
    "2025-01-28",
    "2025-01-29",
    "2025-01-30",
    "2025-05-05",
    "2025-05-06",
    "2025-10-06",
    "2025-10-07",
    "2025-10-08"
  ],
  2026: [
    "2026-02-16",
    "2026-02-17",
    "2026-02-18",
    "2026-05-25",
    "2026-06-03",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26"
  ]
};
function koreaYearEndMarketHoliday(year) {
  return previousWeekdayOnOrBefore(`${year}-12-31`);
}
function usMarketHolidays(year) {
  return /* @__PURE__ */ new Set([
    observedFixedHoliday(year, 1, 1),
    nthWeekdayOfMonth(year, 1, 1, 3),
    nthWeekdayOfMonth(year, 2, 1, 3),
    shiftDate(easterSunday(year), -2),
    lastWeekdayOfMonth(year, 5, 1),
    observedFixedHoliday(year, 6, 19),
    observedFixedHoliday(year, 7, 4),
    nthWeekdayOfMonth(year, 9, 1, 1),
    nthWeekdayOfMonth(year, 11, 4, 4),
    observedFixedHoliday(year, 12, 25)
  ]);
}
function observedFixedHoliday(year, month, day) {
  const actual = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const weekday = weekdayUtc(actual);
  if (weekday === 6) return shiftDate(actual, -1);
  if (weekday === 0) return shiftDate(actual, 1);
  return actual;
}
function nthWeekdayOfMonth(year, month, weekday, nth) {
  let current = `${year}-${String(month).padStart(2, "0")}-01`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, 1);
  return shiftDate(current, (nth - 1) * 7);
}
function lastWeekdayOfMonth(year, month, weekday) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let current = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  while (weekdayUtc(current) !== weekday) current = shiftDate(current, -1);
  return current;
}
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function shiftDate(date, deltaDays) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}
function weekdayUtc(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
function isWeekend(date) {
  const weekday = weekdayUtc(date);
  return weekday === 0 || weekday === 6;
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/market-data/close-gap-policy.ts
var CLOSE_GAP_LOOKBACK_DAYS = 35;
var closeIdentity = (p, date) => [p.market, p.currency, p.ticker, date].join("|");
function expectedCloseDates(target, now2) {
  const cycle = resolveSnapshotCycle(now2), dates = /* @__PURE__ */ new Set();
  for (let i = 0; i < CLOSE_GAP_LOOKBACK_DAYS; i++) {
    const date = new Date(Date.parse(cycle.snapshotDate + "T00:00:00Z") - i * 864e5).toISOString().slice(0, 10);
    dates.add(closeCalendarReferenceDateForAsset(target, date));
  }
  return [...dates].sort();
}
function planCloseGapJobs(targets, present2, now2) {
  const jobs2 = /* @__PURE__ */ new Map();
  for (const target of targets) {
    if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(target.ticker) || !(target.market === "us" && target.currency === "USD" || target.market === "korea" && target.currency === "KRW")) continue;
    const dates = expectedCloseDates(target, now2).filter((date) => (!target.firstCloseDate || date >= target.firstCloseDate) && !present2.has(closeIdentity(target, date)));
    if (!dates.length) continue;
    const startDate = dates[0], endDate = dates.at(-1);
    const key = ["kis:history:raw_close_v1", target.market, target.currency, target.ticker, startDate, endDate].join(":");
    jobs2.set(key, { ...target, key, kind: "history", startDate, endDate });
  }
  return [...jobs2.values()];
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/portfolio-risk-calendar.ts
var ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var DAY_MS = 864e5;
function riskCalendarDayDistance(earlier, later) {
  const earlierMs = parseDateOnly(earlier).getTime();
  const laterMs = parseDateOnly(later).getTime();
  return Math.round((laterMs - earlierMs) / DAY_MS);
}
function isRiskDate(value) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  try {
    return parseDateOnly(value).toISOString().slice(0, 10) === value;
  } catch {
    return false;
  }
}
function parseDateOnly(date) {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new TypeError(`Invalid ISO date: ${date}`);
  }
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.toISOString().slice(0, 10) !== date) {
    throw new TypeError(`Invalid ISO date: ${date}`);
  }
  return value;
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/investment-lab-path-risk.ts
var INVESTMENT_LAB_PATH_RISK_POLICY = Object.freeze({
  version: "cashflow_adjusted_linked_path_risk_v2",
  returnSource: "modified_dietz_period_returns",
  maximumDrawdown: "observed_service_date_linked_growth_peak_to_trough",
  annualizedVolatility: "consecutive_daily_sample_standard_deviation_sqrt_365",
  volatilityObservationAxis: "consecutive_calendar_day_service_periods",
  requiredCalendarDaysPerVolatilityPeriod: 1,
  annualizationFactor: 365,
  minimumAnnualizedVolatilityPeriods: 20,
  partialResultHandling: "preserve_available_metric"
});
function calculateInvestmentLabPathRisk(periods) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return unavailable(["insufficient_periods"]);
  }
  const returns = [];
  let hasIrregularVolatilityPeriod = false;
  let linkedGrowth = 1;
  let peakGrowth = 1;
  let maximumDrawdown = 0;
  for (const period of periods) {
    const periodReturn = period?.periodReturn;
    const growthFactor = 1 + periodReturn;
    if (!Number.isFinite(periodReturn) || !Number.isFinite(growthFactor) || growthFactor < -1e-12) {
      return unavailable(["invalid_period_return"]);
    }
    returns.push(cleanZero(periodReturn));
    if (period.calendarDays !== INVESTMENT_LAB_PATH_RISK_POLICY.requiredCalendarDaysPerVolatilityPeriod) {
      hasIrregularVolatilityPeriod = true;
    }
    linkedGrowth *= Math.max(0, growthFactor);
    if (!Number.isFinite(linkedGrowth)) {
      return unavailable(["non_finite_linked_growth"]);
    }
    peakGrowth = Math.max(peakGrowth, linkedGrowth);
    maximumDrawdown = Math.max(
      maximumDrawdown,
      1 - linkedGrowth / peakGrowth
    );
  }
  const volatilityBlockers = [];
  if (returns.length < INVESTMENT_LAB_PATH_RISK_POLICY.minimumAnnualizedVolatilityPeriods) {
    volatilityBlockers.push("insufficient_volatility_periods");
  }
  if (hasIrregularVolatilityPeriod) {
    volatilityBlockers.push("irregular_volatility_axis");
  }
  if (volatilityBlockers.length > 0) {
    return partial(maximumDrawdown, returns.length, volatilityBlockers);
  }
  const mean = compensatedSum(returns) / returns.length;
  const squaredDeviations = returns.map((value) => (value - mean) ** 2);
  const sampleVariance = compensatedSum(squaredDeviations) / (returns.length - 1);
  const annualizedVolatility = Math.sqrt(
    Math.max(0, sampleVariance) * INVESTMENT_LAB_PATH_RISK_POLICY.annualizationFactor
  );
  if (!Number.isFinite(annualizedVolatility)) {
    return partial(maximumDrawdown, returns.length, [
      "non_finite_volatility"
    ]);
  }
  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: cleanZero(maximumDrawdown),
    annualizedVolatility: cleanZero(annualizedVolatility),
    periodCount: returns.length,
    blockers: []
  });
}
function unavailableInvestmentLabPathRisk() {
  return unavailable(["insufficient_periods"]);
}
function partial(maximumDrawdown, periodCount, blockers) {
  return Object.freeze({
    status: "partial",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: cleanZero(maximumDrawdown),
    annualizedVolatility: null,
    periodCount,
    blockers: Object.freeze([...new Set(blockers)])
  });
}
function unavailable(blockers) {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: null,
    annualizedVolatility: null,
    periodCount: 0,
    blockers: Object.freeze([...blockers])
  });
}
function compensatedSum(values) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return total + compensation;
}
function cleanZero(value) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/src/lib/investment-lab-modified-dietz.ts
var INVESTMENT_LAB_MODIFIED_DIETZ_POLICY = Object.freeze({
  version: "modified_dietz_daily_weighted_eod_v1",
  method: "modified_dietz",
  classification: "estimated_time_weighted_return",
  valuationAxis: "observed_service_dates",
  externalFlowTiming: "end_of_day_date_only",
  flowWeight: "calendar_day_fraction_remaining",
  linking: "geometric",
  cashBalance: "outside_invested_position_boundary",
  incomeTreatment: "not_separately_observed",
  feeTaxTreatment: "not_separately_observed",
  complianceClaim: "none"
});
var OBSERVED_TIMESTAMP_MODIFIED_DIETZ_POLICY = Object.freeze({
  ...INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
  version: "observed_timestamp_modified_dietz_v1",
  classification: "cash_flow_weighted_return_estimate",
  valuationAxis: "observed_timestamps",
  externalFlowTiming: "observed_timestamps",
  flowWeight: "elapsed_milliseconds_fraction_remaining",
  cashBalance: "included_in_portfolio_valuation",
  incomeTreatment: "included_in_valuation_not_external_flow",
  feeTaxTreatment: "included_in_valuation_not_external_flow"
});
function calculateInvestmentLabModifiedDietz(input) {
  const result2 = calculateUnitModifiedDietz({
    valuations: input.valuations.map((row) => ({ serviceDate: row.serviceDate, value: row.valueKrw })),
    flows: input.flows.map((row) => ({ effectiveServiceDate: row.effectiveServiceDate, sequence: row.sequence, direction: row.direction, amount: row.amountKrw }))
  });
  if (result2.status === "blocked") return Object.freeze({ ...result2, policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY });
  return Object.freeze({
    ...result2,
    policy: INVESTMENT_LAB_MODIFIED_DIETZ_POLICY,
    periods: Object.freeze(result2.periods.map((period) => Object.freeze({
      startServiceDate: period.startServiceDate,
      endServiceDate: period.endServiceDate,
      calendarDays: period.calendarDays,
      beginningValueKrw: period.beginningValue,
      endingValueKrw: period.endingValue,
      netExternalFlowKrw: period.netExternalFlow,
      weightedExternalFlowKrw: period.weightedExternalFlow,
      denominatorKrw: period.denominator,
      flowCount: period.flowCount,
      periodReturn: period.periodReturn
    })))
  });
}
function calculateUnitModifiedDietz(input) {
  const timed = input.timing === "observed_timestamps";
  const policy = timed ? OBSERVED_TIMESTAMP_MODIFIED_DIETZ_POLICY : INVESTMENT_LAB_MODIFIED_DIETZ_POLICY;
  const blockers = [];
  const valuations = normalizeValuations(input.valuations, blockers, timed);
  const flows = normalizeFlows(input.flows, blockers, timed);
  const valuationTime = (row) => timed ? Date.parse(row.at) : Date.parse(`${row.serviceDate}T00:00:00Z`);
  const flowTime = (row) => timed ? Date.parse(row.at) : Date.parse(`${row.effectiveServiceDate}T00:00:00Z`);
  if (valuations.length < 2) {
    blockers.push(blocker("insufficient_valuations"));
  }
  if (valuations.length >= 2) {
    const firstDate = valuationTime(valuations[0]);
    const lastDate = valuationTime(valuations.at(-1));
    flows.forEach((flow) => {
      if (flowTime(flow) < firstDate || valuations[0].boundary !== "before" && flowTime(flow) === firstDate || (flowTime(flow) > lastDate || valuations.at(-1).boundary === "before" && flowTime(flow) === lastDate)) {
        blockers.push(
          blocker(
            "flow_outside_valuation_window",
            flow.sourceIndex,
            flow.effectiveServiceDate
          )
        );
      }
    });
  }
  if (blockers.length > 0) return blocked(blockers, policy);
  const periods = [];
  let flowIndex = 0;
  let linkedGrowth = 1;
  for (let index = 1; index < valuations.length; index += 1) {
    const beginning = valuations[index - 1];
    const ending = valuations[index];
    const calendarDays = timed ? (valuationTime(ending) - valuationTime(beginning)) / 864e5 : riskCalendarDayDistance(
      beginning.serviceDate,
      ending.serviceDate
    );
    let netExternalFlow = 0;
    let weightedExternalFlow = 0;
    let flowCount = 0;
    while (flowIndex < flows.length && (flowTime(flows[flowIndex]) < valuationTime(ending) || ending.boundary !== "before" && flowTime(flows[flowIndex]) === valuationTime(ending))) {
      const flow = flows[flowIndex];
      const elapsedDays = timed ? (flowTime(flow) - valuationTime(beginning)) / 864e5 : riskCalendarDayDistance(
        beginning.serviceDate,
        flow.effectiveServiceDate
      );
      const weight = (calendarDays - elapsedDays) / calendarDays;
      const signedAmount = flow.direction === "inflow" ? flow.amount : -flow.amount;
      netExternalFlow += signedAmount;
      weightedExternalFlow += signedAmount * weight;
      flowCount += 1;
      flowIndex += 1;
    }
    const denominator = beginning.value + weightedExternalFlow;
    if (!Number.isFinite(denominator) || denominator <= 0) {
      return blocked([
        blocker("non_positive_denominator", null, ending.serviceDate)
      ], policy);
    }
    const periodReturn = (ending.value - beginning.value - netExternalFlow) / denominator;
    const growth = 1 + periodReturn;
    if (!Number.isFinite(periodReturn) || growth < -1e-12) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate)
      ], policy);
    }
    linkedGrowth *= Math.max(0, growth);
    if (!Number.isFinite(linkedGrowth)) {
      return blocked([
        blocker("invalid_period_return", null, ending.serviceDate)
      ], policy);
    }
    periods.push(
      Object.freeze({
        startServiceDate: beginning.serviceDate,
        endServiceDate: ending.serviceDate,
        ...timed ? { startAt: beginning.at, endAt: ending.at } : {},
        calendarDays,
        beginningValue: beginning.value,
        endingValue: ending.value,
        netExternalFlow: cleanZero2(netExternalFlow),
        weightedExternalFlow: cleanZero2(weightedExternalFlow),
        denominator,
        flowCount,
        periodReturn: cleanZero2(periodReturn)
      })
    );
  }
  return Object.freeze({
    status: "ready",
    policy,
    totalReturn: cleanZero2(linkedGrowth - 1),
    periodCount: periods.length,
    flowCount: flows.length,
    periods: Object.freeze(periods),
    riskMetrics: calculateInvestmentLabPathRisk(periods),
    blockers: []
  });
}
function normalizeValuations(rows, blockers, timed) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.serviceDate) || timed && !Number.isFinite(Date.parse(row.at ?? ""))) {
      blockers.push(
        blocker("invalid_valuation_date", sourceIndex, row.serviceDate)
      );
      return;
    }
    if (!Number.isFinite(row.value) || row.value < 0) {
      blockers.push(
        blocker("invalid_valuation_value", sourceIndex, row.serviceDate)
      );
      return;
    }
    const identity = timed ? String(Date.parse(row.at)) : row.serviceDate;
    if (seen.has(identity)) {
      blockers.push(
        blocker("duplicate_valuation_date", sourceIndex, row.serviceDate)
      );
      return;
    }
    seen.add(identity);
    normalized.push({ serviceDate: row.serviceDate, value: row.value, ...timed ? { at: row.at, boundary: row.boundary } : {} });
  });
  return normalized.sort(
    (left, right) => timed ? Date.parse(left.at) - Date.parse(right.at) : left.serviceDate.localeCompare(right.serviceDate)
  );
}
function normalizeFlows(rows, blockers, timed) {
  const seenSequences = /* @__PURE__ */ new Set();
  const normalized = [];
  rows.forEach((row, sourceIndex) => {
    if (!isRiskDate(row.effectiveServiceDate) || timed && !Number.isFinite(Date.parse(row.at ?? ""))) {
      blockers.push(
        blocker("invalid_flow_date", sourceIndex, row.effectiveServiceDate)
      );
      return;
    }
    if (!Number.isInteger(row.sequence) || row.sequence < 0) {
      blockers.push(
        blocker(
          "invalid_flow_sequence",
          sourceIndex,
          row.effectiveServiceDate
        )
      );
      return;
    }
    if (seenSequences.has(row.sequence)) {
      blockers.push(
        blocker(
          "duplicate_flow_sequence",
          sourceIndex,
          row.effectiveServiceDate
        )
      );
      return;
    }
    if (row.direction !== "inflow" && row.direction !== "outflow") {
      blockers.push(
        blocker(
          "invalid_flow_direction",
          sourceIndex,
          row.effectiveServiceDate
        )
      );
      return;
    }
    if (!Number.isFinite(row.amount) || row.amount <= 0) {
      blockers.push(
        blocker(
          "invalid_flow_amount",
          sourceIndex,
          row.effectiveServiceDate
        )
      );
      return;
    }
    seenSequences.add(row.sequence);
    normalized.push({ ...row, sourceIndex });
  });
  return normalized.sort(
    (left, right) => (timed ? Date.parse(left.at) - Date.parse(right.at) : left.effectiveServiceDate.localeCompare(right.effectiveServiceDate)) || left.sequence - right.sequence || left.sourceIndex - right.sourceIndex
  );
}
function blocker(reason, sourceIndex = null, serviceDate = null) {
  return Object.freeze({ reason, sourceIndex, serviceDate });
}
function blocked(blockers, policy) {
  return Object.freeze({
    status: "blocked",
    policy,
    totalReturn: null,
    periodCount: 0,
    flowCount: 0,
    periods: [],
    riskMetrics: unavailableInvestmentLabPathRisk(),
    blockers: Object.freeze([...blockers])
  });
}
function cleanZero2(value) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}

// ../../../visualizations/2026/10/02/01a0fe5d-fc42-7fd3-9a8f-d2a64aea9075/history-close-gap-repair-20261027/original/tests/cairn-close-gaps/coverage.test.ts
var us = { ticker: "VOO", market: "us", currency: "USD" };
var kr = { ticker: "069500", market: "korea", currency: "KRW" };
var now = /* @__PURE__ */ new Date("2026-10-16T07:01:00+09:00");
var usDates = expectedCloseDates(us, now);
var krDates = expectedCloseDates(kr, now);
import_strict.default.ok(usDates.includes("2026-10-09"));
import_strict.default.ok(!krDates.includes("2026-10-09"));
import_strict.default.ok(!usDates.includes("2026-10-10") && !usDates.includes("2026-10-11"));
import_strict.default.equal(usDates.at(-1), "2026-10-15");
import_strict.default.equal(expectedCloseDates(us, /* @__PURE__ */ new Date("2026-10-16T06:59:00+09:00")).at(-1), "2026-10-14");
var present = /* @__PURE__ */ new Set([...usDates.map((d) => closeIdentity(us, d)), ...krDates.map((d) => closeIdentity(kr, d))]);
import_strict.default.equal(planCloseGapJobs([us, kr], present, now).length, 0);
present.delete(closeIdentity(us, "2026-10-08"));
present.delete(closeIdentity(us, "2026-10-14"));
var jobs = planCloseGapJobs([us, us, kr], present, now);
import_strict.default.equal(jobs.length, 1);
import_strict.default.equal(jobs[0].startDate, "2026-10-08");
import_strict.default.equal(jobs[0].endDate, "2026-10-14");
present.add(closeIdentity(us, "2026-10-08"));
import_strict.default.equal(planCloseGapJobs([us], present, now)[0].startDate, "2026-10-14");
import_strict.default.equal(planCloseGapJobs([{ ...us, ticker: "../bad" }], /* @__PURE__ */ new Set(), now).length, 0);
import_strict.default.equal(planCloseGapJobs([{ ...us, firstCloseDate: "2026-10-14" }], /* @__PURE__ */ new Set(), now)[0].startDate, "2026-10-14");
var result = calculateInvestmentLabModifiedDietz({ valuations: [
  { serviceDate: "2026-10-08", valueKrw: 1e3 },
  { serviceDate: "2026-10-09", valueKrw: 1500 },
  { serviceDate: "2026-10-10", valueKrw: 1500 },
  { serviceDate: "2026-10-11", valueKrw: 1500 },
  { serviceDate: "2026-10-13", valueKrw: 900 }
], flows: [
  { effectiveServiceDate: "2026-10-09", sequence: 1, direction: "inflow", amountKrw: 500 },
  { effectiveServiceDate: "2026-10-13", sequence: 2, direction: "outflow", amountKrw: 600 }
] });
import_strict.default.equal(result.status, "ready");
import_strict.default.equal(result.totalReturn, 0);
console.log("PASS: exchange holidays, cutoff, deduplication, partial retry, invalid identity, buy/sell flow neutrality");
