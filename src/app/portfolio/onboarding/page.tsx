import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, RotateCcw } from "lucide-react";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { OnboardingView } from "@/components/auth/onboarding-view";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { derivePortfolioSetupProgress } from "@/lib/portfolio-setup-progress";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import styles from "@/components/auth/auth-experience.module.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "포트폴리오 시작 | VARDA-LABS",
  robots: { index: false, follow: false },
};

export default async function PortfolioOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; step?: string }>;
}) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "design") {
    if (params.step === "unavailable") return <OnboardingUnavailable preview />;
    const step =
      params.step === "account" || params.step === "holding"
        ? params.step
        : "portfolio";
    return <OnboardingView step={step} accountName="나의 증권 계좌" preview />;
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    if (resolution.failure.code === "unauthenticated")
      redirect("/auth/sign-in");
    if (resolution.failure.code === "identity_unlinked")
      return <OnboardingView step="portfolio" />;
    return <OnboardingUnavailable />;
  }

  const model = await getReadOnlyTenantAccountManagementModel({
    serviceDate: resolveSnapshotCycle(new Date()).snapshotDate,
    tenantContext: resolution.tenantContext,
  });
  if (model.state !== "ready") return <OnboardingUnavailable />;
  const activeAccounts = model.accounts.filter((account) => account.isActive);
  const progress = derivePortfolioSetupProgress({
    activeAccountCount: activeAccounts.length,
    activeHoldingCount: activeAccounts.reduce(
      (count, account) => count + account.activeHoldingCount,
      0,
    ),
  });
  if (progress.isComplete) redirect("/");
  return (
    <OnboardingView
      step={activeAccounts.length ? "holding" : "account"}
      accountName={activeAccounts[0]?.name}
    />
  );
}

function OnboardingUnavailable({ preview = false }: { preview?: boolean }) {
  const accountHref = `/auth/session?view=account${preview ? "&preview=design" : ""}`;
  return (
    <AuthShell
      preview={preview}
      alternate={{ href: accountHref, label: "내 계정" }}
    >
      <section className={styles.panel}>
        <AuthHeading
          eyebrow="PLEASE TRY AGAIN"
          title="잠시 확인이 필요해요"
          description="계정이나 계좌 상태를 확인하지 못했습니다. 기존 기록을 보호하기 위해 새로운 포트폴리오는 만들지 않았습니다."
        />
        <div className={styles.stack}>
          <Link
            className={styles.primaryButton}
            href={
              preview
                ? "/portfolio/onboarding?preview=design"
                : "/portfolio/onboarding"
            }
          >
            <RotateCcw size={16} aria-hidden="true" />
            다시 확인
          </Link>
          <Link className={styles.secondaryButton} href={accountHref}>
            계정 연결 확인
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </AuthShell>
  );
}
