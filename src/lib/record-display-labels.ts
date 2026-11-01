/** Human-readable labels only. Stored evidence and financial values stay unchanged. */
const labels = {
  event_date: ["이벤트 일자 누락", "Event date missing"],
  event_type: ["유형 누락", "Event type missing"],
  asset_name: ["이름 누락", "Name missing"],
  event_identity: ["식별 근거 누락", "Identity missing"],
  asset_reference: ["자산 참조 누락", "Holding reference missing"],
  amount_krw: ["금액 누락", "Amount missing"],
  quantity_delta: ["수량 누락", "Quantity missing"],
  price: ["단가 누락", "Unit price missing"],
  unknown_event_type: ["미지원 유형", "Unsupported type"],
  correction_target_unverified: ["정정 대상 미검증", "Correction target unverified"],
  korea: ["한국", "Korea"], us: ["미국", "United States"], etc: ["기타", "Other"],
  cutoff_live: ["기준 시각 시세", "Quote at cutoff"],
  close: ["종가", "Closing price"], official_close: ["공식 종가", "Official close"],
  manual_current: ["직접 입력한 현재가", "Manually entered quote"],
  confirmed_manual_total: ["확인한 총평가액", "Confirmed total valuation"],
} satisfies Record<string, readonly [string, string]>;

export function recordDisplayLabel(value: string | null, locale = "ko") {
  const pair = value && Object.hasOwn(labels, value) ? labels[value as keyof typeof labels] : null;
  return pair?.[locale === "en" ? 1 : 0] ?? (locale === "en" ? "Details need review" : "상세 확인 필요");
}
