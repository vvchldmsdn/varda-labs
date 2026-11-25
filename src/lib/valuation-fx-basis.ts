import type { DashboardData } from "./portfolio-dashboard";

export type ValuationFxBasis = {
  usdKrwRate: number | null;
  rateDate: string | null;
  rateKind?: DashboardData["dataHealth"]["latestFxRateKind"];
  source?: string | null;
};

export function dashboardFxBasis({ usdKrwRate, dataHealth }: Pick<DashboardData, "usdKrwRate" | "dataHealth">): ValuationFxBasis {
  return {
    usdKrwRate: usdKrwRate > 0 ? usdKrwRate : null,
    rateDate: dataHealth?.latestFxRateDate ?? null,
    rateKind: dataHealth?.latestFxRateKind ?? null,
    source: dataHealth?.latestFxSource ?? null,
  };
}

export function valuationFxLabel({ rateDate, rateKind, source }: ValuationFxBasis) {
  const provider = source === "er-api_open_access" ? "ExchangeRate-API" : source === "frankfurter" ? "Frankfurter" : null;
  const [ko, en] = rateKind === "daily_reference" ? ["일별 기준환율", "Daily reference rate"]
    : rateKind === "spot" ? ["현물환율", "Spot exchange rate"] : ["평가환율", "Valuation rate"];
  return {
    ko: [ko, rateDate ?? "관측일 미제공", provider].filter(Boolean).join(" · "),
    en: [en, rateDate ?? "Observation date unavailable", provider].filter(Boolean).join(" · "),
  };
}
