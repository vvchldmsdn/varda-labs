import "server-only";

import { getReadOnlyTenantAdditionalContributionMa120Evidence } from "@/db/queries/additional-contribution-ma120";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { getReadOnlyTenantTargetPolicyHoldingUniverse } from "@/db/queries/target-policy-holding-universe";
import { loadLatestTenantPortfolioSettingsRows } from "@/db/queries/tenant-settings";
import {
  additionalContributionMa120ReadFailure,
  attachAdditionalContributionMa120Evidence,
  buildAdditionalContributionPreview,
  type AdditionalContributionMa120ReadPort,
} from "@/lib/additional-contribution-preview";
import type { AdditionalContributionMa120OverlayMode } from "@/lib/additional-contribution-ma120-overlay";
import { calculateExplainableAdditionalContribution } from "@/lib/additional-contribution-policy-engine";
import type { AdditionalContributionMa120EvidenceView } from "@/lib/additional-contribution-view";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";

const LEGACY_TARGET_POLICY_ACCOUNTS = new Set(["brokerage", "isa", "irp"]);

export async function getReadOnlyTenantAdditionalContributionPreview({
  account,
  cashAmountKrw,
  tenantContext,
  ma120Mode,
  now = new Date(),
}: {
  account: string;
  cashAmountKrw: number;
  tenantContext: TenantContext;
  ma120Mode?: AdditionalContributionMa120OverlayMode;
  now?: Date;
}) {
  const [approvedPolicyRead, currentUniverse, structure, settingsRows] = await Promise.all([
    getReadOnlyTenantApprovedTargetPolicy({ account, tenantContext }),
    getReadOnlyTenantTargetPolicyHoldingUniverse({ account, tenantContext }),
    getReadOnlyTenantPortfolioStructure({ account, tenantContext }),
    ma120Mode
      ? Promise.resolve(null)
      : loadLatestTenantPortfolioSettingsRows(tenantContext),
  ]);
  const resolvedMa120Mode =
    ma120Mode ?? resolveMa120Mode(settingsRows?.[0]?.useTrendFilter ?? false);
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const preview = buildAdditionalContributionPreview({
    account,
    cashAmountKrw,
    serviceDate,
    approvedPolicyRead,
    currentUniverse,
    structure,
  });
  if (preview.status !== "ready") return preview;

  let ma120Read;
  try {
    ma120Read = await getReadOnlyTenantAdditionalContributionMa120Evidence({
      holdings: structure.holdingRows,
      serviceDate,
    });
  } catch {
    ma120Read = additionalContributionMa120ReadFailure(
      structure.holdingRows.length,
    );
  }

  return attachAdditionalContributionMa120Evidence({
    preview,
    ma120Read,
    mode: resolvedMa120Mode,
  });
}

export async function getReadOnlyTenantAdditionalContributionPreviewForScope({
  cashAmountKrw,
  scope,
  tenantContext,
  now = new Date(),
}: {
  cashAmountKrw: number;
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
  now?: Date;
}) {
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const [model, settingsRows] = await Promise.all([
    getReadOnlyTenantPortfolioTargetPolicyModel({
      scope,
      serviceDate,
      tenantContext,
    }),
    loadLatestTenantPortfolioSettingsRows(tenantContext),
  ]);
  const ma120Mode = resolveMa120Mode(
    settingsRows[0]?.useTrendFilter ?? false,
  );
  const policyParameters = resolvePolicyParameters(settingsRows[0]);

  if (
    model.policyValidation.status === "missing" &&
    scope.kind === "account" &&
    LEGACY_TARGET_POLICY_ACCOUNTS.has(scope.accountCode.toLowerCase())
  ) {
    const legacyPreview = await getReadOnlyTenantAdditionalContributionPreview({
      account: scope.accountCode,
      cashAmountKrw,
      tenantContext,
      ma120Mode,
      now,
    });
    return adaptLegacyPreview({
      model,
      policyParameters,
      preview: legacyPreview,
      scope,
    });
  }

  if (model.status !== "ready") {
    return scopedBlocked(scope, serviceDate, ["valuation_universe_invalid"]);
  }
  if (model.policyValidation.status !== "available") {
    return scopedBlocked(scope, serviceDate, [
      scopedPolicyBlocker(model.policyValidation.status),
    ]);
  }
  if (model.rows.some((row) => row.currentValueKrw === null)) {
    return scopedBlocked(scope, serviceDate, ["valuation_identity_missing"]);
  }

  let ma120Read;
  try {
    ma120Read = await getReadOnlyTenantAdditionalContributionMa120Evidence({
      holdings: model.ma120HoldingRows,
      serviceDate,
    });
  } catch {
    ma120Read = additionalContributionMa120ReadFailure(model.rows.length);
  }
  const result = calculateExplainableAdditionalContribution({
    cashAmountKrw,
    minimumExecutionRatioPct: policyParameters.minimumExecutionRatioPct,
    trimDriftThresholdPct: policyParameters.trimDriftThresholdPct,
    rows: buildPolicyRows({
      ma120Read,
      modelRows: model.rows,
      useTrendFilter: policyParameters.useTrendFilter,
    }),
  });
  if (result.status !== "ready") {
    return scopedBlocked(scope, serviceDate, result.blockers);
  }

  return mapPolicyResult({
    effectiveServiceDate: model.approvedPolicy.policy!.effectiveServiceDate,
    ma120Read,
    mode: ma120Mode,
    policyLabel: "사용자 목표비중",
    policyVersion: model.approvedPolicy.policy!.policyVersion,
    result,
    scopeKey: scope.key,
    serviceDate,
    source: "portfolio_target_policy",
  });
}

function adaptLegacyPreview({
  model,
  policyParameters,
  preview,
  scope,
}: {
  model: Awaited<ReturnType<typeof getReadOnlyTenantPortfolioTargetPolicyModel>>;
  policyParameters: ReturnType<typeof resolvePolicyParameters>;
  preview: Awaited<
    ReturnType<typeof getReadOnlyTenantAdditionalContributionPreview>
  >;
  scope: Extract<PortfolioAnalysisScope, { kind: "account" }>;
}) {
  if (preview.status !== "ready") {
    return Object.freeze({
      ...preview,
      source: "legacy_account_policy" as const,
      scopeKey: scope.key,
    });
  }
  const legacyTargets = new Map(
    preview.rows.map((row) => [instrumentKey(row), Math.round(row.targetWeightPct * 100)]),
  );
  const legacyEvidence = new Map(
    preview.rows.map((row) => [instrumentKey(row), row.ma120Evidence]),
  );
  const result = calculateExplainableAdditionalContribution({
    cashAmountKrw: preview.cashAmountKrw,
    minimumExecutionRatioPct: policyParameters.minimumExecutionRatioPct,
    trimDriftThresholdPct: policyParameters.trimDriftThresholdPct,
    rows: model.rows.map((row) => {
      const key = instrumentKey(row);
      const evidence = legacyEvidence.get(key) ?? unavailableMa120Evidence();
      return Object.freeze({
        allocationKey: `${row.accountId}:${row.assetId}`,
        assetType: row.assetType ?? null,
        buyable: row.buyability === "buyable",
        costBasisKrw: row.costBasisKrw ?? null,
        currentValueKrw: row.currentValueKrw ?? Number.NaN,
        ma120Evidence: Object.freeze({
          distanceFromMaPct: evidence.distanceFromMaPct,
          status: evidence.status,
        }),
        maAssetClass: row.maAssetClass ?? null,
        maRuleEnabled: policyParameters.useTrendFilter && (row.maRuleEnabled ?? true),
        metadata: Object.freeze({
          accountCode: row.accountCode,
          accountName: row.accountName,
          assetName: row.assetName,
          currency: row.currency,
          ma120Evidence: evidence,
          market: row.market,
          ticker: row.ticker,
        }),
        targetWeightBps: legacyTargets.get(key) ?? 0,
      });
    }),
  });
  if (result.status !== "ready") {
    return scopedBlocked(scope, preview.serviceDate, result.blockers);
  }
  return mapPolicyResult({
    effectiveServiceDate: preview.effectiveServiceDate,
    ma120Read: {
      status: preview.ma120Evidence.status,
      usableCount: preview.ma120Evidence.usableCount,
    },
    mode: policyParameters.useTrendFilter ? "enabled" : "off",
    policyLabel: "기존 계좌 목표비중",
    policyVersion: preview.policyVersion,
    result,
    scopeKey: scope.key,
    serviceDate: preview.serviceDate,
    source: "legacy_account_policy",
  });
}

function buildPolicyRows({
  ma120Read,
  modelRows,
  useTrendFilter,
}: {
  ma120Read: AdditionalContributionMa120ReadPort;
  modelRows: Awaited<
    ReturnType<typeof getReadOnlyTenantPortfolioTargetPolicyModel>
  >["rows"];
  useTrendFilter: boolean;
}) {
  const evidenceByKey = new Map(
    ma120Read.rows.map((row) => [row.instrumentKey, compactMa120Evidence(row)]),
  );
  return modelRows.map((row) => {
    const key = instrumentKey(row);
    const evidence = (key ? evidenceByKey.get(key) : null) ?? unavailableMa120Evidence();
    return Object.freeze({
      allocationKey: `${row.accountId}:${row.assetId}`,
      assetType: row.assetType ?? null,
      buyable: row.buyability === "buyable",
      costBasisKrw: row.costBasisKrw ?? null,
      currentValueKrw: row.currentValueKrw ?? Number.NaN,
      ma120Evidence: Object.freeze({
        distanceFromMaPct: evidence.distanceFromMaPct,
        status: evidence.status,
      }),
      maAssetClass: row.maAssetClass ?? null,
      maRuleEnabled: useTrendFilter && (row.maRuleEnabled ?? true),
      metadata: Object.freeze({
        accountCode: row.accountCode,
        accountName: row.accountName,
        assetName: row.assetName,
        currency: row.currency,
        ma120Evidence: evidence,
        market: row.market,
        ticker: row.ticker,
      }),
      targetWeightBps: row.targetWeightBps,
    });
  });
}

function mapPolicyResult<T extends Readonly<{
  accountCode: string;
  accountName: string;
  assetName: string;
  currency: string | null;
  ma120Evidence: AdditionalContributionMa120EvidenceView;
  market: string | null;
  ticker: string | null;
}>>({
  effectiveServiceDate,
  ma120Read,
  mode,
  policyLabel,
  policyVersion,
  result,
  scopeKey,
  serviceDate,
  source,
}: {
  effectiveServiceDate: string | null;
  ma120Read: Readonly<{ status: "ready" | "partial" | "unavailable" | "read_failed"; usableCount: number }>;
  mode: AdditionalContributionMa120OverlayMode;
  policyLabel: string;
  policyVersion: string | null;
  result: Extract<ReturnType<typeof calculateExplainableAdditionalContribution<T>>, { status: "ready" }>;
  scopeKey: string;
  serviceDate: string;
  source: "portfolio_target_policy" | "legacy_account_policy";
}) {
  const totalReductionKrw = result.rows.reduce(
    (total, row) => total + Math.max(0, row.strategicAllocationKrw - row.allocationKrw),
    0,
  );
  return Object.freeze({
    status: "ready" as const,
    source,
    scopeKey,
    serviceDate,
    policyVersion,
    policyLabel,
    effectiveServiceDate,
    cashAmountKrw: result.cashAmountKrw,
    currentPortfolioTotalKrw: result.currentPortfolioTotalKrw,
    postTopupTotalKrw: result.postContributionTotalKrw,
    totalAllocatedKrw: result.totalAllocatedKrw,
    residualCashKrw: result.residualCashKrw,
    totalTrimProceedsKrw: result.totalTrimProceedsKrw,
    totalAvailableFundsKrw: result.totalAvailableFundsKrw,
    totalBaseNeedKrw: result.totalBaseNeedKrw,
    minimumExecutionTargetKrw: result.minimumExecutionTargetKrw,
    minimumExecutionSatisfied: result.minimumExecutionSatisfied,
    calculationPolicy: result.policy,
    calculationParameters: result.parameters,
    ma120Evidence: Object.freeze({
      mode,
      status: mode === "off" ? ("ready" as const) : ma120Read.status,
      usableCount: mode === "off" ? 0 : ma120Read.usableCount,
      totalReductionKrw,
    }),
    rows: Object.freeze(result.rows.map((row) => Object.freeze({
      accountCode: row.metadata.accountCode,
      accountName: row.metadata.accountName,
      action: row.action,
      allocationKrw: row.allocationKrw,
      baseNeedKrw: row.baseNeedKrw,
      costBasisKrw: row.costBasisKrw,
      currentValueKrw: row.currentValueKrw,
      currentWeightPct: row.currentWeightPct,
      currency: row.metadata.currency,
      driftRatioPct: row.driftRatioPct,
      effectiveTargetWeightPct: row.effectiveTargetWeightBps / 100,
      ma120Evidence: row.metadata.ma120Evidence,
      ma120ReductionKrw: Math.max(0, row.strategicAllocationKrw - row.allocationKrw),
      maAdjustmentReason: row.maAdjustmentReason,
      maEffectiveMultiplier: row.maEffectiveMultiplier,
      market: row.metadata.market,
      name: row.metadata.assetName,
      postTopupValueKrw: row.postTradeValueKrw,
      postTopupWeightPct: row.postTradeWeightPct,
      postTrimValueKrw: row.postTrimValueKrw,
      strategicAllocationKrw: row.strategicAllocationKrw,
      targetWeightPct: row.targetWeightBps / 100,
      ticker: row.metadata.ticker,
      trimAmountKrw: row.trimAmountKrw,
      trimReason: row.trimReason,
      unrealizedReturnPct: row.unrealizedReturnPct,
    }))),
    blockers: Object.freeze([] as string[]),
  });
}

function compactMa120Evidence(
  row: AdditionalContributionMa120ReadPort["rows"][number],
) {
  return Object.freeze({
    status: row.status,
    priceBasis: row.priceBasis,
    availableObservationCount: row.evidence?.availableObservationCount ?? 0,
    latestWindowPriceDate: row.evidence?.latestWindowPriceDate ?? null,
    ma120: row.evidence?.ma120 ?? null,
    distanceFromMaPct: row.evidence?.distanceFromMaPct ?? null,
  });
}

function unavailableMa120Evidence() {
  return Object.freeze({
    status: "unavailable" as const,
    priceBasis: null,
    availableObservationCount: 0,
    latestWindowPriceDate: null,
    ma120: null,
    distanceFromMaPct: null,
  });
}

function instrumentKey(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeInstrumentPart(row.market, "lower");
  const currency = normalizeInstrumentPart(row.currency, "upper");
  const ticker = normalizeInstrumentPart(row.ticker, "upper");
  return market && currency && ticker
    ? `${market}:${currency}:${ticker}`
    : null;
}

function normalizeInstrumentPart(
  value: string | null,
  casing: "lower" | "upper",
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return casing === "lower"
    ? normalized.toLowerCase()
    : normalized.toUpperCase();
}

function resolvePolicyParameters(
  settings: Awaited<ReturnType<typeof loadLatestTenantPortfolioSettingsRows>>[number] | undefined,
) {
  return Object.freeze({
    minimumExecutionRatioPct: boundedPercent(settings?.minExecutionRatioPct, 85),
    trimDriftThresholdPct: boundedPercent(settings?.trimDriftThreshold, 12),
    useTrendFilter: settings?.useTrendFilter ?? false,
  });
}

function boundedPercent(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : fallback;
}

function scopedBlocked(
  scope: PortfolioAnalysisScope,
  serviceDate: string,
  blockers: readonly string[],
) {
  return Object.freeze({
    status: "blocked" as const,
    source: "portfolio_target_policy" as const,
    scopeKey: scope.key,
    serviceDate,
    policyVersion: null,
    policyLabel: null,
    effectiveServiceDate: null,
    cashAmountKrw: null,
    currentPortfolioTotalKrw: null,
    postTopupTotalKrw: null,
    totalAllocatedKrw: null,
    residualCashKrw: null,
    rows: Object.freeze([]),
    blockers: Object.freeze([...new Set(blockers)].toSorted()),
  });
}

function scopedPolicyBlocker(status: string) {
  if (status === "missing") return "portfolio_target_policy_missing";
  if (status === "conflict") return "portfolio_target_policy_conflict";
  if (status === "universe_mismatch") {
    return "portfolio_target_policy_universe_changed";
  }
  if (status === "not_effective") {
    return "portfolio_target_policy_not_effective";
  }
  return "portfolio_target_policy_integrity_error";
}

function resolveMa120Mode(
  useTrendFilter: boolean,
): AdditionalContributionMa120OverlayMode {
  return useTrendFilter ? "enabled" : "off";
}
