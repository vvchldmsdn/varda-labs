import { localizedMetadata } from "@/lib/i18n/server";
import { registerTenantSimulationPath } from "@/lib/server/simulation-path-details";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { bootstrapPathSnapshot, economicPathSnapshot } from "@/lib/simulation-path-snapshot";
import { CurrencyPortfolioSurface } from "@/components/currency-portfolio-surface";
import { hasNativeLedger } from "@/db/queries/native-portfolio-ledger";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { admitNativeKrwEconomic } from "@/lib/native-economic-admission";
import { getOwnedCurrencyResearchInput } from "@/db/queries/currency-research";
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
import { SimulationLoading } from "@/components/simulation/simulation-loading";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return localizedMetadata({ title: "시뮬레이션 | CAIRN LABS" }, "Simulation | CAIRN LABS");
}
type SimulationPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    currency?: string | string[];
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
  const model = buildSimulationPageControls({ endServiceDate: params.end, horizon: params.horizon, kodexWeight: params.kodexWeight, now });
  let admittedNativeResearch: ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch> | undefined;
  if (params.currency === "USD" || await hasNativeLedger(resolution.tenantContext, scopeContext.resolution.scope)) {
    const reporting = params.currency === "USD" ? "USD" : "KRW";
    // The economic model is calibrated to KRW returns. Never relabel it or
    // silently substitute a historical model when the user selected economic.
    const historical = pathModel === "bootstrap";
    const invalidReason = pathModel === null ? "invalid_model" : model.researchHorizonSelection.status !== "valid" ? "invalid_horizon" : model.endServiceDateSelection.status !== "valid" || (typeof params.end === "string" && params.end > resolveSnapshotCycle(now).snapshotDate) ? "invalid_end_date" : undefined;
    if (invalidReason) return <CurrencyPortfolioSurface surface="simulation" reporting={reporting} economicUnsupported={!historical} researchUnavailableReason={invalidReason} scopes={scopeContext.catalog.scopes} selectedScope={selectedScope} />;
    if (historical || reporting === "USD" || pathModel !== "economic") {
      const research = historical ? await getOwnedCurrencyResearchInput(resolution.tenantContext, selectedScope, reporting, { horizon: model.researchHorizonSelection.horizon!, ...(typeof params.end === "string" ? { endServiceDate: params.end } : {}) }) : null;
      return <CurrencyPortfolioSurface surface="simulation" reporting={reporting} research={research} economicUnsupported={!historical} scopes={scopeContext.catalog.scopes} selectedScope={selectedScope} />;
    }
    const candidate = getReadOnlyTenantSimulationOwnerResearch({ includeDisplayPaths: false, endServiceDate: params.end, horizon: params.horizon, scope: selectedScope, serviceDate: resolveSnapshotCycle(now).snapshotDate, tenantContext: resolution.tenantContext });
    const [native, research] = await Promise.all([getTrackedCurrencyEvidence(resolution.tenantContext, selectedScope, "KRW"), candidate]);
    const admission = admitNativeKrwEconomic(native, research);
    if (!admission.ready) return <CurrencyPortfolioSurface surface="simulation" reporting="KRW" economicUnsupported researchUnavailableReason={admission.reason} scopes={scopeContext.catalog.scopes} selectedScope={selectedScope} />;
    admittedNativeResearch = candidate;
  }
  const ownerResearchPromise = admittedNativeResearch ?? getReadOnlyTenantSimulationOwnerResearch({
    includeDisplayPaths: pathModel === "bootstrap",
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
          <Suspense key={`${selectedScope.key}:${pathModel}:${model.requestedEndServiceDate}:${model.researchHorizonSelection.horizon}`} fallback={<SimulationLoading />}>
            <OwnerResearchExecutionContent tenantContext={resolution.tenantContext} resultPromise={ownerResearchPromise} selectedScopeKey={selectedScope.key} pathModel={pathModel} stateAsOfServiceDate={typeof params.end === "string" && model.endServiceDateSelection.status === "valid" ? params.end : resolveSnapshotCycle(now).snapshotDate} />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
    />
  );
}

async function OwnerResearchExecutionContent({ tenantContext, resultPromise, selectedScopeKey, pathModel, stateAsOfServiceDate }: {
  tenantContext: TenantContext;
  pathModel: ReturnType<typeof resolveSimulationPathModel>;
  stateAsOfServiceDate: string;
  resultPromise: ReturnType<typeof getReadOnlyTenantSimulationOwnerResearch>;
  selectedScopeKey: PortfolioAnalysisScopeKey;
}) {
  const result = await resultPromise;
  if (pathModel === null) return <p role="alert"><SimulationText ko="계산 모형을 확인해 주세요. 경제지표 또는 과거 수익률 경로를 선택할 수 있습니다." en="Choose Economic paths or Historical paths to run a model." /></p>;
  if (pathModel === "economic") {
    const economic = await getReadOnlyTenantSimulationOwnerEconomicResearch({ ownerResearchPromise: resultPromise, stateAsOfServiceDate, includeDisplayPaths: true });
    const registration = await registerTenantSimulationPath(tenantContext, economicPathSnapshot(economic, result.execution));
    return <EconomicExecutionSection pathDetail={registration.handle} pathDetailNotice={registration.notice} result={economicResearchPresentation(economic)} baseline={result.execution} />;
  }
  const registration = await registerTenantSimulationPath(tenantContext, bootstrapPathSnapshot(result.execution, result.preparedPaths));
  return <OwnerResearchExecutionSection pathDetail={registration.handle} pathDetailNotice={registration.notice} execution={result.execution} selectedScopeKey={selectedScopeKey} />;
}
