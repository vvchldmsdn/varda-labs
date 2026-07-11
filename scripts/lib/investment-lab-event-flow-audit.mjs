import {
  classifyInvestmentLabEvent,
  INVESTMENT_LAB_MEASUREMENT_BOUNDARY,
} from "../../src/lib/investment-lab-event-flow.ts";
import {
  INVESTMENT_LAB_EXECUTION_POLICY,
  scheduleInvestmentLabBoundaryFlows,
} from "../../src/lib/investment-lab-execution-schedule.ts";

export function auditInvestmentLabEventFlowEvidence({
  eventRows,
  closeRows,
  snapshot,
}) {
  const classified = eventRows.map((row) => ({
    row,
    classification: classifyInvestmentLabEvent({
      eventType: row.event_type,
      amountResolved: row.amount_resolved,
      isCorrection: row.is_correction,
    }),
  }));
  const eligible = classified.filter(
    ({ classification }) => classification.includedInV1,
  );
  const closes = closeRows.map((row) => ({
    priceDate: row.price_date,
    adjustedClose: number(row.adjusted_close_price),
  }));
  const windowEndPriceDate = closes.at(-1)?.priceDate ?? "invalid";
  const schedule = scheduleInvestmentLabBoundaryFlows({
    events: eligible.map(({ row, classification }) => ({
      eventDate: row.event_date,
      sequence: number(row.sequence),
      direction: classification.direction,
      amountKrw: number(row.resolved_amount_krw),
      amountProvenance: row.amount_provenance,
    })),
    closes,
    windowEndPriceDate,
  });

  return {
    audit: "investment_lab_event_flow_and_execution_semantics",
    status: "passed",
    readOnly: true,
    measurementBoundary: INVESTMENT_LAB_MEASUREMENT_BOUNDARY,
    executionPolicy: INVESTMENT_LAB_EXECUTION_POLICY,
    events: {
      rowCount: eventRows.length,
      typeDistribution: typeDistribution(classified),
      classificationDistribution: classificationDistribution(classified),
      eligibleBoundaryFlowRows: eligible.length,
      unresolvedBoundaryFlowRows: classified.filter(
        ({ classification }) => classification.reason === "amount_unresolved",
      ).length,
      correctionRows: classified.filter(({ row }) => row.is_correction).length,
      amountProvenanceDistribution: distribution(
        eligible.map(({ row }) => row.amount_provenance ?? "unresolved"),
      ),
    },
    snapshots: {
      rowCount: number(snapshot.row_count),
      nonzeroCashRows: number(snapshot.nonzero_cash_rows),
      positiveMarketValueRows: number(snapshot.positive_market_value_rows),
    },
    kodex200Execution: {
      priceRows: closes.length,
      priceStartDate: closes[0]?.priceDate ?? null,
      priceEndDate: closes.at(-1)?.priceDate ?? null,
      status: schedule.status,
      scheduledRows: schedule.scheduledFlows.length,
      sameDayRows: schedule.sameDayFlowCount,
      pendingRows: schedule.pendingFlowCount,
      blockerCounts: countReasons(schedule.blockers),
    },
    boundaries: {
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      routesEnabled: 0,
    },
  };
}

function typeDistribution(rows) {
  const counts = new Map();
  for (const { row } of rows) {
    counts.set(row.event_type, (counts.get(row.event_type) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function classificationDistribution(rows) {
  const counts = new Map();
  for (const { classification } of rows) {
    counts.set(
      classification.category,
      (counts.get(classification.category) ?? 0) + 1,
    );
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
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
