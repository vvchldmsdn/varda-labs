"use client";

import { useState, type FormEvent } from "react";

const PRESENTATION_ENDPOINT =
  "/api/identity/bootstrap-claim/present";

type SubmissionStatus =
  | "idle"
  | "submitting"
  | "submitted"
  | "failed";

export function IdentityBootstrapClaimForm() {
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const locked = status !== "idle";

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    let rawClaim: string | null = String(formData.get("claim") ?? "").trim();
    if (rawClaim.length === 0) return;

    form.reset();
    setStatus("submitting");

    try {
      const body = JSON.stringify({ claim: rawClaim });
      rawClaim = null;
      const response = await fetch(PRESENTATION_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
        },
        body,
      });

      setStatus(response.status === 204 ? "submitted" : "failed");
    } catch {
      setStatus("failed");
    } finally {
      rawClaim = null;
    }
  }

  return (
    <section className="mt-6 rounded-md border border-[#dfe3d5] bg-white p-4">
      <h2 className="font-semibold">One-time account link</h2>
      <form className="mt-3 space-y-3" onSubmit={submitClaim}>
        <label className="block text-sm font-semibold text-[#4f594e]">
          Bootstrap claim
          <input
            name="claim"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            className="mt-2 block w-full rounded-md border border-[#cfd6c8] bg-white px-3 py-2 font-mono text-sm text-[#171916] disabled:bg-[#f3f4ef] disabled:text-[#7b8278]"
          />
        </label>
        <button
          type="submit"
          disabled={locked}
          className="rounded-md bg-[#173f38] px-4 py-2 font-semibold text-white hover:bg-[#0f312b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "Submitting" : "Link once"}
        </button>
      </form>

      {status === "submitted" ? (
        <p role="status" className="mt-3 text-sm text-[#386744]">
          Submitted once. Server verification is pending.
        </p>
      ) : null}
      {status === "failed" ? (
        <p role="alert" className="mt-3 text-sm text-[#a43e3e]">
          Submission was not confirmed. Stop here; do not submit again.
        </p>
      ) : null}
    </section>
  );
}
