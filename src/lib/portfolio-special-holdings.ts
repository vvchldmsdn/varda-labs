import { hasCanonicalPortfolioInstrumentIdentity } from "./portfolio-direct-holdings.ts";
import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";

export const PORTFOLIO_SPECIAL_HOLDINGS_POLICY = Object.freeze({
  version: "special_holdings_coverage_adjustability_v1",
  listedIdentity: "account_market_currency_ticker",
  managedSleeveEvidence: "explicit_asset_type_only",
  nameInference: "forbidden",
  adjustmentAuthority: "read_only_eligibility_evidence",
} as const);

export type PortfolioHoldingClassification =
  | "listed_instrument"
  | "physical_commodity_position"
  | "managed_sleeve"
  | "unresolved";

export type PortfolioHoldingValuationStatus =
  | "valued"
  | "missing_price"
  | "missing_fx"
  | "unsupported_currency";

export type PortfolioHoldingAdjustmentReason =
  | "listed_instrument_ready"
  | "valuation_evidence_incomplete"
  | "physical_commodity_execution_model_unavailable"
  | "managed_sleeve_not_directly_adjustable"
  | "instrument_classification_unresolved";

export type PortfolioSpecialHoldingRow = Readonly<{
  key: string;
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  assetType: string | null;
  classification: PortfolioHoldingClassification;
  valuationStatus: PortfolioHoldingValuationStatus;
  currentValueKrw: number | null;
  currentWeightPct: number | null;
  adjustmentEligibility: "eligible" | "ineligible";
  adjustmentReason: PortfolioHoldingAdjustmentReason;
}>;

export type PortfolioSpecialHoldingsModel = Readonly<{
  policy: typeof PORTFOLIO_SPECIAL_HOLDINGS_POLICY;
  selectedAccount: PortfolioStructureResult["selectedAccount"];
  status: "complete" | "review_required" | "unavailable";
  totalPositionCount: number;
  valuedPositionCount: number;
  excludedPositionCount: number;
  adjustablePositionCount: number;
  ineligiblePositionCount: number;
  listedInstrumentCount: number;
  physicalCommodityPositionCount: number;
  managedSleeveCount: number;
  unresolvedCount: number;
  adjustableValuedWeightPct: number;
  ineligibleValuedWeightPct: number;
  attentionRows: readonly PortfolioSpecialHoldingRow[];
}>;

const EXPLICIT_MANAGED_ASSET_TYPES = new Set([
  "managed_product",
  "managed_sleeve",
]);

export function buildPortfolioSpecialHoldingsModel(
  portfolio: Pick<
    PortfolioStructureResult,
    "selectedAccount" | "holdingRows" | "exclusions"
  >,
): PortfolioSpecialHoldingsModel {
  const valuedRows = portfolio.holdingRows.map((row, index) =>
    classifyPosition(row, "valued", index),
  );
  const excludedRows = portfolio.exclusions.map((row, index) =>
    classifyPosition(row, row.reason, valuedRows.length + index),
  );
  const rows = [...valuedRows, ...excludedRows];
  const attentionRows = rows
    .filter((row) => row.adjustmentEligibility === "ineligible")
    .sort(compareAttentionRows);
  const adjustableValuedWeightPct = sumWeights(
    valuedRows.filter((row) => row.adjustmentEligibility === "eligible"),
  );
  const ineligibleValuedWeightPct = sumWeights(
    valuedRows.filter((row) => row.adjustmentEligibility === "ineligible"),
  );

  return Object.freeze({
    policy: PORTFOLIO_SPECIAL_HOLDINGS_POLICY,
    selectedAccount: portfolio.selectedAccount,
    status:
      rows.length === 0
        ? "unavailable"
        : attentionRows.length === 0
          ? "complete"
          : "review_required",
    totalPositionCount: rows.length,
    valuedPositionCount: valuedRows.length,
    excludedPositionCount: excludedRows.length,
    adjustablePositionCount: rows.length - attentionRows.length,
    ineligiblePositionCount: attentionRows.length,
    listedInstrumentCount: countClassification(rows, "listed_instrument"),
    physicalCommodityPositionCount: countClassification(
      rows,
      "physical_commodity_position",
    ),
    managedSleeveCount: countClassification(rows, "managed_sleeve"),
    unresolvedCount: countClassification(rows, "unresolved"),
    adjustableValuedWeightPct,
    ineligibleValuedWeightPct,
    attentionRows: Object.freeze(attentionRows),
  });
}

function classifyPosition(
  row: PortfolioStructureHoldingRow | PortfolioStructureExclusion,
  valuationStatus: PortfolioHoldingValuationStatus,
  index: number,
): PortfolioSpecialHoldingRow {
  const classification = classifyHolding(row);
  const valuationComplete = valuationStatus === "valued";
  const adjustmentEligibility =
    classification === "listed_instrument" && valuationComplete
      ? "eligible"
      : "ineligible";

  return Object.freeze({
    key: [
      String(index),
      row.account.trim().toLowerCase(),
      row.market.trim().toLowerCase(),
      row.currency.trim().toUpperCase(),
      row.ticker?.trim().toUpperCase() ?? "tickerless",
    ]
      .map((part) => encodeURIComponent(part))
      .join("|"),
    name: row.name,
    ticker: row.ticker,
    account: row.account,
    market: row.market,
    currency: row.currency,
    assetType: row.assetType,
    classification,
    valuationStatus,
    currentValueKrw:
      valuationStatus === "valued"
        ? (row as PortfolioStructureHoldingRow).currentValueKrw
        : null,
    currentWeightPct:
      valuationStatus === "valued"
        ? (row as PortfolioStructureHoldingRow).currentWeightPct
        : null,
    adjustmentEligibility,
    adjustmentReason: adjustmentReason(classification, valuationComplete),
  });
}

function classifyHolding(
  row: Pick<
    PortfolioStructureHoldingRow,
    "account" | "market" | "currency" | "ticker" | "assetType"
  >,
): PortfolioHoldingClassification {
  const assetType = row.assetType?.trim().toLowerCase() ?? "";
  if (EXPLICIT_MANAGED_ASSET_TYPES.has(assetType)) return "managed_sleeve";
  if (hasCanonicalPortfolioInstrumentIdentity(row)) {
    return "listed_instrument";
  }
  if (assetType === "commodity") return "physical_commodity_position";
  return "unresolved";
}

function adjustmentReason(
  classification: PortfolioHoldingClassification,
  valuationComplete: boolean,
): PortfolioHoldingAdjustmentReason {
  if (classification === "listed_instrument") {
    return valuationComplete
      ? "listed_instrument_ready"
      : "valuation_evidence_incomplete";
  }
  if (classification === "physical_commodity_position") {
    return "physical_commodity_execution_model_unavailable";
  }
  if (classification === "managed_sleeve") {
    return "managed_sleeve_not_directly_adjustable";
  }
  return "instrument_classification_unresolved";
}

function countClassification(
  rows: readonly PortfolioSpecialHoldingRow[],
  classification: PortfolioHoldingClassification,
) {
  return rows.filter((row) => row.classification === classification).length;
}

function sumWeights(rows: readonly PortfolioSpecialHoldingRow[]) {
  return rows.reduce(
    (total, row) => total + (row.currentWeightPct ?? 0),
    0,
  );
}

function compareAttentionRows(
  left: PortfolioSpecialHoldingRow,
  right: PortfolioSpecialHoldingRow,
) {
  return (
    left.classification.localeCompare(right.classification) ||
    left.account.localeCompare(right.account) ||
    left.name.localeCompare(right.name) ||
    left.key.localeCompare(right.key)
  );
}
