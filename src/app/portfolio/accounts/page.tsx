import { getLocale, localizedMetadata } from "@/lib/i18n/server";
import { T } from "@/components/i18n/localized-text";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { RecoveryJourneyLink as Link } from '@/components/recovery/recovery-return';
import { redirect } from "next/navigation";

import {
  AccountCreateForm,
  AccountEditor,
  ArchivedAccountRow,
} from "@/components/account-management";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { derivePortfolioSetupProgress } from "@/lib/portfolio-setup-progress";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { ActionGroup, ActionContent, PageHeader, SectionTitle as CairnSectionTitle } from "@/components/cairn-ui";
import { Layers3, ListChecks, Plus, Wallet } from "lucide-react";
import styles from "@/components/portfolio/management-forms.module.css";


export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "계좌 관리 | CAIRN LABS" }, "Accounts | CAIRN LABS");
}

export default async function AccountManagementPage() {
  const [resolution, locale] = await Promise.all([resolveCurrentTenantContext(), getLocale()]);
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
      <div className={styles.pageSections}>
        <PageHeader title={<T ko="계좌 관리" en="Your accounts" />}
          actions={<Link className={styles.link} href="/portfolio/manage"><T ko="전체 관리" en="All settings" /></Link>} />

        {model.state !== "ready" ? (
          <section className="rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            <T ko="계좌 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." en="Account information is unavailable. Please try again shortly." />
          </section>
        ) : (
          <>
            {setupProgress && !setupProgress.isComplete && activeAccounts.length > 0 ? (
              <ActionGroup label={locale === "en" ? "Add your first holding" : "첫 종목 등록"}>
                <Link href={setupProgress.nextAction.href} data-primary="true"><ActionContent icon={<Plus size={22} />} title={<T ko="이제 종목을 담아 볼까요?" en="Ready to add your holdings?" />} description={<T ko="종목과 수량으로 시작해요" en="Start with a holding and quantity" />} /></Link>
              </ActionGroup>
            ) : null}

            <section
              className={styles.card}
              id="create-account"
            >
              <CairnSectionTitle><T ko="새 계좌" en="New account" /></CairnSectionTitle>
              <div className="mt-6">
                <AccountCreateForm />
              </div>
            </section>

            <section className={styles.accountList}>
              <div>
                <CairnSectionTitle><T ko="사용 중인 계좌" en="Active accounts" /> <span className={styles.countLabel}>{activeAccounts.length}</span></CairnSectionTitle>
              </div>
              {activeAccounts.length === 0 ? (
                <div className={styles.emptyState}>
                  <Wallet size={28} aria-hidden="true" /><p><T ko="아직 등록한 계좌가 없어요" en="No accounts yet" /></p>
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
              <details className={styles.disclosure}>
                <summary><span><T ko="종료된 계좌" en="Closed accounts" /> · {archivedAccounts.length}</span></summary>
                <p className={styles.hint}><T ko="기록은 그대로, 언제든 복원할 수 있어요." en="Records are kept. Restore an account anytime." /></p>
                <div className={styles.accountList}>
                {archivedAccounts.map((account) => (
                  <ArchivedAccountRow
                    account={account}
                    key={`${account.id}:${account.updatedAt}`}
                  />
                ))}
                </div>
              </details>
            ) : null}
          </>
        )}
        <ActionGroup label={locale === "en" ? "Explore your assets" : "자산 관리 이어가기"} layout="list">
          <Link href="/portfolio/holdings"><ActionContent icon={<Wallet size={22} />} title={<T ko="보유 종목 확인" en="View holdings" />} /></Link>
          <Link href="/portfolio/groups"><ActionContent icon={<Layers3 size={22} />} title={<T ko="여러 계좌 함께 보기" en="Group accounts together" />} description={<T ko="분석 범위 설정" en="Set up an analysis scope" />} /></Link>
          <Link href="/portfolio/events?account=all"><ActionContent icon={<ListChecks size={22} />} title={<T ko="거래 기록 보기" en="View transactions" />} /></Link>
        </ActionGroup>
      </div>
    </main>
  );
}
