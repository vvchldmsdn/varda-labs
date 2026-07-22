import { Suspense } from "react";

import { FanBandValidationSection } from "@/components/simulation/fan-band-validation-section";
import { RegimeBootstrapResearchSection } from "@/components/simulation/regime-bootstrap-research-section";
import { RegimeReadinessHistoryPanel } from "@/components/simulation/regime-readiness-history-panel";
import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { getReadOnlySimulationFanBandValidation } from "@/db/queries/simulation-fan-band-validation";
import { getReadOnlySimulationInputReadiness } from "@/db/queries/simulation-input-readiness";
import { getReadOnlySimulationRegimeBootstrap } from "@/db/queries/simulation-regime-bootstrap";

export const dynamic = "force-dynamic";

type SimulationPageProps = {
  searchParams: Promise<{
    end?: string | string[];
    kodexWeight?: string | string[];
  }>;
};

export default async function SimulationPage({
  searchParams,
}: SimulationPageProps) {
  const params = await searchParams;
  const modelPromise = getReadOnlySimulationInputReadiness({
    endServiceDate: params.end,
    kodexWeight: params.kodexWeight,
  });
  const fanBandValidationPromise = getReadOnlySimulationFanBandValidation({
    endServiceDate: params.end,
  });
  const regimePromise = getReadOnlySimulationRegimeBootstrap({
    endServiceDate: params.end,
    kodexWeight: params.kodexWeight,
  });

  return (
    <Suspense fallback={<SimulationSkeleton />}>
      <SimulationContent
        fanBandValidationPromise={fanBandValidationPromise}
        modelPromise={modelPromise}
        regimePromise={regimePromise}
      />
    </Suspense>
  );
}

async function SimulationContent({
  fanBandValidationPromise,
  modelPromise,
  regimePromise,
}: {
  fanBandValidationPromise: ReturnType<
    typeof getReadOnlySimulationFanBandValidation
  >;
  modelPromise: ReturnType<typeof getReadOnlySimulationInputReadiness>;
  regimePromise: ReturnType<typeof getReadOnlySimulationRegimeBootstrap>;
}) {
  const model = await modelPromise;
  return (
    <SimulationInputReadinessView
      fanBandValidation={
        <Suspense fallback={<FanBandValidationSkeleton />}>
          <FanBandValidationContent
            fanBandValidationPromise={fanBandValidationPromise}
          />
        </Suspense>
      }
      model={model}
      regimeBootstrap={
        <Suspense fallback={<RegimeBootstrapSkeleton />}>
          <RegimeBootstrapContent regimePromise={regimePromise} />
        </Suspense>
      }
    />
  );
}

async function FanBandValidationContent({
  fanBandValidationPromise,
}: {
  fanBandValidationPromise: ReturnType<
    typeof getReadOnlySimulationFanBandValidation
  >;
}) {
  const result = await fanBandValidationPromise;
  return <FanBandValidationSection result={result} />;
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

function FanBandValidationSkeleton() {
  return (
    <section
      aria-label="과거 확률밴드 검증 로딩"
      className="border-b border-[#d7ddcf] py-5"
      data-fan-band-validation-loading
    >
      <div className="h-8 w-56 rounded bg-[#e3e6dd]" />
      <div className="mt-4 h-52 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
    </section>
  );
}
