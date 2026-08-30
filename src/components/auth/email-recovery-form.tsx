"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import {
  AUTH_EMAIL_VERIFIED_PATH,
  AUTH_PASSWORD_RESET_PATH,
} from "@/lib/auth/auth-methods";
import { AuthPasswordField } from "./auth-password-field";
import styles from "./auth-experience.module.css";

export type EmailRecoveryMode =
  | "forgot-password"
  | "verify-email"
  | "reset-password";

export function EmailRecoveryForm({
  mode,
  enabled,
  preview = false,
  resetToken = "",
}: {
  mode: EmailRecoveryMode;
  enabled: boolean;
  preview?: boolean;
  resetToken?: string;
}) {
  const [token, setToken] = useState(resetToken);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seconds, setSeconds] = useState(0);
  const resetting = mode === "reset-password";
  useEffect(() => {
    if (mode !== "reset-password") return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("token")) return;
    url.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search,
    );
  }, [mode]);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds(seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || seconds > 0 || (!enabled && !preview)) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("new-password") ?? "");
    setError("");
    if (resetting && password !== String(data.get("password-confirm") ?? "")) {
      setError("비밀번호가 서로 다릅니다.");
      return;
    }
    if (preview) {
      setNotice(
        "화면 미리보기입니다. 메일을 보내거나 비밀번호를 변경하지 않습니다.",
      );
      return;
    }
    setPending(true);
    try {
      const result = resetting
        ? await authClient.resetPassword({ newPassword: password, token })
        : mode === "verify-email"
          ? await authClient.sendVerificationEmail({
              email,
              callbackURL: AUTH_EMAIL_VERIFIED_PATH,
            })
          : await authClient.requestPasswordReset({
              email,
              redirectTo: AUTH_PASSWORD_RESET_PATH,
            });
      if (result.error) {
        setError(authErrorMessage(result.error));
        if (
          resetting &&
          ["INVALID_TOKEN", "TOKEN_EXPIRED"].includes(result.error.code ?? "")
        )
          setToken("");
      } else {
        setSent(true);
        setSeconds(60);
        if (resetting) setToken("");
      }
    } catch {
      setError(authErrorMessage(null));
    } finally {
      setPending(false);
    }
  }

  if (resetting && sent)
    return (
      <div className={styles.stack}>
        <p className={styles.verificationState} role="status">
          <Check size={20} aria-hidden="true" />
          비밀번호를 변경했습니다.
        </p>
        <Link href="/auth/sign-in" className={styles.primaryButton}>
          로그인 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    );
  if (resetting && !token && !preview)
    return (
      <div className={styles.stack}>
        <p className={styles.notice} role="alert">
          유효한 재설정 링크가 필요합니다. 새 메일을 요청해 주세요.
        </p>
        <Link href="/auth/forgot-password" className={styles.primaryButton}>
          재설정 메일 요청
        </Link>
      </div>
    );
  return (
    <form
      onSubmit={submit}
      className={styles.emailForm}
      aria-label={resetting ? "비밀번호 재설정" : "인증 메일 요청"}
    >
      <fieldset
        className={styles.form}
        disabled={pending || (!enabled && !preview)}
      >
        {resetting ? (
          <>
            <AuthPasswordField
              id="new-password"
              label="새 비밀번호"
              newPassword
            />
            <AuthPasswordField
              id="password-confirm"
              label="새 비밀번호 확인"
              newPassword
            />
          </>
        ) : (
          <div className={styles.field}>
            <label htmlFor="recovery-email">이메일</label>
            <input
              id="recovery-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              required
              className={styles.input}
              placeholder="name@example.com"
            />
          </div>
        )}
        {sent && !resetting ? (
          <p className={styles.notice} role="status">
            입력한 이메일에 연결된 계정이 있다면 안내 메일을 보냈습니다.
            스팸함도 확인해 주세요.
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={seconds > 0}
          className={styles.primaryButton}
          aria-busy={pending}
        >
          <span className={styles.buttonLabel}>
            {pending
              ? "요청 중"
              : seconds > 0
                ? `${seconds}초 후 재전송`
                : resetting
                  ? "비밀번호 변경"
                  : mode === "verify-email"
                    ? "인증 메일 보내기"
                    : "재설정 링크 보내기"}
          </span>
          {pending ? (
            <LoaderCircle
              size={17}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <ArrowRight size={17} aria-hidden="true" />
          )}
        </button>
      </fieldset>
      {!enabled && !preview ? (
        <p className={styles.note}>이메일 인증은 준비 중입니다.</p>
      ) : null}
      <div className={styles.recoveryLinks}>
        <Link
          href={`/auth/sign-in${preview ? "?preview=design" : ""}`}
          className={styles.textLink}
        >
          로그인으로 돌아가기
        </Link>
      </div>
    </form>
  );
}
