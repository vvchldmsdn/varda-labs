"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import { useState } from "react";

import { AUTH_TRANSPORT_CALLBACK_PATH } from "@/lib/auth/auth-transport-routes";

const authClient = createAuthClient();

export function GoogleSignInButton() {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");

  async function signIn() {
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
        className="w-full rounded-md bg-[#173f38] px-4 py-3 font-semibold text-white hover:bg-[#0f312b] disabled:cursor-wait disabled:opacity-60"
      >
        {status === "pending" ? "Connecting to Google" : "Continue with Google"}
      </button>
      {status === "failed" ? (
        <p role="alert" className="text-sm text-[#a43e3e]">
          Sign-in could not be started. Try again.
        </p>
      ) : null}
    </div>
  );
}

export function SignOutButton() {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");

  async function signOut() {
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
        className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 font-semibold text-[#35423a] hover:bg-[#eef2e8] disabled:cursor-wait disabled:opacity-60"
      >
        {status === "pending" ? "Signing out" : "Sign out"}
      </button>
      {status === "failed" ? (
        <p role="alert" className="text-sm text-[#a43e3e]">
          Sign-out failed. Your session is still active.
        </p>
      ) : null}
    </div>
  );
}
