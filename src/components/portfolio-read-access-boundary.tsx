import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import { redirect } from "next/navigation";

import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import { sessionResolutionNextAction } from "@/lib/session-resolution-next-action";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export function PortfolioReadAccessBoundary({
  closedMessage =
    "Portfolio data remains closed until the session and owner link are available.",
  description =
    "This view reads portfolio data only after the signed-in user and canonical account ownership are resolved on the server.",
  resolution,
  title,
}: {
  closedMessage?: string;
  description?: string;
  resolution: SessionResolverResult;
  title: string;
}) {
  if (!resolution.ok && resolution.failure.code === "unauthenticated") redirect("/auth/sign-in");
  if (!resolution.ok && resolution.failure.code === "identity_unlinked") redirect("/portfolio/onboarding");
  const nextAction = sessionResolutionNextAction(resolution);

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <EvidenceCell
            label="Portfolio user link"
            value={sessionResolutionEvidence(resolution)}
          />
          <EvidenceCell label="Product database read" value="Not attempted" />
        </dl>
        <p className="mt-6 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
          {closedMessage}
        </p>
        <Link
          href={nextAction.href}
          className="mt-5 inline-flex rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
        >
          {nextAction.label}
        </Link>
      </section>
    </main>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
