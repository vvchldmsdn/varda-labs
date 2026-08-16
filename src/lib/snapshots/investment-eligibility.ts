export const SNAPSHOT_INVESTMENT_ASSET_TYPES = [
  "etf",
  "stock",
  "pension",
  "commodity",
] as const;

const SNAPSHOT_INVESTMENT_ASSET_TYPE_SET = new Set<string>(
  SNAPSHOT_INVESTMENT_ASSET_TYPES,
);

export function isSnapshotInvestmentAssetType(
  assetType: string | null | undefined,
): boolean {
  return SNAPSHOT_INVESTMENT_ASSET_TYPE_SET.has(assetType ?? "etf");
}
