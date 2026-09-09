"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowRight, Check, LoaderCircle, MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import { AUTH_EMAIL_VERIFIED_PATH } from "@/lib/auth/auth-methods";
import { AuthElement, AuthText } from "./auth-localized";
import styles from "./auth-experience.module.css";

export function EmailVerificationForm({
  initialEmail = "",
  initialCooldownSeconds = 0,
  enabled,
  preview = false,
  onBack,
}: {
  initialEmail?: string;
  initialCooldownSeconds?: number;
  enabled: boolean;
  preview?: boolean;
  onBack?: () => void;
}) {
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [step, setStep] = useState<"email" | "code" | "complete">(
    initialEmail ? "code" : "email",
  );
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState<"send" | "verify" | null>(null);
  const [seconds, setSeconds] = useState(initialCooldownSeconds);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const unavailable = !enabled && !preview;
  const signInHref = `/auth/sign-in${preview ? "?preview=design" : "?verified=1"}`;

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds(seconds - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function sendCode() {
    if (pending || seconds > 0 || unavailable) return;
    setPending("send");
    setError("");
    setNotice("");
    try {
      if (!preview) {
        const result = await authClient.sendVerificationEmail({
          email: email.trim(),
          callbackURL: AUTH_EMAIL_VERIFIED_PATH,
        });
        if (result.error) {
          setError(authErrorMessage(result.error));
          return;
        }
      }
      setEmail(email.trim());
      setOtp("");
      setStep("code");
      setSeconds(60);
      setNotice(preview
        ? "화면 미리보기입니다. 메일 전송과 실제 인증은 수행하지 않습니다."
        : "인증 코드를 요청했습니다. 해당 이메일의 미인증 계정이 있다면 메일이 발송됩니다. 스팸함도 확인해 주세요.");
    } catch {
      setError(authErrorMessage(null));
    } finally {
      setPending(null);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || unavailable || !/^[0-9]{6}$/.test(otp)) return;
    setPending("verify");
    setError("");
    setNotice("");
    const submittedCode = otp;
    setOtp("");
    try {
      if (!preview) {
        const result = await authClient.emailOtp.verifyEmail({ email, otp: submittedCode });
        if (result.error) {
          setError(authErrorMessage(result.error));
          return;
        }
        if (result.data?.status !== true || result.data.user?.emailVerified !== true) {
          setError("인증 결과를 확인하지 못했습니다. 로그인 화면에서 다시 확인해 주세요.");
          return;
        }
      }
      setStep("complete");
    } catch {
      setError(authErrorMessage(null));
    } finally {
      setPending(null);
    }
  }

  function changeEmail() {
    if (pending) return;
    setOtp("");
    setError("");
    setNotice("");
    if (onBack) onBack();
    else setStep("email");
  }

  if (step === "complete") return (
    <div className={styles.stack}>
      <p className={styles.verificationState} role="status">
        <Check size={22} aria-hidden="true" />
        <AuthText>{preview ? "인증 완료 화면 미리보기" : "이메일 인증을 완료했습니다."}</AuthText>
      </p>
      <p className={styles.note}><AuthText>{preview
        ? "화면 미리보기입니다. 메일 전송과 실제 인증은 수행하지 않습니다."
        : "가입할 때 설정한 비밀번호로 로그인해 주세요."}</AuthText></p>
      <Link href={signInHref} className={styles.primaryButton}>
        <AuthText>{"로그인으로 계속"}</AuthText><ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );

  return (
    <div className={styles.stack}>
      <AuthElement as="form"
        className={styles.emailForm}
        aria-label={step === "email" ? "인증 코드 요청" : "인증 코드 확인"}
        onSubmit={step === "code" ? verifyCode : (event) => {
          event.preventDefault();
          const action = (event.nativeEvent as SubmitEvent).submitter;
          if (action instanceof HTMLButtonElement && action.value === "existing") {
            setEmail(email.trim());
            setStep("code");
            setError("");
          } else void sendCode();
        }}
      >
        <fieldset className={styles.form} disabled={!!pending || unavailable}>
          {step === "email" ? (
            <div className={styles.field}>
              <label htmlFor={`${id}-email`}><AuthText>{"이메일"}</AuthText></label>
              <AuthElement as="input" id={`${id}-email`} type="email" name="email"
                value={email} onChange={(event) => setEmail(event.target.value)}
                autoComplete="email" inputMode="email" autoCapitalize="none"
                spellCheck={false} maxLength={254} required className={styles.input}
                placeholder="name@example.com" />
            </div>
          ) : (
            <>
              <div className={styles.verificationState}>
                <MailCheck size={22} aria-hidden="true" />
                <strong><AuthText>{"이메일의 인증 코드를 입력해 주세요"}</AuthText></strong>
              </div>
              <p className={styles.note} id={`${id}-hint`}>
                <span className={styles.emailAddress}>{email}</span>
                <br /><AuthText>{"메일에 있는 6자리 숫자를 입력해 주세요. 만료된 코드는 다시 요청할 수 있습니다."}</AuthText>
              </p>
              <div className={styles.field}>
                <label htmlFor={`${id}-otp`}><AuthText>{"인증 코드"}</AuthText></label>
                <AuthElement as="input" id={`${id}-otp`} name="otp" type="text"
                  value={otp} onChange={(event) => setOtp(event.target.value.replace(/\s/g, ""))}
                  onPaste={(event) => {
                    const pastedCode = event.clipboardData.getData("text").replace(/\s/g, "");
                    if (/^[0-9]{6}$/.test(pastedCode)) {
                      event.preventDefault();
                      setOtp(pastedCode);
                    }
                  }}
                  inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none"
                  spellCheck={false} pattern="[0-9]{6}" minLength={6} maxLength={6}
                  required autoFocus aria-describedby={`${id}-hint`}
                  aria-invalid={error ? true : undefined}
                  className={`${styles.input} ${styles.verificationCode}`} placeholder="6자리 숫자" />
              </div>
            </>
          )}
          {error ? <p className={styles.error} role="alert"><AuthText>{error}</AuthText></p> : null}
          {notice ? <p className={styles.notice} role="status"><AuthText>{notice}</AuthText></p> : null}
          <button type="submit" className={styles.primaryButton} aria-busy={!!pending}
            disabled={step === "email" ? seconds > 0 : !/^[0-9]{6}$/.test(otp)}>
            <AuthText>{pending === "verify" ? "확인 중" : pending === "send" ? "요청 중" : step === "code" ? "인증하고 계속" : "인증 코드 요청"}</AuthText>
            {pending ? <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight size={17} aria-hidden="true" />}
          </button>
          {step === "email" ? <button type="submit" value="existing" className={styles.textLink}>
            <AuthText>{"이미 받은 코드 입력"}</AuthText>
          </button> : null}
        </fieldset>
      </AuthElement>
      {unavailable ? <p className={styles.note}><AuthText>{"이메일 인증은 준비 중입니다."}</AuthText></p> : null}
      {step === "code" ? (
        <>
          <button type="button" className={styles.secondaryButton} onClick={sendCode}
            disabled={!!pending || seconds > 0 || unavailable}>
            <AuthText>{pending === "send" ? "요청 중" : seconds > 0 ? `${seconds}초 후 재전송` : "인증 코드 재전송"}</AuthText>
          </button>
          <button type="button" className={styles.textLink} onClick={changeEmail} disabled={!!pending}>
            <AuthText>{"다른 이메일 사용"}</AuthText>
          </button>
        </>
      ) : seconds > 0 ? <p className={styles.note} role="status"><AuthText>{`${seconds}초 후 재전송`}</AuthText></p> : null}
      <Link href={`/auth/sign-in${preview ? "?preview=design" : ""}`} className={styles.textLink}>
        <AuthText>{"로그인으로 돌아가기"}</AuthText>
      </Link>
    </div>
  );
}
