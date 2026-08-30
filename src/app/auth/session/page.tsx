import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignOutButton } from "@/components/auth/auth-transport-controls";
import { IdentityBootstrapClaimForm } from "@/components/auth/identity-bootstrap-claim-form";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import {
  assessIdentityPairingClaimPresentationEnvironment,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV,
} from "@/lib/auth/identity-pairing-claim-presentation-policy";

export const dynamic = "force-dynamic";

type SessionEvidence =
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

export default async function SessionPage() {
  const runtime = getAuthTransportRuntime();
  if (runtime.state === "disabled") notFound();

  const evidence = await readSessionEvidence(runtime);
  const presentationRuntime =
    assessIdentityPairingClaimPresentationEnvironment({
      VERCEL_ENV: process.env.VERCEL_ENV,
      IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE:
        process.env[IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV],
    });

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          Server session evidence
        </h1>

        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <EvidenceCell
            label="Authenticated session"
            value={evidence === "authenticated" ? "Present" : "Not present"}
          />
          <EvidenceCell
            label="Server user identifier"
            value={evidence === "authenticated" ? "Present" : "Not exposed"}
          />
          <EvidenceCell label="Portfolio user link" value="Not attempted" />
          <EvidenceCell label="Product database read" value="Not attempted" />
        </dl>

        {evidence === "unavailable" ? (
          <p className="mt-4 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
            The server session is currently unavailable.
          </p>
        ) : null}

        {evidence === "authenticated" &&
        presentationRuntime.state === "enabled" ? (
          <IdentityBootstrapClaimForm />
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {evidence === "authenticated" ? <SignOutButton /> : null}
          <Link
            href="/auth/sign-in"
            className="rounded-md border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          >
            Sign-in screen
          </Link>
          {evidence === "authenticated" ? (
            <Link
              href="/portfolio/accounts?account=all"
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
            >
              Owner-scoped accounts
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}

async function readSessionEvidence(
  runtime: ReturnType<typeof getAuthTransportRuntime>,
): Promise<SessionEvidence> {
  if (runtime.state !== "ready") return "unavailable";

  try {
    const result = await runtime.auth.getSession();
    if (result.error) return "unavailable";
    return result.data?.user.id ? "authenticated" : "unauthenticated";
  } catch {
    return "unavailable";
  }
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
