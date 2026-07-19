import {
  KRX_GOLD_ACTIVE_VALUATION_POLICY,
  KRX_GOLD_CLOSE_ONLY_CONTRACT,
} from "./instrument-identity.ts";

const IMPORTED_SNAPSHOT_SOURCE = "base44_import";

export const DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS = Object.freeze({
  version: "legacy_imported_special_holding_decisions_v1",
  authority: "product_owner_review_2026_07_16",
  scope: Object.freeze(["investment_lab", "simulation"]),
  decisions: Object.freeze({
    krxGold: Object.freeze({
      assetName: "금현물",
      account: "brokerage",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
      productKey: KRX_GOLD_CLOSE_ONLY_CONTRACT.identityBinding.productKey,
      outcome: "manual_valuation_history_required",
    }),
    fount: Object.freeze({
      assetName: "Fount 일임서비스",
      account: "irp",
      market: "korea",
      currency: "KRW",
      assetType: "etf",
      outcome: "intentionally_excluded",
    }),
  }),
} as const);

const PERMANENTLY_UNSUPPORTED_ASSET_TYPES = new Set([
  "fixed_deposit",
  "housing_subscription",
  "savings",
]);

export const INVESTMENT_LAB_SPECIAL_HOLDING_AUTHORITY_POLICY = Object.freeze({
  version: "investment_lab_special_holding_authority_v1",
  importedTickerAuthority:
    "same_legacy_identity_base44_snapshot_metadata_consensus",
  currentAssetFallback: "forbidden",
  currentValuation:
    KRX_GOLD_ACTIVE_VALUATION_POLICY.currentValuation.mode,
  currentPriceFallback: "forbidden_for_historical_backcast",
  manualValuationHistory: "admit_explicit_observations_only",
  nameInference: "forbidden",
  partialBasket: "forbidden",
  productOwnerDecisionBinding:
    "exact_name_account_market_currency_asset_type",
  exclusionApplication: "blocked_until_scope_consistent_path_transform",
} as const);

export type InvestmentLabImportedIdentityRow = Readonly<{
  identityKey: string | null;
  snapshotDate: string;
  source: string | null;
  ticker: string | null;
  assetName: string | null;
  account: string;
  market: string | null;
  currency: string | null;
  assetType: string | null;
}>;

export type InvestmentLabImportedTickerEvidence = Readonly<{
  authority: "base44_imported_daily_position_snapshot_consensus";
  status: "resolved" | "unavailable" | "conflict";
  ticker: string | null;
  evidenceRowCount: number;
  reason:
    | "consensus"
    | "no_imported_ticker_evidence"
    | "metadata_mismatch"
    | "conflicting_imported_tickers";
}>;

export type InvestmentLabSpecialHoldingAuthorityOutcome =
  | "eligible_historical_instrument"
  | "manual_valuation_history_required"
  | "separate_valuation_model_required"
  | "intentionally_excluded"
  | "permanently_unsupported";

export type InvestmentLabAnchorSpecialHoldingEvidence = Readonly<{
  name: string;
  account: string;
  source: string | null;
  market: string | null;
  currency: string | null;
  assetType: string | null;
  classification:
    | "stored_listed_instrument"
    | "physical_commodity_position"
    | "product_owner_excluded"
    | "unresolved"
    | "unsupported_non_investment_position";
  identityStatus: "resolved" | "unavailable" | "not_required";
  resolvedTicker: string | null;
  resolvedProductKey: string | null;
  identityAuthority:
    | "base44_imported_snapshot_ticker_consensus"
    | "broker_statement_and_krx_product_definition"
    | "product_owner_scope_decision"
    | "explicit_snapshot_asset_type"
    | "none";
  historicalAuthorityOutcome: InvestmentLabSpecialHoldingAuthorityOutcome;
  historicalCoverageStatus: "not_evaluated" | "blocked" | "not_required";
  evidenceRowCount: number;
  reason:
    | "stored_snapshot_ticker_recovered"
    | "stored_snapshot_ticker_conflict"
    | "stored_snapshot_metadata_mismatch"
    | "manual_valuation_history_required"
    | "instrument_keyed_official_close_required"
    | "product_owner_excluded_from_decision_support"
    | "explicit_product_classification_required"
    | "non_investment_asset_type_unsupported";
}>;

export type InvestmentLabSpecialHoldingIdentityInput = Readonly<{
  ticker: string | null;
  assetName: string | null;
  account: string;
  source: string | null;
  market: string | null;
  currency: string | null;
  assetType: string | null;
  importedTickerEvidence?: InvestmentLabImportedTickerEvidence | null;
}>;

type ImportedTickerGroup = {
  tickers: Set<string>;
  rowsByMetadata: Map<string, { tickers: Set<string>; rowCount: number }>;
  tickerRowCount: number;
};

export function attachBase44ImportedTickerEvidence<
  T extends InvestmentLabImportedIdentityRow,
>(rows: readonly T[]): readonly (T & {
  importedTickerEvidence: InvestmentLabImportedTickerEvidence | null;
})[] {
  const groups = new Map<string, ImportedTickerGroup>();

  for (const row of rows) {
    const identityKey = normalizeText(row.identityKey);
    const source = normalizeText(row.source)?.toLowerCase() ?? null;
    const ticker = normalizeText(row.ticker)?.toUpperCase() ?? null;
    if (!identityKey || source !== IMPORTED_SNAPSHOT_SOURCE || !ticker) continue;

    const group = groups.get(identityKey) ?? {
      tickers: new Set<string>(),
      rowsByMetadata: new Map(),
      tickerRowCount: 0,
    };
    const metadataKey = importedMetadataKey(row);
    const metadataRows = group.rowsByMetadata.get(metadataKey) ?? {
      tickers: new Set<string>(),
      rowCount: 0,
    };
    group.tickers.add(ticker);
    group.tickerRowCount += 1;
    metadataRows.tickers.add(ticker);
    metadataRows.rowCount += 1;
    group.rowsByMetadata.set(metadataKey, metadataRows);
    groups.set(identityKey, group);
  }

  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        ...row,
        importedTickerEvidence: resolveImportedTickerEvidence(groups, row),
      }),
    ),
  );
}

export function resolveInvestmentLabSpecialHoldingIdentity(
  row: InvestmentLabSpecialHoldingIdentityInput,
): Readonly<{
  ticker: string | null;
  specialHoldingEvidence: InvestmentLabAnchorSpecialHoldingEvidence | null;
}> {
  const storedTicker = normalizeText(row.ticker)?.toUpperCase() ?? null;
  if (storedTicker) {
    return Object.freeze({ ticker: storedTicker, specialHoldingEvidence: null });
  }

  const name = normalizeText(row.assetName) ?? "이름 없는 저장 포지션";
  const account = normalizeText(row.account)?.toLowerCase() ?? "unknown";
  const source = normalizeText(row.source);
  const market = normalizeText(row.market)?.toLowerCase() ?? null;
  const currency = normalizeText(row.currency)?.toUpperCase() ?? null;
  const assetType = normalizeText(row.assetType)?.toLowerCase() ?? null;
  const imported = row.importedTickerEvidence ?? null;

  if (imported?.status === "resolved" && imported.ticker) {
    return Object.freeze({
      ticker: imported.ticker,
      specialHoldingEvidence: Object.freeze({
        name,
        account,
        source,
        market,
        currency,
        assetType,
        classification: "stored_listed_instrument",
        identityStatus: "resolved",
        resolvedTicker: imported.ticker,
        resolvedProductKey: null,
        identityAuthority: "base44_imported_snapshot_ticker_consensus",
        historicalAuthorityOutcome: "eligible_historical_instrument",
        historicalCoverageStatus: "not_evaluated",
        evidenceRowCount: imported.evidenceRowCount,
        reason: "stored_snapshot_ticker_recovered",
      }),
    });
  }

  const common = {
    name,
    account,
    source,
    market,
    currency,
    assetType,
    evidenceRowCount: imported?.evidenceRowCount ?? 0,
  };

  if (matchesApprovedDecision(row, "fount")) {
    return Object.freeze({
      ticker: null,
      specialHoldingEvidence: Object.freeze({
        ...common,
        classification: "product_owner_excluded",
        identityStatus: "not_required",
        resolvedTicker: null,
        resolvedProductKey: null,
        identityAuthority: "product_owner_scope_decision",
        historicalAuthorityOutcome: "intentionally_excluded",
        historicalCoverageStatus: "not_required",
        reason: "product_owner_excluded_from_decision_support",
      }),
    });
  }

  if (matchesApprovedDecision(row, "krxGold")) {
    return Object.freeze({
      ticker: null,
      specialHoldingEvidence: Object.freeze({
        ...common,
        classification: "physical_commodity_position",
        identityStatus: "resolved",
        resolvedTicker: null,
        resolvedProductKey:
          DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold
            .productKey,
        identityAuthority: "broker_statement_and_krx_product_definition",
        historicalAuthorityOutcome: "manual_valuation_history_required",
        historicalCoverageStatus: "blocked",
        reason: "manual_valuation_history_required",
      }),
    });
  }

  if (assetType === "commodity") {
    return Object.freeze({
      ticker: null,
      specialHoldingEvidence: Object.freeze({
        ...common,
        classification: "physical_commodity_position",
        identityStatus: "unavailable",
        resolvedTicker: null,
        resolvedProductKey: null,
        identityAuthority: "explicit_snapshot_asset_type",
        historicalAuthorityOutcome: "separate_valuation_model_required",
        historicalCoverageStatus: "blocked",
        reason: "instrument_keyed_official_close_required",
      }),
    });
  }

  if (assetType && PERMANENTLY_UNSUPPORTED_ASSET_TYPES.has(assetType)) {
    return Object.freeze({
      ticker: null,
      specialHoldingEvidence: Object.freeze({
        ...common,
        classification: "unsupported_non_investment_position",
        identityStatus: "unavailable",
        resolvedTicker: null,
        resolvedProductKey: null,
        identityAuthority: "explicit_snapshot_asset_type",
        historicalAuthorityOutcome: "permanently_unsupported",
        historicalCoverageStatus: "blocked",
        reason: "non_investment_asset_type_unsupported",
      }),
    });
  }

  return Object.freeze({
    ticker: null,
    specialHoldingEvidence: Object.freeze({
      ...common,
      classification: "unresolved",
      identityStatus: "unavailable",
      resolvedTicker: null,
      resolvedProductKey: null,
      identityAuthority: "none",
      historicalAuthorityOutcome: "separate_valuation_model_required",
      historicalCoverageStatus: "blocked",
      reason:
        imported?.reason === "conflicting_imported_tickers"
          ? "stored_snapshot_ticker_conflict"
          : imported?.reason === "metadata_mismatch"
            ? "stored_snapshot_metadata_mismatch"
            : "explicit_product_classification_required",
    }),
  });
}

function matchesApprovedDecision(
  row: InvestmentLabSpecialHoldingIdentityInput,
  decisionKey: keyof typeof DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions,
) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions[decisionKey];
  return (
    normalizeText(row.assetName)?.toLowerCase() ===
      decision.assetName.toLowerCase() &&
    normalizeText(row.account)?.toLowerCase() === decision.account &&
    normalizeText(row.market)?.toLowerCase() === decision.market &&
    normalizeText(row.currency)?.toUpperCase() === decision.currency &&
    normalizeText(row.assetType)?.toLowerCase() === decision.assetType
  );
}

function resolveImportedTickerEvidence(
  groups: ReadonlyMap<string, ImportedTickerGroup>,
  row: InvestmentLabImportedIdentityRow,
): InvestmentLabImportedTickerEvidence | null {
  const identityKey = normalizeText(row.identityKey);
  if (!identityKey) return null;
  const group = groups.get(identityKey);
  if (!group) {
    return evidence("unavailable", null, 0, "no_imported_ticker_evidence");
  }
  if (group.tickers.size !== 1) {
    return evidence(
      "conflict",
      null,
      group.tickerRowCount,
      "conflicting_imported_tickers",
    );
  }

  const metadataRows = group.rowsByMetadata.get(importedMetadataKey(row));
  if (!metadataRows || metadataRows.tickers.size !== 1) {
    return evidence(
      "unavailable",
      null,
      group.tickerRowCount,
      "metadata_mismatch",
    );
  }
  return evidence(
    "resolved",
    [...metadataRows.tickers][0] ?? null,
    metadataRows.rowCount,
    "consensus",
  );
}

function evidence(
  status: InvestmentLabImportedTickerEvidence["status"],
  ticker: string | null,
  evidenceRowCount: number,
  reason: InvestmentLabImportedTickerEvidence["reason"],
): InvestmentLabImportedTickerEvidence {
  return Object.freeze({
    authority: "base44_imported_daily_position_snapshot_consensus",
    status,
    ticker,
    evidenceRowCount,
    reason,
  });
}

function importedMetadataKey(row: InvestmentLabImportedIdentityRow) {
  return [
    normalizeText(row.assetName)?.toLowerCase() ?? "",
    normalizeText(row.account)?.toLowerCase() ?? "",
    normalizeText(row.market)?.toLowerCase() ?? "",
    normalizeText(row.currency)?.toUpperCase() ?? "",
    normalizeText(row.assetType)?.toLowerCase() ?? "",
  ].join("\u0000");
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
