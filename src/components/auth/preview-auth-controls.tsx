"use client";

import { createAuthClient } from "@neondatabase/auth/next";
import { useState } from "react";

const authClient = createAuthClient();

export function PreviewGoogleSignInButton() {
  const [status, setStatus] = useState<"idle" | "pending" | "failed">("idle");

  async function signIn() {
    setStatus("pending");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/auth/session",
        newUserCallbackURL: "/auth/session",
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

export function PreviewSignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);

    try {
      await authClient.signOut();
    } finally {
      window.location.assign("/auth/sign-in");
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 font-semibold text-[#35423a] hover:bg-[#eef2e8] disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Signing out" : "Sign out of Preview"}
    </button>
  );
}
