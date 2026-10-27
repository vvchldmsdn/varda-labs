import { localizedMetadata } from "@/lib/i18n/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { PLAN_RETURN_COOKIE, PLAN_RETURN_SOURCE_COOKIE, planReturnDestination } from "@/lib/auth/plan-return";
import { ArrowRight, RotateCcw } from "lucide-react";
import { AuthHeading, AuthShell } from "@/components/auth/auth-shell";
import { QuickPortfolio } from "@/components/first-visit/quick-portfolio";
import { PublicNav } from "@/components/first-visit/public-nav";
import { listPortfolioDrafts } from "@/db/queries/portfolio-drafts";
import entryStyles from "@/components/first-visit/first-visit.module.css";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import styles from "@/components/auth/auth-experience.module.css";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({
  title: "포트폴리오 시작 | CAIRN LABS",
  robots: { index: false, follow: false },
}, "Get started | CAIRN LABS");
}

export default async function PortfolioOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; step?: string }>;
}) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "design") {
    if (params.step === "unavailable") return <OnboardingUnavailable preview />;
    return <QuickEntry preview />;
  }

  const store = await cookies();
  const planIntent = store.get(PLAN_RETURN_COOKIE)?.value;
  if (planIntent === "1") {
    const session = await readCurrentSessionSubject();
    const destination = planReturnDestination(session.state, planIntent, store.get(PLAN_RETURN_SOURCE_COOKIE)?.value);
    if (destination) redirect(destination);
  }
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    if (resolution.failure.code === "unauthenticated")
      redirect("/auth/sign-in");
    if (resolution.failure.code === "identity_unlinked")
      return <QuickEntry />;
    return <OnboardingUnavailable />;
  }

  const model = await getReadOnlyTenantAccountManagementModel({
    serviceDate: resolveSnapshotCycle(new Date()).snapshotDate,
    tenantContext: resolution.tenantContext,
  });
  if (model.state !== "ready") return <OnboardingUnavailable />;
  if (model.hasAssetHistory) redirect("/");
  let hasDraft = false;
  try { hasDraft = (await listPortfolioDrafts(resolution.tenantContext)).length > 0; }
  catch { return <OnboardingUnavailable />; }
  if (hasDraft) redirect("/");
  return <QuickEntry />;
}

function QuickEntry({ preview = false }: { preview?: boolean }) {
  return <main className={entryStyles.page}><PublicNav signedIn />{preview ? <p>화면 미리보기 · 저장 없음</p> : null}<QuickPortfolio signedIn preview={preview} /></main>;
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
          description="내 자산을 불러오지 못했어요. 잠시 후 다시 시도해 주세요."
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
