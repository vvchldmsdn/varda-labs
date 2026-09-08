import { localizedMetadata } from "@/lib/i18n/server";
import { ManagementText } from "@/components/i18n/management-text";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { HoldingOnboardingForm } from "@/components/holding-onboarding-form";
import { getHoldingOnboardingOptions } from "@/db/queries/holding-onboarding";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "보유 종목 추가 | VARDA LABS" }, "Add holding | VARDA LABS");
}

export default async function NewHoldingPage() {
  const resolution = await resolveCurrentTenantContext();
  const options = resolution.ok
    ? await getHoldingOnboardingOptions(resolution.tenantContext)
    : null;

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-normal"><ManagementText>{"보유종목 추가"}</ManagementText></h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
              href="/portfolio/groups"
            ><ManagementText>{"분석 범위"}</ManagementText></Link>
            <Link
              className="rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
              href="/portfolio/holdings?account=all"
            ><ManagementText>{"보유종목"}</ManagementText></Link>
          </div>
        </div>

        {!resolution.ok ? (
          <div className="mt-6 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            <p><ManagementText>{"로그인 후 보유종목을 추가할 수 있습니다."}</ManagementText></p>
            <Link
              className="mt-3 inline-block font-semibold underline"
              href="/auth/sign-in"
            ><ManagementText>{"로그인"}</ManagementText></Link>
          </div>
        ) : options?.state !== "ready" ? (
          <p className="mt-6 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]"><ManagementText>{"계좌와 분석 범위 정보를 불러오지 못했습니다."}</ManagementText></p>
        ) : options.accounts.length === 0 ? (
          <div className="mt-6 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            <p><ManagementText>{"먼저 보유 계좌를 만들어야 합니다."}</ManagementText></p>
            <Link
              className="mt-3 inline-block font-semibold underline"
              href="/portfolio/accounts"
            ><ManagementText>{"계좌 관리 열기"}</ManagementText></Link>
          </div>
        ) : (
          <HoldingOnboardingForm options={options} />
        )}
      </section>
    </main>
  );
}
