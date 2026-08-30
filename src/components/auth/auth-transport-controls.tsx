"use client";

import { useState } from "react";
import { GoogleIcon, GitHubIcon } from "@neondatabase/auth/react/ui";
import { LoaderCircle, LogOut } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { authErrorMessage } from "@/lib/auth/auth-error-message";
import {
  SOCIAL_AUTH_LABELS,
  type AuthMethodAvailability,
  type SocialAuthProvider,
} from "@/lib/auth/auth-methods";
import { AUTH_TRANSPORT_CALLBACK_PATH } from "@/lib/auth/auth-transport-routes";
import {
  isNaverAuthorizationUrl,
  NAVER_AUTH_BASE_PATH,
} from "@/lib/auth/naver-auth-policy";
import styles from "./auth-experience.module.css";

export function SocialSignInButtons({
  mode,
  availability,
  preview = false,
}: {
  mode: "sign-in" | "sign-up";
  availability: AuthMethodAvailability;
  preview?: boolean;
}) {
  const [pending, setPending] = useState<SocialAuthProvider | null>(null);
  const [error, setError] = useState("");
  const [previewNotice, setPreviewNotice] = useState(false);

  async function signIn(provider: SocialAuthProvider) {
    if (pending) return;
    if (preview) {
      setPreviewNotice(true);
      return;
    }
    if (!availability[provider]) return;
    setPending(provider);
    setError("");
    try {
      if (provider === "naver") {
        const csrfResponse = await fetch(`${NAVER_AUTH_BASE_PATH}/csrf`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        const csrf: unknown = await csrfResponse.json();
        if (
          !csrfResponse.ok ||
          typeof csrf !== "object" ||
          !csrf ||
          !("csrfToken" in csrf) ||
          typeof csrf.csrfToken !== "string"
        )
          throw new Error("Auth unavailable");
        const response = await fetch(`${NAVER_AUTH_BASE_PATH}/signin/naver`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            csrfToken: csrf.csrfToken,
            callbackUrl: "/auth/session",
          }),
        });
        const result: unknown = await response.json();
        if (
          !response.ok ||
          typeof result !== "object" ||
          !result ||
          !("url" in result) ||
          !isNaverAuthorizationUrl(result.url)
        )
          throw new Error("Auth unavailable");
        window.location.assign(result.url);
      } else {
        const result = await authClient.signIn.social({
          provider,
          callbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
          newUserCallbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
          errorCallbackURL: "/auth/sign-in",
        });
        if (result.error) {
          setError(authErrorMessage(result.error));
          setPending(null);
        }
      }
    } catch {
      setError(
        `${SOCIAL_AUTH_LABELS[provider]}로 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
      );
      setPending(null);
    }
  }

  return (
    <div className={styles.stack}>
      <div className={styles.socialGroup} aria-label="소셜 로그인">
        {(["google", "github", "naver"] as const).map((provider) => {
          const enabled = preview || availability[provider];
          const label = SOCIAL_AUTH_LABELS[provider];
          return (
            <button
              key={provider}
              type="button"
              onClick={() => signIn(provider)}
              disabled={!enabled || pending !== null}
              className={styles.socialButton}
              aria-label={`${label}로 ${mode === "sign-up" ? "가입하기" : "로그인"}${enabled ? "" : " (설정 준비 중)"}`}
              aria-busy={pending === provider}
              title={
                enabled ? `${label}로 계속` : `${label} 로그인 설정 준비 중`
              }
            >
              {pending === provider ? (
                <LoaderCircle
                  size={20}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <span className={styles.providerIcon} aria-hidden="true">
                  {provider === "google" ? (
                    <GoogleIcon />
                  ) : provider === "github" ? (
                    <GitHubIcon />
                  ) : (
                    <span className={styles.naverMark}>N</span>
                  )}
                </span>
              )}
              <span>{label}</span>
              {!enabled ? <small>준비 중</small> : null}
            </button>
          );
        })}
      </div>
      {previewNotice ? (
        <p role="status" className={styles.notice}>
          화면 미리보기입니다. 실제 로그인은 운영 서비스에서 진행할 수 있습니다.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SignOutButton() {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");

  async function signOut() {
    if (status === "pending") return;
    setStatus("pending");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setStatus("failed");
        return;
      }
      window.location.replace("/auth/sign-in");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className={styles.stack}>
      <button
        type="button"
        onClick={signOut}
        disabled={status === "pending"}
        className={styles.secondaryButton}
        aria-busy={status === "pending"}
      >
        <LogOut size={16} aria-hidden="true" />
        {status === "pending" ? "로그아웃 중" : "로그아웃"}
      </button>
      {status === "failed" ? (
        <p role="alert" className={styles.error}>
          로그아웃하지 못했습니다. 로그인 상태가 유지되고 있으니 다시 시도해
          주세요.
        </p>
      ) : null}
    </div>
  );
}
