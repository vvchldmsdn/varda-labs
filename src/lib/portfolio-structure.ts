import {
  normalizeTicker,
  resolveKrwFxRate,
  sumBy,
  toNumber,
} from "./portfolio-math.ts";

export type PortfolioStructureAccount = "all" | "brokerage" | "isa" | "irp";

export type PortfolioStructureAssetInput = {
  id: string;
  legacyBase44Id?: string | null;
  name: string | null;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  assetType?: string | null;
  quantity: string | number | null;
  currentPrice: string | number | null;
  fractionalKrwValue?: string | number | null;
  targetWeight?: string | number | null;
  groupId?: string | null;
  priceSource?: string | null;
  priceFetchedAt?: Date | string | null;
  priceAsOf?: Date | string | null;
  priceQuoteType?: string | null;
  priceStatus?: string | null;
};

export type PortfolioStructureGroupInput = {
  id: string;
  name: string;
  targetWeight?: string | number | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
};

export type PortfolioStructureGroupMemberInput = {
  assetId: string;
  groupId: string;
  allocationRatio?: string | number | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
};

export type PortfolioStructureLiveQuoteInput = {
  ticker: string;
  market: string;
  currency: string;
  price: string | number | null;
  source?: string | null;
  status?: string | null;
  quoteType?: string | null;
  fetchedAt?: Date | string | null;
  priceAsOf?: Date | string | null;
};

export type PortfolioStructureTargetPolicyStatus =
  | "asset_target_raw"
  | "group_target_raw"
  | "target_policy_unresolved"
  | "missing_target";

export type PortfolioStructureExclusionReason =
  | "missing_price"
  | "missing_fx"
  | "unsupported_currency";

export type PortfolioStructurePriceEvidenceSource =
  | "live_price_quote"
  | "asset_current_price_fallback";

export type PortfolioStructureHoldingRow = {
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  assetType: string | null;
  groupName: string;
  quantity: number;
  currentPrice: number;
  currentValueKrw: number;
  currentWeightPct: number;
  rawAssetTargetPct: number | null;
  groupTargetPct: number | null;
  memberAllocationRatioPct: number | null;
  effectiveTargetPct: null;
  driftPct: null;
  targetPolicyStatus: PortfolioStructureTargetPolicyStatus;
  priceEvidenceSource: PortfolioStructurePriceEvidenceSource;
  priceSource: string | null;
  priceFetchedAt: string | null;
  priceAsOf: string | null;
};

export type PortfolioStructureGroupRow = {
  name: string;
  currentValueKrw: number;
  currentWeightPct: number;
  groupTargetPct: number | null;
  effectiveTargetPct: null;
  driftPct: null;
  holdingCount: number;
  excludedCount: number;
};

export type PortfolioStructureExclusion = {
  reason: PortfolioStructureExclusionReason;
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  assetType: string | null;
  groupName: string;
  quantity: number;
  currentPrice: number | null;
};

export type PortfolioStructureResult = {
  selectedAccount: PortfolioStructureAccount;
  usdKrwRate: number | null;
  totalValueKrw: number;
  includedHoldingCount: number;
  excludedHoldingCount: number;
  holdingRows: PortfolioStructureHoldingRow[];
  groupRows: PortfolioStructureGroupRow[];
  exclusions: PortfolioStructureExclusion[];
  dataHealth: {
    inputAssetCount: number;
    selectedAssetCount: number;
    includedHoldingCount: number;
    excludedHoldingCount: number;
    missingPriceCount: number;
    missingFxCount: number;
    unsupportedCurrencyCount: number;
    unresolvedTargetPolicyCount: number;
  };
};

export type BuildPortfolioStructureInput = {
  assets: PortfolioStructureAssetInput[];
  groups?: PortfolioStructureGroupInput[];
  groupMembers?: PortfolioStructureGroupMemberInput[];
  liveQuotes?: PortfolioStructureLiveQuoteInput[];
  usdKrwRate?: string | number | null;
  selectedAccount?: PortfolioStructureAccount;
};

type HoldingCandidate =
  | { kind: "holding"; holding: PortfolioStructureHoldingRow }
  | { kind: "exclusion"; exclusion: PortfolioStructureExclusion };

const TRACKED_ACCOUNTS = new Set(["brokerage", "isa", "irp"]);
const UNGROUPED_NAME = "Ungrouped";

export function buildPortfolioStructure({
  assets,
  groups = [],
  groupMembers = [],
  liveQuotes = [],
  usdKrwRate,
  selectedAccount = "brokerage",
}: BuildPortfolioStructureInput): PortfolioStructureResult {
  const normalizedAccount = normalizeStructureAccount(selectedAccount);
  const usdKrw = toNumber(usdKrwRate);
  const activeGroupsById = buildActiveGroupsById(groups);
  const activeMembersByAssetGroup = buildActiveMembersByAssetGroup(groupMembers);
  const quotesByKey = buildUsableQuotesByKey(liveQuotes);
  const selectedAssets = assets.filter((asset) =>
    normalizedAccount === "all"
      ? TRACKED_ACCOUNTS.has(asset.account)
      : asset.account === normalizedAccount,
  );

  const candidateRows = selectedAssets.map((asset) =>
    buildHoldingCandidate({
      asset,
      group: asset.groupId ? activeGroupsById.get(asset.groupId) : undefined,
      member:
        asset.groupId !== null && asset.groupId !== undefined
          ? activeMembersByAssetGroup.get(memberKey(asset.id, asset.groupId))
          : undefined,
      quote: quotesByKey.get(assetQuoteKey(asset)),
      usdKrw,
    }),
  );
  const holdingRows: PortfolioStructureHoldingRow[] = [];
  const exclusions: PortfolioStructureExclusion[] = [];
  for (const row of candidateRows) {
    if (row.kind === "holding") {
      holdingRows.push(row.holding);
    } else {
      exclusions.push(row.exclusion);
    }
  }
  const totalValueKrw = sumBy(holdingRows, (row) => row.currentValueKrw);
  const weightedHoldingRows = holdingRows
    .map((row) => ({
      ...row,
      currentWeightPct:
        totalValueKrw > 0 ? (row.currentValueKrw / totalValueKrw) * 100 : 0,
    }))
    .sort(compareHoldingRows);
  const groupRows = buildGroupRows(weightedHoldingRows, exclusions, totalValueKrw);

  return {
    selectedAccount: normalizedAccount,
    usdKrwRate: usdKrw,
    totalValueKrw,
    includedHoldingCount: weightedHoldingRows.length,
    excludedHoldingCount: exclusions.length,
    holdingRows: weightedHoldingRows,
    groupRows,
    exclusions,
    dataHealth: {
      inputAssetCount: assets.length,
      selectedAssetCount: selectedAssets.length,
      includedHoldingCount: weightedHoldingRows.length,
      excludedHoldingCount: exclusions.length,
      missingPriceCount: exclusions.filter((row) => row.reason === "missing_price")
        .length,
      missingFxCount: exclusions.filter((row) => row.reason === "missing_fx").length,
      unsupportedCurrencyCount: exclusions.filter(
        (row) => row.reason === "unsupported_currency",
      ).length,
      unresolvedTargetPolicyCount: weightedHoldingRows.filter(
        (row) => row.targetPolicyStatus === "target_policy_unresolved",
      ).length,
    },
  };
}

export function normalizeStructureAccount(
  value: string | null | undefined,
): PortfolioStructureAccount {
  if (value === "all" || value === "brokerage" || value === "isa" || value === "irp") {
    return value;
  }
  return "brokerage";
}

function buildHoldingCandidate({
  asset,
  group,
  member,
  quote,
  usdKrw,
}: {
  asset: PortfolioStructureAssetInput;
  group: PortfolioStructureGroupInput | undefined;
  member: PortfolioStructureGroupMemberInput | undefined;
  quote: PortfolioStructureLiveQuoteInput | undefined;
  usdKrw: number | null;
}): HoldingCandidate {
  const quantity = toNumber(asset.quantity) ?? 0;
  const quotePrice = quote ? toNumber(quote.price) : null;
  const assetPrice = toNumber(asset.currentPrice);
  const currentPrice = quotePrice && quotePrice > 0 ? quotePrice : assetPrice;
  const priceEvidenceSource: PortfolioStructurePriceEvidenceSource | null =
    quotePrice && quotePrice > 0 ? "live_price_quote" : assetPrice && assetPrice > 0
      ? "asset_current_price_fallback"
      : null;
  const groupName = group?.name ?? UNGROUPED_NAME;
  const base = {
    name: displayName(asset.name),
    ticker: normalizeTicker(asset.ticker),
    account: asset.account,
    market: asset.market,
    currency: normalizeCurrency(asset.currency),
    assetType: normalizeAssetType(asset.assetType),
    groupName,
    quantity,
    currentPrice,
  };

  if (!currentPrice || currentPrice <= 0 || !priceEvidenceSource) {
    return {
      kind: "exclusion" as const,
      exclusion: {
        ...base,
        reason: "missing_price" as const,
        currentPrice: null,
      },
    };
  }

  const fx = resolveKrwFxRate(asset.currency, usdKrw);
  if (!fx.ok) {
    return {
      kind: "exclusion" as const,
      exclusion: {
        ...base,
        reason:
          fx.reason === "missing_usd_krw_rate"
            ? ("missing_fx" as const)
            : ("unsupported_currency" as const),
      },
    };
  }

  const fractionalKrwValue = toNumber(asset.fractionalKrwValue) ?? 0;
  const currentValueKrw = quantity * currentPrice * fx.rate + fractionalKrwValue;
  const rawAssetTargetPct = toNumber(asset.targetWeight);
  const groupTargetPct = toNumber(group?.targetWeight);
  const memberAllocationRatioPct = toNumber(member?.allocationRatio);

  return {
    kind: "holding" as const,
    holding: {
      ...base,
      currentPrice,
      currentValueKrw,
      currentWeightPct: 0,
      rawAssetTargetPct,
      groupTargetPct,
      memberAllocationRatioPct,
      effectiveTargetPct: null,
      driftPct: null,
      targetPolicyStatus: targetPolicyStatus({
        rawAssetTargetPct,
        groupTargetPct,
        memberAllocationRatioPct,
      }),
      priceEvidenceSource,
      priceSource: quote?.source ?? asset.priceSource ?? null,
      priceFetchedAt: timestampString(quote?.fetchedAt ?? asset.priceFetchedAt),
      priceAsOf: timestampString(quote?.priceAsOf ?? asset.priceAsOf),
    },
  };
}

function normalizeAssetType(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function buildGroupRows(
  holdings: PortfolioStructureHoldingRow[],
  exclusions: PortfolioStructureExclusion[],
  totalValueKrw: number,
) {
  const groupNames = new Set<string>();
  for (const holding of holdings) groupNames.add(holding.groupName);
  for (const exclusion of exclusions) groupNames.add(exclusion.groupName);

  return [...groupNames]
    .map((name) => {
      const groupHoldings = holdings.filter((holding) => holding.groupName === name);
      const currentValueKrw = sumBy(groupHoldings, (holding) => holding.currentValueKrw);
      const groupTargetPct =
        groupHoldings.find((holding) => holding.groupTargetPct !== null)
          ?.groupTargetPct ?? null;

      return {
        name,
        currentValueKrw,
        currentWeightPct:
          totalValueKrw > 0 ? (currentValueKrw / totalValueKrw) * 100 : 0,
        groupTargetPct,
        effectiveTargetPct: null,
        driftPct: null,
        holdingCount: groupHoldings.length,
        excludedCount: exclusions.filter((exclusion) => exclusion.groupName === name)
          .length,
      };
    })
    .sort(compareGroupRows);
}

function targetPolicyStatus({
  rawAssetTargetPct,
  groupTargetPct,
  memberAllocationRatioPct,
}: {
  rawAssetTargetPct: number | null;
  groupTargetPct: number | null;
  memberAllocationRatioPct: number | null;
}): PortfolioStructureTargetPolicyStatus {
  if (memberAllocationRatioPct !== null) return "target_policy_unresolved";
  if (groupTargetPct !== null) return "group_target_raw";
  if (rawAssetTargetPct !== null) return "asset_target_raw";
  return "missing_target";
}

function buildActiveGroupsById(groups: PortfolioStructureGroupInput[]) {
  const result = new Map<string, PortfolioStructureGroupInput>();
  for (const group of groups) {
    if (group.isActive === false) continue;
    result.set(group.id, group);
  }
  return result;
}

function buildActiveMembersByAssetGroup(
  members: PortfolioStructureGroupMemberInput[],
) {
  const result = new Map<string, PortfolioStructureGroupMemberInput>();
  for (const member of members) {
    if (member.isActive === false) continue;
    result.set(memberKey(member.assetId, member.groupId), member);
  }
  return result;
}

function buildUsableQuotesByKey(quotes: PortfolioStructureLiveQuoteInput[]) {
  const result = new Map<string, PortfolioStructureLiveQuoteInput>();
  for (const quote of quotes) {
    if (quote.status !== "ok") continue;
    const price = toNumber(quote.price);
    if (!price || price <= 0) continue;
    const key = liveQuoteKey(quote.market, quote.ticker, quote.currency);
    if (!result.has(key)) result.set(key, quote);
  }
  return result;
}

function assetQuoteKey(
  asset: Pick<PortfolioStructureAssetInput, "market" | "ticker" | "currency">,
) {
  return liveQuoteKey(asset.market, asset.ticker ?? "", asset.currency);
}

function liveQuoteKey(market: string, ticker: string, currency: string) {
  return `${market.trim().toLowerCase()}:${normalizeTicker(ticker) ?? ""}:${normalizeCurrency(currency)}`;
}

function memberKey(assetId: string, groupId: string) {
  return `${groupId}:${assetId}`;
}

function normalizeCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "UNKNOWN";
}

function displayName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || "-";
}

function timestampString(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
}

function compareHoldingRows(
  left: PortfolioStructureHoldingRow,
  right: PortfolioStructureHoldingRow,
) {
  return (
    right.currentValueKrw - left.currentValueKrw ||
    left.account.localeCompare(right.account) ||
    left.name.localeCompare(right.name)
  );
}

function compareGroupRows(
  left: PortfolioStructureGroupRow,
  right: PortfolioStructureGroupRow,
) {
  if (left.name === UNGROUPED_NAME && right.name !== UNGROUPED_NAME) return 1;
  if (right.name === UNGROUPED_NAME && left.name !== UNGROUPED_NAME) return -1;
  return (
    right.currentValueKrw - left.currentValueKrw ||
    left.name.localeCompare(right.name)
  );
}
