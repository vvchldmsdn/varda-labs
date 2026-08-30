"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { AUTH_EMAIL_VERIFIED_PATH } from "@/lib/auth/auth-methods";
import { AUTH_TRANSPORT_SESSION_PATH } from "@/lib/auth/auth-transport-routes";
import { AuthPasswordField } from "./auth-password-field";
import styles from "./auth-experience.module.css";

export function EmailAuthForm({
  mode,
  enabled,
  preview = false,
}: {
  mode: "sign-in" | "sign-up";
  enabled: boolean;
  preview?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const signingUp = mode === "sign-up";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (!enabled && !preview)) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setError("");
    if (signingUp && password !== String(data.get("password-confirm") ?? "")) {
      setError("비밀번호가 서로 다릅니다. 다시 확인해 주세요.");
      return;
    }
    if (preview) {
      setNotice(
        "화면 미리보기입니다. 입력한 정보는 전송하거나 저장하지 않습니다.",
      );
      return;
    }
    setPending(true);
    try {
      if (signingUp) {
        const result = await authClient.signUp.email({
          name: String(data.get("name") ?? "").trim(),
          email,
          password,
          callbackURL: AUTH_EMAIL_VERIFIED_PATH,
        });
        if (result.error) setError(authErrorMessage(result.error));
        else setVerificationEmail(email);
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
          callbackURL: AUTH_TRANSPORT_SESSION_PATH,
        });
        if (result.error?.code === "EMAIL_NOT_VERIFIED")
          setVerificationEmail(email);
        else if (result.error) setError(authErrorMessage(result.error));
        else if (result.data?.user.emailVerified !== true)
          setVerificationEmail(email);
        else window.location.replace(AUTH_TRANSPORT_SESSION_PATH);
      }
    } catch {
      setError(authErrorMessage(null));
    } finally {
      setPending(false);
    }
  }

  if (verificationEmail) {
    return (
      <VerificationNotice
        email={verificationEmail}
        onBack={() => setVerificationEmail("")}
      />
    );
  }
  return (
    <form
      onSubmit={submit}
      className={styles.emailForm}
      aria-label={signingUp ? "이메일 회원가입" : "이메일 로그인"}
    >
      <fieldset
        className={styles.form}
        disabled={pending || (!enabled && !preview)}
      >
        {signingUp ? (
          <div className={styles.field}>
            <label htmlFor="auth-name">이름</label>
            <input
              id="auth-name"
              name="name"
              type="text"
              autoComplete="nickname"
              maxLength={80}
              required
              className={styles.input}
              placeholder="사용할 이름"
            />
          </div>
        ) : null}
        <div className={styles.field}>
          <label htmlFor="auth-email">이메일</label>
          <input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            className={styles.input}
            placeholder="name@example.com"
          />
        </div>
        <AuthPasswordField id="password" newPassword={signingUp} />
        {signingUp ? (
          <AuthPasswordField
            id="password-confirm"
            label="비밀번호 확인"
            newPassword
          />
        ) : null}
        {error ? (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        ) : null}
        <button
          className={styles.primaryButton}
          type="submit"
          aria-busy={pending}
        >
          <span className={styles.buttonLabel}>
            {pending
              ? "확인 중"
              : signingUp
                ? "이메일로 가입하기"
                : "이메일로 로그인"}
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
        <p className={styles.note}>이메일 로그인은 준비 중입니다.</p>
      ) : null}
      <div className={styles.recoveryLinks}>
        <Link
          href={`/auth/forgot-password${preview ? "?preview=design" : ""}`}
          className={styles.textLink}
        >
          비밀번호 찾기
        </Link>
        <Link
          href={`/auth/verify-email${preview ? "?preview=design" : ""}`}
          className={styles.textLink}
        >
          인증 메일 재전송
        </Link>
      </div>
    </form>
  );
}

function VerificationNotice({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds(seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function resend() {
    if (pending || seconds > 0) return;
    setPending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: AUTH_EMAIL_VERIFIED_PATH,
      });
      setMessage(
        result.error
          ? authErrorMessage(result.error)
          : "인증 메일을 다시 요청했습니다. 스팸함도 확인해 주세요.",
      );
      if (!result.error) setSeconds(60);
    } catch {
      setMessage(authErrorMessage(null));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.stack} role="status">
      <div className={styles.verificationState}>
        <MailCheck size={22} aria-hidden="true" />
        <strong>이메일을 확인해 주세요</strong>
      </div>
      <p className={styles.note}>
        <span className={styles.emailAddress}>{email}</span>으로 받은 인증
        메일의 링크를 연 뒤 로그인해 주세요.
      </p>
      <Link href="/auth/sign-in" className={styles.primaryButton}>
        로그인으로 계속 <ArrowRight size={16} aria-hidden="true" />
      </Link>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={resend}
        disabled={pending || seconds > 0}
      >
        {pending
          ? "요청 중"
          : seconds > 0
            ? `${seconds}초 후 재전송`
            : "인증 메일 재전송"}
      </button>
      {message ? <p className={styles.note}>{message}</p> : null}
      <button type="button" onClick={onBack} className={styles.textLink}>
        다른 이메일 사용
      </button>
    </div>
  );
}
