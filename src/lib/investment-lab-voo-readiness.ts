import { closeCalendarReferenceDateForAsset } from "./snapshots/market-calendar.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";

const TRACKED_ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"] as const);
const MAX_EXECUTION_DELAY_DAYS = 7;

export const INVESTMENT_LAB_VOO_READINESS_POLICY = Object.freeze({
  version: "investment_lab_voo_evidence_v1",
  instrumentKey: "us:USD:VOO",
  valuationPriceBasis: "raw_close_price_return",
  distributionTreatment: "excluded_not_reinvested",
  valuationPriceDate:
    "previous_us_trading_day_on_or_before_service_date_minus_one",
  valuationFx: "stored_snapshot_usdkrw_named_account_consensus",
  executionPrice: "first_observed_raw_close_on_or_after_event_date",
  executionFx: "exact_usdkrw_rate_on_execution_price_date",
  maxExecutionDelayDays: MAX_EXECUTION_DELAY_DAYS,
  lookAhead: "forbidden",
  latestSpotNearestFallback: "forbidden",
  incompleteOutput: "readiness_only_no_partial_path",
} as const);

export type InvestmentLabVooPriceRow = Readonly<{
  priceDate: string;
  closePrice: string | number | null;
  adjustedClosePrice: string | number | null;
}>;

export type InvestmentLabVooSnapshotFxRow = Readonly<{
  snapshotDate: string;
  account: string;
  usdKrw: string | number | null;
}>;

export type InvestmentLabVooFxRow = Readonly<{
  rateDate: string;
  usdKrw: string | number | null;
  status: string | null;
}>;

export type InvestmentLabVooFlowRow = Readonly<{
  eventDate: string;
  sequence: number;
}>;

export type InvestmentLabVooReadinessBlocker =
  | "invalid_service_date_axis"
  | "missing_valuation_price"
  | "duplicate_valuation_price"
  | "invalid_valuation_price"
  | "missing_snapshot_fx"
  | "ambiguous_snapshot_fx"
  | "invalid_flow_date"
  | "missing_execution_price"
  | "duplicate_execution_price"
  | "invalid_execution_price"
  | "execution_price_too_late"
  | "execution_after_window"
  | "missing_execution_fx"
  | "duplicate_execution_fx"
  | "invalid_execution_fx";

export type InvestmentLabVooReadiness = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_VOO_READINESS_POLICY;
  serviceDateCount: number;
  valuationPriceReadyCount: number;
  snapshotFxReadyCount: number;
  relevantFlowCount: number;
  executionPriceReadyCount: number;
  executionFxReadyCount: number;
  sourcePriceRows: number;
  sourceFxRows: number;
  valuationAdjustedDifferenceRows: number;
  blockers: readonly InvestmentLabVooReadinessBlocker[];
}>;

export function assessInvestmentLabVooReadiness(input: {
  serviceDates: readonly string[];
  priceRows: readonly InvestmentLabVooPriceRow[];
  snapshotRows: readonly InvestmentLabVooSnapshotFxRow[];
  fxRows: readonly InvestmentLabVooFxRow[];
  boundaryFlows: readonly InvestmentLabVooFlowRow[];
}): InvestmentLabVooReadiness {
  const blockers = new Set<InvestmentLabVooReadinessBlocker>();
  const serviceDates = [...input.serviceDates];
  const serviceDateSet = new Set(serviceDates);
  if (
    serviceDates.length < 2 ||
    serviceDateSet.size !== serviceDates.length ||
    serviceDates.some((date) => !isRiskDate(date)) ||
    serviceDates.some(
      (date, index) => index > 0 && serviceDates[index - 1] >= date,
    )
  ) {
    blockers.add("invalid_service_date_axis");
  }

  const priceGroups = groupByDate(input.priceRows, (row) => row.priceDate);
  const observedPriceDates = [...priceGroups.keys()]
    .filter(isRiskDate)
    .sort();

  let valuationPriceReadyCount = 0;
  let valuationAdjustedDifferenceRows = 0;
  for (const serviceDate of serviceDates) {
    if (!isRiskDate(serviceDate)) continue;
    const expectedPriceDate = closeCalendarReferenceDateForAsset(
      { market: "us", currency: "USD" },
      serviceDate,
    );
    const rows = priceGroups.get(expectedPriceDate) ?? [];
    if (rows.length === 0) {
      blockers.add("missing_valuation_price");
      continue;
    }
    if (rows.length > 1) {
      blockers.add("duplicate_valuation_price");
      continue;
    }
    const closePrice = positiveNumber(rows[0].closePrice);
    if (closePrice === null) {
      blockers.add("invalid_valuation_price");
      continue;
    }
    valuationPriceReadyCount += 1;
    const adjustedClosePrice = positiveNumber(rows[0].adjustedClosePrice);
    if (
      adjustedClosePrice !== null &&
      !sameNumber(closePrice, adjustedClosePrice)
    ) {
      valuationAdjustedDifferenceRows += 1;
    }
  }

  const snapshotGroups = groupByDate(
    input.snapshotRows.filter((row) => serviceDateSet.has(row.snapshotDate)),
    (row) => row.snapshotDate,
  );
  let snapshotFxReadyCount = 0;
  for (const serviceDate of serviceDates) {
    const rows = snapshotGroups.get(serviceDate) ?? [];
    const namedRates: number[] = [];
    let invalid = false;
    for (const account of TRACKED_ACCOUNTS) {
      const matches = rows.filter(
        (row) => String(row.account).trim().toLowerCase() === account,
      );
      if (matches.length !== 1) {
        invalid = true;
        continue;
      }
      const rate = positiveNumber(matches[0].usdKrw);
      if (rate === null) invalid = true;
      else namedRates.push(rate);
    }
    if (invalid || namedRates.length !== TRACKED_ACCOUNTS.length) {
      blockers.add("missing_snapshot_fx");
      continue;
    }
    if (namedRates.some((rate) => !sameNumber(rate, namedRates[0]))) {
      blockers.add("ambiguous_snapshot_fx");
      continue;
    }
    const allRows = rows.filter(
      (row) => String(row.account).trim().toLowerCase() === "all",
    );
    if (
      allRows.length > 1 ||
      (allRows.length === 1 &&
        !sameNumber(positiveNumber(allRows[0].usdKrw), namedRates[0]))
    ) {
      blockers.add("ambiguous_snapshot_fx");
      continue;
    }
    snapshotFxReadyCount += 1;
  }

  const fxGroups = groupByDate(input.fxRows, (row) => row.rateDate);
  const startServiceDate = serviceDates[0] ?? null;
  const endServiceDate = serviceDates.at(-1) ?? null;
  let relevantFlowCount = 0;
  let executionPriceReadyCount = 0;
  let executionFxReadyCount = 0;

  if (startServiceDate && endServiceDate) {
    for (const flow of [...input.boundaryFlows].sort(
      (left, right) => left.sequence - right.sequence,
    )) {
      if (!isRiskDate(flow.eventDate)) {
        blockers.add("invalid_flow_date");
        continue;
      }
      if (flow.eventDate >= endServiceDate) continue;

      const executionPriceDate = firstDateOnOrAfter(
        observedPriceDates,
        flow.eventDate,
      );
      if (!executionPriceDate) {
        blockers.add("missing_execution_price");
        continue;
      }
      const delayDays = riskCalendarDayDistance(
        flow.eventDate,
        executionPriceDate,
      );
      if (delayDays > MAX_EXECUTION_DELAY_DAYS) {
        blockers.add("execution_price_too_late");
        continue;
      }
      const executionServiceDate = mapRiskEvidenceDateToServiceDate(
        executionPriceDate,
      );
      if (executionServiceDate <= startServiceDate) continue;
      relevantFlowCount += 1;
      if (executionServiceDate > endServiceDate) {
        blockers.add("execution_after_window");
        continue;
      }

      const executionPriceRows = priceGroups.get(executionPriceDate) ?? [];
      if (executionPriceRows.length > 1) {
        blockers.add("duplicate_execution_price");
        continue;
      }
      if (positiveNumber(executionPriceRows[0]?.closePrice ?? null) === null) {
        blockers.add("invalid_execution_price");
        continue;
      }
      executionPriceReadyCount += 1;

      const fxRows = fxGroups.get(executionPriceDate) ?? [];
      if (fxRows.length === 0) {
        blockers.add("missing_execution_fx");
        continue;
      }
      if (fxRows.length > 1) {
        blockers.add("duplicate_execution_fx");
        continue;
      }
      const fxRate = positiveNumber(fxRows[0].usdKrw);
      if (
        String(fxRows[0].status ?? "").trim().toLowerCase() !== "ok" ||
        fxRate === null
      ) {
        blockers.add("invalid_execution_fx");
        continue;
      }
      executionFxReadyCount += 1;
    }
  }

  return Object.freeze({
    status: blockers.size === 0 ? "ready" : "unavailable",
    policy: INVESTMENT_LAB_VOO_READINESS_POLICY,
    serviceDateCount: serviceDates.length,
    valuationPriceReadyCount,
    snapshotFxReadyCount,
    relevantFlowCount,
    executionPriceReadyCount,
    executionFxReadyCount,
    sourcePriceRows: input.priceRows.length,
    sourceFxRows: input.fxRows.length,
    valuationAdjustedDifferenceRows,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function groupByDate<T>(rows: readonly T[], date: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = date(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function firstDateOnOrAfter(
  rows: readonly string[],
  eventDate: string,
) {
  let low = 0;
  let high = rows.length - 1;
  let selected: string | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = rows[middle];
    if (candidate >= eventDate) {
      selected = candidate;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return selected;
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sameNumber(left: number | null, right: number | null) {
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= Math.max(1, Math.abs(left)) * 1e-10;
}
