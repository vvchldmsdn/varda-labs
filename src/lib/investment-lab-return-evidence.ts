import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";

const TRACKED_ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"] as const);

export const INVESTMENT_LAB_RETURN_EVIDENCE_POLICY = Object.freeze({
  version: "position_return_evidence_v1",
  snapshotCash: "zero_required_until_cash_semantics_versioned",
  cashLedgerEvents: "outside_invested_position_boundary",
  positionMetadata:
    "allowed_only_without_amount_quantity_price_or_fx_payload",
  unsupportedEconomicEvents: "fail_closed",
} as const);

export type InvestmentLabReturnEvidenceSnapshot = Readonly<{
  snapshotDate: string;
  account: string;
  cashValue: string | number | null;
}>;

export type InvestmentLabReturnEvidenceEvent = Readonly<{
  eventDate: string;
  eventType: string;
  amountKrw: string | number | null;
  quantityDelta: string | number | null;
  price: string | number | null;
  fxRate: string | number | null;
  isCorrection: boolean;
}>;

export type InvestmentLabReturnEvidenceBlocker =
  | "cash_evidence_unavailable"
  | "nonzero_cash_evidence"
  | "ambiguous_position_metadata_event"
  | "unmodeled_return_event";

export type InvestmentLabReturnEvidenceResult = Readonly<{
  status: "ready" | "blocked";
  policy: typeof INVESTMENT_LAB_RETURN_EVIDENCE_POLICY;
  cashEvidenceRows: number;
  nonzeroCashRows: number;
  cashLedgerEventRows: number;
  positionMetadataEventRows: number;
  ambiguousPositionMetadataRows: number;
  unmodeledEventRows: number;
  blockers: readonly InvestmentLabReturnEvidenceBlocker[];
}>;

export function validateInvestmentLabReturnEvidence(input: {
  serviceDates: readonly string[];
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
}): InvestmentLabReturnEvidenceResult {
  const blockers = new Set<InvestmentLabReturnEvidenceBlocker>();
  const serviceDates = input.serviceDates.filter(isRiskDate);
  const serviceDateSet = new Set(serviceDates);
  const startServiceDate = serviceDates[0] ?? null;
  const endServiceDate = serviceDates.at(-1) ?? null;
  const namedCashRows = new Map<string, number>();
  let cashEvidenceRows = 0;
  let nonzeroCashRows = 0;

  if (
    serviceDates.length !== input.serviceDates.length ||
    serviceDates.length < 2 ||
    new Set(serviceDates).size !== serviceDates.length ||
    serviceDates.some(
      (date, index) => index > 0 && serviceDates[index - 1] >= date,
    )
  ) {
    blockers.add("cash_evidence_unavailable");
  }

  for (const row of input.snapshotRows) {
    const account = String(row.account ?? "").trim().toLowerCase();
    if (
      !serviceDateSet.has(row.snapshotDate) ||
      !TRACKED_ACCOUNTS.includes(
        account as (typeof TRACKED_ACCOUNTS)[number],
      )
    ) {
      continue;
    }

    const key = `${row.snapshotDate}|${account}`;
    namedCashRows.set(key, (namedCashRows.get(key) ?? 0) + 1);
    const cashValue = finiteNumber(row.cashValue);
    if (cashValue === null) {
      blockers.add("cash_evidence_unavailable");
      continue;
    }
    cashEvidenceRows += 1;
    if (Math.abs(cashValue) > 1e-8) {
      nonzeroCashRows += 1;
      blockers.add("nonzero_cash_evidence");
    }
  }

  for (const serviceDate of serviceDates) {
    for (const account of TRACKED_ACCOUNTS) {
      if (namedCashRows.get(`${serviceDate}|${account}`) !== 1) {
        blockers.add("cash_evidence_unavailable");
      }
    }
  }

  let cashLedgerEventRows = 0;
  let positionMetadataEventRows = 0;
  let ambiguousPositionMetadataRows = 0;
  let unmodeledEventRows = 0;

  if (startServiceDate && endServiceDate) {
    for (const row of input.eventRows) {
      if (!isRiskDate(row.eventDate)) {
        unmodeledEventRows += 1;
        blockers.add("unmodeled_return_event");
        continue;
      }

      const effectiveServiceDate = mapRiskEvidenceDateToServiceDate(
        row.eventDate,
      );
      if (
        effectiveServiceDate <= startServiceDate ||
        effectiveServiceDate > endServiceDate
      ) {
        continue;
      }

      const eventType = String(row.eventType ?? "").trim().toLowerCase();
      if (row.isCorrection) {
        unmodeledEventRows += 1;
        blockers.add("unmodeled_return_event");
      } else if (eventType === "buy" || eventType === "sell") {
        continue;
      } else if (eventType === "deposit" || eventType === "withdrawal") {
        cashLedgerEventRows += 1;
      } else if (
        eventType === "asset_added" ||
        eventType === "asset_removed"
      ) {
        positionMetadataEventRows += 1;
        if (hasFinancialPayload(row)) {
          ambiguousPositionMetadataRows += 1;
          blockers.add("ambiguous_position_metadata_event");
        }
      } else {
        unmodeledEventRows += 1;
        blockers.add("unmodeled_return_event");
      }
    }
  }

  return Object.freeze({
    status: blockers.size === 0 ? "ready" : "blocked",
    policy: INVESTMENT_LAB_RETURN_EVIDENCE_POLICY,
    cashEvidenceRows,
    nonzeroCashRows,
    cashLedgerEventRows,
    positionMetadataEventRows,
    ambiguousPositionMetadataRows,
    unmodeledEventRows,
    blockers: Object.freeze([...blockers].sort()),
  });
}

function hasFinancialPayload(row: InvestmentLabReturnEvidenceEvent) {
  return [row.amountKrw, row.quantityDelta, row.price, row.fxRate].some(
    (value) => {
      if (value === null || value === "") return false;
      const parsed = Number(value);
      return !Number.isFinite(parsed) || Math.abs(parsed) > 1e-8;
    },
  );
}

function finiteNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
