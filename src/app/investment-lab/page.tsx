import { Suspense } from "react";

import {
  InvestmentLabEtfXray,
  InvestmentLabEtfXraySkeleton,
  InvestmentLabEtfXrayUnavailable,
} from "@/components/investment-lab/investment-lab-etf-xray";
import { InvestmentLabFixedMix } from "@/components/investment-lab/investment-lab-fixed-mix";
import { InvestmentLabAnchorBasket } from "@/components/investment-lab/investment-lab-anchor-basket";
import { InvestmentLabRollingComparisonView } from "@/components/investment-lab/investment-lab-rolling-comparison";
import {
  InvestmentLabSmallAdjustment,
  InvestmentLabSmallAdjustmentSkeleton,
  InvestmentLabSmallAdjustmentUnavailable,
} from "@/components/investment-lab/investment-lab-small-adjustment";
import { InvestmentLabView } from "@/components/investment-lab/investment-lab-view";
import { getReadOnlyInvestmentLabCounterfactual } from "@/db/queries/investment-lab";
import { getReadOnlyInvestmentLabEtfXray } from "@/db/queries/investment-lab-etf-xray";
import { getReadOnlyAllPortfolioStructure } from "@/db/queries/portfolio-structure";
import { buildInvestmentLabSmallAdjustmentModel } from "@/lib/investment-lab-small-adjustment";
import { resolveInvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";

export const dynamic = "force-dynamic";

type InvestmentLabPageProps = {
  searchParams: Promise<{
    start?: string | string[];
    end?: string | string[];
    kodexWeight?: string | string[];
    basketAnchor?: string | string[];
  }>;
};

export default async function InvestmentLabPage({
  searchParams,
}: InvestmentLabPageProps) {
  const portfolioStructurePromise = getReadOnlyAllPortfolioStructure();
  const etfXrayPromise = getReadOnlyInvestmentLabEtfXray();
  const params = await searchParams;
  const fixedMixSelection = resolveInvestmentLabFixedMixSelection(
    params.kodexWeight,
  );
  const modelPromise = getReadOnlyInvestmentLabCounterfactual(
    params.start === undefined && params.end === undefined
      ? undefined
      : {
          startServiceDate: params.start,
          endServiceDate: params.end,
        },
    fixedMixSelection,
    normalizeSingleParam(params.basketAnchor),
  );

  return (
    <div className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <Suspense fallback={<InvestmentLabSkeleton />}>
        <InvestmentLabContent
          fixedMixSelection={fixedMixSelection}
          modelPromise={modelPromise}
        />
      </Suspense>
      <Suspense fallback={<InvestmentLabEtfXraySkeleton />}>
        <InvestmentLabEtfXrayContent modelPromise={etfXrayPromise} />
      </Suspense>
      <Suspense fallback={<InvestmentLabSmallAdjustmentSkeleton />}>
        <InvestmentLabSmallAdjustmentContent
          modelPromise={portfolioStructurePromise}
        />
      </Suspense>
    </div>
  );
}

async function InvestmentLabContent({
  fixedMixSelection,
  modelPromise,
}: {
  fixedMixSelection: InvestmentLabFixedMixSelection;
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabCounterfactual>;
}) {
  const { anchorBasketScenario, model, period, rollingComparison } =
    await modelPromise;
  return (
    <>
      <InvestmentLabView model={model} period={period} />
      <InvestmentLabFixedMix
        model={model.fixedMixScenario}
        period={period}
        selection={fixedMixSelection}
      />
      <InvestmentLabAnchorBasket
        fixedMixSelection={fixedMixSelection}
        model={anchorBasketScenario}
        period={period}
      />
      <InvestmentLabRollingComparisonView model={rollingComparison} />
    </>
  );
}

function normalizeSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return "__ambiguous__";
  return value ?? null;
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

async function InvestmentLabSmallAdjustmentContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlyAllPortfolioStructure>;
}) {
  let portfolio;
  try {
    portfolio = await modelPromise;
  } catch {
    return <InvestmentLabSmallAdjustmentUnavailable />;
  }
  return (
    <InvestmentLabSmallAdjustment
      model={buildInvestmentLabSmallAdjustmentModel(portfolio)}
    />
  );
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
