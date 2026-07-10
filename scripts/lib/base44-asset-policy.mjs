const EXCLUDED_ASSET_TYPE_SET = new Set([
  "housing_subscription",
  "savings",
]);

export const EXCLUDED_BASE44_ASSET_TYPES = Object.freeze([
  ...EXCLUDED_ASSET_TYPE_SET,
]);

export function isExcludedBase44AssetType(value) {
  if (typeof value !== "string") return false;
  return EXCLUDED_ASSET_TYPE_SET.has(value.trim().toLowerCase());
}
