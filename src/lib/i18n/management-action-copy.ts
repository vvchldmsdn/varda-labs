/** UI-only translations for validated management action messages.
 * Business results and persisted values remain in their original form. */
export const managementActionEnglish: Readonly<Record<string, string>> = {
  "보유 계좌를 다시 확인해 주세요.": "Check the holding account again.",
  "검색 결과에서 종목을 다시 선택해 주세요.": "Select the instrument from the search results again.",
  "종목 가격을 확인하지 못했습니다. 잠시 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요.": "The price could not be verified. Try saving again shortly or enter a current price per unit.",
  "자동 가격 조회가 준비되지 않았습니다. 현재 1좌 가격을 입력하거나 잠시 후 다시 저장해 주세요.": "Automatic quotes are unavailable. Enter a current price per unit or try saving again shortly.",
  "로그인과 사용자 연결을 확인해 주세요.": "Check your sign-in and user link.",
  "보유종목 또는 계좌 상태가 변경되었습니다. 화면을 새로고침해 주세요.": "The holding or account has changed. Refresh the page.",
  "저장된 분석 데이터 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The stored analysis-data status could not be verified. Please try again later.",
  "이미 현재 분석에 필요한 가격 기록이 준비되어 있습니다.": "The price history required for the current analysis is already available.",
  "금현물은 자동 조회 대신 저장된 수동 평가 기록을 사용합니다.": "Physical gold uses stored manual valuations instead of automatic retrieval.",
  "일임·관리형 상품은 투자 랩·시뮬레이션 계산 대상에서 제외합니다.": "Managed products are excluded from Investment Lab and simulation calculations.",
  "이 보유종목은 자동 과거 가격 준비 대상이 아닙니다.": "This holding is not eligible for automatic historical-price preparation.",
  "현재 사용자 범위에서는 이 가격 기록을 분석에 사용할 수 없습니다.": "This price history cannot be used for analysis within the current user scope.",
  "KIS 가격 조회 설정을 확인한 뒤 다시 시도해 주세요.": "Check the KIS price-retrieval configuration, then try again.",
  "자동 조회에 필요한 티커가 없습니다.": "The ticker required for automatic retrieval is missing.",
  "과거 가격을 준비하지 못했습니다. 저장된 데이터는 변경하지 않고 중단했습니다.": "Historical prices could not be prepared. The operation stopped without changing stored data.",
  "보유종목을 종료했습니다. 수량·매입원가·과거 기록은 보존됩니다.": "The holding was closed. Quantity, cost basis and historical records are preserved.",
  "보유종목을 복원했습니다. 분석 범위 연결은 필요할 때 다시 지정해 주세요.": "The holding was restored. Reassign analysis-scope links if needed.",
  "보유종목 상태 변경 조건을 다시 확인해 주세요.": "Review the requirements for changing the holding status.",
  "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.": "Another change was applied first. Refresh the page.",
  "보유종목 상태를 변경하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The holding status could not be changed. Please try again later.",
  "종료 확인 항목을 선택해 주세요.": "Select the closure confirmation checkbox.",
  "보유종목 식별자가 올바르지 않습니다.": "The holding identifier is invalid.",
  "화면을 새로고침한 뒤 다시 시도해 주세요.": "Refresh the page, then try again.",
  "메모는 제어문자 없이 500자 이내로 입력해 주세요.": "Enter a note of no more than 500 characters, without control characters.",
  "저장된 최신 가격이 없습니다. 현재 1좌 가격을 입력해 주세요.": "No latest price is stored. Enter the current price per unit.",
  "계좌 또는 분석 범위가 변경되었거나 보관되었습니다. 화면을 새로고침해 주세요.": "The account or analysis scope changed or was archived. Refresh the page.",
  "보유종목을 분석 범위에 추가했습니다.": "The holding was added to the analysis scope.",
  "같은 종목이나 분석 범위가 먼저 등록되었습니다. 화면을 새로고침해 주세요.": "The same instrument or analysis scope was added first. Refresh the page.",
  "보유종목을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The holding could not be saved. Please try again later.",
  "한국": "Korea",
  "미국": "United States",
  "주식": "Stock",
  "보유 계좌를 선택해 주세요.": "Select the holding account.",
  "분석 범위 선택이 올바르지 않습니다.": "The analysis-scope selection is invalid.",
  "기존 분석 범위 선택과 새 범위 이름 중 하나만 입력해 주세요.": "Choose an existing analysis scope or enter a new scope name, not both.",
  "기존 분석 범위를 선택하거나 새 범위 이름을 입력해 주세요.": "Choose an existing analysis scope or enter a new scope name.",
  "새 분석 범위 이름은 100자 이하여야 합니다.": "The new analysis-scope name must be no more than 100 characters.",
  "상장 시장을 선택해 주세요.": "Select the listed market.",
  "종목 유형을 선택해 주세요.": "Select the instrument type.",
  "티커는 영문, 숫자, 점, 밑줄 또는 하이픈으로 입력해 주세요.": "Enter a ticker using Latin letters, numbers, periods, underscores or hyphens.",
  "종목명은 255자 이하여야 합니다.": "The holding name must be no more than 255 characters.",
  "보유 수량은 0보다 큰 숫자로 소수점 6자리까지 입력해 주세요.": "Enter a quantity greater than zero, with up to six decimal places.",
  "1좌당 매입 원가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.": "Enter a cost per unit greater than zero, with up to four decimal places.",
  "현재가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.": "Enter a current price greater than zero, with up to four decimal places.",
  "현재 수익률은 -100%보다 큰 숫자로 소수점 6자리까지 입력해 주세요.": "Enter a current return greater than -100%, with up to six decimal places.",
  "현재 보유 수량과 평균 매입가를 정정하고 변경 이력을 남겼습니다.": "The current quantity and average cost were corrected, and a change record was saved.",
  "변경된 수량이나 평균 매입가가 없습니다.": "Neither the quantity nor the average cost has changed.",
  "정정 조건을 다시 확인해 주세요.": "Review the correction requirements.",
  "보유 상태를 정정하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The holding could not be corrected. Please try again later.",
  "화면을 새로고침한 뒤 다시 정정해 주세요.": "Refresh the page, then submit the correction again.",
  "1좌당 평균 매입가는 0보다 큰 숫자로 소수점 4자리까지 입력해 주세요.": "Enter an average cost per unit greater than zero, with up to four decimal places.",
  "정정 사유는 제어문자 없이 500자 이내로 입력해 주세요.": "Enter a correction reason of no more than 500 characters, without control characters.",
  "분석 범위를 만들었습니다.": "The analysis scope was created.",
  "분석 범위 구성을 저장했습니다.": "The analysis-scope configuration was saved.",
  "분석 범위를 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The analysis scope could not be saved. Please try again later.",
  "분석 범위를 보관했습니다. 과거 분석 기록은 유지됩니다.": "The analysis scope was archived. Historical analysis records are preserved.",
  "분석 범위가 변경되었거나 이미 보관되었습니다. 화면을 새로고침해 주세요.": "The analysis scope changed or was already archived. Refresh the page.",
  "분석 범위를 보관하지 못했습니다. 잠시 후 다시 확인해 주세요.": "The analysis scope could not be archived. Please try again later.",
  "같은 이름의 활성 분석 범위가 이미 있습니다.": "An active analysis scope with the same name already exists.",
  "선택한 계좌 또는 종목의 소유권이 변경되었습니다. 화면을 새로고침해 주세요.": "Ownership of a selected account or holding has changed. Refresh the page.",
  "미래 날짜의 그룹 구성 기록이 있어 자동 변경하지 않았습니다.": "A future-dated group configuration exists, so no automatic change was made.",
  "분석 범위가 변경되었거나 보관되었습니다. 화면을 새로고침해 주세요.": "The analysis scope changed or was archived. Refresh the page.",
  "분석 범위 변경 조건을 다시 확인해 주세요.": "Review the requirements for changing the analysis scope.",
  "분석 범위 식별자가 올바르지 않습니다.": "The analysis-scope identifier is invalid.",
  "분석 범위의 최신 상태를 확인할 수 없습니다.": "The latest analysis-scope state could not be verified.",
  "새 분석 범위에 기존 버전 값이 포함되어 있습니다.": "The new analysis scope includes an existing version value.",
  "분석 범위 이름을 100자 이내로 입력해 주세요.": "Enter an analysis-scope name of no more than 100 characters.",
  "설명은 500자 이내로 입력해 주세요.": "Enter a description of no more than 500 characters.",
  "선택한 계좌 목록이 올바르지 않습니다.": "The selected account list is invalid.",
  "선택한 종목 목록이 올바르지 않습니다.": "The selected holding list is invalid.",
  "분석 범위 삭제 확인란을 선택해 주세요.": "Select the analysis-scope deletion confirmation checkbox.",
  "저장할 자산 범위를 확인해 주세요.": "Review the asset scope to save.",
  "자산 범위가 변경되었습니다. 화면을 새로고침해 주세요.": "The asset scope has changed. Refresh the page.",
  "현재 보유종목 구성을 목표비중으로 저장할 수 없습니다.": "The current holdings cannot be saved as target weights.",
  "보유종목 구성이 변경되었습니다. 화면을 새로고침해 주세요.": "The holdings have changed. Refresh the page.",
  "목표비중은 소수점 둘째 자리까지 입력해 주세요.": "Enter target weights with no more than two decimal places.",
  "목표비중 저장 결과를 확인하지 못했습니다.": "The target-weight save result could not be verified.",
  "이 범위의 목표비중을 저장했습니다.": "Target weights for this scope were saved.",
  "다른 저장이 먼저 완료되었습니다. 화면을 새로고침해 확인해 주세요.": "Another save completed first. Refresh the page to review it.",
  "목표비중을 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.": "Target weights could not be saved. Please try again later.",
  "목표비중 합계는 정확히 100%여야 합니다.": "Target weights must total exactly 100%.",
  "현재 매수 대상으로 지원하지 않는 자산은 목표비중을 0%로 두어야 합니다.": "Assets currently unsupported for purchases must have a 0% target weight.",
  "입력한 목표비중을 확인해 주세요.": "Review the target weights you entered."
};

export function translateManagementActionCopy(text: string): string {
  if (!/[가-힣]/.test(text)) return text;
  const normalized = text.replace(/\s+/g, " ").trim();
  const exact = managementActionEnglish[normalized];
  if (exact !== undefined) return exact;
  let busy = /^다른 가격 조회가 진행 중입니다\. (\d+)초 후 다시 시도해 주세요\.$/.exec(normalized);
  if (busy) return `Another price refresh is in progress. Try again in ${busy[1]} seconds.`;
  busy = /^가격 조회가 진행 중입니다\. (\d+)초 후 다시 저장하거나 현재 1좌 가격을 입력해 주세요\.$/.exec(normalized);
  if (busy) return `A price refresh is in progress. Save again in ${busy[1]} seconds or enter a current price per unit.`;
  let match = /^다른 가격 조회 직후입니다\. (\d+)초 후 다시 시도해 주세요\.$/.exec(normalized);
  if (match) return `Another price request just completed. Try again in ${match[1]} seconds.`;
  match = /^가격 기록 (\d+)개를 확인했습니다\. 일부 구간은 제공자 응답이 없어 저장된 범위만 사용합니다\.$/.exec(normalized);
  if (match) return `${match[1]} price records were checked. Some periods had no provider response, so only stored coverage is used.`;
  match = /^가격 기록 (\d+)개를 확인해 분석 데이터로 준비했습니다\.$/.exec(normalized);
  if (match) return `${match[1]} price records were checked and prepared for analysis.`;
  return text;
}
