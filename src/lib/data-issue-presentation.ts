/** Display copy only. Admission codes and calculation boundaries stay unchanged. */
export function dataIssueLabel(code: string, english = false): string {
  if (/target.*missing|targets_required/.test(code)) return english ? "Set target weights first." : "목표비중을 먼저 설정해 주세요.";
  if (/cash_not_observed/.test(code)) return english ? "No cash balance has been recorded." : "현금 잔액 기록이 없습니다.";
  if (/fx|exchange_rate/.test(code)) return english ? "An exchange rate for this date is missing." : "해당 시점의 환율이 필요합니다.";
  if (/price|quote/.test(code)) return english ? "A verified price is needed." : "확인된 종목 가격이 필요합니다.";
  if (/valuation/.test(code)) return english ? "Some holdings cannot be valued yet." : "평가 자료가 부족한 종목이 있습니다.";
  if (/cost/.test(code)) return english ? "Purchase cost has not been confirmed." : "매입원가가 확인되지 않았습니다.";
  if (/manual_gold|manual_history/.test(code)) return english ? "A dated manual valuation is needed." : "날짜가 있는 수동 평가 기록이 필요합니다.";
  if (/unsupported/.test(code)) return english ? "This asset is not supported by this analysis." : "이 분석에서 지원하지 않는 자산입니다.";
  if (/history|observation|anchor/.test(code)) return english ? "Dated historical evidence is needed." : "날짜별 과거 자료가 필요합니다.";
  if (/conflict|mismatch|changed/.test(code)) return english ? "The data basis changed. Reload and check." : "계산 기준이 바뀌었습니다. 다시 확인해 주세요.";
  return english ? "Unable to verify the data. Please reload." : "자료를 확인하지 못했습니다. 다시 조회해 주세요.";
}
