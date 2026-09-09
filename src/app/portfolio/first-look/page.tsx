import { Suspense } from "react";
import { FirstPortfolioAnalysis, FirstPortfolioAnalysisView } from "@/components/onboarding/first-portfolio-analysis";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { T } from "@/components/i18n/localized-text";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { localizedMetadata } from "@/lib/i18n/server";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import styles from "@/components/onboarding/first-portfolio-analysis.module.css";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "첫 포트폴리오 분석 | VARDA LABS" }, "Your first look | VARDA LABS");
}

export default async function FirstLookPage({ searchParams }: {
  searchParams: Promise<{ scope?: string | string[]; preview?: string | string[]; previewState?: string | string[] }>;
}) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "design") {
    const { buildFirstPortfolioAnalysisDesignPreview } = await import("@/lib/first-portfolio-analysis-design-preview");
    return <main className={`varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)] ${styles.page}`}><SecondaryPageHeader /><FirstPortfolioAnalysisView result={buildFirstPortfolioAnalysisDesignPreview(params.previewState === "empty")} scopeKey="all" designPreview /></main>;
  }
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) return <PortfolioReadAccessBoundary resolution={resolution} title="첫 포트폴리오 분석" titleEn="Your first look" />;
  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({ scope: params.scope, tenantContext: resolution.tenantContext });
  if (scopeContext.state !== "ready" || scopeContext.resolution.state !== "resolved") return <PortfolioAnalysisScopeBoundary basePath="/portfolio/first-look" context={scopeContext} title="첫 포트폴리오 분석" titleEn="Your first look" />;
  return <main className={`varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)] ${styles.page}`}>
    <SecondaryPageHeader />
    <Suspense fallback={<p role="status" className="mx-auto max-w-5xl px-6 py-16 text-sm text-[var(--muted)]"><T ko="등록한 포트폴리오를 살펴보고 있습니다." en="Taking a first look at your portfolio." /></p>}>
      <FirstPortfolioAnalysis scope={scopeContext.resolution.scope} serviceDate={resolveSnapshotCycle().snapshotDate} tenantContext={resolution.tenantContext} />
    </Suspense>
  </main>;
}
