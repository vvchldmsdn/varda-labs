"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import { useState } from "react";
import { ArrowUpRight, LoaderCircle, LogOut } from "lucide-react";

import { AUTH_TRANSPORT_CALLBACK_PATH } from "@/lib/auth/auth-transport-routes";
import styles from "./auth-experience.module.css";

const authClient = createAuthClient();

export function GoogleSignInButton({
  mode = "sign-in",
  preview = false,
}: {
  mode?: "sign-in" | "sign-up";
  preview?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");
  const [previewNotice, setPreviewNotice] = useState(false);

  async function signIn() {
    if (status === "pending") return;
    if (preview) {
      setPreviewNotice(true);
      return;
    }
    setStatus("pending");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
        newUserCallbackURL: AUTH_TRANSPORT_CALLBACK_PATH,
        errorCallbackURL: "/auth/sign-in",
      });

      if (result.error) setStatus("failed");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signIn}
        disabled={status === "pending"}
        className={styles.primaryButton}
        aria-busy={status === "pending"}
      >
        <span className={styles.buttonLabel}>
          {status === "pending"
            ? "Google로 연결 중"
            : mode === "sign-up"
              ? "Google로 가입하기"
              : "Google로 로그인"}
        </span>
        {status === "pending" ? (
          <LoaderCircle
            className="animate-spin motion-reduce:animate-none"
            size={17}
            aria-hidden="true"
          />
        ) : (
          <ArrowUpRight size={17} aria-hidden="true" />
        )}
      </button>
      {previewNotice ? (
        <p role="status" className={styles.notice}>
          화면 미리보기입니다. 실제 로그인은 운영 서비스에서 진행할 수 있습니다.
        </p>
      ) : null}
      {status === "failed" ? (
        <p role="alert" className="text-sm text-[var(--negative)]">
          Google로 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.
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
    <div className="space-y-2">
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
        <p role="alert" className="text-sm text-[var(--negative)]">
          로그아웃하지 못했습니다. 로그인 상태가 유지되고 있으니 다시 시도해
          주세요.
        </p>
      ) : null}
    </div>
  );
}
