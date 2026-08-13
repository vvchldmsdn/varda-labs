import { Suspense } from "react";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioDashboardAccessBoundary } from "@/components/portfolio-dashboard-access-boundary";
import { TodayMovement } from "@/components/today-movement";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";
import { normalizeTodayHoldingDetailQuery } from "@/lib/today-holding-detail";

export const dynamic = "force-dynamic";

type TodayPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    holdingAccount?: string | string[];
    scope?: string | string[];
    ticker?: string | string[];
    market?: string | string[];
  }>;
};

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const detailQuery = normalizeTodayHoldingDetailQuery(params);

  if (!resolution.ok) {
    return (
      <PortfolioDashboardAccessBoundary
        resolution={resolution}
        title="Today movement"
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
        basePath="/today"
        context={scopeContext}
        title="오늘 변동"
      />
    );
  }

  const dashboardPromise = getPortfolioDashboard({
    analysisScopes: scopeContext.catalog.scopes,
    scope: scopeContext.resolution.scope,
    tenantContext: resolution.tenantContext,
  });

  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayContent
        dashboardPromise={dashboardPromise}
        detailQuery={detailQuery}
      />
    </Suspense>
  );
}

async function TodayContent({
  dashboardPromise,
  detailQuery,
}: {
  dashboardPromise: ReturnType<typeof getPortfolioDashboard>;
  detailQuery: ReturnType<typeof normalizeTodayHoldingDetailQuery>;
}) {
  const dashboard = await dashboardPromise;
  return <TodayMovement data={dashboard} detailQuery={detailQuery} />;
}

function TodaySkeleton() {
  return (
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-4 text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="h-32 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        </div>
        <div className="h-80 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      </div>
    </main>
  );
}
