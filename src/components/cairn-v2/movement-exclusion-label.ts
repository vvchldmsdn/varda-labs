const exclusionLabels: Readonly<Record<string, string>> = {
  missing_comparison_evidence: "비교 근거 확인 필요",
  missing_quoted_instrument: "비교할 종목 티커 없음",
  unsupported_asset_type: "가격 비교 대상이 아닌 자산",
  incomplete_trade_attribution: "가격·환율 변동 근거 부족",
  missing_fresh_live_prices: "비교 시점 시세 부족",
  missing_baseline_snapshot: "기준 기록 없음",
  missing_previous_close_fallback: "이전 종가 없음",
  coverage_below_threshold: "비교 범위 부족",
  manual_valuation_not_updated_in_cycle: "수동 평가 갱신 필요",
  unsupported_currency: "지원 통화 밖",
  missing_current_fx: "현재 환율 없음",
  missing_baseline_fx: "기준 환율 없음",
};

export function movementExclusionLabel(reason: string) {
  return exclusionLabels[reason] ?? "근거 확인 필요";
}
