import { Suspense } from "react";

import { DownsideOutcomeValidationSection } from "@/components/simulation/downside-outcome-validation-section";
import { FanBandValidationSection } from "@/components/simulation/fan-band-validation-section";
import { RegimeBootstrapResearchSection } from "@/components/simulation/regime-bootstrap-research-section";
import { RegimeHistoricalOutcomeValidationSection } from "@/components/simulation/regime-historical-outcome-validation-section";
import { RegimeReadinessHistoryPanel } from "@/components/simulation/regime-readiness-history-panel";
import { ResearchUniversePreflightSection } from "@/components/simulation/research-universe-preflight-section";
import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { SimulationSectionErrorBoundary } from "@/components/simulation/simulation-section-error-boundary";
import { getReadOnlySimulationHistoricalOutcomeValidation } from "@/db/queries/simulation-historical-outcome-validation";
import { getReadOnlySimulationInputReadiness } from "@/db/queries/simulation-input-readiness";
import { getReadOnlySimulationRegimeBootstrap } from "@/db/queries/simulation-regime-bootstrap";
import { getReadOnlySimulationRegimeHistoricalOutcomeValidation } from "@/db/queries/simulation-regime-historical-outcome-validation";
import { getReadOnlySimulationResearchUniversePreflight } from "@/db/queries/simulation-research-universe-preflight";

export const dynamic = "force-dynamic";

type SimulationPageProps = {
  searchParams: Promise<{
    end?: string | string[];
    horizon?: string | string[];
    kodexWeight?: string | string[];
    researchUniverse?: string | string[];
  }>;
};

export default async function SimulationPage({
  searchParams,
}: SimulationPageProps) {
  const params = await searchParams;
  const modelPromise = getReadOnlySimulationInputReadiness({
    endServiceDate: params.end,
    horizon: params.horizon,
    kodexWeight: params.kodexWeight,
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
        modelPromise={modelPromise}
        regimePromise={regimePromise}
        regimeHistoricalOutcomeValidationPromise={
          regimeHistoricalOutcomeValidationPromise
        }
        researchUniversePreflightPromise={
          researchUniversePreflightPromise
        }
        preservedQuery={preservedQuery}
      />
    </Suspense>
  );
}

async function SimulationContent({
  historicalOutcomeValidationPromise,
  modelPromise,
  regimePromise,
  regimeHistoricalOutcomeValidationPromise,
  researchUniversePreflightPromise,
  preservedQuery,
}: {
  historicalOutcomeValidationPromise: ReturnType<
    typeof getReadOnlySimulationHistoricalOutcomeValidation
  >;
  modelPromise: ReturnType<typeof getReadOnlySimulationInputReadiness>;
  regimePromise: ReturnType<typeof getReadOnlySimulationRegimeBootstrap>;
  regimeHistoricalOutcomeValidationPromise: ReturnType<
    typeof getReadOnlySimulationRegimeHistoricalOutcomeValidation
  >;
  researchUniversePreflightPromise: ReturnType<
    typeof getReadOnlySimulationResearchUniversePreflight
  >;
  preservedQuery: Readonly<{
    end: string | null;
    horizon: string | null;
    kodexWeight: string | null;
    researchUniverse: string | null;
  }>;
}) {
  const model = await modelPromise;
  return (
    <SimulationInputReadinessView
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
      researchUniverse={preservedQuery.researchUniverse}
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

async function ResearchUniversePreflightContent({
  preservedQuery,
  resultPromise,
}: {
  preservedQuery: Readonly<{
    end: string | null;
    horizon: string | null;
    kodexWeight: string | null;
    researchUniverse: string | null;
  }>;
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

function singleQueryValue(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}
