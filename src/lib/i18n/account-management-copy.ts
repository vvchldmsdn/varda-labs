/** Presentation-only copy. Validated action outcomes and persisted values stay unchanged. */
const accountActionKorean: Readonly<Record<string, string>> = {
  "Enter an account name between 1 and 100 characters.": "계좌 이름을 1~100자로 입력해 주세요.",
  "Confirm that this account should be archived.": "계좌 종료 확인 항목을 선택해 주세요.",
  "The account identity is invalid.": "선택한 계좌를 확인해 주세요.",
  "Refresh the page before changing this account.": "화면을 새로고침한 뒤 다시 변경해 주세요.",
  "Account created.": "계좌를 만들었습니다.",
  "An active account already uses this name.": "사용 중인 계좌 이름입니다. 다른 이름을 입력해 주세요.",
  "The active account limit has been reached.": "사용 가능한 계좌 수 한도에 도달했습니다.",
  "The account could not be created.": "계좌를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "Account name updated.": "계좌 이름을 변경했습니다.",
  "The account could not be updated.": "계좌를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "Account archived. Historical rows were preserved.": "계좌를 종료했습니다. 과거 기록은 보존됩니다.",
  "Account ownership integrity must be repaired before archiving.": "계좌 연결 상태를 확인해야 종료할 수 있습니다.",
  "Move or close active holdings before archiving this account.": "먼저 이 계좌의 보유종목을 이동하거나 종료해 주세요.",
  "Remove this account and its holdings from asset groups before archiving.": "먼저 분석 범위에서 이 계좌와 보유종목의 연결을 해제해 주세요.",
  "The account could not be archived.": "계좌를 종료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "Account restored.": "계좌를 복원했습니다.",
  "Rename the active account with the same name before restoring this one.": "같은 이름으로 사용 중인 계좌의 이름을 변경한 뒤 복원해 주세요.",
  "The account could not be restored.": "계좌를 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  "Sign in with an active portfolio user.": "로그인 상태를 확인해 주세요.",
  "The account changed. Refresh the page and try again.": "계좌 정보가 변경되었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  "The account change was blocked.": "계좌를 변경할 수 없습니다. 현재 상태를 확인해 주세요.",
  "Another account change completed first. Refresh the page.": "다른 변경이 먼저 반영되었습니다. 화면을 새로고침해 주세요.",
};

export function accountActionMessageKo(message: string) {
  return Object.hasOwn(accountActionKorean, message) ? accountActionKorean[message] : message;
}

const accountTypeLabels: Readonly<Record<string, readonly [string, string]>> = {
  investment: ["투자 계좌", "Investment account"],
  brokerage: ["증권 계좌", "Brokerage account"],
  cash: ["현금 계좌", "Cash account"],
  isa: ["ISA 계좌", "ISA account"],
  irp: ["IRP 계좌", "IRP account"],
};

export function accountTypeLabel(accountType: string): readonly [string, string] {
  return Object.hasOwn(accountTypeLabels, accountType)
    ? accountTypeLabels[accountType]
    : [accountType, accountType];
}
