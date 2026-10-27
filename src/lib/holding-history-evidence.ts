import type { PortfolioDashboardHeatmapCell } from "./portfolio-dashboard-history.ts";

/** Explains absent valuation returns without replacing them with unit-price returns. */
export function holdingHistoryMissingEvidence(cell: PortfolioDashboardHeatmapCell) {
  if (cell.changePct !== null && Number.isFinite(cell.changePct)) return null;
  const price = cell.priceReturnEvidence;
  if (!price) return {
    ko: "기록 없음", en: "No record",
    detailKo: "이 날짜에 비교 가능한 보유 평가 변동 기록이 없습니다. 시세 새로고침으로 과거 보유 기록을 만들지는 않습니다.",
    detailEn: "No comparable holding valuation change was recorded for this date. Refreshing prices does not create past holding records.",
  };
  if (price.reason === "missing_current_quote") return {
    ko: "시세 확인 필요", en: "Quote unavailable",
    detailKo: "현재 시세 근거가 없거나 오래되어 평가 변동을 표시하지 않습니다. 시세 새로고침 후 다시 확인해 주세요.",
    detailEn: "Current quote evidence is missing or stale. Refresh prices and check again.",
  };
  return {
    ko: "비교 불가", en: "Not comparable",
    detailKo: "현재 시세는 수집됐지만 보유 평가액의 일별 변동을 비교할 근거가 부족합니다. 신규 편입 등으로 비교할 보유 기록이 없을 수 있으며, 매매·환율 근거도 필요합니다. 가격 등락은 아래에서 별도로 확인할 수 있습니다.",
    detailEn: "The current quote is available, but the holding's daily valuation change lacks comparable evidence. A newly added holding may have no baseline record; trade and FX evidence may also be needed. Price change is shown separately below.",
  };
}
