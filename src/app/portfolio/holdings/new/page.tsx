import Link from "next/link";

import { HoldingOnboardingForm } from "@/components/holding-onboarding-form";
import { getHoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

export default async function NewHoldingPage() {
  const resolution = await resolveCurrentTenantContext();
  const options = resolution.ok
    ? await getHoldingOnboardingOptions(resolution.tenantContext)
    : null;

  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal">
              보유종목 추가
            </h1>
          </div>
          <Link
            className="rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
            href="/portfolio/holdings?account=all"
          >
            보유종목
          </Link>
        </div>

        {!resolution.ok ? (
          <div className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-4 text-sm text-[#76591f]">
            <p>로그인 후 보유종목을 추가할 수 있습니다.</p>
            <Link
              className="mt-3 inline-block font-semibold underline"
              href="/auth/sign-in"
            >
              로그인
            </Link>
          </div>
        ) : options?.state !== "ready" ? (
          <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-4 text-sm text-[#76591f]">
            계좌와 자산 그룹 정보를 불러오지 못했습니다.
          </p>
        ) : options.accounts.length === 0 ? (
          <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-4 text-sm text-[#76591f]">
            먼저 보유 계좌를 만들어야 합니다.
          </p>
        ) : (
          <HoldingOnboardingForm options={options} />
        )}
      </section>
    </main>
  );
}
