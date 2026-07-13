import { Suspense } from "react";

import { InvestmentLabView } from "@/components/investment-lab/investment-lab-view";
import { getReadOnlyInvestmentLabCounterfactual } from "@/db/queries/investment-lab";

export const dynamic = "force-dynamic";

export default function InvestmentLabPage() {
  const modelPromise = getReadOnlyInvestmentLabCounterfactual();

  return (
    <Suspense fallback={<InvestmentLabSkeleton />}>
      <InvestmentLabContent modelPromise={modelPromise} />
    </Suspense>
  );
}

async function InvestmentLabContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabCounterfactual>;
}) {
  const model = await modelPromise;
  return <InvestmentLabView model={model} />;
}

function InvestmentLabSkeleton() {
  return (
    <main className="min-h-screen bg-[#f3f4ef] p-4 text-[#171916]">
      <div className="mx-auto w-full max-w-[1500px] space-y-4">
        <div className="h-40 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-28 rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]"
            />
          ))}
        </div>
        <div className="h-[420px] rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]" />
      </div>
    </main>
  );
}
