import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SelfServiceTenantOnboardingForm } from "@/components/auth/self-service-tenant-onboarding-form";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

export default async function PortfolioOnboardingPage() {
  const resolution = await resolveCurrentTenantContext();
  if (resolution.ok) redirect("/portfolio/accounts?account=all");

  const canCreate = resolution.failure.code === "identity_unlinked";
  const needsSignIn = resolution.failure.code === "unauthenticated";

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          Start a portfolio
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          New users start with an empty portfolio, then create only the custody
          accounts and analysis groups they actually need.
        </p>

        {canCreate ? <SelfServiceTenantOnboardingForm /> : null}

        {!canCreate ? (
          <div className="mt-5 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            {needsSignIn
              ? "Sign in before creating a portfolio."
              : "Portfolio onboarding is unavailable until the identity state is reviewed."}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={needsSignIn ? "/auth/sign-in" : "/auth/session"}
            className="rounded-md border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
          >
            {needsSignIn ? "Sign in" : "Session evidence"}
          </Link>
        </div>
      </section>
    </main>
  );
}
