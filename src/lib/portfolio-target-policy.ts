import { createHash } from "node:crypto";

import type { PortfolioAnalysisScope } from "./portfolio-analysis-scope.ts";
import { isKrxGoldManualInstrumentCandidate } from "./market-data/manual-asset-price.ts";

export const PORTFOLIO_TARGET_POLICY = Object.freeze({
  version: "portfolio_target_policy_v1",
  authoritySource: "session_user_explicit_v1",
  universeHashVersion: "portfolio_target_universe_sha256_v1",
  vectorHashVersion: "portfolio_target_vector_sha256_v1",
  maximumRowCount: 64,
  targetWeightTotalBps: 10_000,
  explicitZeroRows: "preserved",
  currentAllocationDefault: "editable_starting_point_not_authority",
} as const);

export type PortfolioTargetBuyability =
  | "buyable"
  | "not_buyable"
  | "tickerless"
  | "unsupported_market"
  | "unsupported_currency";

export type PortfolioTargetUniverseInput = Readonly<{
  accountCode: string;
  accountId: string;
  accountName: string;
  assetId: string;
  assetName: string;
  assetType: string | null;
  market: string;
  currency: string;
  ticker: string | null;
  currentValueKrw: number | null;
}>;

export type PortfolioTargetUniverseRow = Readonly<{
  accountCode: string;
  accountId: string;
  accountName: string;
  assetId: string;
  assetName: string;
  assetType: string | null;
  market: string;
  currency: string;
  ticker: string | null;
  buyability: PortfolioTargetBuyability;
  currentValueKrw: number | null;
}>;

export type PortfolioTargetPolicyBlocker =
  | "empty_universe"
  | "too_many_rows"
  | "invalid_universe_row"
  | "duplicate_asset"
  | "invalid_effective_service_date"
  | "decision_set_mismatch"
  | "invalid_target_weight"
  | "positive_target_not_buyable"
  | "target_weight_total_invalid";

export type PortfolioTargetPolicyDecision = Readonly<{
  assetId: string;
  targetWeightBps: number;
}>;

type PortfolioTargetPolicyPersistenceRow = Readonly<{
  accountId: string;
  assetId: string;
  assetName: string;
  market: string;
  currency: string;
  ticker: string | null;
  buyability: PortfolioTargetBuyability;
  targetWeightBps: number;
}>;

export function normalizePortfolioTargetUniverse(
  input: readonly PortfolioTargetUniverseInput[],
) {
  const blockers = new Set<PortfolioTargetPolicyBlocker>();
  if (input.length === 0) blockers.add("empty_universe");
  if (input.length > PORTFOLIO_TARGET_POLICY.maximumRowCount) {
    blockers.add("too_many_rows");
  }

  const seenAssets = new Set<string>();
  const rows = input.map((source) => {
    const row = normalizeUniverseRow(source);
    if (!row) {
      blockers.add("invalid_universe_row");
      return null;
    }
    if (seenAssets.has(row.assetId)) blockers.add("duplicate_asset");
    seenAssets.add(row.assetId);
    return row;
  });

  const normalized = rows
    .filter((row): row is PortfolioTargetUniverseRow => row !== null)
    .toSorted(compareUniverseRows);

  return Object.freeze({
    status: blockers.size === 0 ? ("ready" as const) : ("blocked" as const),
    rows: Object.freeze(normalized),
    blockers: Object.freeze([...blockers].toSorted()),
  });
}

export function buildPortfolioTargetPolicyRecord({
  decisions,
  effectiveServiceDate,
  scope,
  universe,
}: {
  decisions: readonly PortfolioTargetPolicyDecision[];
  effectiveServiceDate: string;
  scope: PortfolioAnalysisScope;
  universe: readonly PortfolioTargetUniverseRow[];
}) {
  const blockers = new Set<PortfolioTargetPolicyBlocker>();
  if (!DATE_PATTERN.test(effectiveServiceDate)) {
    blockers.add("invalid_effective_service_date");
  }
  if (
    universe.length === 0 ||
    universe.length > PORTFOLIO_TARGET_POLICY.maximumRowCount
  ) {
    blockers.add(universe.length === 0 ? "empty_universe" : "too_many_rows");
  }

  const universeByAsset = new Map(universe.map((row) => [row.assetId, row]));
  const decisionsByAsset = new Map<string, number>();
  for (const decision of decisions) {
    if (
      !UUID_PATTERN.test(decision.assetId) ||
      !Number.isSafeInteger(decision.targetWeightBps) ||
      decision.targetWeightBps < 0 ||
      decision.targetWeightBps > PORTFOLIO_TARGET_POLICY.targetWeightTotalBps
    ) {
      blockers.add("invalid_target_weight");
      continue;
    }
    if (decisionsByAsset.has(decision.assetId)) {
      blockers.add("decision_set_mismatch");
      continue;
    }
    decisionsByAsset.set(decision.assetId, decision.targetWeightBps);
  }
  if (
    decisionsByAsset.size !== universeByAsset.size ||
    [...universeByAsset.keys()].some((assetId) => !decisionsByAsset.has(assetId))
  ) {
    blockers.add("decision_set_mismatch");
  }

  const rows = universe.map((row) => {
    const targetWeightBps = decisionsByAsset.get(row.assetId) ?? -1;
    if (targetWeightBps > 0 && row.buyability !== "buyable") {
      blockers.add("positive_target_not_buyable");
    }
    return Object.freeze({ ...row, targetWeightBps });
  });
  const totalWeightBps = rows.reduce(
    (total, row) => total + Math.max(0, row.targetWeightBps),
    0,
  );
  if (totalWeightBps !== PORTFOLIO_TARGET_POLICY.targetWeightTotalBps) {
    blockers.add("target_weight_total_invalid");
  }

  if (blockers.size > 0) {
    return Object.freeze({
      status: "blocked" as const,
      policy: PORTFOLIO_TARGET_POLICY,
      rows: Object.freeze(rows),
      totalWeightBps,
      universeHash: null,
      vectorHash: null,
      blockers: Object.freeze([...blockers].toSorted()),
    });
  }

  const universeHash = createPortfolioTargetUniverseHash({ scope, universe });
  const vectorSerialization = JSON.stringify({
    hashVersion: PORTFOLIO_TARGET_POLICY.vectorHashVersion,
    policyVersion: PORTFOLIO_TARGET_POLICY.version,
    scopeKey: scope.key,
    effectiveServiceDate,
    rows: rows.map((row) => ({
      ...projectUniverseHashRow(row),
      targetWeightBps: row.targetWeightBps,
    })),
  });

  return Object.freeze({
    status: "ready" as const,
    policy: PORTFOLIO_TARGET_POLICY,
    scopeKey: scope.key,
    effectiveServiceDate,
    rows: Object.freeze(rows),
    totalWeightBps,
    universeHash,
    vectorHash: sha256(vectorSerialization),
    blockers: Object.freeze([] as PortfolioTargetPolicyBlocker[]),
  });
}

export function createPortfolioTargetUniverseHash({
  scope,
  universe,
}: {
  scope: PortfolioAnalysisScope;
  universe: readonly PortfolioTargetUniverseRow[];
}) {
  return sha256(
    JSON.stringify({
      hashVersion: PORTFOLIO_TARGET_POLICY.universeHashVersion,
      policyVersion: PORTFOLIO_TARGET_POLICY.version,
      scopeKey: scope.key,
      rows: universe.map(projectUniverseHashRow),
    }),
  );
}

export function buildCurrentAllocationStartingWeights(
  rows: readonly PortfolioTargetUniverseRow[],
) {
  const buyable = rows.filter((row) => row.buyability === "buyable");
  const result = new Map(rows.map((row) => [row.assetId, 0]));
  if (buyable.length === 0) return result;

  const totalValue = buyable.reduce(
    (total, row) =>
      total +
      (row.currentValueKrw !== null && row.currentValueKrw > 0
        ? row.currentValueKrw
        : 0),
    0,
  );
  const ideals = buyable.map((row) => ({
    assetId: row.assetId,
    ideal:
      totalValue > 0
        ? ((row.currentValueKrw ?? 0) / totalValue) *
          PORTFOLIO_TARGET_POLICY.targetWeightTotalBps
        : PORTFOLIO_TARGET_POLICY.targetWeightTotalBps / buyable.length,
  }));
  let assigned = 0;
  for (const row of ideals) {
    const floor = Math.floor(row.ideal);
    result.set(row.assetId, floor);
    assigned += floor;
  }
  const remainderOrder = ideals.toSorted(
    (left, right) =>
      right.ideal - Math.floor(right.ideal) -
        (left.ideal - Math.floor(left.ideal)) ||
      left.assetId.localeCompare(right.assetId),
  );
  for (
    let index = 0;
    assigned < PORTFOLIO_TARGET_POLICY.targetWeightTotalBps;
    index += 1
  ) {
    const row = remainderOrder[index % remainderOrder.length];
    result.set(row.assetId, (result.get(row.assetId) ?? 0) + 1);
    assigned += 1;
  }
  return result;
}

export function parseTargetWeightPercent(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= PORTFOLIO_TARGET_POLICY.targetWeightTotalBps
    ? basisPoints
    : null;
}

export function portfolioTargetScopeColumns(scope: PortfolioAnalysisScope) {
  return Object.freeze({
    scopeKind: scope.kind,
    scopeAccountId: scope.kind === "account" ? scope.accountId : null,
    scopePortfolioGroupId:
      scope.kind === "portfolio_group" ? scope.portfolioGroupId : null,
  });
}

export function serializePortfolioTargetPolicyRows(
  rows: readonly PortfolioTargetPolicyPersistenceRow[],
) {
  return JSON.stringify(
    rows.map((row) => ({
      account_id: row.accountId,
      asset_id: row.assetId,
      asset_name: row.assetName,
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      buyability: row.buyability,
      target_weight_bps: row.targetWeightBps,
    })),
  );
}

export function classifyPortfolioTargetBuyability({
  assetName,
  assetType,
  currency,
  market,
  ticker,
}: {
  assetName: string | null;
  assetType: string | null;
  currency: string | null;
  market: string | null;
  ticker: string | null;
}): PortfolioTargetBuyability {
  if (
    isKrxGoldManualInstrumentCandidate({
      name: assetName,
      ticker,
      assetType,
      market,
      currency,
    })
  ) {
    return "buyable";
  }
  if (!ticker) return "tickerless";
  if (!market || !SUPPORTED_MARKETS.has(market)) return "unsupported_market";
  if (!currency || !SUPPORTED_CURRENCIES.has(currency)) {
    return "unsupported_currency";
  }
  return SUPPORTED_PAIRS.has(`${market}:${currency}`)
    ? "buyable"
    : "not_buyable";
}

function normalizeUniverseRow(
  source: PortfolioTargetUniverseInput,
): PortfolioTargetUniverseRow | null {
  const accountCode = canonicalText(source.accountCode);
  const accountName = canonicalText(source.accountName);
  const assetName = canonicalText(source.assetName);
  const assetType = canonicalText(source.assetType)?.toLowerCase() ?? null;
  const market = canonicalText(source.market)?.toLowerCase() ?? null;
  const currency = canonicalText(source.currency)?.toUpperCase() ?? null;
  const ticker = canonicalText(source.ticker)?.toUpperCase() ?? null;
  const currentValueKrw = source.currentValueKrw;
  if (
    !UUID_PATTERN.test(source.accountId) ||
    !UUID_PATTERN.test(source.assetId) ||
    !accountCode ||
    !accountName ||
    !assetName ||
    !market ||
    !currency ||
    (currentValueKrw !== null &&
      (!Number.isFinite(currentValueKrw) || currentValueKrw < 0))
  ) {
    return null;
  }

  return Object.freeze({
    accountCode,
    accountId: source.accountId.toLowerCase(),
    accountName,
    assetId: source.assetId.toLowerCase(),
    assetName,
    assetType,
    market,
    currency,
    ticker,
    buyability: classifyPortfolioTargetBuyability({
      assetName,
      assetType,
      currency,
      market,
      ticker,
    }),
    currentValueKrw,
  });
}

function projectUniverseHashRow(row: PortfolioTargetUniverseRow) {
  return {
    accountId: row.accountId,
    assetId: row.assetId,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    buyability: row.buyability,
  };
}

function compareUniverseRows(
  left: PortfolioTargetUniverseRow,
  right: PortfolioTargetUniverseRow,
) {
  return (
    left.accountId.localeCompare(right.accountId) ||
    left.assetId.localeCompare(right.assetId)
  );
}

function canonicalText(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_MARKETS = new Set(["korea", "us"]);
const SUPPORTED_CURRENCIES = new Set(["KRW", "USD"]);
const SUPPORTED_PAIRS = new Set(["korea:KRW", "us:USD"]);
