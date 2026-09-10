import { localizedMetadata } from "@/lib/i18n/server";
import { SimulationText } from "@/components/simulation/simulation-text";
import { Suspense } from "react";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { OwnerResearchExecutionSection } from "@/components/simulation/owner-research-execution-section";
import { SimulationSectionErrorBoundary } from "@/components/simulation/simulation-section-error-boundary";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { buildSimulationPageControls } from "@/lib/simulation-page-controls";
import { getReadOnlyTenantSimulationOwnerResearch } from "@/db/queries/simulation-owner-research";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import { resolveSimulationPathModel } from "@/lib/simulation-model-selection";
import { getReadOnlyTenantSimulationOwnerEconomicResearch, economicResearchPresentation } from "@/db/queries/simulation-owner-economic";
import { EconomicExecutionSection } from "@/components/simulation/economic-execution-section";
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
    model?: string | string[];
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
  const now = new Date();
  const pathModel = resolveSimulationPathModel(params.model);
  const model = buildSimulationPageControls({
    endServiceDate: params.end,
    horizon: params.horizon,
    kodexWeight: params.kodexWeight,
    now,
  });
  const ownerResearchPromise = getReadOnlyTenantSimulationOwnerResearch({
    endServiceDate: params.end,
    horizon: params.horizon,
    scope: selectedScope,
    serviceDate: resolveSnapshotCycle(now).snapshotDate,
    tenantContext: resolution.tenantContext,
  });
  return (
    <SimulationInputReadinessView
      model={model}
      pathModel={pathModel}
      scopeCatalog={scopeContext.catalog.scopes}
      selectedScopeKey={selectedScope.key}
      researchUniverse={typeof params.researchUniverse === "string" ? params.researchUniverse : null}
      ownerResearchExecution={
        <SimulationSectionErrorBoundary section="owner-research-execution" title="내 포트폴리오 확률 경로">
          <Suspense fallback={<p role="status"><SimulationText ko="확률 경로를 계산하고 있습니다." /></p>}>
            <OwnerResearchExecutionContent resultPromise={ownerResearchPromise} selectedScopeKey={selectedScope.key} pathModel={pathModel} stateAsOfServiceDate={typeof params.end === "string" && model.endServiceDateSelection.status === "valid" ? params.end : resolveSnapshotCycle(now).snapshotDate} />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
    />
  );
}

async function OwnerResearchExecutionContent({ resultPromise, selectedScopeKey, pathModel, stateAsOfServiceDate }: {
  pathModel: ReturnType<typeof resolveSimulationPathModel>;
  stateAsOfServiceDate: string;
  resultPromise: ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch>;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  const result = await resultPromise;
  if (pathModel === null) return <p role="alert"><SimulationText ko="계산 모형을 확인해 주세요. 경제지표 또는 과거 수익률 경로를 선택할 수 있습니다." en="Choose Economic paths or Historical paths to run a model." /></p>;
  if (pathModel === "economic") {
    const economic = await getReadOnlyTenantSimulationOwnerEconomicResearch({ ownerResearchPromise: resultPromise, stateAsOfServiceDate });
    return <EconomicExecutionSection result={economicResearchPresentation(economic)} baseline={result.execution} />;
  }
  return <OwnerResearchExecutionSection execution={result.execution} selectedScopeKey={selectedScopeKey} />;
}
