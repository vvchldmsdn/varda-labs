"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "./locale-provider";

const pageNames: Record<string, [string, string]> = {
  "/": ["홈", "Home"], "/today": ["오늘 변동", "Today"], "/history": ["히스토리", "History"],
  "/additional-contribution": ["추가 투입", "Contribute"], "/portfolio/structure": ["포트 구조", "Allocation"],
  "/portfolio/risk": ["위험 분석", "Risk analysis"], "/investment-lab": ["투자 랩", "Investment Lab"],
  "/simulation": ["시뮬레이션", "Simulation"], "/portfolio/manage": ["관리", "Manage"],
  "/portfolio/accounts": ["계좌", "Accounts"], "/portfolio/groups": ["그룹", "Groups"],
  "/portfolio/holdings": ["보유 종목", "Holdings"], "/portfolio/holdings/new": ["종목 추가", "Add holding"],
  "/portfolio/targets": ["목표 비중", "Target weights"], "/portfolio/events": ["거래 기록", "Transactions"],
  "/portfolio/onboarding": ["시작하기", "Get started"], "/portfolio/portfolio-snapshots": ["자산 기록", "Portfolio records"],
  "/portfolio/position-snapshots": ["종목 기록", "Position records"], "/market": ["시장 데이터", "Market data"],
  "/etfs": ["ETF", "ETFs"], "/admin/market-sync": ["시장 동기화", "Market sync"],
  "/auth/sign-in": ["로그인", "Sign in"], "/auth/sign-up": ["회원가입", "Sign up"],
  "/auth/session": ["내 계정", "My account"], "/auth/forgot-password": ["비밀번호 찾기", "Forgot password"],
  "/auth/reset-password": ["비밀번호 재설정", "Reset password"], "/auth/verify-email": ["이메일 인증", "Verify email"],
};

export function LocaleDocumentTitle() {
  const pathname = usePathname();
  const {locale} = useI18n();
  useEffect(() => {
    const names = pageNames[pathname];
    if (names) document.title = `${names[locale === "en" ? 1 : 0]} | VARDA LABS`;
  }, [pathname, locale]);
  return null;
}
