import type {
  InvestmentLabAnchorInstrument,
  InvestmentLabAnchorPositionRow,
  InvestmentLabAnchorSelection,
} from "./investment-lab-anchor-basket-anchor.ts";
import type { InvestmentLabSourceSnapshotRow } from "./investment-lab-counterfactual-read-model.ts";
import type {
  InvestmentLabAmountProvenance,
  InvestmentLabBoundaryFlow,
} from "./investment-lab-execution-schedule.ts";
import { resolveInvestmentLabSnapshotFx } from "./investment-lab-snapshot-fx.ts";
import type {
  InvestmentLabUnitExecution,
  InvestmentLabUnitValuation,
} from "./investment-lab-unit-price-path.ts";
import {
  closeCalendarReferenceDateForAsset,
} from "./snapshots/market-calendar.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";
import {
  resolveManualValuationPath,
  type ManualValuationPathBlockerReason,
  type ManualValuationPathResolution,
  type ManualValuationSnapshotRow,
} from "./manual-valuation-history.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./investment-lab-special-holding-authority.ts";

const MAX_EXECUTION_DELAY_DAYS = 7;

export const INVESTMENT_LAB_ANCHOR_BASKET_EVIDENCE_POLICY = Object.freeze({
  version: "anchor_basket_raw_close_evidence_v1",
  valuationPrice: "exact_market_reference_date_raw_close",
  valuationFx: "exact_service_date_stored_snapshot_fx_consensus",
  executionPrice: "first_observed_raw_close_on_or_after_event_date",
  executionFx: "exact_usdkrw_on_execution_price_date",
  maximumExecutionDelayDays: MAX_EXECUTION_DELAY_DAYS,
  distributionTreatment: "excluded_not_reinvested",
  manualValuation:
    "exact_current_writer_stored_manual_observation_or_carry_only",
  manualExecutionPrice: "stored_manual_value_available_on_execution_service_date",
  partialEvidence: "forbidden",
} as const);

export type InvestmentLabAnchorPriceRow = Readonly<{
  ticker: string | null;
  market: string | null;
  currency: string | null;
  priceDate: string;
  closePrice: string | number | null;
  source: string | null;
}>;

export type InvestmentLabAnchorFxRow = Readonly<{
  rateDate: string;
  usdKrw: string | number | null;
  source: string | null;
  status: string | null;
}>;

export type InvestmentLabAnchorEvidenceBlocker = Readonly<{
  reason:
    | "anchor_selection_unavailable"
    | "invalid_actual_date_axis"
    | "invalid_boundary_flow"
    | "missing_valuation_price"
    | "duplicate_valuation_price"
    | "invalid_valuation_price"
    | "missing_valuation_price_provenance"
    | "missing_snapshot_fx"
    | "ambiguous_snapshot_fx"
    | "missing_snapshot_fx_provenance"
    | "ambiguous_snapshot_fx_provenance"
    | "missing_execution_price"
    | "duplicate_execution_price"
    | "invalid_execution_price"
    | "missing_execution_price_provenance"
    | "execution_price_too_late"
    | "execution_after_window"
    | "missing_execution_fx"
    | "duplicate_execution_fx"
    | "invalid_execution_fx"
    | "missing_execution_fx_provenance"
    | ManualValuationPathBlockerReason
    | "manual_execution_after_window"
    | "missing_manual_execution_valuation";
  instrumentKey: string | null;
  evidenceDate: string | null;
}>;

export type InvestmentLabAnchorComponentEvidence = Readonly<{
  instrument: InvestmentLabAnchorInstrument;
  valuationBasis: "listed_close" | "stored_manual_valuation";
  valuations: readonly InvestmentLabUnitValuation[];
  executions: readonly InvestmentLabUnitExecution[];
}>;

export type InvestmentLabAnchorEvidenceResolution = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_ANCHOR_BASKET_EVIDENCE_POLICY;
  components: readonly InvestmentLabAnchorComponentEvidence[];
  coverage: Readonly<{
    serviceDateCount: number;
    instrumentCount: number;
    sourcePriceRows: number;
    relevantFlowCount: number;
    valuationEvidenceRows: number;
    executionEvidenceRows: number;
    manualSourceRows: number;
    manualObservationRows: number;
    manualCarryRows: number;
  }>;
  blockers: readonly InvestmentLabAnchorEvidenceBlocker[];
}>;

export function resolveInvestmentLabAnchorBasketEvidence(input: Readonly<{
  account?: PortfolioAccountScope;
  anchor: InvestmentLabAnchorSelection;
  serviceDates: readonly string[];
  priceRows: readonly InvestmentLabAnchorPriceRow[];
  manualValuationRows?: readonly InvestmentLabAnchorPositionRow[];
  snapshotRows: readonly InvestmentLabSourceSnapshotRow[];
  fxRows: readonly InvestmentLabAnchorFxRow[];
  boundaryFlows: readonly InvestmentLabBoundaryFlow[];
}>): InvestmentLabAnchorEvidenceResolution {
  const blockers: InvestmentLabAnchorEvidenceBlocker[] = [];
  if (input.anchor.status !== "ready" || !input.anchor.selectedAnchorDate) {
    blockers.push(blocker("anchor_selection_unavailable"));
    return unavailable(input, blockers);
  }
  if (!isOrderedDateAxis(input.serviceDates)) {
    blockers.push(blocker("invalid_actual_date_axis"));
    return unavailable(input, blockers);
  }

  const flows = normalizeFlows(input.boundaryFlows, blockers);
  const priceGroups = groupPriceRows(input.priceRows);
  const observedPriceDates = observedDatesByInstrument(input.priceRows);
  const snapshotGroups = groupByDate(input.snapshotRows, (row) => row.snapshotDate);
  const fxGroups = groupByDate(input.fxRows, (row) => row.rateDate);
  const snapshotFx = new Map<
    string,
    ReturnType<typeof resolveInvestmentLabSnapshotFx>
  >();
  const components: InvestmentLabAnchorComponentEvidence[] = [];
  let valuationEvidenceRows = 0;
  let executionEvidenceRows = 0;
  let relevantFlowCount = 0;
  let manualSourceRows = 0;
  let manualObservationRows = 0;
  let manualCarryRows = 0;
  const anchorDate = input.anchor.selectedAnchorDate;
  const endServiceDate = input.serviceDates.at(-1)!;

  for (const instrument of input.anchor.instruments) {
    if (instrument.valuationModel === "stored_manual") {
      const manual = resolveManualValuationPath({
        target: DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold,
        snapshotRows: (input.manualValuationRows ?? []).map(
          toManualValuationSnapshotRow,
        ),
        serviceDates: input.serviceDates,
      });
      manualSourceRows += manual.coverage.sourceRowCount;
      manualObservationRows += manual.coverage.manualObservationRowCount;
      manualCarryRows += manual.coverage.carriedValuationRowCount;
      if (manual.status !== "ready") {
        manual.blockers.forEach((row) => {
          blockers.push(
            blocker(row.reason, instrument.key, row.serviceDate),
          );
        });
        continue;
      }

      const valuations = manual.rows.map((row) =>
        Object.freeze({
          serviceDate: row.serviceDate,
          priceDate: row.referenceDate,
          unitPriceKrw: row.unitPriceKrw,
        }),
      );
      valuationEvidenceRows += valuations.length;
      const executions = resolveManualExecutions({
        anchorDate,
        endServiceDate,
        flows,
        manualRows: manual.rows,
        instrumentKey: instrument.key,
        blockers,
      });
      relevantFlowCount += executions.relevantFlowCount;
      executionEvidenceRows += executions.rows.length;
      components.push(
        Object.freeze({
          instrument,
          valuationBasis: "stored_manual_valuation" as const,
          valuations: Object.freeze(valuations),
          executions: Object.freeze(executions.rows),
        }),
      );
      continue;
    }

    const valuations: InvestmentLabUnitValuation[] = [];
    for (const serviceDate of input.serviceDates) {
      const priceDate = closeCalendarReferenceDateForAsset(
        instrument,
        serviceDate,
      );
      const price = resolvePrice(
        priceGroups.get(priceGroupKey(instrument.key, priceDate)) ?? [],
        "valuation",
        instrument.key,
        priceDate,
        blockers,
      );
      const fx =
        instrument.currency === "USD"
          ? resolveSnapshotRate(
              serviceDate,
              snapshotGroups,
              snapshotFx,
              instrument.key,
              blockers,
              input.account,
            )
          : 1;
      if (price !== null && fx !== null) {
        valuations.push(
          Object.freeze({
            serviceDate,
            priceDate,
            unitPriceKrw: price * fx,
          }),
        );
        valuationEvidenceRows += 1;
      }
    }

    const executions: InvestmentLabUnitExecution[] = [];
    const priceDates = observedPriceDates.get(instrument.key) ?? [];
    const endPriceDate = closeCalendarReferenceDateForAsset(
      instrument,
      endServiceDate,
    );
    for (const flow of flows) {
      if (flow.eventDate <= anchorDate) continue;
      relevantFlowCount += 1;
      if (flow.eventDate > endPriceDate) {
        blockers.push(
          blocker("execution_after_window", instrument.key, flow.eventDate),
        );
        continue;
      }
      const executionPriceDate = firstDateOnOrAfter(
        priceDates,
        flow.eventDate,
      );
      if (!executionPriceDate || executionPriceDate > endPriceDate) {
        blockers.push(
          blocker("missing_execution_price", instrument.key, flow.eventDate),
        );
        continue;
      }
      const pendingCalendarDays = riskCalendarDayDistance(
        flow.eventDate,
        executionPriceDate,
      );
      if (pendingCalendarDays > MAX_EXECUTION_DELAY_DAYS) {
        blockers.push(
          blocker(
            "execution_price_too_late",
            instrument.key,
            executionPriceDate,
          ),
        );
        continue;
      }
      const executionServiceDate = mapRiskEvidenceDateToServiceDate(
        executionPriceDate,
      );
      if (
        executionServiceDate <= anchorDate ||
        executionServiceDate > endServiceDate
      ) {
        blockers.push(
          blocker(
            "execution_after_window",
            instrument.key,
            executionServiceDate,
          ),
        );
        continue;
      }
      const price = resolvePrice(
        priceGroups.get(
          priceGroupKey(instrument.key, executionPriceDate),
        ) ?? [],
        "execution",
        instrument.key,
        executionPriceDate,
        blockers,
      );
      const fx =
        instrument.currency === "USD"
          ? resolveExecutionFx(
              fxGroups.get(executionPriceDate) ?? [],
              instrument.key,
              executionPriceDate,
              blockers,
            )
          : 1;
      if (price !== null && fx !== null) {
        executions.push(
          Object.freeze({
            ...flow,
            executionPriceDate,
            executionServiceDate,
            unitPriceKrw: price * fx,
            pendingCalendarDays,
          }),
        );
        executionEvidenceRows += 1;
      }
    }

    components.push(
      Object.freeze({
        instrument,
        valuationBasis: "listed_close" as const,
        valuations: Object.freeze(valuations),
        executions: Object.freeze(executions),
      }),
    );
  }

  const coverage = Object.freeze({
    serviceDateCount: input.serviceDates.length,
    instrumentCount: input.anchor.instruments.length,
    sourcePriceRows: input.priceRows.length,
    relevantFlowCount,
    valuationEvidenceRows,
    executionEvidenceRows,
    manualSourceRows,
    manualObservationRows,
    manualCarryRows,
  });
  if (blockers.length > 0) {
    return Object.freeze({
      status: "unavailable",
      policy: INVESTMENT_LAB_ANCHOR_BASKET_EVIDENCE_POLICY,
      components: [] as const,
      coverage,
      blockers: dedupeBlockers(blockers),
    });
  }
  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_ANCHOR_BASKET_EVIDENCE_POLICY,
    components: Object.freeze(components),
    coverage,
    blockers: [] as const,
  });
}

function normalizeFlows(
  rows: readonly InvestmentLabBoundaryFlow[],
  blockers: InvestmentLabAnchorEvidenceBlocker[],
) {
  return rows.map((row, sourceIndex) => {
    if (
      !isRiskDate(row.eventDate) ||
      !Number.isInteger(row.sequence) ||
      row.sequence < 0 ||
      (row.direction !== "inflow" && row.direction !== "outflow") ||
      !positiveFinite(row.amountKrw) ||
      !isAmountProvenance(row.amountProvenance)
    ) {
      blockers.push(blocker("invalid_boundary_flow", null, row.eventDate));
    }
    return Object.freeze({ ...row, sourceIndex });
  });
}

function toManualValuationSnapshotRow(
  row: InvestmentLabAnchorPositionRow,
): ManualValuationSnapshotRow {
  return Object.freeze({
    snapshotDate: row.snapshotDate,
    assetId: row.assetId ?? null,
    legacyAssetId: row.legacyAssetId ?? null,
    assetName: row.assetName ?? "",
    account: row.account,
    market: row.market,
    currency: row.currency,
    assetType: row.assetType,
    source: row.source,
    priceSource: row.priceSource ?? null,
    priceBasis: row.priceBasis ?? null,
    currentPrice: row.currentPrice ?? null,
    priceDate: row.priceDate ?? null,
    referenceDate: row.referenceDate ?? null,
    capturedAt: row.capturedAt ?? null,
  });
}

function resolveManualExecutions(input: Readonly<{
  anchorDate: string;
  endServiceDate: string;
  flows: ReturnType<typeof normalizeFlows>;
  manualRows: ManualValuationPathResolution["rows"];
  instrumentKey: string;
  blockers: InvestmentLabAnchorEvidenceBlocker[];
}>) {
  const rows: InvestmentLabUnitExecution[] = [];
  let relevantFlowCount = 0;
  for (const flow of input.flows) {
    if (flow.eventDate <= input.anchorDate) continue;
    relevantFlowCount += 1;
    const expectedServiceDate = mapRiskEvidenceDateToServiceDate(flow.eventDate);
    if (expectedServiceDate > input.endServiceDate) {
      input.blockers.push(
        blocker(
          "manual_execution_after_window",
          input.instrumentKey,
          expectedServiceDate,
        ),
      );
      continue;
    }
    const valuation = input.manualRows.find(
      (row) => row.serviceDate >= expectedServiceDate,
    );
    if (!valuation) {
      input.blockers.push(
        blocker(
          "missing_manual_execution_valuation",
          input.instrumentKey,
          expectedServiceDate,
        ),
      );
      continue;
    }
    rows.push(
      Object.freeze({
        ...flow,
        executionPriceDate: valuation.referenceDate,
        executionServiceDate: valuation.serviceDate,
        unitPriceKrw: valuation.unitPriceKrw,
        pendingCalendarDays: riskCalendarDayDistance(
          flow.eventDate,
          valuation.serviceDate,
        ),
      }),
    );
  }
  return Object.freeze({ rows: Object.freeze(rows), relevantFlowCount });
}

function resolvePrice(
  rows: readonly InvestmentLabAnchorPriceRow[],
  use: "valuation" | "execution",
  instrumentKey: string,
  evidenceDate: string,
  blockers: InvestmentLabAnchorEvidenceBlocker[],
) {
  const missingReason =
    use === "valuation" ? "missing_valuation_price" : "missing_execution_price";
  const duplicateReason =
    use === "valuation"
      ? "duplicate_valuation_price"
      : "duplicate_execution_price";
  const invalidReason =
    use === "valuation" ? "invalid_valuation_price" : "invalid_execution_price";
  const sourceReason =
    use === "valuation"
      ? "missing_valuation_price_provenance"
      : "missing_execution_price_provenance";
  if (rows.length === 0) {
    blockers.push(blocker(missingReason, instrumentKey, evidenceDate));
    return null;
  }
  if (rows.length !== 1) {
    blockers.push(blocker(duplicateReason, instrumentKey, evidenceDate));
    return null;
  }
  const price = positiveNumber(rows[0].closePrice);
  if (price === null) {
    blockers.push(blocker(invalidReason, instrumentKey, evidenceDate));
    return null;
  }
  if (!normalizeText(rows[0].source)) {
    blockers.push(blocker(sourceReason, instrumentKey, evidenceDate));
    return null;
  }
  return price;
}

function resolveSnapshotRate(
  serviceDate: string,
  groups: Map<string, InvestmentLabSourceSnapshotRow[]>,
  cache: Map<string, ReturnType<typeof resolveInvestmentLabSnapshotFx>>,
  instrumentKey: string,
  blockers: InvestmentLabAnchorEvidenceBlocker[],
  account?: PortfolioAccountScope,
) {
  const resolution =
    cache.get(serviceDate) ??
    resolveInvestmentLabSnapshotFx(groups.get(serviceDate) ?? [], account);
  cache.set(serviceDate, resolution);
  for (const reason of resolution.blockers) {
    blockers.push(blocker(reason, instrumentKey, serviceDate));
  }
  return resolution.rate !== null && resolution.provenanceReady
    ? resolution.rate
    : null;
}

function resolveExecutionFx(
  rows: readonly InvestmentLabAnchorFxRow[],
  instrumentKey: string,
  evidenceDate: string,
  blockers: InvestmentLabAnchorEvidenceBlocker[],
) {
  if (rows.length === 0) {
    blockers.push(blocker("missing_execution_fx", instrumentKey, evidenceDate));
    return null;
  }
  if (rows.length !== 1) {
    blockers.push(
      blocker("duplicate_execution_fx", instrumentKey, evidenceDate),
    );
    return null;
  }
  const rate = positiveNumber(rows[0].usdKrw);
  if (normalizeText(rows[0].status)?.toLowerCase() !== "ok" || rate === null) {
    blockers.push(blocker("invalid_execution_fx", instrumentKey, evidenceDate));
    return null;
  }
  if (!normalizeText(rows[0].source)) {
    blockers.push(
      blocker("missing_execution_fx_provenance", instrumentKey, evidenceDate),
    );
    return null;
  }
  return rate;
}

function groupPriceRows(rows: readonly InvestmentLabAnchorPriceRow[]) {
  const groups = new Map<string, InvestmentLabAnchorPriceRow[]>();
  for (const row of rows) {
    const key = sourceInstrumentKey(row);
    if (!key) continue;
    const groupKey = priceGroupKey(key, row.priceDate);
    const group = groups.get(groupKey) ?? [];
    group.push(row);
    groups.set(groupKey, group);
  }
  return groups;
}

function observedDatesByInstrument(
  rows: readonly InvestmentLabAnchorPriceRow[],
) {
  const dates = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = sourceInstrumentKey(row);
    if (!key || !isRiskDate(row.priceDate)) continue;
    const group = dates.get(key) ?? new Set<string>();
    group.add(row.priceDate);
    dates.set(key, group);
  }
  return new Map(
    [...dates].map(([key, values]) => [key, [...values].sort()] as const),
  );
}

function sourceInstrumentKey(row: InvestmentLabAnchorPriceRow) {
  const ticker = normalizeText(row.ticker)?.toUpperCase();
  const market = normalizeText(row.market)?.toLowerCase();
  const currency = normalizeText(row.currency)?.toUpperCase();
  if (!ticker || !market || !currency) return null;
  return `${market}:${currency}:${ticker}`;
}

function priceGroupKey(instrumentKey: string, priceDate: string) {
  return `${instrumentKey}\u0000${priceDate}`;
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

function isOrderedDateAxis(dates: readonly string[]) {
  return (
    dates.length >= 2 &&
    new Set(dates).size === dates.length &&
    dates.every(
      (date, index) =>
        isRiskDate(date) && (index === 0 || dates[index - 1] < date),
    )
  );
}

function isAmountProvenance(value: InvestmentLabAmountProvenance) {
  return (
    value === "explicit_amount_krw" ||
    value === "derived_quantity_price_krw" ||
    value === "derived_quantity_price_fx"
  );
}

function blocker(
  reason: InvestmentLabAnchorEvidenceBlocker["reason"],
  instrumentKey: string | null = null,
  evidenceDate: string | null = null,
) {
  return Object.freeze({ reason, instrumentKey, evidenceDate });
}

function dedupeBlockers(rows: readonly InvestmentLabAnchorEvidenceBlocker[]) {
  const seen = new Set<string>();
  return Object.freeze(
    rows.filter((row) => {
      const key = `${row.reason}\u0000${row.instrumentKey}\u0000${row.evidenceDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function unavailable(
  input: Pick<
    Parameters<typeof resolveInvestmentLabAnchorBasketEvidence>[0],
    "serviceDates" | "anchor" | "priceRows" | "manualValuationRows"
  >,
  blockers: readonly InvestmentLabAnchorEvidenceBlocker[],
): InvestmentLabAnchorEvidenceResolution {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_ANCHOR_BASKET_EVIDENCE_POLICY,
    components: [] as const,
    coverage: Object.freeze({
      serviceDateCount: input.serviceDates.length,
      instrumentCount: input.anchor.instruments.length,
      sourcePriceRows: input.priceRows.length,
      relevantFlowCount: 0,
      valuationEvidenceRows: 0,
      executionEvidenceRows: 0,
      manualSourceRows: input.manualValuationRows?.length ?? 0,
      manualObservationRows: 0,
      manualCarryRows: 0,
    }),
    blockers: dedupeBlockers(blockers),
  });
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
