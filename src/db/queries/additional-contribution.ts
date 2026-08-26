import "server-only";

import { getReadOnlyTenantAdditionalContributionMa120Evidence } from "@/db/queries/additional-contribution-ma120";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { getReadOnlyTenantPortfolioStructure } from "@/db/queries/portfolio-structure";
import { getReadOnlyTenantApprovedTargetPolicy } from "@/db/queries/target-policy";
import { getReadOnlyTenantTargetPolicyHoldingUniverse } from "@/db/queries/target-policy-holding-universe";
import { loadLatestTenantPortfolioSettingsRows } from "@/db/queries/tenant-settings";
import {
  additionalContributionMa120ReadFailure,
  applyAdditionalContributionMa120Overlay,
  attachAdditionalContributionMa120Evidence,
  buildAdditionalContributionPreview,
} from "@/lib/additional-contribution-preview";
import type { AdditionalContributionMa120OverlayMode } from "@/lib/additional-contribution-ma120-overlay";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { allocateTargetDeficits } from "@/lib/target-deficit-allocation";

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
    return adaptLegacyPreview({ preview: legacyPreview, scope });
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

  const allocation = allocateTargetDeficits({
    cashAmountKrw,
    rows: model.rows.map((row) => ({
      allocationKey: `${row.accountId}:${row.assetId}`,
      buyable: row.buyability === "buyable",
      currentValueKrw: row.currentValueKrw!,
      targetWeightBps: row.targetWeightBps,
      metadata: Object.freeze({
        accountCode: row.accountCode,
        accountName: row.accountName,
        assetName: row.assetName,
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
      }),
    })),
  });
  if (allocation.status !== "ready") {
    return scopedBlocked(scope, serviceDate, allocation.blockers);
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
  const preview = Object.freeze({
    status: "ready" as const,
    source: "portfolio_target_policy" as const,
    scopeKey: scope.key,
    serviceDate,
    policyVersion: model.approvedPolicy.policy!.policyVersion,
    policyLabel: "사용자 목표비중",
    effectiveServiceDate:
      model.approvedPolicy.policy!.effectiveServiceDate,
    cashAmountKrw: allocation.cashAmountKrw,
    currentPortfolioTotalKrw: allocation.currentPortfolioTotalKrw,
    postTopupTotalKrw: allocation.postTopupTotalKrw,
    totalAllocatedKrw: allocation.totalAllocatedKrw,
    residualCashKrw: allocation.residualCashKrw,
    rows: Object.freeze(
      allocation.rows.map((row) =>
        Object.freeze({
          allocationKey: row.allocationKey,
          accountCode: row.metadata.accountCode,
          accountName: row.metadata.accountName,
          name: row.metadata.assetName,
          market: row.metadata.market,
          currency: row.metadata.currency,
          ticker: row.metadata.ticker,
          currentValueKrw: row.currentValueKrw,
          currentWeightPct:
            allocation.currentPortfolioTotalKrw > 0
              ? (row.currentValueKrw /
                  allocation.currentPortfolioTotalKrw) *
                100
              : 0,
          targetWeightPct: row.targetWeightBps / 100,
          allocationKrw: row.allocationKrw,
          postTopupValueKrw: row.currentValueKrw + row.allocationKrw,
          postTopupWeightPct:
            allocation.postTopupTotalKrw > 0
              ? ((row.currentValueKrw + row.allocationKrw) /
                  allocation.postTopupTotalKrw) *
                100
              : 0,
          allocationStatus: row.allocationStatus,
        }),
      ),
    ),
    blockers: Object.freeze([] as string[]),
  });

  return applyAdditionalContributionMa120Overlay({
    preview,
    ma120Read,
    mode: ma120Mode,
  });
}

function adaptLegacyPreview({
  preview,
  scope,
}: {
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
  return Object.freeze({
    ...preview,
    source: "legacy_account_policy" as const,
    scopeKey: scope.key,
    policyLabel: "기존 계좌 목표비중",
    rows: Object.freeze(
      preview.rows.map((row) =>
        Object.freeze({
          ...row,
          accountCode: scope.accountCode,
          accountName: scope.label,
          strategicAllocationKrw: row.strategicAllocationKrw,
          ma120Multiplier: row.ma120Multiplier,
          ma120ReductionKrw: row.ma120ReductionKrw,
          ma120Decision: row.ma120Decision,
          ma120Evidence: row.ma120Evidence,
        }),
      ),
    ),
  });
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
