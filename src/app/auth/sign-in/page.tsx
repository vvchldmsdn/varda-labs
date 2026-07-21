import { notFound } from "next/navigation";

import { PreviewGoogleSignInButton } from "@/components/auth/preview-auth-controls";
import { getPreviewAuthRuntimeState } from "@/lib/auth/preview-auth-runtime";

export const dynamic = "force-dynamic";

export default function PreviewSignInPage() {
  const runtime = getPreviewAuthRuntimeState();
  if (runtime.state === "disabled") notFound();

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-md rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <p className="text-xs font-semibold text-[#687064]">Varda Labs Preview</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          Authentication smoke check
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#566056]">
          This Preview-only screen verifies Neon Auth sign-in and server session
          transport. It does not link a portfolio user.
        </p>

        <div className="mt-6">
          {runtime.state === "ready" ? (
            <PreviewGoogleSignInButton />
          ) : (
            <p className="rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
              Preview authentication is unavailable.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
