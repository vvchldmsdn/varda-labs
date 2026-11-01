/** Primary status copy; detailed source messages remain in the evidence disclosure. */
export function recordReadStatus(state: string, locale: string) {
  const copy: Record<string, readonly [string, string]> = {
    idle: ["조회할 날짜를 선택해 주세요.", "Choose a date to view records."],
    loading: ["선택한 기록을 확인하고 있어요.", "Checking the selected records."],
    partial: ["일부 기록의 근거가 부족해요. 아래 누락 항목을 확인해 주세요.", "Some records are incomplete. Review the missing evidence below."],
    empty: ["이 범위와 날짜에 저장된 기록이 없어요.", "No saved records for this scope and date."],
    invalid: ["날짜와 계좌 선택을 확인해 주세요.", "Check the date and account selection."],
    unauthorized: ["로그인 상태와 계좌 접근 권한을 확인해 주세요.", "Check your sign-in and account access."],
    unsupported: ["선택한 범위에서는 이 기록을 조회할 수 없어요.", "These records are unavailable for the selected scope."],
    unavailable: ["기록을 확인하지 못했어요. 다시 조회해 주세요.", "Records could not be verified. Please reload."],
  };
  return (Object.hasOwn(copy, state) ? copy[state] : ["기록 상태를 확인해 주세요.", "Please review the record status."])[locale === "en" ? 1 : 0];
}
