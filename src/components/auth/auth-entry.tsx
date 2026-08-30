import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "./auth-shell";
import { GoogleSignInButton } from "./auth-transport-controls";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import styles from "./auth-experience.module.css";

export async function AuthEntry({
  mode,
  preview = false,
}: {
  mode: "sign-in" | "sign-up";
  preview?: boolean;
}) {
  const designPreview = process.env.NODE_ENV === "development" && preview;
  const runtime = getAuthTransportRuntime();
  if (runtime.state === "disabled" && !designPreview) notFound();
  let sessionPresent = false;
  if (runtime.state === "ready" && !designPreview) {
    try {
      const session = await runtime.auth.getSession();
      sessionPresent = !session.error && Boolean(session.data?.user.id);
    } catch {
      // Keep sign-in available after a transient session-read failure.
    }
  }
  if (sessionPresent) redirect("/portfolio/onboarding");
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
                Google 계정으로 시작하세요.
              </>
            ) : (
              <>
                다시, 나의 자산 흐름으로.
                <br />
                사용하던 Google 계정으로 로그인하세요.
              </>
            )
          }
        />
        {runtime.state === "ready" || designPreview ? (
          <GoogleSignInButton mode={mode} preview={designPreview} />
        ) : (
          <p role="alert" className={styles.notice}>
            지금은 로그인에 연결할 수 없습니다. 잠시 후 다시 방문해 주세요.
          </p>
        )}
        {signingUp ? (
          <p className={styles.note}>
            이미 가입된 Google 계정이라면 기존 계정으로 로그인됩니다.
          </p>
        ) : null}
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
