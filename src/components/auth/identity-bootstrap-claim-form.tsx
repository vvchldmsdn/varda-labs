"use client";

import { AuthText } from "./auth-localized";
import { useState, type FormEvent } from "react";
import { Button as CairnButton, Field as CairnField, Form as CairnForm, Input as CairnInput, SectionTitle as CairnSectionTitle, Status as CairnStatus } from "@/components/cairn-ui";


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
      <CairnSectionTitle className="font-medium"><AuthText>{"기존 포트폴리오 연결"}</AuthText></CairnSectionTitle>
      <CairnForm className="mt-3 space-y-3" onSubmit={submitClaim}>
        <CairnField className="block text-sm font-semibold text-[var(--muted)]"><AuthText>{"안내받은 일회용 연결 코드"}</AuthText><CairnInput
            name="claim"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            className="mt-2 block w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm text-[var(--ink)] disabled:bg-[var(--paper)] disabled:text-[var(--faint)]"
          />
        </CairnField>
        <CairnButton variant="primary"
          type="submit"
          disabled={locked}
          className="rounded-md bg-[var(--ink)] px-4 py-2 font-semibold text-white hover:bg-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AuthText>{status === "submitting" ? "확인 중" : "연결 코드 확인"}</AuthText>
        </CairnButton>
      </CairnForm>

      {status === "submitted" ? (
        <CairnStatus as="p" tone="neutral" role="status" className="mt-3 text-sm text-[var(--brand)]"><AuthText>{"코드가 전달되었습니다. 서버 확인 후 계정 연결 상태가 반영됩니다."}</AuthText></CairnStatus>
      ) : null}
      {status === "failed" ? (
        <CairnStatus as="p" tone="danger" role="alert" className="mt-3 text-sm text-[var(--negative)]"><AuthText>{"코드 전달 여부를 확인하지 못했습니다. 중복 제출하지 말고 운영자에게 확인해 주세요."}</AuthText></CairnStatus>
      ) : null}
    </section>
  );
}
