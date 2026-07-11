export const INVESTMENT_LAB_MEASUREMENT_BOUNDARY = Object.freeze({
  measuredValue: "invested_positions_only",
  cashIncluded: false,
  buy: "invested_boundary_inflow",
  sell: "invested_boundary_outflow",
  deposit: "cash_ledger_only",
  withdrawal: "cash_ledger_only",
  assetAdded: "position_metadata",
  assetRemoved: "position_metadata",
} as const);

export type InvestmentLabEventClassification =
  | "invested_boundary_flow"
  | "cash_ledger_only"
  | "position_metadata"
  | "unsupported";

export type InvestmentLabFlowDirection = "inflow" | "outflow";

export function classifyInvestmentLabEvent(input: {
  eventType: string;
  amountResolved: boolean;
  isCorrection?: boolean;
}) {
  const eventType = String(input.eventType ?? "").trim().toLowerCase();

  if (input.isCorrection) {
    return classification(
      eventType,
      "unsupported",
      null,
      false,
      "correction_policy_required",
    );
  }

  if (eventType === "buy" || eventType === "sell") {
    if (!input.amountResolved) {
      return classification(
        eventType,
        "unsupported",
        null,
        false,
        "amount_unresolved",
      );
    }
    return classification(
      eventType,
      "invested_boundary_flow",
      eventType === "buy" ? "inflow" : "outflow",
      true,
      "invested_positions_exclude_cash",
    );
  }

  if (eventType === "deposit" || eventType === "withdrawal") {
    return classification(
      eventType,
      "cash_ledger_only",
      null,
      false,
      "cash_outside_v1_measurement_boundary",
    );
  }

  if (eventType === "asset_added" || eventType === "asset_removed") {
    return classification(
      eventType,
      "position_metadata",
      null,
      false,
      "not_a_trade_notional",
    );
  }

  return classification(
    eventType || "unknown",
    "unsupported",
    null,
    false,
    "event_type_unsupported",
  );
}

function classification(
  eventType: string,
  category: InvestmentLabEventClassification,
  direction: InvestmentLabFlowDirection | null,
  includedInV1: boolean,
  reason: string,
) {
  return Object.freeze({
    eventType,
    category,
    direction,
    includedInV1,
    reason,
  });
}
