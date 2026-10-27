import { buildPortfolioDirectHoldingsBaseline } from "./portfolio-direct-holdings.ts";
import { buildHomeDesignPreview } from "./home-design-preview.ts";
import { buildPortfolioRiskDesignPreview } from "./portfolio-risk-design-preview.ts";
import { buildPortfolioSpecialHoldingsModel } from "./portfolio-special-holdings.ts";
import type {
  PortfolioStructureGroupRow,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";

export function buildPortfolioStructureDesignPreview(
  scopeInput: string | readonly string[] | undefined,
) {
  const dashboard = buildHomeDesignPreview(scopeInput);
  const previewHoldings = [
    ...dashboard.holdings.map((holding) => ({
      name: holding.name,
      ticker: holding.ticker,
      account: holding.account,
      market: holding.market,
      currency: holding.currency,
      assetType: holding.assetType,
      groupName: holding.groupName,
      quantity: holding.quantity,
      currentPrice: holding.currentPrice,
      currentValueKrw: holding.valueKrw,
      rawTargetPct: holding.targetWeight,
      priceSource: holding.priceSource,
      priceFetchedAt: holding.priceFetchedAt,
      priceAsOf: holding.priceAsOf,
    })),
    ...specialPreviewRows(dashboard.selectedScope),
  ];
  const totalValueKrw = previewHoldings.reduce(
    (sum, holding) => sum + holding.currentValueKrw,
    0,
  );
  const targetTotal = previewHoldings.reduce(
    (sum, holding) => sum + (holding.rawTargetPct ?? 0),
    0,
  );
  const holdingRows: PortfolioStructureHoldingRow[] = previewHoldings
    .map((holding) => {
      const currentWeightPct = percentage(
        holding.currentValueKrw,
        totalValueKrw,
      );
      const effectiveTargetPct =
        holding.rawTargetPct === null || targetTotal <= 0
          ? null
          : percentage(holding.rawTargetPct, targetTotal);
      return {
        name: holding.name,
        ticker: holding.ticker,
        account: holding.account,
        market: holding.market,
        currency: holding.currency,
        assetType: holding.assetType,
        groupName: holding.groupName ?? "Ungrouped",
        quantity: holding.quantity,
        currentPrice: holding.currentPrice,
        currentValueKrw: holding.currentValueKrw,
        currentWeightPct,
        rawAssetTargetPct: effectiveTargetPct,
        groupTargetPct: null,
        memberAllocationRatioPct: null,
        effectiveTargetPct,
        driftPct:
          effectiveTargetPct === null
            ? null
            : currentWeightPct - effectiveTargetPct,
        targetPolicyStatus:
          effectiveTargetPct === null ? "missing_target" : "approved_policy",
        priceEvidenceSource: "live_price_quote",
        priceSource: holding.priceSource,
        priceFetchedAt: holding.priceFetchedAt,
        priceAsOf: holding.priceAsOf,
      } satisfies PortfolioStructureHoldingRow;
    })
    .toSorted(
      (left, right) =>
        right.currentValueKrw - left.currentValueKrw ||
        left.name.localeCompare(right.name),
    );
  const groupRows = buildGroupRows(holdingRows, totalValueKrw);
  const unresolvedTargetPolicyCount = holdingRows.filter(
    (row) => row.effectiveTargetPct === null,
  ).length;
  const selectedAccount =
    dashboard.selectedScope.kind === "account"
      ? structureAccount(dashboard.selectedScope.accountCode)
      : "all";
  const structure: PortfolioStructureResult = {
    selectedAccount,
    identityScope:
      dashboard.selectedScope.kind === "account"
        ? "account_scoped"
        : "cross_account_exposure",
    usdKrwRate: dashboard.usdKrwRate,
    totalValueKrw,
    includedHoldingCount: holdingRows.length,
    excludedHoldingCount: 0,
    holdingRows,
    groupRows,
    exclusions: [],
    dataHealth: {
      inputAssetCount: holdingRows.length,
      selectedAssetCount: holdingRows.length,
      includedHoldingCount: holdingRows.length,
      excludedHoldingCount: 0,
      missingPriceCount: 0,
      missingFxCount: 0,
      unsupportedCurrencyCount: 0,
      unresolvedTargetPolicyCount,
    },
  };
  const matchedHoldingCount = holdingRows.length - unresolvedTargetPolicyCount;
  const targetProjection = {
    status:
      unresolvedTargetPolicyCount === 0
        ? ("applied" as const)
        : ("partial" as const),
    reason:
      unresolvedTargetPolicyCount === 0
        ? "exact_policy_identity_match"
        : "partial_policy_identity_match",
    coverage: {
      policyTargetCount: matchedHoldingCount,
      matchedHoldingCount,
      unmatchedHoldingCount: unresolvedTargetPolicyCount,
      unmatchedTargetCount: 0,
      totalTargetWeightBps: 10_000,
    },
  };

  return {
    analysisScopes: dashboard.analysisScopes,
    selectedScope: dashboard.selectedScope,
    generatedAt: dashboard.generatedAt,
    serviceDate: dashboard.movementBaselineDate,
    structure,
    targetProjection,
    targetEffectiveServiceDate: "2026-08-01",
    directHoldingsBaseline: buildPortfolioDirectHoldingsBaseline(structure),
    specialHoldingsCoverage: buildPortfolioSpecialHoldingsModel(structure),
    riskModel: buildPortfolioRiskDesignPreview(holdingRows),
  };
}

function specialPreviewRows(
  scope: ReturnType<typeof buildHomeDesignPreview>["selectedScope"],
) {
  const includesBrokerage =
    scope.kind === "all" ||
    (scope.kind === "account" && scope.accountCode === "brokerage");
  if (!includesBrokerage) return [];

  return [
    {
      name: "KRX 금현물",
      ticker: null,
      account: "brokerage",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
      groupName: "금",
      quantity: 8,
      currentPrice: 192_000,
      currentValueKrw: 1_536_000,
      rawTargetPct: 6,
      priceSource: "manual_close",
      priceFetchedAt: "2026-08-21T15:30:00+09:00",
      priceAsOf: "2026-08-21T15:30:00+09:00",
    },
    {
      name: "Fount 일임 포트폴리오",
      ticker: null,
      account: "brokerage",
      market: "managed",
      currency: "KRW",
      assetType: "managed_sleeve",
      groupName: "관리형 자산",
      quantity: 1,
      currentPrice: 1_200_000,
      currentValueKrw: 1_200_000,
      rawTargetPct: null,
      priceSource: "manual_valuation",
      priceFetchedAt: "2026-08-21T07:00:00+09:00",
      priceAsOf: "2026-08-21T07:00:00+09:00",
    },
  ] as const;
}

function buildGroupRows(
  holdings: readonly PortfolioStructureHoldingRow[],
  totalValueKrw: number,
) {
  const groups = new Map<
    string,
    {
      currentValueKrw: number;
      effectiveTargetPct: number;
      hasTarget: boolean;
      holdingCount: number;
    }
  >();
  for (const holding of holdings) {
    const group = groups.get(holding.groupName) ?? {
      currentValueKrw: 0,
      effectiveTargetPct: 0,
      hasTarget: false,
      holdingCount: 0,
    };
    group.currentValueKrw += holding.currentValueKrw;
    group.holdingCount += 1;
    if (holding.effectiveTargetPct !== null) {
      group.effectiveTargetPct += holding.effectiveTargetPct;
      group.hasTarget = true;
    }
    groups.set(holding.groupName, group);
  }

  return [...groups]
    .map(([name, group]) => {
      const currentWeightPct = percentage(
        group.currentValueKrw,
        totalValueKrw,
      );
      const effectiveTargetPct = group.hasTarget
        ? group.effectiveTargetPct
        : null;
      return {
        name,
        currentValueKrw: group.currentValueKrw,
        currentWeightPct,
        groupTargetPct: null,
        effectiveTargetPct,
        driftPct:
          effectiveTargetPct === null
            ? null
            : currentWeightPct - effectiveTargetPct,
        holdingCount: group.holdingCount,
        excludedCount: 0,
      } satisfies PortfolioStructureGroupRow;
    })
    .toSorted(
      (left, right) =>
        right.currentValueKrw - left.currentValueKrw ||
        left.name.localeCompare(right.name),
    );
}

function structureAccount(accountCode: string) {
  if (
    accountCode === "brokerage" ||
    accountCode === "isa" ||
    accountCode === "irp"
  ) {
    return accountCode;
  }
  return "all";
}

function percentage(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}
