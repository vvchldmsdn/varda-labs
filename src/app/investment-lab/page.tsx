import { Suspense } from "react";

import {
  InvestmentLabDataAvailabilitySkeleton,
  InvestmentLabDataAvailabilityUnavailable,
  InvestmentLabDataAvailabilityView,
} from "@/components/investment-lab/investment-lab-data-availability";
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
import { getReadOnlyInvestmentLabDataAvailability } from "@/db/queries/investment-lab-data-availability";
import { getReadOnlyInvestmentLabCounterfactual } from "@/db/queries/investment-lab";
import { getReadOnlyInvestmentLabEtfXray } from "@/db/queries/investment-lab-etf-xray";
import { getReadOnlyPortfolioStructure } from "@/db/queries/portfolio-structure";
import { applyInvestmentLabFountAvailabilityScope } from "@/lib/investment-lab-data-availability";
import { buildInvestmentLabSmallAdjustmentModel } from "@/lib/investment-lab-small-adjustment";
import { applyInvestmentLabCurrentHoldingScope } from "@/lib/investment-lab-current-holding-scope";
import { resolveInvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import {
  normalizePortfolioAccountScope,
  type PortfolioAccountScope,
  type PortfolioAccountScopeQuery,
} from "@/lib/portfolio-account-scope";

export const dynamic = "force-dynamic";

type InvestmentLabPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    start?: string | string[];
    end?: string | string[];
    kodexWeight?: string | string[];
    basketAnchor?: string | string[];
  }>;
};

export default async function InvestmentLabPage({
  searchParams,
}: InvestmentLabPageProps) {
  const params = await searchParams;
  const selectedAccount = normalizePortfolioAccountScope(
    params.account,
    "all",
  );
  const accountQuery = Object.freeze({
    start: params.start,
    end: params.end,
    kodexWeight: params.kodexWeight,
    basketAnchor: params.basketAnchor,
  });
  const fixedMixSelection = resolveInvestmentLabFixedMixSelection(
    params.kodexWeight,
  );
  const portfolioStructurePromise = getReadOnlyPortfolioStructure({
    account: selectedAccount,
  });
  const dataAvailabilityPromise =
    getReadOnlyInvestmentLabDataAvailability(selectedAccount);
  const etfXrayPromise = getReadOnlyInvestmentLabEtfXray(selectedAccount);
  const modelPromise = getReadOnlyInvestmentLabCounterfactual(
    params.start === undefined && params.end === undefined
      ? undefined
      : {
          startServiceDate: params.start,
          endServiceDate: params.end,
        },
    fixedMixSelection,
    normalizeSingleParam(params.basketAnchor),
    selectedAccount,
  );

  return (
    <div className="min-h-screen bg-[#f3f4ef] text-[#171916]">
      <Suspense fallback={<InvestmentLabSkeleton />}>
        <InvestmentLabContent
          dataAvailabilityPromise={dataAvailabilityPromise}
          fixedMixSelection={fixedMixSelection}
          modelPromise={modelPromise}
          accountQuery={accountQuery}
          selectedAccount={selectedAccount}
        />
      </Suspense>
      <Suspense fallback={<InvestmentLabEtfXraySkeleton />}>
        <InvestmentLabEtfXrayContent modelPromise={etfXrayPromise} />
      </Suspense>
      <Suspense fallback={<InvestmentLabSmallAdjustmentSkeleton />}>
        <InvestmentLabSmallAdjustmentContent
          modelPromise={portfolioStructurePromise}
          selectedAccount={selectedAccount}
        />
      </Suspense>
    </div>
  );
}

async function InvestmentLabContent({
  accountQuery,
  dataAvailabilityPromise,
  fixedMixSelection,
  modelPromise,
  selectedAccount,
}: {
  accountQuery: PortfolioAccountScopeQuery;
  dataAvailabilityPromise: ReturnType<
    typeof getReadOnlyInvestmentLabDataAvailability
  >;
  fixedMixSelection: InvestmentLabFixedMixSelection;
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabCounterfactual>;
  selectedAccount: PortfolioAccountScope;
}) {
  const {
    accountComposition,
    anchorBasketScenario,
    anchorValueWeightScenario,
    fountScopeAdjustment,
    fundingPreflight,
    model,
    period,
    rollingComparison,
  } = await modelPromise;
  return (
    <>
      <InvestmentLabView
        accountComposition={accountComposition}
        anchorBasketScenario={anchorBasketScenario}
        anchorValueWeightScenario={anchorValueWeightScenario}
        dataAvailability={
          <Suspense fallback={<InvestmentLabDataAvailabilitySkeleton />}>
            <InvestmentLabDataAvailabilityContent
              fountScopeStatus={fountScopeAdjustment.status}
              modelPromise={dataAvailabilityPromise}
            />
          </Suspense>
        }
        fountScopeAdjustment={fountScopeAdjustment}
        fundingPreflight={fundingPreflight}
        model={model}
        period={period}
        accountQuery={accountQuery}
        selectedAccount={selectedAccount}
      />
      <InvestmentLabFixedMix
        account={selectedAccount}
        comparison={model.fixedMixComparison}
        model={model.fixedMixScenario}
        period={period}
        selection={fixedMixSelection}
      />
      <InvestmentLabAnchorBasket
        account={selectedAccount}
        fixedMixSelection={fixedMixSelection}
        model={anchorBasketScenario}
        period={period}
      />
      <InvestmentLabRollingComparisonView model={rollingComparison} />
    </>
  );
}

async function InvestmentLabDataAvailabilityContent({
  fountScopeStatus,
  modelPromise,
}: {
  fountScopeStatus: "not_applicable" | "applied" | "blocked";
  modelPromise: ReturnType<typeof getReadOnlyInvestmentLabDataAvailability>;
}) {
  let model;
  try {
    model = await modelPromise;
  } catch {
    return <InvestmentLabDataAvailabilityUnavailable />;
  }
  return (
    <InvestmentLabDataAvailabilityView
      model={applyInvestmentLabFountAvailabilityScope(
        model,
        fountScopeStatus,
      )}
    />
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
  selectedAccount,
}: {
  modelPromise: ReturnType<typeof getReadOnlyPortfolioStructure>;
  selectedAccount: PortfolioAccountScope;
}) {
  let portfolio;
  try {
    portfolio = await modelPromise;
  } catch {
    return <InvestmentLabSmallAdjustmentUnavailable />;
  }
  return (
    <InvestmentLabSmallAdjustment
      key={selectedAccount}
      model={buildInvestmentLabSmallAdjustmentModel(
        applyInvestmentLabCurrentHoldingScope(portfolio).portfolio,
        selectedAccount,
      )}
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
