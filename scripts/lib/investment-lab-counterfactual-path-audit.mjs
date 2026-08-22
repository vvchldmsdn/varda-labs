import { classifyInvestmentLabEvent } from "../../src/lib/investment-lab-event-flow.ts";
import {
  INVESTMENT_LAB_PATH_POLICY,
  buildInvestmentLabCounterfactualPath,
} from "../../src/lib/investment-lab-counterfactual-path.ts";
import {
  INVESTMENT_LAB_EXECUTION_POLICY,
  scheduleInvestmentLabBoundaryFlows,
} from "../../src/lib/investment-lab-execution-schedule.ts";
import {
  admitAdjustedHistoricalPriceRows,
  admitSharedKisRawHistoricalPriceRows,
  selectPreferredPrivateHistoricalPriceRows,
} from "../../src/lib/market-data/asset-price-consumer-admission.ts";

export function auditInvestmentLabCounterfactualPathEvidence({
  eventRows,
  closeRows,
  actualPathRows,
  ownerRows = [],
}) {
  const classified = eventRows.map((row) => ({
    row,
    classification: classifyInvestmentLabEvent({
      eventType: row.event_type,
      amountResolved: row.amount_resolved,
      isCorrection: row.is_correction,
    }),
  }));
  const unsupported = classified.filter(
    ({ classification }) => classification.category === "unsupported",
  );
  const eligible = classified.filter(
    ({ classification }) => classification.includedInV1,
  );
  const closeEvidence = resolvePreferredCloseEvidence(closeRows);
  const closes = closeEvidence.rows;
  const actualPath = actualPathRows.map((row) => ({
    serviceDate: row.service_date,
    totalMarketValueKrw: number(row.total_market_value_krw),
  }));
  const schedule = scheduleInvestmentLabBoundaryFlows({
    events: eligible.map(({ row, classification }) => ({
      eventDate: row.event_date,
      sequence: number(row.sequence),
      direction: classification.direction,
      amountKrw: number(row.resolved_amount_krw),
      amountProvenance: row.amount_provenance,
    })),
    closes,
    windowEndPriceDate: closes.at(-1)?.priceDate ?? "invalid",
  });

  const preEngineBlockers = [
    ...(ownerRows.length === 1 ? [] : ["active_owner_scope_not_established"]),
    ...unsupported.map(() => "unsupported_event_evidence"),
    ...schedule.blockers.map((row) => row.reason),
  ];
  const path =
    preEngineBlockers.length === 0 && schedule.status === "ready"
      ? buildInvestmentLabCounterfactualPath({
          actualPath,
          closes,
          scheduledFlows: schedule.scheduledFlows,
        })
      : null;
  const pathBlockers = path?.blockers.map((row) => row.reason) ?? [];
  const blockerCounts = distribution([...preEngineBlockers, ...pathBlockers]);
  const ready = path?.status === "ready";

  return {
    audit: "investment_lab_aggregate_kodex200_counterfactual_path",
    status: ready ? "passed" : "blocked",
    readOnly: true,
    pathPolicy: INVESTMENT_LAB_PATH_POLICY,
    executionPolicy: INVESTMENT_LAB_EXECUTION_POLICY,
    input: {
      actualPathRows: actualPath.length,
      actualPathStartDate: actualPath[0]?.serviceDate ?? null,
      actualPathEndDate: actualPath.at(-1)?.serviceDate ?? null,
      eventRows: eventRows.length,
      eligibleBoundaryFlowRows: eligible.length,
      unsupportedEventRows: unsupported.length,
      closeRows: closes.length,
      closeStartDate: closes[0]?.priceDate ?? null,
      closeEndDate: closes.at(-1)?.priceDate ?? null,
      priceBasis: closeEvidence.priceBasis,
      activeOwnerCount: ownerRows.length,
      suppliedCloseRows: closeRows.length,
      adjustedAdmittedRows: closeEvidence.adjustedAdmittedRows,
      privateRawAdmittedRows: closeEvidence.privateRawAdmittedRows,
      amountProvenanceDistribution: distribution(
        eligible.map(({ row }) => row.amount_provenance ?? "unresolved"),
      ),
    },
    schedule: {
      status: schedule.status,
      scheduledRows: schedule.scheduledFlows.length,
      sameDayRows: schedule.sameDayFlowCount,
      pendingRows: schedule.pendingFlowCount,
    },
    path: {
      status: path?.status ?? "not_run",
      rowCount: ready ? path.rows.length : 0,
      appliedFlowRows: ready ? path.appliedFlows.length : 0,
      pendingComparisonRows: ready
        ? path.rows.filter(
            (row) =>
              row.comparisonBasis ===
              "position_value_only_with_pending_flows",
          ).length
        : 0,
      maxValuationCarryDays: ready
        ? Math.max(...path.rows.map((row) => row.valuationCarryDays))
        : null,
      ignoredThroughAnchorRows: ready
        ? path.ignoredFlows.throughAnchor
        : 0,
      ignoredAfterWindowRows: ready ? path.ignoredFlows.afterWindow : 0,
      pendingAtEndRows: ready ? path.pendingAtEnd.flowCount : 0,
      blockerCounts,
    },
    boundaries: {
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      routesEnabled: 0,
      userFacingMetricsEnabled: 0,
    },
  };
}

function resolvePreferredCloseEvidence(closeRows) {
  const candidates = closeRows.map((row) => ({
    ticker: row.ticker,
    market: row.market,
    currency: row.currency,
    priceDate: row.price_date,
    closePrice: row.close_price,
    adjustedClosePrice: row.adjusted_close_price,
    adjustedCloseBasis: row.adjusted_close_basis,
    adjustedCloseProvider: row.adjusted_close_provider,
    adjustedCloseSource: row.adjusted_close_source,
    adjustedCloseFetchedAt: row.adjusted_close_fetched_at,
    providerSymbol: row.provider_symbol,
    providerExchange: row.provider_exchange,
    fetchedAt: row.fetched_at,
    source: row.source,
  }));
  const adjusted = admitAdjustedHistoricalPriceRows(candidates);
  const raw = admitSharedKisRawHistoricalPriceRows(candidates);
  const preferred = selectPreferredPrivateHistoricalPriceRows({
    adjustedRows: adjusted.rows,
    privateRawRows: raw.rows,
  });
  const bases = new Set(preferred.rows.map((row) => row.priceBasis));
  const selectedBasis = bases.size === 1 ? [...bases][0] : null;
  const priceBasis =
    selectedBasis === "provider_adjusted_close"
      ? "provider_adjusted_close"
      : selectedBasis === "private_kis_raw_close"
        ? "kis_raw_close"
        : "unavailable";
  const rows = preferred.rows.map(({ row }) => ({
    priceDate: row.priceDate,
    adjustedClose:
      priceBasis === "kis_raw_close"
        ? number(row.closePrice)
        : number(row.adjustedClosePrice),
  }));

  return {
    rows,
    priceBasis,
    adjustedAdmittedRows: adjusted.rows.length,
    privateRawAdmittedRows: raw.rows.length,
  };
}

function distribution(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
