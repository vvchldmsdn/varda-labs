const KOREA_UNHEDGED_GLOBAL_CATEGORIES = new Set([
  "\ubbf8\uad6d\uc8fc\uc2dd",
  "\uc120\uc9c4\uad6d\uc8fc\uc2dd",
  "\uc2e0\ud765\uad6d\uc8fc\uc2dd",
  "\uae00\ub85c\ubc8c\ucc44\uad8c",
  "\uc6d0\uc790\uc7ac",
  "\uae08/\uadc0\uae08\uc18d",
]);

export function getSnapshotFxExposureType(asset: { market: string | null; currency: string | null; ticker: string | null; name: string; category: string | null }) {
  if (asset.market === "us" || asset.currency === "USD") return "US_LISTED";
  const ticker = asset.ticker?.trim().toUpperCase() ?? "";
  const name = asset.name.toLowerCase();
  if (
    ticker.endsWith("(H)") ||
    name.includes("(h)") ||
    name.includes("hedged")
  ) {
    return "HEDGED";
  }
  if (
    asset.market === "korea" &&
    KOREA_UNHEDGED_GLOBAL_CATEGORIES.has(asset.category ?? "")
  ) {
    return "KR_UNHEDGED_GLOBAL";
  }
  return "DOMESTIC";
}
