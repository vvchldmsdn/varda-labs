export const ACCOUNT_ENTITY_API_RESPONSE_KEYS = [
  "id",
  "code",
  "name",
  "accountType",
  "currency",
  "isActive",
  "sortOrder",
  "createdAt",
  "updatedAt",
] as const;

export const ASSET_ENTITY_API_RESPONSE_KEYS = [
  "id",
  "legacyBase44Id",
  "name",
  "ticker",
  "assetType",
  "category",
  "market",
  "currency",
  "account",
  "accountId",
  "quantity",
  "currentPrice",
  "priceSource",
  "priceFetchedAt",
  "priceAsOf",
  "priceQuoteType",
  "priceStatus",
  "priceError",
  "averageCost",
  "targetWeight",
  "groupId",
  "memo",
  "description",
  "maAssetClass",
  "maRuleEnabled",
  "ma120",
  "daysAboveMa",
  "fractionalKrwValue",
  "fractionalAvgCost",
  "monthlyContribution",
  "contributionDay",
  "createdAt",
  "updatedAt",
] as const;

export const ASSET_GROUP_ENTITY_API_RESPONSE_KEYS = [
  "id",
  "legacyBase44Id",
  "name",
  "targetWeight",
  "description",
  "color",
  "isActive",
  "sortOrder",
  "fxExempt",
  "maExempt",
  "executionMode",
  "createdAt",
  "updatedAt",
] as const;

export const ASSET_GROUP_MEMBER_ENTITY_API_RESPONSE_KEYS = [
  "id",
  "groupId",
  "assetId",
  "priority",
  "allocationRatio",
  "sortOrder",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

export function projectEntityApiRow<const Keys extends readonly string[]>(
  keys: Keys,
  row: Record<string, unknown>,
): { [Key in Keys[number]]: unknown } {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as {
    [Key in Keys[number]]: unknown;
  };
}
