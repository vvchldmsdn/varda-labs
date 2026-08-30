import { Suspense } from "react";

import {
  HoldingAnalysisDataPanel,
  HoldingAnalysisDataPanelSkeleton,
} from "@/components/holding-analysis-data-panel";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { DownsideOutcomeValidationSection } from "@/components/simulation/downside-outcome-validation-section";
import { FanBandValidationSection } from "@/components/simulation/fan-band-validation-section";
import { OwnerInputPreflightSection } from "@/components/simulation/owner-input-preflight-section";
import { OwnerModelCalibrationSection } from "@/components/simulation/owner-model-calibration-section";
import { OwnerModelComparisonSection } from "@/components/simulation/owner-model-comparison-section";
import { OwnerParametricFactorSection } from "@/components/simulation/owner-parametric-factor-section";
import { OwnerHistoricalOutcomeValidationSection } from "@/components/simulation/owner-historical-outcome-validation-section";
import { OwnerCandidateComparisonSection } from "@/components/simulation/owner-candidate-comparison-section";
import { OwnerWalkForwardValidationSection } from "@/components/simulation/owner-walk-forward-validation-section";
import { OwnerResearchExecutionSection } from "@/components/simulation/owner-research-execution-section";
import { RegimeBootstrapResearchSection } from "@/components/simulation/regime-bootstrap-research-section";
import { RegimeHistoricalOutcomeValidationSection } from "@/components/simulation/regime-historical-outcome-validation-section";
import { RegimeReadinessHistoryPanel } from "@/components/simulation/regime-readiness-history-panel";
import { ResearchUniversePreflightSection } from "@/components/simulation/research-universe-preflight-section";
import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { SimulationSectionErrorBoundary } from "@/components/simulation/simulation-section-error-boundary";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope } from "@/db/queries/holding-analysis-data-readiness";
import { getReadOnlySimulationHistoricalOutcomeValidation } from "@/db/queries/simulation-historical-outcome-validation";
import { getReadOnlySimulationInputReadiness } from "@/db/queries/simulation-input-readiness";
import { getReadOnlyTenantSimulationOwnerParametricFactorResearch } from "@/db/queries/simulation-owner-parametric-factor";
import { getReadOnlyTenantSimulationOwnerModelCalibration } from "@/db/queries/simulation-owner-model-calibration";
import { getReadOnlyTenantSimulationOwnerModelComparison } from "@/db/queries/simulation-owner-model-comparison";
import { getReadOnlyTenantSimulationOwnerResearch } from "@/db/queries/simulation-owner-research";
import { getReadOnlySimulationRegimeBootstrap } from "@/db/queries/simulation-regime-bootstrap";
import { getReadOnlySimulationRegimeHistoricalOutcomeValidation } from "@/db/queries/simulation-regime-historical-outcome-validation";
import { getReadOnlySimulationResearchUniversePreflight } from "@/db/queries/simulation-research-universe-preflight";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeKey,
} from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

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

type SimulationPreservedQuery = Readonly<{
  scope: PortfolioAnalysisScopeKey;
  end: string | null;
  horizon: string | null;
  kodexWeight: string | null;
  researchUniverse: string | null;
}>;

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
        closedMessage="Simulation research remains closed until the session and user link are available."
        description="This view reads shared market research only after the signed-in user is resolved on the server."
        resolution={resolution}
        title="Simulation validation"
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
        title="Simulation validation"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const analysisDataReadinessPromise =
    getReadOnlyTenantHoldingAnalysisDataReadinessForScope({
      scope: selectedScope,
      serviceDate,
      tenantContext: resolution.tenantContext,
    });
  const modelPromise = getReadOnlySimulationInputReadiness({
    endServiceDate: params.end,
    horizon: params.horizon,
    kodexWeight: params.kodexWeight,
  });
  const ownerResearchPromise =
    getReadOnlyTenantSimulationOwnerResearch({
      endServiceDate: params.end,
      horizon: params.horizon,
      scope: selectedScope,
      serviceDate,
      tenantContext: resolution.tenantContext,
    });
  const ownerParametricFactorPromise =
    getReadOnlyTenantSimulationOwnerParametricFactorResearch({
      ownerResearchPromise,
    });
  const ownerModelComparisonPromise =
    getReadOnlyTenantSimulationOwnerModelComparison({
      ownerResearchPromise,
      parametricFactorPromise: ownerParametricFactorPromise,
    });
  const ownerModelCalibrationPromise =
    getReadOnlyTenantSimulationOwnerModelCalibration({
      ownerResearchPromise,
    });
  const historicalOutcomeValidationPromise =
    getReadOnlySimulationHistoricalOutcomeValidation({
      endServiceDate: params.end,
      horizon: params.horizon,
    });
  const regimePromise = getReadOnlySimulationRegimeBootstrap({
    endServiceDate: params.end,
    kodexWeight: params.kodexWeight,
  });
  const regimeHistoricalOutcomeValidationPromise =
    getReadOnlySimulationRegimeHistoricalOutcomeValidation({
      endServiceDate: params.end,
    });
  const researchUniversePreflightPromise =
    getReadOnlySimulationResearchUniversePreflight({
      endServiceDate: params.end,
      researchUniverse: params.researchUniverse,
    });
  const preservedQuery = Object.freeze({
    scope: selectedScope.key,
    end: singleQueryValue(params.end),
    horizon: singleQueryValue(params.horizon),
    kodexWeight: singleQueryValue(params.kodexWeight),
    researchUniverse: singleQueryValue(params.researchUniverse),
  });

  return (
    <Suspense fallback={<SimulationSkeleton />}>
      <SimulationContent
        historicalOutcomeValidationPromise={
          historicalOutcomeValidationPromise
        }
        analysisDataReadinessPromise={analysisDataReadinessPromise}
        modelPromise={modelPromise}
        ownerResearchPromise={ownerResearchPromise}
        ownerParametricFactorPromise={ownerParametricFactorPromise}
        ownerModelCalibrationPromise={ownerModelCalibrationPromise}
        ownerModelComparisonPromise={ownerModelComparisonPromise}
        regimePromise={regimePromise}
        regimeHistoricalOutcomeValidationPromise={
          regimeHistoricalOutcomeValidationPromise
        }
        researchUniversePreflightPromise={
          researchUniversePreflightPromise
        }
        preservedQuery={preservedQuery}
        scopeCatalog={scopeContext.catalog.scopes}
        selectedScope={selectedScope}
      />
    </Suspense>
  );
}

async function SimulationContent({
  analysisDataReadinessPromise,
  historicalOutcomeValidationPromise,
  modelPromise,
  ownerResearchPromise,
  ownerParametricFactorPromise,
  ownerModelCalibrationPromise,
  ownerModelComparisonPromise,
  regimePromise,
  regimeHistoricalOutcomeValidationPromise,
  researchUniversePreflightPromise,
  preservedQuery,
  scopeCatalog,
  selectedScope,
}: {
  analysisDataReadinessPromise: ReturnType<
    typeof getReadOnlyTenantHoldingAnalysisDataReadinessForScope
  >;
  historicalOutcomeValidationPromise: ReturnType<
    typeof getReadOnlySimulationHistoricalOutcomeValidation
  >;
  modelPromise: ReturnType<typeof getReadOnlySimulationInputReadiness>;
  ownerResearchPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
  ownerParametricFactorPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerParametricFactorResearch
  >;
  ownerModelCalibrationPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerModelCalibration
  >;
  ownerModelComparisonPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerModelComparison
  >;
  regimePromise: ReturnType<typeof getReadOnlySimulationRegimeBootstrap>;
  regimeHistoricalOutcomeValidationPromise: ReturnType<
    typeof getReadOnlySimulationRegimeHistoricalOutcomeValidation
  >;
  researchUniversePreflightPromise: ReturnType<
    typeof getReadOnlySimulationResearchUniversePreflight
  >;
  preservedQuery: SimulationPreservedQuery;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const model = await modelPromise;
  return (
    <SimulationInputReadinessView
      scopeCatalog={scopeCatalog}
      historicalOutcomeValidation={
        <SimulationSectionErrorBoundary
          section="historical-outcome-validation"
          title="과거 결과 검증"
        >
          <Suspense fallback={<HistoricalOutcomeValidationSkeleton />}>
            <HistoricalOutcomeValidationContent
              historicalOutcomeValidationPromise={
                historicalOutcomeValidationPromise
              }
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      model={model}
      ownerInputPreflight={
        <SimulationSectionErrorBoundary
          section="owner-input-preflight"
          title="내 포트폴리오 입력 점검"
        >
          <div className="space-y-4">
            <Suspense fallback={<OwnerInputPreflightSkeleton />}>
              <OwnerInputPreflightContent
                preservedQuery={preservedQuery}
                resultPromise={ownerResearchPromise}
                scopeCatalog={scopeCatalog}
                selectedScope={selectedScope}
              />
            </Suspense>
            <Suspense fallback={<HoldingAnalysisDataPanelSkeleton />}>
              <HoldingAnalysisDataPanel
                resultPromise={analysisDataReadinessPromise}
              />
            </Suspense>
          </div>
        </SimulationSectionErrorBoundary>
      }
      ownerResearchExecution={
        <SimulationSectionErrorBoundary
          section="owner-research-execution"
          title="내 포트폴리오 확률 경로"
        >
          <Suspense
            fallback={
              <OwnerResultSkeleton
                label="내 포트폴리오 확률 경로 로딩"
                marker="execution"
              />
            }
          >
            <OwnerResearchExecutionContent
              resultPromise={ownerResearchPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerCandidateComparison={
        <SimulationSectionErrorBoundary
          section="owner-candidate-comparison"
          title="변동성 완화 후보 비교"
        >
          <Suspense
            fallback={
              <OwnerResultSkeleton
                label="변동성 완화 후보 비교 로딩"
                marker="candidate-comparison"
              />
            }
          >
            <OwnerCandidateComparisonContent
              resultPromise={ownerResearchPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerWalkForwardValidation={
        <SimulationSectionErrorBoundary
          section="owner-walk-forward-validation"
          title="과거 구간 밖 검증"
        >
          <Suspense
            fallback={
              <OwnerResultSkeleton
                label="과거 구간 밖 검증 로딩"
                marker="walk-forward-validation"
              />
            }
          >
            <OwnerWalkForwardValidationContent
              resultPromise={ownerResearchPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerHistoricalValidation={
        <SimulationSectionErrorBoundary
          section="owner-historical-validation"
          title="내 포트폴리오 예측 범위와 실제 결과"
        >
          <Suspense
            fallback={
              <OwnerResultSkeleton
                label="내 포트폴리오 과거 결과 검증 로딩"
                marker="historical-validation"
              />
            }
          >
            <OwnerHistoricalValidationContent
              resultPromise={ownerResearchPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerParametricFactor={
        <SimulationSectionErrorBoundary
          section="owner-parametric-factor"
          title="환율·금리 요인 확률모형"
        >
          <Suspense fallback={<OwnerParametricFactorSkeleton />}>
            <OwnerParametricFactorContent
              resultPromise={ownerParametricFactorPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerModelComparison={
        <SimulationSectionErrorBoundary
          section="owner-model-comparison"
          title="두 확률모형 비교"
        >
          <Suspense fallback={<OwnerModelComparisonSkeleton />}>
            <OwnerModelComparisonContent
              resultPromise={ownerModelComparisonPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      ownerModelCalibration={
        <SimulationSectionErrorBoundary
          section="owner-model-calibration"
          title="과거 결과 모형 점검"
        >
          <Suspense fallback={<OwnerModelCalibrationSkeleton />}>
            <OwnerModelCalibrationContent
              resultPromise={ownerModelCalibrationPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      researchUniverse={preservedQuery.researchUniverse}
      selectedScopeKey={preservedQuery.scope}
      researchUniversePreflight={
        <SimulationSectionErrorBoundary
          section="research-universe-preflight"
          title="연구 종목 데이터 점검"
        >
          <Suspense fallback={<ResearchUniversePreflightSkeleton />}>
            <ResearchUniversePreflightContent
              preservedQuery={preservedQuery}
              resultPromise={researchUniversePreflightPromise}
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      regimeHistoricalOutcomeValidation={
        <SimulationSectionErrorBoundary
          section="regime-historical-outcome-validation"
          title="시장 국면 모델 과거 결과 대조"
        >
          <Suspense
            fallback={
              <RegimeHistoricalOutcomeValidationSkeleton />
            }
          >
            <RegimeHistoricalOutcomeValidationContent
              resultPromise={
                regimeHistoricalOutcomeValidationPromise
              }
            />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
      regimeBootstrap={
        <SimulationSectionErrorBoundary
          section="regime-bootstrap"
          title="시장 국면 사후 연구"
        >
          <Suspense fallback={<RegimeBootstrapSkeleton />}>
            <RegimeBootstrapContent regimePromise={regimePromise} />
          </Suspense>
        </SimulationSectionErrorBoundary>
      }
    />
  );
}

async function OwnerInputPreflightContent({
  preservedQuery,
  resultPromise,
  scopeCatalog,
  selectedScope,
}: {
  preservedQuery: SimulationPreservedQuery;
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const result = await resultPromise;
  return (
    <OwnerInputPreflightSection
      model={result.inputPreflight}
      preservedQuery={preservedQuery}
      scopes={scopeCatalog}
      selectedScope={selectedScope}
    />
  );
}

async function OwnerResearchExecutionContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
}) {
  const result = await resultPromise;
  return <OwnerResearchExecutionSection execution={result.execution} />;
}

async function OwnerCandidateComparisonContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
}) {
  const result = await resultPromise;
  return (
    <OwnerCandidateComparisonSection comparison={result.candidateComparison} instruments={result.execution.instruments} />
  );
}

async function OwnerWalkForwardValidationContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
}) {
  const result = await resultPromise;
  return (
    <OwnerWalkForwardValidationSection result={result.walkForwardValidation} />
  );
}

async function OwnerHistoricalValidationContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerResearch
  >;
}) {
  const result = await resultPromise;
  return (
    <OwnerHistoricalOutcomeValidationSection
      result={result.historicalValidation}
    />
  );
}

async function OwnerParametricFactorContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerParametricFactorResearch
  >;
}) {
  const result = await resultPromise;
  return <OwnerParametricFactorSection result={result} />;
}

async function OwnerModelComparisonContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerModelComparison
  >;
}) {
  const result = await resultPromise;
  return <OwnerModelComparisonSection result={result} />;
}

async function OwnerModelCalibrationContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlyTenantSimulationOwnerModelCalibration
  >;
}) {
  const result = await resultPromise;
  return <OwnerModelCalibrationSection result={result} />;
}

async function ResearchUniversePreflightContent({
  preservedQuery,
  resultPromise,
}: {
  preservedQuery: SimulationPreservedQuery;
  resultPromise: ReturnType<
    typeof getReadOnlySimulationResearchUniversePreflight
  >;
}) {
  const model = await resultPromise;
  return (
    <ResearchUniversePreflightSection
      model={model}
      preservedQuery={preservedQuery}
    />
  );
}

async function HistoricalOutcomeValidationContent({
  historicalOutcomeValidationPromise,
}: {
  historicalOutcomeValidationPromise: ReturnType<
    typeof getReadOnlySimulationHistoricalOutcomeValidation
  >;
}) {
  const result = await historicalOutcomeValidationPromise;
  return (
    <>
      <FanBandValidationSection result={result} />
      <DownsideOutcomeValidationSection result={result} />
    </>
  );
}

async function RegimeBootstrapContent({
  regimePromise,
}: {
  regimePromise: ReturnType<typeof getReadOnlySimulationRegimeBootstrap>;
}) {
  const model = await regimePromise;
  return (
    <>
      <RegimeReadinessHistoryPanel model={model.readinessHistory} />
      <RegimeBootstrapResearchSection model={model.research} />
    </>
  );
}

async function RegimeHistoricalOutcomeValidationContent({
  resultPromise,
}: {
  resultPromise: ReturnType<
    typeof getReadOnlySimulationRegimeHistoricalOutcomeValidation
  >;
}) {
  const result = await resultPromise;
  return <RegimeHistoricalOutcomeValidationSection result={result} />;
}

function SimulationSkeleton() {
  return (
    <main className="min-h-screen bg-[#f3f4ef] p-4 text-[#171916]">
      <div className="mx-auto w-full max-w-[1400px] space-y-4">
        <div className="h-36 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
          <div className="h-96 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        </div>
      </div>
    </main>
  );
}

function RegimeBootstrapSkeleton() {
  return (
    <section
      aria-label="시장 국면 조건부 연구 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-regime-bootstrap-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-40 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function HistoricalOutcomeValidationSkeleton() {
  return (
    <section
      aria-label="과거 시뮬레이션 결과 검증 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-historical-outcome-validation-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function RegimeHistoricalOutcomeValidationSkeleton() {
  return (
    <section
      aria-label="시장 국면 모델 과거 결과 대조 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-regime-historical-outcome-validation-loading
    >
      <div className="h-8 w-64 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function ResearchUniversePreflightSkeleton() {
  return (
    <section
      aria-label="연구 종목 데이터 점검 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-research-universe-preflight-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function OwnerInputPreflightSkeleton() {
  return (
    <section
      aria-label="내 포트폴리오 입력 점검 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-simulation-preflight-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-40 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function OwnerResultSkeleton({
  label,
  marker,
}: {
  label: string;
  marker: string;
}) {
  return (
    <section
      aria-label={label}
      className="border-b border-[#d7ddcf] py-5"
      data-owner-result-loading={marker}
    >
      <div className="h-8 w-64 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-64 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function OwnerParametricFactorSkeleton() {
  return (
    <section
      aria-label="환율·금리 요인 확률모형 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-parametric-factor-loading
    >
      <div className="h-8 w-64 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function OwnerModelComparisonSkeleton() {
  return (
    <section
      aria-label="두 확률모형 비교 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-model-comparison-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function OwnerModelCalibrationSkeleton() {
  return (
    <section
      aria-label="과거 결과 모형 점검 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-owner-model-calibration-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}

function singleQueryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}
