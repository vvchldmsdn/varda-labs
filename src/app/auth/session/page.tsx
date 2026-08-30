import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { SignOutButton } from "@/components/auth/auth-transport-controls";
import { IdentityBootstrapClaimForm } from "@/components/auth/identity-bootstrap-claim-form";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import {
  assessIdentityPairingClaimPresentationEnvironment,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV,
} from "@/lib/auth/identity-pairing-claim-presentation-policy";
import styles from "@/components/auth/auth-experience.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "내 계정 | VARDA-LABS",
  robots: { index: false, follow: false },
};
type SessionEvidence = "authenticated" | "unauthenticated" | "unavailable";

export default async function SessionPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; preview?: string }>;
}) {
  const params = await searchParams;
  const preview =
    process.env.NODE_ENV === "development" && params.preview === "design";
  const runtime = getAuthTransportRuntime();
  if (runtime.state === "disabled" && !preview) notFound();
  const evidence = preview
    ? "authenticated"
    : await readSessionEvidence(runtime);
  if (evidence === "unauthenticated") redirect("/auth/sign-in");
  if (evidence === "authenticated" && params.view !== "account" && !preview)
    redirect("/portfolio/onboarding");
  const presentationRuntime = assessIdentityPairingClaimPresentationEnvironment(
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE:
        process.env[IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV],
    },
  );

  return (
    <AuthShell preview={preview} alternate={{ href: "/", label: "포트폴리오" }}>
      <section className={styles.panel}>
        <AuthHeading
          eyebrow="YOUR ACCOUNT"
          title="내 계정"
          description={
            evidence === "authenticated"
              ? "로그인이 확인되었습니다. 나의 포트폴리오로 이어가세요."
              : "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
          }
        />
        {evidence === "authenticated" ? (
          <>
            <p className={styles.sessionState}>
              <Check size={16} aria-hidden="true" />
              Google 계정으로 로그인됨
            </p>
            <div className={styles.stack}>
              <Link
                className={styles.primaryButton}
                href={
                  preview
                    ? "/portfolio/onboarding?preview=design"
                    : "/portfolio/onboarding"
                }
              >
                포트폴리오로 계속
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              {!preview ? (
                <SignOutButton />
              ) : (
                <Link
                  className={styles.secondaryButton}
                  href="/auth/sign-in?preview=design"
                >
                  로그인 화면 보기
                </Link>
              )}
            </div>
            <details className={styles.disclosure} id="existing-data">
              <summary>기존 데이터 연결</summary>
              <p>
                이전 서비스의 자산 기록은 별도로 확인한 연결 코드로만
                연결됩니다. 코드를 다른 사람에게 공유하지 마세요.
              </p>
              {presentationRuntime.state === "enabled" && !preview ? (
                <IdentityBootstrapClaimForm />
              ) : (
                <p>
                  현재 연결 코드 입력이 열려 있지 않습니다. 기존 기록이 있다면
                  신규 포트폴리오 생성 전에 운영자에게 연결을 요청해 주세요.
                </p>
              )}
            </details>
          </>
        ) : (
          <div className={styles.stack}>
            <Link
              className={styles.primaryButton}
              href="/auth/session?view=account"
            >
              <RotateCcw size={16} aria-hidden="true" />
              로그인 상태 다시 확인
            </Link>
            <Link className={styles.secondaryButton} href="/auth/sign-in">
              로그인 화면으로
            </Link>
          </div>
        )}
      </section>
    </AuthShell>
  );
}

async function readSessionEvidence(
  runtime: ReturnType<typeof getAuthTransportRuntime>,
): Promise<SessionEvidence> {
  if (runtime.state !== "ready") return "unavailable";
  try {
    const result = await runtime.auth.getSession();
    if (result.error) return "unavailable";
    return result.data?.user.id ? "authenticated" : "unauthenticated";
  } catch {
    return "unavailable";
  }
}
