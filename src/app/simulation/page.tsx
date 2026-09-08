import { localizedMetadata } from "@/lib/i18n/server";
import { SimulationText } from "@/components/simulation/simulation-text";
import { Suspense } from "react";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { OwnerResearchExecutionSection } from "@/components/simulation/owner-research-execution-section";
import { SimulationSectionErrorBoundary } from "@/components/simulation/simulation-section-error-boundary";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlySimulationInputReadiness } from "@/db/queries/simulation-input-readiness";
import { getReadOnlyTenantSimulationOwnerResearch } from "@/db/queries/simulation-owner-research";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({ title: "시뮬레이션 | VARDA LABS" }, "Simulation | VARDA LABS");
}
type SimulationPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    end?: string | string[];
    horizon?: string | string[];
    kodexWeight?: string | string[];
    researchUniverse?: string | string[];
    view?: string | string[];
    preview?: string | string[];
    previewState?: string | string[];
  }>;
};

export default async function SimulationPage({
  searchParams,
}: SimulationPageProps) {
  const previewParams = process.env.NODE_ENV === "development" ? await searchParams : null;
  if (process.env.NODE_ENV === "development" && previewParams?.preview === "design") {
    const { SimulationDesignPreview } = await import("@/components/simulation/simulation-design-preview");
    return <SimulationDesignPreview query={previewParams} />;
  }
  const [params, resolution] = await Promise.all([searchParams, resolveCurrentTenantContext()]);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인과 사용자 연결이 확인된 뒤에 시뮬레이션을 읽습니다."
        closedMessageEn="Simulation research remains closed until the session and user link are available."
        description="서버에서 로그인한 사용자를 확인한 뒤에 시장 연구 데이터를 읽습니다."
        descriptionEn="This view reads shared market research only after the signed-in user is resolved on the server."
        resolution={resolution}
        title="시뮬레이션 검증" titleEn="Simulation validation"
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
        basePath="/simulation"
        context={scopeContext}
        title="시뮬레이션 검증" titleEn="Simulation validation"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const modelPromise = getReadOnlySimulationInputReadiness({ includeResearch: false, endServiceDate: params.end, horizon: params.horizon, kodexWeight: params.kodexWeight });
  const ownerResearchPromise = getReadOnlyTenantSimulationOwnerResearch({ endServiceDate: params.end, horizon: params.horizon, scope: selectedScope, serviceDate: resolveSnapshotCycle(new Date()).snapshotDate, tenantContext: resolution.tenantContext });
  return <Suspense fallback={<SimulationSkeleton />}><SimulationContent modelPromise={modelPromise} ownerResearchPromise={ownerResearchPromise} scopeCatalog={scopeContext.catalog.scopes} selectedScope={selectedScope} researchUniverse={typeof params.researchUniverse === "string" ? params.researchUniverse : null} /></Suspense>;
}
async function SimulationContent({modelPromise, ownerResearchPromise, scopeCatalog, selectedScope, researchUniverse}: {
 modelPromise: ReturnType<typeof getReadOnlySimulationInputReadiness>; ownerResearchPromise: ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch>;
 scopeCatalog: readonly PortfolioAnalysisScope[]; selectedScope: PortfolioAnalysisScope; researchUniverse: string | null;
}) {
 const model = await modelPromise;
 return <SimulationInputReadinessView model={model} scopeCatalog={scopeCatalog} selectedScopeKey={selectedScope.key} researchUniverse={researchUniverse}
 ownerResearchExecution={<SimulationSectionErrorBoundary section="owner-research-execution" title="내 포트폴리오 확률 경로"><Suspense fallback={<p role="status"><SimulationText ko="확률 경로를 계산하고 있습니다." /></p>}><OwnerResearchExecutionContent resultPromise={ownerResearchPromise} /></Suspense></SimulationSectionErrorBoundary>} />;
}
async function OwnerResearchExecutionContent({resultPromise}: {resultPromise: ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch>}) { const result = await resultPromise; return <OwnerResearchExecutionSection execution={result.execution} />; }
function SimulationSkeleton() {
  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] p-4 text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1400px] space-y-4">
        <div className="h-36 rounded-lg border border-[var(--line)] bg-[var(--surface)]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-96 rounded-lg border border-[var(--line)] bg-[var(--surface)]" />
          <div className="h-96 rounded-lg border border-[var(--line)] bg-[var(--surface)]" />
        </div>
      </div>
    </main>
  );
}
