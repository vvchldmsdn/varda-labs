import { Suspense } from "react";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { PortfolioDashboardAccessBoundary } from "@/components/portfolio-dashboard-access-boundary";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
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
  return <PortfolioDashboard data={dashboard} />;
}

function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-[#f7f8f5] text-[#20231f]">
      <div className="h-16 border-b border-[#e1e4df] bg-[#fafbf8]" />
      <div className="mx-auto w-full max-w-[1540px] animate-pulse px-5 py-10 sm:px-8 lg:px-10">
        <div className="h-4 w-40 bg-[#e4e7e2]" />
        <div className="mt-8 h-5 w-full max-w-xl bg-[#e4e7e2]" />
        <div className="mx-auto mt-16 h-20 w-full max-w-2xl bg-[#e1e4df]" />
        <div className="mt-16 grid gap-12 border-t border-[#d9ddd7] pt-9 lg:grid-cols-[minmax(0,1.5fr)_minmax(420px,0.9fr)]">
          <div className="h-[340px] bg-[#eceeeb]" />
          <div className="h-[340px] bg-[#eceeeb]" />
        </div>
        <div className="mt-10 h-28 border-y border-[#d9ddd7] bg-[#f1f3ef]" />
      </div>
    </main>
  );
}
