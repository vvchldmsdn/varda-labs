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
    <section className="mt-6 rounded-md border border-[var(--line)] bg-white p-4">
      <h2 className="font-medium">기존 포트폴리오 연결</h2>
      <form className="mt-3 space-y-3" onSubmit={submitClaim}>
        <label className="block text-sm font-semibold text-[var(--muted)]">
          안내받은 일회용 연결 코드
          <input
            name="claim"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            className="mt-2 block w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm text-[var(--ink)] disabled:bg-[var(--paper)] disabled:text-[var(--faint)]"
          />
        </label>
        <button
          type="submit"
          disabled={locked}
          className="rounded-md bg-[var(--ink)] px-4 py-2 font-semibold text-white hover:bg-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "확인 중" : "연결 코드 확인"}
        </button>
      </form>

      {status === "submitted" ? (
        <p role="status" className="mt-3 text-sm text-[var(--brand)]">
          코드가 전달되었습니다. 서버 확인 후 계정 연결 상태가 반영됩니다.
        </p>
      ) : null}
      {status === "failed" ? (
        <p role="alert" className="mt-3 text-sm text-[var(--negative)]">
          코드 전달 여부를 확인하지 못했습니다. 중복 제출하지 말고 운영자에게 확인해 주세요.
        </p>
      ) : null}
    </section>
  );
}
