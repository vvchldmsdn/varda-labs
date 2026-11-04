/** Display copy only. Admission codes and calculation boundaries stay unchanged. */
export function dataIssueLabel(code: string, english = false): string {
  if (/target.*missing|targets_required/.test(code)) return english ? "Set target weights first." : "목표비중을 먼저 설정해 주세요.";
  if (/cash_not_observed/.test(code)) return english ? "No cash balance has been recorded." : "현금 잔액 기록이 없습니다.";
  if (code === "fractional_value_not_dated") return english ? "The fractional holding needs a native price and valuation date." : "소수점 보유분의 원본 가격과 평가 날짜가 필요합니다.";
  if (code === 'corporate_action_ledger_mismatch') return english ? 'Corporate actions and recorded shares do not match. Review your records.' : '기업행사와 기록된 수량이 달라 거래 기록 확인이 필요합니다.';
  if (/corporate_action/.test(code)) return english ? 'Corporate-action evidence needs service review. Collecting prices alone does not resolve it.' : '분할·병합 등 기업행사 자료를 서비스에서 확인해야 합니다. 가격 수집만으로 해결되지 않습니다.';
  if (/price.*conflict|paired_history_conflict|historical_evidence_conflict|conflicting_provider_binding/.test(code)) return english ? 'Price sources conflict and need service review.' : '가격 출처가 서로 달라 서비스의 확인이 필요합니다.';
  if (/history_admission_mismatch|price_basis_mismatch|provider_(symbol|exchange)_missing|adjusted_close_(basis_ineligible|provider_missing|source_missing)|raw_source_not_kis/.test(code)) return english ? 'Price currency, source or adjustment basis needs service review.' : '가격의 통화·출처·수정 기준을 서비스에서 확인해야 합니다.';
  if (/fx_stale|stale_fx/.test(code)) return english ? 'The exchange-rate evidence is too old for this date.' : '해당 날짜에 사용할 환율 자료가 오래됐습니다.';
  if (/fx_invalid|fx.*conflict/.test(code)) return english ? 'The exchange-rate source or value needs review.' : '환율의 출처나 값을 확인해야 합니다.';
  if (/fx|exchange_rate/.test(code)) return english ? "An exchange rate for this date is missing." : "해당 시점의 환율이 필요합니다.";
  if (/price|quote|raw_close_missing|adjusted_close_missing/.test(code)) return english ? "A verified price is needed." : "확인된 종목 가격이 필요합니다.";
  if (/valuation/.test(code)) return english ? "Some holdings cannot be valued yet." : "평가 자료가 부족한 종목이 있습니다.";
  if (/cost/.test(code)) return english ? "Purchase cost has not been confirmed." : "매입원가가 확인되지 않았습니다.";
  if (/ledger_incomplete/.test(code)) return english ? 'Review the opening balances and subsequent transactions.' : '시작 잔액과 이후 거래 기록을 확인해 주세요.';
  if (/manual_gold|manual_history/.test(code)) return english ? "A dated manual valuation is needed." : "날짜가 있는 수동 평가 기록이 필요합니다.";
  if (/unsupported/.test(code)) return english ? "This asset is not supported by this analysis." : "이 분석에서 지원하지 않는 자산입니다.";
  if (/history|observation|anchor/.test(code)) return english ? "Dated historical evidence is needed." : "날짜별 과거 자료가 필요합니다.";
  if (/conflict|mismatch|changed/.test(code)) return english ? "The data basis changed. Reload and check." : "계산 기준이 바뀌었습니다. 다시 확인해 주세요.";
  return english ? "Unable to verify the data. Please reload." : "자료를 확인하지 못했습니다. 다시 조회해 주세요.";
}
