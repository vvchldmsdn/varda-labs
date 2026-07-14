import { Suspense } from "react";

import {
  InvestmentLabEtfXray,
  InvestmentLabEtfXraySkeleton,
  InvestmentLabEtfXrayUnavailable,
} from "@/components/investment-lab/investment-lab-etf-xray";
import { InvestmentLabRollingComparisonView } from "@/components/investment-lab/investment-lab-rolling-comparison";
import { InvestmentLabView } from "@/components/investment-lab/investment-lab-view";
import { getReadOnlyInvestmentLabCounterfactual } from "@/db/queries/investment-lab";
import { getReadOnlyInvestmentLabEtfXray } from "@/db/queries/investment-lab-etf-xray";

export const dynamic = "force-dynamic";

type InvestmentLabPageProps = {
  searchParams: Promise<{
    start?: string | string[];
    end?: string | string[];
  }>;
};

export default async function InvestmentLabPage({
  searchParams,
}: InvestmentLabPageProps) {
  const etfXrayPromise = getReadOnlyInvestmentLabEtfXray();
  const params = await searchParams;
  const modelPromise = getReadOnlyInvestmentLabCounterfactual(
    params.start === undefined && params.end === undefined
      ? undefined
      : {
          startServiceDate: params.start,
          endServiceDate: params.end,
        },
  );

  return (
    <div className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <Suspense fallback={<InvestmentLabSkeleton />}>
        <InvestmentLabContent modelPromise={modelPromise} />
      </Suspense>
      <Suspense fallback={<InvestmentLabEtfXraySkeleton />}>
        <InvestmentLabEtfXrayContent modelPromise={etfXrayPromise} />
      </Suspense>
    </div>
  );
}

async function InvestmentLabContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabCounterfactual>;
}) {
  const { model, period, rollingComparison } = await modelPromise;
  return (
    <>
      <InvestmentLabView model={model} period={period} />
      <InvestmentLabRollingComparisonView model={rollingComparison} />
    </>
  );
}

async function InvestmentLabEtfXrayContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabEtfXray>;
}) {
  let model;
  try {
    model = await modelPromise;
  } catch {
    return <InvestmentLabEtfXrayUnavailable />;
  }
  return <InvestmentLabEtfXray model={model} />;
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
