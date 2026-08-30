"use client";

import { useActionState } from "react";

import { createEmptyPortfolio } from "@/app/portfolio/onboarding/actions";
import {
  INITIAL_SELF_SERVICE_TENANT_ONBOARDING_STATE,
  SELF_SERVICE_TENANT_ONBOARDING_POLICY,
} from "@/lib/auth/self-service-tenant-onboarding";

export function SelfServiceTenantOnboardingForm() {
  const [state, action, pending] = useActionState(
    createEmptyPortfolio,
    INITIAL_SELF_SERVICE_TENANT_ONBOARDING_STATE,
  );

  return (
    <form
      action={action}
      className="mt-5 rounded-md border border-[var(--line)] bg-white p-4"
    >
      <h2 className="font-semibold">Create a new empty portfolio</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Use this only for a new Varda account. Existing migrated portfolio data
        must be connected through the reviewed claim process instead.
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-[var(--ink)]">
        <input
          required
          type="checkbox"
          name="confirmation"
          value={SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue}
          className="mt-1"
        />
        <span>I confirm that I do not need existing portfolio data attached.</span>
      </label>

      {state.status !== "idle" ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]"
        >
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-[var(--ink)] px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Creating..." : "Create portfolio"}
      </button>
    </form>
  );
}
