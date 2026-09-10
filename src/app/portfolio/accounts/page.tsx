import { localizedMetadata } from "@/lib/i18n/server";
import { T } from "@/components/i18n/localized-text";
import type { ReactNode } from "react";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  AccountCreateForm,
  AccountEditor,
  ArchivedAccountRow,
} from "@/components/account-management";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioSetupProgressPanel } from "@/components/portfolio-setup-progress";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { derivePortfolioSetupProgress } from "@/lib/portfolio-setup-progress";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "계좌 관리 | VARDA LABS" }, "Accounts | VARDA LABS");
}

export default async function AccountManagementPage() {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    if (resolution.failure.code === "identity_unlinked") {
      redirect("/portfolio/onboarding");
    }
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인한 포트폴리오 소유자가 확인되기 전에는 계좌를 조회하지 않습니다."
        closedMessageEn="Accounts remain closed until the signed-in portfolio owner is resolved."
        description="분석 그룹과 구분하여 실제 자산을 보관하는 계좌를 만들고 관리합니다."
        descriptionEn="Create and manage custody accounts without mixing them with analysis groups."
        resolution={resolution}
        title="계좌 관리"
        titleEn="Account management"
      />
    );
  }

  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const model = await getReadOnlyTenantAccountManagementModel({
    serviceDate,
    tenantContext: resolution.tenantContext,
  });
  const activeAccounts =
    model.state === "ready"
      ? model.accounts.filter((account) => account.isActive)
      : [];
  const archivedAccounts =
    model.state === "ready"
      ? model.accounts.filter((account) => !account.isActive)
      : [];
  const setupProgress =
    model.state === "ready"
      ? derivePortfolioSetupProgress({
          activeAccountCount: activeAccounts.length,
          activeHoldingCount: activeAccounts.reduce(
            (count, account) => count + account.activeHoldingCount,
            0,
          ),
        })
      : null;

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-6 text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <header className="border-b border-[var(--line)] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                <T ko="계좌 관리" en="Your accounts" />
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
                <T ko="증권·연금 등 실제 보유 계좌를 관리합니다. 여러 계좌를 함께 분석하려면 분석 범위로 묶어 주세요." en="Manage brokerage, pension and other holding accounts. Link them through analysis scopes to view several accounts together." />
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/"><T ko="홈" en="Home" /></NavLink>
              <NavLink href="/portfolio/holdings"><T ko="보유 종목" en="Holdings" /></NavLink>
              <NavLink href="/portfolio/holdings/new"><T ko="종목 추가" en="Add holding" /></NavLink>
              <NavLink href="/portfolio/groups"><T ko="분석 범위" en="Analysis scopes" /></NavLink>
              <NavLink href="/portfolio/events?account=all"><T ko="거래 기록" en="Transactions" /></NavLink>
            </nav>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryCell label={<T ko="서비스 기준일" en="Service date" />} value={serviceDate} />
            <SummaryCell
              label={<T ko="사용 중인 계좌" en="Active accounts" />}
              value={model.state === "ready" ? String(activeAccounts.length) : "-"}
            />
            <SummaryCell
              label={<T ko="종료된 계좌" en="Closed accounts" />}
              value={
                model.state === "ready" ? String(archivedAccounts.length) : "-"
              }
            />
          </dl>
        </header>

        {model.state !== "ready" ? (
          <section className="rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            <T ko="계좌 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." en="Account information is unavailable. Please try again shortly." />
          </section>
        ) : (
          <>
            {setupProgress ? (
              <PortfolioSetupProgressPanel progress={setupProgress} />
            ) : null}

            <section
              className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-4"
              id="create-account"
            >
              <h2 className="text-lg font-semibold"><T ko="새 계좌" en="New account" /></h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                <T ko="알아보기 쉬운 이름을 정해 주세요. 이름은 나중에 바꿀 수 있습니다." en="Choose a name you recognize. You can change it later." />
              </p>
              <div className="mt-4">
                <AccountCreateForm />
              </div>
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold"><T ko="사용 중인 계좌" en="Active accounts" /></h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  <T ko="계좌 이름을 바꿔도 보유종목과 과거 기록은 그대로 유지됩니다." en="Renaming keeps holdings and historical records intact." />
                </p>
              </div>
              {activeAccounts.length === 0 ? (
                <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                  <T ko="첫 계좌를 만든 다음 보유종목을 추가해 주세요." en="Create your first account, then add holdings." />
                </div>
              ) : (
                activeAccounts.map((account) => (
                  <AccountEditor
                    account={account}
                    key={`${account.id}:${account.updatedAt}`}
                  />
                ))
              )}
            </section>

            {archivedAccounts.length > 0 ? (
              <section className="space-y-3 border-t border-[var(--line)] pt-5">
                <div>
                  <h2 className="text-lg font-semibold"><T ko="종료된 계좌" en="Closed accounts" /></h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    <T ko="과거 기록은 보존되며 언제든 계좌를 복원할 수 있습니다." en="Historical records are preserved, and you can restore these accounts." />
                  </p>
                </div>
                {archivedAccounts.map((account) => (
                  <ArchivedAccountRow
                    account={account}
                    key={`${account.id}:${account.updatedAt}`}
                  />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCell({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      className="inline-flex min-h-11 items-center rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)] hover:bg-[var(--wash)]"
      href={href}
    >
      {children}
    </Link>
  );
}
