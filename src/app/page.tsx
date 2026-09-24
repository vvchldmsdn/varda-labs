import { localizedMetadata } from "@/lib/i18n/server";
import { CurrencyPortfolioSurface } from "@/components/currency-portfolio-surface";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { hasNativeLedger } from "@/db/queries/native-portfolio-ledger";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";
import { listPortfolioDrafts } from "@/db/queries/portfolio-drafts";
import { getReadOnlyTenantAccountManagementModel } from "@/db/queries/account-management";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { QuickHome } from "@/components/first-visit/quick-home";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioDashboard } from "@/components/portfolio-dashboard";
import { PortfolioDashboardAccessBoundary } from "@/components/portfolio-dashboard-access-boundary";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { buildHomeDesignPreview } from "@/lib/home-design-preview";
import { getPortfolioDashboard } from "@/lib/portfolio-dashboard";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "홈 | CAIRN LABS" }, "Home | CAIRN LABS");
}

type HomeProps = {
  searchParams: Promise<{
    account?: string | string[];
    preview?: string | string[];
    scope?: string | string[];
    currency?: string | string[];
    welcome?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;

  if (process.env.NODE_ENV === "development" && firstSearchParam(params.preview) === "quick-usd") {
    const asOf = "2026-09-13T00:00:00Z";
    return <><p role="status" className="px-6 py-2 text-xs">Synthetic portfolio · USD preview</p><QuickHome input={{ version: 2, source: "manual", currency: "USD", locale: "en", timeZone: "America/New_York", asOf,
      rows: [{ name: "VOO", value: 1234.56, instrumentId: "us-voo", inputCurrency: "USD" }, { name: "KODEX 200", value: 1300000, instrumentId: "kr-069500", inputCurrency: "KRW" }],
      fx: [{ base: "USD", quote: "KRW", rate: "1300", observedAt: asOf, fetchedAt: asOf, source: "manual", kind: "user_input" }],
    }} createdAt={asOf} preview welcome /></>;
  }

  if (process.env.NODE_ENV === "development" && firstSearchParam(params.preview) === "quick") {
    return <><p role="status" className="px-6 py-2 text-xs">화면 미리보기 · 가상 입력</p><QuickHome input={{ currency: "KRW", rows: [{ name: "KODEX 200", value: 3000000, instrumentId: "kr-069500" }, { name: "VOO", value: 2000000, instrumentId: "us-voo" }] }} createdAt="2026-09-13T00:00:00Z" preview welcome /></>;
  }
  if (
    process.env.NODE_ENV === "development" &&
    firstSearchParam(params.preview) === "design"
  ) {
    return (
      <PortfolioDashboard
        data={buildHomeDesignPreview(params.scope)}
        designPreview
        liveSyncEnabled={false}
      />
    );
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok && resolution.failure.code === "unauthenticated") redirect("/start");
  if (!resolution.ok && resolution.failure.code === "identity_unlinked") redirect("/portfolio/onboarding");
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
        titleEn="Portfolio summary"
      />
    );
  }

  // Native holdings and cash are authoritative even when legacy assets are
  // empty. Amount-only drafts still reach the existing QuickHome below.
  if (await hasNativeLedger(resolution.tenantContext, scopeContext.resolution.scope)) {
    const evidence = await getTrackedCurrencyEvidence(resolution.tenantContext, scopeContext.resolution.scope, params.currency === "USD" ? "USD" : "KRW");
    return <CurrencyPortfolioSurface surface="home" evidence={evidence} scopes={scopeContext.catalog.scopes} selectedScope={scopeContext.resolution.scope} />;
  }
  const dashboardPromise = getPortfolioDashboard({
    analysisScopes: scopeContext.catalog.scopes,
    scope: scopeContext.resolution.scope,
    tenantContext: resolution.tenantContext,
  });

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardContent dashboardPromise={dashboardPromise} tenant={resolution.tenantContext} allScope={scopeContext.resolution.scope.kind === "all"} welcome={params.welcome === "1"} usd={params.currency === "USD"} scopes={scopeContext.catalog.scopes} selectedScope={scopeContext.resolution.scope} />
    </Suspense>
  );
}

async function DashboardContent({
  dashboardPromise, tenant, allScope, welcome, usd, scopes, selectedScope,
}: {
  dashboardPromise: ReturnType<typeof getPortfolioDashboard>;
  tenant: TenantContext;
  allScope: boolean;
  welcome: boolean;
  usd: boolean;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const dashboard = await dashboardPromise;
  if (allScope && dashboard.dataHealth.importedAssetCount === 0) {
    const history = await getReadOnlyTenantAccountManagementModel({
      serviceDate: resolveSnapshotCycle(new Date()).snapshotDate, tenantContext: tenant,
    });
    // Zero current assets can mean a complete sale or closed accounts. Only a
    // confirmed absence of all owned asset history starts the first-use flow.
    if (history.state === "ready" && !history.hasAssetHistory) {
      const drafts = await listPortfolioDrafts(tenant);
      if (drafts[0]) return <QuickHome id={drafts[0].id} input={drafts[0].input} createdAt={drafts[0].createdAt} welcome={welcome} />;
      redirect("/portfolio/onboarding");
    }
  }
  if (usd) {
    const evidence = await getTrackedCurrencyEvidence(tenant, selectedScope, "USD");
    return <CurrencyPortfolioSurface surface="home" evidence={evidence} scopes={scopes} selectedScope={selectedScope} />;
  }
  return <>{welcome ? <p role="status" className="px-6 py-3 text-sm">입력한 자산을 저장했어요. <Link href="/plans" className="underline">저장한 구성 보기</Link></p> : null}<PortfolioDashboard data={dashboard} liveSyncEnabled /></>;
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
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
