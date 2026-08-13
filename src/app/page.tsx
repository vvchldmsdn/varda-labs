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
    <main className="min-h-screen bg-[#f3f4ef] p-4 text-[#171916]">
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        <div className="h-80 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="space-y-4">
          <div className="h-48 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        </div>
        <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      </div>
    </main>
  );
}
