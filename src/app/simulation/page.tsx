import { Suspense } from "react";

import { SimulationInputReadinessView } from "@/components/simulation/simulation-input-readiness-view";
import { getReadOnlySimulationInputReadiness } from "@/db/queries/simulation-input-readiness";

export const dynamic = "force-dynamic";

type SimulationPageProps = {
  searchParams: Promise<{ end?: string | string[] }>;
};

export default async function SimulationPage({
  searchParams,
}: SimulationPageProps) {
  const params = await searchParams;
  const modelPromise = getReadOnlySimulationInputReadiness({
    endServiceDate: params.end,
  });

  return (
    <Suspense fallback={<SimulationSkeleton />}>
      <SimulationContent modelPromise={modelPromise} />
    </Suspense>
  );
}

async function SimulationContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlySimulationInputReadiness>;
}) {
  const model = await modelPromise;
  return <SimulationInputReadinessView model={model} />;
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
