export type Locale = "ko" | "en";
export const LOCALE_COOKIE = "varda-locale";

export function resolveLocale(value: string | null | undefined): Locale {
  return value === "en" ? "en" : "ko";
}

export function localeCookie(locale: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${resolveLocale(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const intlLocale = (locale: Locale) => locale === "en" ? "en-US" : "ko-KR";

// Only product labels belong here. User-created names and market data are never translated.
export const commonEnglish: Readonly<Record<string, string>> = {
  "홈": "Home", "오늘 변동": "Today", "히스토리": "History", "포트 구조": "Allocation",
  "추가 투입": "Contribute", "추가투입": "Contribute", "투자 랩": "Investment Lab", "시뮬레이션": "Simulation",
  "관리": "Manage", "내 계정": "My account", "포트폴리오": "Portfolio", "전체": "All", "전체 자산": "All assets",
  "전체 계좌": "All accounts", "증권": "Brokerage", "계좌": "Account", "분석 범위": "Analysis scope",
  "닫기": "Close", "열기": "Open", "취소": "Cancel", "저장": "Save", "삭제": "Delete", "수정": "Edit",
  "확인": "Confirm", "추가": "Add", "새로고침": "Refresh", "다시 시도": "Try again", "상세 보기": "View details",
  "계산 대기": "Awaiting calculation", "데이터 없음": "No data", "확인 필요": "Needs attention",
  "계산 중": "Calculating", "계산 중…": "Calculating…", "데이터 부족": "Insufficient data", "변동 없음": "No change",
  "로그인": "Sign in", "회원가입": "Sign up", "로그아웃": "Sign out", "이메일": "Email", "비밀번호": "Password",
  "수량": "Quantity", "평가액": "Value", "수익률": "Return", "누적 수익률": "Total return", "보유 종목": "Holdings",
  "기준일": "As of", "현재": "Current", "목표": "Target", "매수": "Buy", "매도": "Sell",
  "근거 부족": "Insufficient evidence", "원가 근거 부족": "Cost basis unavailable", "계산 불가": "Unavailable",
  "예시": "Demo", "예시 데이터": "Demo data", "종목 추가": "Add holding", "전체 보기": "View all",
};

export function translate(locale: Locale, ko: string, en?: string): string {
  return locale === "en" ? en ?? translationEntry(commonEnglish, ko) ?? ko : ko;
}

export function translationEntry(messages: Readonly<Record<string,string>>, key: string): string | undefined {
  return Object.hasOwn(messages, key) ? messages[key] : undefined;
}
