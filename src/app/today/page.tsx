import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { Suspense } from "react";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioDashboardAccessBoundary } from "@/components/portfolio-dashboard-access-boundary";
import { TodayMovement } from "@/components/today-movement";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
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
    preview?: string | string[];
  }>;
};

export default async function TodayPage({ searchParams }: TodayPageProps) {
  const params = await searchParams;
  const detailQuery = normalizeTodayHoldingDetailQuery(params);

  if (
    process.env.NODE_ENV === "development" &&
    firstSearchParam(params.preview) === "design"
  ) {
    return (
      <TodayMovement
        data={buildHomeDesignPreview(params.scope ?? params.account)}
        detailQuery={detailQuery}
      />
    );
  }

  const resolution = await resolveCurrentTenantContext();

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

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="h-16 border-b border-[var(--wash)] bg-[var(--paper)]" />
      <div className="mx-auto w-full max-w-[1540px] animate-pulse px-5 pb-12 pt-10 sm:px-8 lg:px-10">
        <div className="h-4 w-36 bg-[var(--wash)]" />
        <div className="mt-8 h-10 w-full border-b border-[var(--wash)]" />
        <div className="mx-auto mt-16 h-20 w-96 max-w-full bg-[var(--wash)]" />
        <div className="mt-20 h-32 border-y border-[var(--line)] bg-[var(--wash)]" />
        <div className="mt-16 h-[520px] border-y border-[var(--line)] bg-[var(--wash)]" />
      </div>
    </main>
  );
}
