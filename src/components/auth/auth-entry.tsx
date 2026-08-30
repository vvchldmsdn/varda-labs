import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "./auth-shell";
import { SocialSignInButtons, SignOutButton } from "./auth-transport-controls";
import { EmailAuthForm } from "./email-auth-form";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { getAuthMethodAvailability } from "@/lib/auth/auth-method-availability";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import styles from "./auth-experience.module.css";

export async function AuthEntry({
  mode,
  preview = false,
  verified = false,
  callbackError = false,
}: {
  mode: "sign-in" | "sign-up";
  preview?: boolean;
  verified?: boolean;
  callbackError?: boolean;
}) {
  const designPreview = process.env.NODE_ENV === "development" && preview;
  const runtime = getAuthTransportRuntime();
  if (runtime.state === "disabled" && !designPreview) notFound();
  let sessionState = "unauthenticated";
  if (runtime.state === "ready" && !designPreview) {
    try {
      sessionState = (await readCurrentSessionSubject()).state;
    } catch {
      // Keep sign-in available after a transient session-read failure.
    }
  }
  if (sessionState === "authenticated") redirect("/portfolio/onboarding");
  const availability = getAuthMethodAvailability();
  const signingUp = mode === "sign-up";
  const alternateHref = `${signingUp ? "/auth/sign-in" : "/auth/sign-up"}${designPreview ? "?preview=design" : ""}`;
  const alternateLabel = signingUp ? "로그인" : "회원가입";
  return (
    <AuthShell
      preview={designPreview}
      alternate={{ href: alternateHref, label: alternateLabel }}
    >
      <section
        className={styles.panel}
        data-auth-entry
        aria-label={signingUp ? "회원가입" : "로그인"}
      >
        <AuthHeading
          eyebrow={signingUp ? "YOUR PORTFOLIO STARTS HERE" : "WELCOME BACK"}
          title={signingUp ? "회원가입" : "로그인"}
          description={
            signingUp ? (
              <>
                나의 자산, 나의 기록.
                <br />
                편한 방법으로 시작하세요.
              </>
            ) : (
              <>
                다시, 나의 자산 흐름으로.
                <br />
                가입한 방법으로 로그인하세요.
              </>
            )
          }
        />
        {sessionState === "invalid" ? (
          <div className={styles.stack}>
            <p role="alert" className={styles.notice}>
              여러 로그인 정보가 함께 남아 있습니다. 로그아웃 후 사용할 계정
              하나로 다시 로그인해 주세요.
            </p>
            <SignOutButton />
          </div>
        ) : runtime.state === "ready" || designPreview ? (
          <>
            {sessionState === "unverified" ? (
              <p className={styles.entryNotice}>
                이메일 인증 후 로그인해 주세요.{" "}
                <Link href="/auth/verify-email" className={styles.textLink}>
                  인증 메일 다시 받기
                </Link>
              </p>
            ) : null}
            {verified ? (
              <p role="status" className={styles.entryNotice}>
                메일의 인증 결과를 확인한 뒤 로그인해 주세요.
              </p>
            ) : null}
            {callbackError ? (
              <p role="alert" className={styles.entryNotice}>
                로그인을 완료하지 못했습니다. 다시 시도하거나 다른 방법을 선택해
                주세요.
              </p>
            ) : null}
            <SocialSignInButtons
              mode={mode}
              availability={availability}
              preview={designPreview}
            />
            <div className={styles.methodDivider}>
              <span>또는 이메일로 계속</span>
            </div>
            <EmailAuthForm
              mode={mode}
              enabled={availability.emailPassword}
              preview={designPreview}
            />
          </>
        ) : (
          <p role="alert" className={styles.notice}>
            지금은 로그인에 연결할 수 없습니다. 잠시 후 다시 방문해 주세요.
          </p>
        )}
        <div className={styles.divider} />
        <p className={styles.switchLine}>
          {signingUp ? "이미 계정이 있나요?" : "처음 방문하셨나요?"}
          <Link href={alternateHref} className={styles.textLink}>
            {alternateLabel}
          </Link>
        </p>
      </section>
    </AuthShell>
  );
}
