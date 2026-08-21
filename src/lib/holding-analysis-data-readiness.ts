import {
  admitPrivateSingleTenantRawTrendEvidenceRows,
  type RawHistoricalPriceConsumerEvidenceRow,
} from "./market-data/asset-price-consumer-admission.ts";
import {
  mapRiskEvidenceDateToServiceDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";
import { resolveDecisionSupportSpecialHolding } from "./portfolio-analysis-special-holding-authority.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import { buildPrivateOwnerRawHistory } from "./simulation-private-owner-raw-history.ts";
import type { SimulationReturnMatrixFxInput } from "./simulation-return-matrix.ts";

export const HOLDING_ANALYSIS_DATA_READINESS_POLICY = Object.freeze({
  version: "holding_analysis_data_readiness_v1",
  priceBasis: "stored_kis_raw_close",
  simulationReturnStepCount: 90,
  simulationObservationCount: 91,
  trendObservationCount: 120,
  freshnessMaximumCalendarDays: 7,
  providerCallsDuringRead: "forbidden",
  missingValueImputation: "forbidden",
  physicalCommodityHistory: "manual_only",
  managedSleeveHistory: "excluded",
} as const);

export type HoldingAnalysisDataCandidate = Readonly<{
  holdingId: string;
  accountCode: string;
  name: string;
  ticker: string | null;
  assetType: string | null;
  market: string;
  currency: string;
}>;

export type HoldingAnalysisDataReadiness = Readonly<{
  holdingId: string;
  state: "ready" | "limited" | "missing" | "blocked" | "unsupported";
  reason:
    | "analysis_inputs_ready"
    | "trend_history_incomplete"
    | "simulation_history_incomplete"
    | "latest_close_stale"
    | "stored_history_missing"
    | "historical_evidence_conflict"
    | "private_owner_scope_not_established"
    | "manual_history_required"
    | "managed_sleeve_excluded"
    | "instrument_identity_unresolved"
    | "provider_market_unsupported";
  observationCount: number;
  simulationReady: boolean;
  trendReady: boolean;
  latestSourceDate: string | null;
  latestServiceDate: string | null;
  freshnessDays: number | null;
  canPrepare: boolean;
  policy: typeof HOLDING_ANALYSIS_DATA_READINESS_POLICY;
}>;

export type HoldingAnalysisDataPreparationActionState = Readonly<{
  status:
    | "idle"
    | "success"
    | "already_ready"
    | "busy"
    | "invalid"
    | "unauthorized"
    | "conflict"
    | "error";
  message: string | null;
  retryAfterSeconds?: number;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGED_ASSET_TYPES = new Set(["managed_product", "managed_sleeve"]);

export function buildHoldingAnalysisDataReadiness(input: {
  holding: HoldingAnalysisDataCandidate;
  serviceDate: string;
  requestedOwnerUserId: string;
  activeOwnerUserIds: readonly string[];
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}): HoldingAnalysisDataReadiness {
  const classification = classifyHolding(input.holding);
  const unsupported = unsupportedReason(input.holding, classification);
  if (unsupported) {
    return terminalReadiness(input.holding.holdingId, "unsupported", unsupported);
  }

  if (!hasPrivateOwnerScope(input.requestedOwnerUserId, input.activeOwnerUserIds)) {
    return terminalReadiness(
      input.holding.holdingId,
      "blocked",
      "private_owner_scope_not_established",
    );
  }

  const matchingRows = input.priceRows.filter((row) =>
    matchesHolding(row, input.holding),
  );
  if (matchingRows.length === 0) {
    return terminalReadiness(
      input.holding.holdingId,
      "missing",
      "stored_history_missing",
      true,
    );
  }

  const admission = admitPrivateSingleTenantRawTrendEvidenceRows({
    rows: matchingRows,
    requestedOwnerUserId: input.requestedOwnerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
  });
  if (admission.status !== "ready") {
    return terminalReadiness(
      input.holding.holdingId,
      "blocked",
      "historical_evidence_conflict",
    );
  }

  const admittedRows = [...admission.rows].sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
  const observationCount = new Set(admittedRows.map((row) => row.priceDate)).size;
  const latestSourceDate = admittedRows.at(-1)?.priceDate ?? null;
  const latestServiceDate = latestSourceDate
    ? mapRiskEvidenceDateToServiceDate(latestSourceDate)
    : null;
  const freshnessDays = latestServiceDate
    ? Math.max(0, riskCalendarDayDistance(latestServiceDate, input.serviceDate))
    : null;
  const trendReady =
    observationCount >= HOLDING_ANALYSIS_DATA_READINESS_POLICY.trendObservationCount;
  const history = buildPrivateOwnerRawHistory({
    requestedOwnerUserId: input.requestedOwnerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
    requestedEndServiceDate: latestServiceDate ?? input.serviceDate,
    returnStepCount:
      HOLDING_ANALYSIS_DATA_READINESS_POLICY.simulationReturnStepCount,
    instruments: [
      {
        instrumentKey: instrumentKey(input.holding),
        market: normalizeMarket(input.holding.market),
        currency: normalizeCurrency(input.holding.currency) as "KRW" | "USD",
        ticker: normalizeTicker(input.holding.ticker)!,
        classification,
        weightBps: 10_000,
      },
    ],
    priceRows: admittedRows,
    fxRows: input.fxRows,
  });
  const simulationReady = history.status === "ready";
  const fresh =
    freshnessDays !== null &&
    freshnessDays <=
      HOLDING_ANALYSIS_DATA_READINESS_POLICY.freshnessMaximumCalendarDays;
  const state = simulationReady && trendReady && fresh ? "ready" : "limited";
  const reason = !fresh
    ? "latest_close_stale"
    : !simulationReady
      ? "simulation_history_incomplete"
      : !trendReady
        ? "trend_history_incomplete"
        : "analysis_inputs_ready";

  return Object.freeze({
    holdingId: input.holding.holdingId,
    state,
    reason,
    observationCount,
    simulationReady,
    trendReady,
    latestSourceDate,
    latestServiceDate,
    freshnessDays,
    canPrepare: state !== "ready",
    policy: HOLDING_ANALYSIS_DATA_READINESS_POLICY,
  });
}

export function parseHoldingAnalysisDataPreparationInput(formData: FormData) {
  const value = formData.get("holdingId");
  const holdingId = typeof value === "string" ? value.trim() : "";
  return UUID_PATTERN.test(holdingId)
    ? Object.freeze({ ok: true as const, holdingId })
    : Object.freeze({
        ok: false as const,
        message: "보유종목 식별자가 올바르지 않습니다.",
      });
}

export function evaluateHoldingAnalysisDataCooldown(input: {
  now: Date;
  lastActivityAt: Date | null;
  cooldownSeconds: number;
}) {
  if (!input.lastActivityAt) {
    return Object.freeze({ ready: true as const, retryAfterSeconds: 0 });
  }
  const elapsedSeconds = Math.floor(
    (input.now.getTime() - input.lastActivityAt.getTime()) / 1_000,
  );
  const retryAfterSeconds = Math.max(0, input.cooldownSeconds - elapsedSeconds);
  return Object.freeze({
    ready: retryAfterSeconds === 0,
    retryAfterSeconds,
  });
}

function terminalReadiness(
  holdingId: string,
  state: HoldingAnalysisDataReadiness["state"],
  reason: HoldingAnalysisDataReadiness["reason"],
  canPrepare = false,
): HoldingAnalysisDataReadiness {
  return Object.freeze({
    holdingId,
    state,
    reason,
    observationCount: 0,
    simulationReady: false,
    trendReady: false,
    latestSourceDate: null,
    latestServiceDate: null,
    freshnessDays: null,
    canPrepare,
    policy: HOLDING_ANALYSIS_DATA_READINESS_POLICY,
  });
}

function classifyHolding(
  holding: HoldingAnalysisDataCandidate,
): PortfolioHoldingClassification {
  const assetType = holding.assetType?.trim().toLowerCase() ?? "";
  if (MANAGED_ASSET_TYPES.has(assetType)) return "managed_sleeve";
  const specialHolding = resolveDecisionSupportSpecialHolding({
    assetName: holding.name,
    account: holding.accountCode,
    market: holding.market,
    currency: holding.currency,
    assetType: holding.assetType,
  });
  if (specialHolding === "fount") return "managed_sleeve";
  if (specialHolding === "krxGold") return "physical_commodity_position";
  if (assetType === "commodity") return "physical_commodity_position";
  if (
    holding.accountCode.trim() &&
    holding.market.trim() &&
    holding.currency.trim() &&
    normalizeTicker(holding.ticker)
  ) {
    return "listed_instrument";
  }
  return "unresolved";
}

function unsupportedReason(
  holding: HoldingAnalysisDataCandidate,
  classification: PortfolioHoldingClassification,
): HoldingAnalysisDataReadiness["reason"] | null {
  if (classification === "managed_sleeve") return "managed_sleeve_excluded";
  if (classification === "physical_commodity_position") {
    return "manual_history_required";
  }
  if (classification !== "listed_instrument") {
    return "instrument_identity_unresolved";
  }
  const identity = `${normalizeMarket(holding.market)}/${normalizeCurrency(holding.currency)}`;
  return identity === "korea/KRW" || identity === "us/USD"
    ? null
    : "provider_market_unsupported";
}

function hasPrivateOwnerScope(
  requestedOwnerUserId: string,
  activeOwnerUserIds: readonly string[],
) {
  const requested = requestedOwnerUserId.trim().toLowerCase();
  const active = [
    ...new Set(activeOwnerUserIds.map((value) => value.trim().toLowerCase())),
  ];
  return requested.length > 0 && active.length === 1 && active[0] === requested;
}

function matchesHolding(
  row: Pick<
    RawHistoricalPriceConsumerEvidenceRow,
    "market" | "currency" | "ticker"
  >,
  holding: HoldingAnalysisDataCandidate,
) {
  return (
    normalizeMarket(row.market) === normalizeMarket(holding.market) &&
    normalizeCurrency(row.currency) === normalizeCurrency(holding.currency) &&
    normalizeTicker(row.ticker) === normalizeTicker(holding.ticker)
  );
}

function instrumentKey(holding: HoldingAnalysisDataCandidate) {
  return [
    normalizeMarket(holding.market),
    normalizeCurrency(holding.currency),
    normalizeTicker(holding.ticker),
  ].join("|");
}

function normalizeMarket(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function normalizeTicker(value: string | null) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}
