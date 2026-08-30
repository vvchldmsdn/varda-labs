import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { Suspense } from "react";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { PortfolioDashboardAccessBoundary } from "@/components/portfolio-dashboard-access-boundary";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;

  if (process.env.NODE_ENV === "development") {
    return (
      <PortfolioDashboard
        data={buildHomeDesignPreview(params.scope)}
        liveSyncEnabled={false}
      />
    );
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return (
      <PortfolioDashboardAccessBoundary
        resolution={resolution}
        title="Portfolio dashboard"
      />
    );
  }

  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({
    account: params.account,
    scope: params.scope,
    tenantContext: resolution.tenantContext,
  });
  if (
    scopeContext.state !== "ready" ||
    scopeContext.resolution.state !== "resolved"
  ) {
    return (
      <PortfolioAnalysisScopeBoundary
        basePath="/"
        context={scopeContext}
        title="포트폴리오 요약"
      />
    );
  }

  const dashboardPromise = getPortfolioDashboard({
    analysisScopes: scopeContext.catalog.scopes,
    scope: scopeContext.resolution.scope,
    tenantContext: resolution.tenantContext,
  });

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent dashboardPromise={dashboardPromise} />
    </Suspense>
  );
}

async function DashboardContent({
  dashboardPromise,
}: {
  dashboardPromise: ReturnType<typeof getPortfolioDashboard>;
}) {
  const dashboard = await dashboardPromise;
  return <PortfolioDashboard data={dashboard} liveSyncEnabled />;
}

function DashboardSkeleton() {
  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="h-16 border-b border-[var(--wash)] bg-[var(--paper)]" />
      <div className="mx-auto w-full max-w-[1540px] animate-pulse px-5 py-10 sm:px-8 lg:px-10">
        <div className="h-4 w-40 bg-[var(--wash)]" />
        <div className="mt-8 h-5 w-full max-w-xl bg-[var(--wash)]" />
        <div className="mx-auto mt-16 h-20 w-full max-w-2xl bg-[var(--wash)]" />
        <div className="mt-16 grid gap-12 border-t border-[var(--line)] pt-9 lg:grid-cols-[minmax(0,1.5fr)_minmax(420px,0.9fr)]">
          <div className="h-[340px] bg-[var(--wash)]" />
          <div className="h-[340px] bg-[var(--wash)]" />
        </div>
        <div className="mt-10 h-28 border-y border-[var(--line)] bg-[var(--wash)]" />
      </div>
    </main>
  );
}
