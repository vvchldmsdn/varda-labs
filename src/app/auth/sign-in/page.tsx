import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { notFound } from "next/navigation";

import { GoogleSignInButton } from "@/components/auth/auth-transport-controls";
import { getAuthTransportRuntimeState } from "@/lib/auth/auth-transport-runtime";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const runtime = getAuthTransportRuntimeState();
  if (runtime.state === "disabled") notFound();

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          Sign in
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          Google sign-in verifies your session. Portfolio access remains
          unavailable until your account is explicitly linked.
        </p>

        <div className="mt-6">
          {runtime.state === "ready" ? (
            <GoogleSignInButton />
          ) : (
            <p className="rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
              Authentication is unavailable.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
