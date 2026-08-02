import Link from "next/link";

import { sessionResolutionEvidence } from "@/lib/session-resolution-evidence";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";

export function PortfolioDashboardAccessBoundary({
  resolution,
  title,
}: {
  resolution: SessionResolverResult;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-2 text-sm text-[#687064]">
          This view reads portfolio data only after the signed-in user and
          canonical account ownership are resolved on the server.
        </p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          <EvidenceCell
            label="Portfolio user link"
            value={sessionResolutionEvidence(resolution)}
          />
          <EvidenceCell label="Product database read" value="Not attempted" />
        </dl>
        <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
          Portfolio data remains closed until the session and owner link are
          available.
        </p>
        <Link
          href="/auth/sign-in"
          className="mt-5 inline-flex rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
        >
          Sign in
        </Link>
      </section>
    </main>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
