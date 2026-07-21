import Link from "next/link";
import { notFound } from "next/navigation";

import { PreviewSignOutButton } from "@/components/auth/preview-auth-controls";
import { getPreviewAuthRuntime } from "@/lib/auth/preview-auth-runtime";

export const dynamic = "force-dynamic";

type SessionEvidence =
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

export default async function PreviewSessionPage() {
  const runtime = getPreviewAuthRuntime();
  if (runtime.state === "disabled") notFound();

  const evidence = await readSessionEvidence(runtime);

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <p className="text-xs font-semibold text-[#687064]">Varda Labs Preview</p>
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
          <p className="mt-4 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
            The server session is currently unavailable.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {evidence === "authenticated" ? <PreviewSignOutButton /> : null}
          <Link
            href="/auth/sign-in"
            className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 font-semibold text-[#35423a] hover:bg-[#eef2e8]"
          >
            Sign-in screen
          </Link>
        </div>
      </section>
    </main>
  );
}

async function readSessionEvidence(
  runtime: ReturnType<typeof getPreviewAuthRuntime>,
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
    <div className="rounded-md border border-[#dfe3d5] bg-white p-4">
      <dt className="text-xs font-semibold text-[#687064]">{label}</dt>
      <dd className="mt-2 font-semibold">{value}</dd>
    </div>
  );
}
