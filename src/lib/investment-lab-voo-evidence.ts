import { closeCalendarReferenceDateForAsset } from "./snapshots/market-calendar.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import type { InvestmentLabAmountProvenance } from "./investment-lab-execution-schedule.ts";
import { resolveInvestmentLabSnapshotFx } from "./investment-lab-snapshot-fx.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

const MAX_EXECUTION_DELAY_DAYS = 7;

export const INVESTMENT_LAB_VOO_READINESS_POLICY = Object.freeze({
  version: "investment_lab_voo_evidence_v2",
  instrumentKey: "us:USD:VOO",
  valuationPriceBasis: "raw_close_price_return",
  distributionTreatment: "excluded_not_reinvested",
  valuationPriceDate:
    "previous_us_trading_day_on_or_before_service_date_minus_one",
  valuationPriceProvenance: "stored_price_source_required",
  valuationFx:
    "exact_service_date_snapshot_source_rule_consensus",
  valuationFxProviderDate:
    "not_inferred_from_legacy_snapshot_evidence",
  executionPrice: "first_observed_raw_close_on_or_after_event_date",
  executionPriceProvenance: "stored_price_source_required",
  executionFx: "exact_usdkrw_rate_on_execution_price_date",
  executionFxProvenance: "stored_fx_source_and_ok_status_required",
  maxExecutionDelayDays: MAX_EXECUTION_DELAY_DAYS,
  lookAhead: "forbidden",
  latestSpotNearestFallback: "forbidden",
  incompleteOutput: "readiness_only_no_partial_path",
} as const);

export type InvestmentLabVooPriceRow = Readonly<{
  priceDate: string;
  closePrice: string | number | null;
  adjustedClosePrice: string | number | null;
  source: string | null;
}>;

export type InvestmentLabVooSnapshotFxRow = Readonly<{
  snapshotDate: string;
  account: string;
  usdKrw: string | number | null;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabVooFxRow = Readonly<{
  rateDate: string;
  usdKrw: string | number | null;
  source: string | null;
  status: string | null;
}>;

export type InvestmentLabVooFlowRow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
  amountProvenance: InvestmentLabAmountProvenance;
}>;

export type InvestmentLabVooReadinessBlocker =
  | "invalid_service_date_axis"
  | "missing_valuation_price"
  | "duplicate_valuation_price"
  | "invalid_valuation_price"
  | "missing_valuation_price_provenance"
  | "missing_snapshot_fx"
  | "ambiguous_snapshot_fx"
  | "missing_snapshot_fx_provenance"
  | "ambiguous_snapshot_fx_provenance"
  | "invalid_flow_evidence"
  | "missing_execution_price"
  | "duplicate_execution_price"
  | "invalid_execution_price"
  | "missing_execution_price_provenance"
  | "execution_price_too_late"
  | "execution_after_window"
  | "missing_execution_fx"
  | "duplicate_execution_fx"
  | "invalid_execution_fx"
  | "missing_execution_fx_provenance";

export type InvestmentLabVooReadiness = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_VOO_READINESS_POLICY;
  serviceDateCount: number;
  valuationPriceReadyCount: number;
  snapshotFxReadyCount: number;
  snapshotFxProvenanceReadyCount: number;
  relevantFlowCount: number;
  executionPriceReadyCount: number;
  executionFxReadyCount: number;
  sourcePriceRows: number;
  sourceFxRows: number;
  valuationAdjustedDifferenceRows: number;
  blockers: readonly InvestmentLabVooReadinessBlocker[];
}>;

export type InvestmentLabVooValuationEvidence = Readonly<{
  serviceDate: string;
  priceDate: string;
  rawCloseUsd: number;
  snapshotUsdKrw: number;
  unitValueKrw: number;
}>;

export type InvestmentLabVooExecutionEvidence = Readonly<{
  sourceIndex: number;
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
  amountProvenance: InvestmentLabAmountProvenance;
  executionPriceDate: string;
  executionServiceDate: string;
  rawCloseUsd: number;
  usdKrw: number;
  unitPriceKrw: number;
  pendingCalendarDays: number;
}>;

export type InvestmentLabVooEvidenceInput = Readonly<{
  account?: PortfolioAccountScope;
  serviceDates: readonly string[];
  priceRows: readonly InvestmentLabVooPriceRow[];
  snapshotRows: readonly InvestmentLabVooSnapshotFxRow[];
  fxRows: readonly InvestmentLabVooFxRow[];
  boundaryFlows: readonly InvestmentLabVooFlowRow[];
}>;

export type InvestmentLabVooEvidenceResolution = Readonly<{
  status: "ready" | "unavailable";
  readiness: InvestmentLabVooReadiness;
  valuations: readonly InvestmentLabVooValuationEvidence[];
  executions: readonly InvestmentLabVooExecutionEvidence[];
}>;

export function resolveInvestmentLabVooEvidence(
  input: InvestmentLabVooEvidenceInput,
): InvestmentLabVooEvidenceResolution {
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
  const snapshotGroups = groupByDate(
    input.snapshotRows.filter((row) => serviceDateSet.has(row.snapshotDate)),
    (row) => row.snapshotDate,
  );
  const valuationEvidence: InvestmentLabVooValuationEvidence[] = [];
  let valuationPriceReadyCount = 0;
  let snapshotFxReadyCount = 0;
  let snapshotFxProvenanceReadyCount = 0;
  let valuationAdjustedDifferenceRows = 0;

  for (const serviceDate of serviceDates) {
    if (!isRiskDate(serviceDate)) continue;
    const expectedPriceDate = closeCalendarReferenceDateForAsset(
      { market: "us", currency: "USD" },
      serviceDate,
    );
    const priceRows = priceGroups.get(expectedPriceDate) ?? [];
    const price = resolveValuationPrice(priceRows, blockers);
    if (price) {
      valuationPriceReadyCount += 1;
      if (
        price.adjustedClose !== null &&
        !sameNumber(price.rawClose, price.adjustedClose)
      ) {
        valuationAdjustedDifferenceRows += 1;
      }
    }

    const snapshot = resolveInvestmentLabSnapshotFx(
      snapshotGroups.get(serviceDate) ?? [],
      input.account,
    );
    for (const blocker of snapshot.blockers) blockers.add(blocker);
    if (snapshot.rate !== null) snapshotFxReadyCount += 1;
    if (snapshot.provenanceReady) snapshotFxProvenanceReadyCount += 1;

    if (price && snapshot.rate !== null && snapshot.provenanceReady) {
      valuationEvidence.push(
        Object.freeze({
          serviceDate,
          priceDate: expectedPriceDate,
          rawCloseUsd: price.rawClose,
          snapshotUsdKrw: snapshot.rate,
          unitValueKrw: price.rawClose * snapshot.rate,
        }),
      );
    }
  }

  const fxGroups = groupByDate(input.fxRows, (row) => row.rateDate);
  const startServiceDate = serviceDates[0] ?? null;
  const endServiceDate = serviceDates.at(-1) ?? null;
  const executionEvidence: InvestmentLabVooExecutionEvidence[] = [];
  let relevantFlowCount = 0;
  let executionPriceReadyCount = 0;
  let executionFxReadyCount = 0;

  if (startServiceDate && endServiceDate) {
    const flows = input.boundaryFlows
      .map((flow, sourceIndex) => ({ ...flow, sourceIndex }))
      .sort(
        (left, right) =>
          left.eventDate.localeCompare(right.eventDate) ||
          left.sequence - right.sequence ||
          left.sourceIndex - right.sourceIndex,
      );

    for (const flow of flows) {
      if (!isValidFlow(flow)) {
        blockers.add("invalid_flow_evidence");
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
      const pendingCalendarDays = riskCalendarDayDistance(
        flow.eventDate,
        executionPriceDate,
      );
      if (pendingCalendarDays > MAX_EXECUTION_DELAY_DAYS) {
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

      const price = resolveExecutionPrice(
        priceGroups.get(executionPriceDate) ?? [],
        blockers,
      );
      if (!price) continue;
      executionPriceReadyCount += 1;

      const fx = resolveExecutionFx(
        fxGroups.get(executionPriceDate) ?? [],
        blockers,
      );
      if (!fx) continue;
      executionFxReadyCount += 1;

      executionEvidence.push(
        Object.freeze({
          sourceIndex: flow.sourceIndex,
          eventDate: flow.eventDate,
          sequence: flow.sequence,
          direction: flow.direction,
          amountKrw: flow.amountKrw,
          amountProvenance: flow.amountProvenance,
          executionPriceDate,
          executionServiceDate,
          rawCloseUsd: price,
          usdKrw: fx,
          unitPriceKrw: price * fx,
          pendingCalendarDays,
        }),
      );
    }
  }

  const readiness = Object.freeze({
    status: blockers.size === 0 ? "ready" : "unavailable",
    policy: INVESTMENT_LAB_VOO_READINESS_POLICY,
    serviceDateCount: serviceDates.length,
    valuationPriceReadyCount,
    snapshotFxReadyCount,
    snapshotFxProvenanceReadyCount,
    relevantFlowCount,
    executionPriceReadyCount,
    executionFxReadyCount,
    sourcePriceRows: input.priceRows.length,
    sourceFxRows: input.fxRows.length,
    valuationAdjustedDifferenceRows,
    blockers: Object.freeze([...blockers].sort()),
  } as InvestmentLabVooReadiness);

  const ready = readiness.status === "ready";
  return Object.freeze({
    status: readiness.status,
    readiness,
    valuations: ready ? Object.freeze(valuationEvidence) : Object.freeze([]),
    executions: ready ? Object.freeze(executionEvidence) : Object.freeze([]),
  });
}

function resolveValuationPrice(
  rows: readonly InvestmentLabVooPriceRow[],
  blockers: Set<InvestmentLabVooReadinessBlocker>,
) {
  if (rows.length === 0) {
    blockers.add("missing_valuation_price");
    return null;
  }
  if (rows.length > 1) {
    blockers.add("duplicate_valuation_price");
    return null;
  }
  const rawClose = positiveNumber(rows[0].closePrice);
  if (rawClose === null) {
    blockers.add("invalid_valuation_price");
    return null;
  }
  if (!nonEmptyString(rows[0].source)) {
    blockers.add("missing_valuation_price_provenance");
    return null;
  }
  return {
    rawClose,
    adjustedClose: positiveNumber(rows[0].adjustedClosePrice),
  };
}

function resolveExecutionPrice(
  rows: readonly InvestmentLabVooPriceRow[],
  blockers: Set<InvestmentLabVooReadinessBlocker>,
) {
  if (rows.length === 0) {
    blockers.add("missing_execution_price");
    return null;
  }
  if (rows.length > 1) {
    blockers.add("duplicate_execution_price");
    return null;
  }
  const price = positiveNumber(rows[0].closePrice);
  if (price === null) {
    blockers.add("invalid_execution_price");
    return null;
  }
  if (!nonEmptyString(rows[0].source)) {
    blockers.add("missing_execution_price_provenance");
    return null;
  }
  return price;
}

function resolveExecutionFx(
  rows: readonly InvestmentLabVooFxRow[],
  blockers: Set<InvestmentLabVooReadinessBlocker>,
) {
  if (rows.length === 0) {
    blockers.add("missing_execution_fx");
    return null;
  }
  if (rows.length > 1) {
    blockers.add("duplicate_execution_fx");
    return null;
  }
  const rate = positiveNumber(rows[0].usdKrw);
  if (
    String(rows[0].status ?? "").trim().toLowerCase() !== "ok" ||
    rate === null
  ) {
    blockers.add("invalid_execution_fx");
    return null;
  }
  if (!nonEmptyString(rows[0].source)) {
    blockers.add("missing_execution_fx_provenance");
    return null;
  }
  return rate;
}

function isValidFlow(
  row: InvestmentLabVooFlowRow & Readonly<{ sourceIndex: number }>,
) {
  return (
    isRiskDate(row.eventDate) &&
    Number.isInteger(row.sequence) &&
    row.sequence >= 0 &&
    (row.direction === "inflow" || row.direction === "outflow") &&
    Number.isFinite(row.amountKrw) &&
    row.amountKrw > 0 &&
    Number.isInteger(row.sourceIndex) &&
    isAmountProvenance(row.amountProvenance)
  );
}

function isAmountProvenance(value: InvestmentLabAmountProvenance) {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx"
  );
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

function firstDateOnOrAfter(rows: readonly string[], eventDate: string) {
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

function nonEmptyString(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sameNumber(left: number | null, right: number | null) {
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= Math.max(1, Math.abs(left)) * 1e-10;
}
