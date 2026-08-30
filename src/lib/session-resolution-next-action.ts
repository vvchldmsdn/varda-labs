import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export type SessionResolutionNextAction = Readonly<{
  href: string;
  label: string;
}>;

const SIGN_IN_ACTION = Object.freeze({
  href: "/auth/sign-in",
  label: "로그인",
});
const START_PORTFOLIO_ACTION = Object.freeze({
  href: "/portfolio/onboarding",
  label: "포트폴리오 시작",
});
const SESSION_EVIDENCE_ACTION = Object.freeze({
  href: "/auth/session?view=account",
  label: "계정 연결 확인",
});
const DASHBOARD_ACTION = Object.freeze({
  href: "/",
  label: "홈",
});

export function sessionResolutionNextAction(
  resolution: SessionResolverResult,
): SessionResolutionNextAction {
  if (resolution.ok) return DASHBOARD_ACTION;
  if (resolution.failure.code === "unauthenticated") return SIGN_IN_ACTION;
  if (resolution.failure.code === "identity_unlinked") {
    return START_PORTFOLIO_ACTION;
  }
  return SESSION_EVIDENCE_ACTION;
}
