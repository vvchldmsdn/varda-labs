import { Suspense } from "react";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
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
import { InvestmentLabPreperiodMinVolatilityView } from "@/components/investment-lab/investment-lab-preperiod-min-volatility";
import { InvestmentLabPreperiodOptimizerView } from "@/components/investment-lab/investment-lab-preperiod-optimizer";
import { InvestmentLabRollingComparisonView } from "@/components/investment-lab/investment-lab-rolling-comparison";
import {
  InvestmentLabStressReplaySkeleton,
  InvestmentLabStressReplayUnavailable,
  InvestmentLabStressReplayView,
} from "@/components/investment-lab/investment-lab-stress-replay";
import {
  InvestmentLabSmallAdjustment,
  InvestmentLabSmallAdjustmentSkeleton,
  InvestmentLabSmallAdjustmentUnavailable,
} from "@/components/investment-lab/investment-lab-small-adjustment";
import { InvestmentLabView } from "@/components/investment-lab/investment-lab-view";
import { getReadOnlyTenantInvestmentLabDataAvailabilityForScope } from "@/db/queries/investment-lab-data-availability";
import { getReadOnlyTenantInvestmentLabCounterfactualForScope } from "@/db/queries/investment-lab";
import { getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio } from "@/db/queries/investment-lab-etf-xray";
import { getReadOnlyTenantInvestmentLabAnalysisScopeEvidence } from "@/db/queries/investment-lab-scope-evidence";
import { getReadOnlyTenantInvestmentLabStressReplay } from "@/db/queries/investment-lab-stress-replay";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioStructureForScope } from "@/db/queries/portfolio-structure";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { applyInvestmentLabFountAvailabilityScope } from "@/lib/investment-lab-data-availability";
import { buildInvestmentLabSmallAdjustmentModel } from "@/lib/investment-lab-small-adjustment";
import { applyInvestmentLabCurrentHoldingScope } from "@/lib/investment-lab-current-holding-scope";
import { resolveInvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

type InvestmentLabPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    start?: string | string[];
    end?: string | string[];
    kodexWeight?: string | string[];
    basketAnchor?: string | string[];
  }>;
};

export default async function InvestmentLabPage({
  searchParams,
}: InvestmentLabPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        resolution={resolution}
        title="Investment Lab"
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
        basePath="/investment-lab"
        context={scopeContext}
        title="Investment Lab"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const scopeQuery = Object.freeze({
    start: params.start,
    end: params.end,
    kodexWeight: params.kodexWeight,
    basketAnchor: params.basketAnchor,
  });
  const fixedMixSelection = resolveInvestmentLabFixedMixSelection(
    params.kodexWeight,
  );
  const tenantContext = resolution.tenantContext;
  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const scopeEvidencePromise =
    getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({
      scope: selectedScope,
      tenantContext,
    });
  const portfolioStructurePromise = getReadOnlyTenantPortfolioStructureForScope({
    scope: selectedScope,
    serviceDate,
    tenantContext,
  });
  const dataAvailabilityPromise =
    getReadOnlyTenantInvestmentLabDataAvailabilityForScope({
      evidencePromise: scopeEvidencePromise,
      scope: selectedScope,
      tenantContext,
    });
  const etfXrayPromise =
    getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio(
      portfolioStructurePromise,
    );
  const modelPromise = getReadOnlyTenantInvestmentLabCounterfactualForScope({
    evidencePromise: scopeEvidencePromise,
    fixedMixSelection,
    request:
      params.start === undefined && params.end === undefined
        ? undefined
        : {
            startServiceDate: params.start,
            endServiceDate: params.end,
          },
    requestedAnchorDate: normalizeSingleParam(params.basketAnchor),
    scope: selectedScope,
    tenantContext,
  });
  const stressReplayPromise = getReadOnlyTenantInvestmentLabStressReplay({
    account: selectedScope.key,
    portfolioStructurePromise,
    tenantContext,
  });

  return (
    <div
      className="min-h-screen bg-[#f3f4ef] text-[#171916]"
      data-page="investment-lab"
    >
      <Suspense fallback={<InvestmentLabSkeleton />}>
        <InvestmentLabContent
          dataAvailabilityPromise={dataAvailabilityPromise}
          fixedMixSelection={fixedMixSelection}
          modelPromise={modelPromise}
          scopeCatalog={scopeContext.catalog.scopes}
          scopeQuery={scopeQuery}
          selectedScope={selectedScope}
        />
      </Suspense>
      <Suspense fallback={<InvestmentLabEtfXraySkeleton />}>
        <div className="scroll-mt-4" id="investment-lab-etf-xray">
          <InvestmentLabEtfXrayContent modelPromise={etfXrayPromise} />
        </div>
      </Suspense>
      <div className="scroll-mt-4" id="investment-lab-stress">
        <Suspense fallback={<InvestmentLabStressReplaySkeleton />}>
          <InvestmentLabStressReplayContent modelPromise={stressReplayPromise} />
        </Suspense>
      </div>
      <div className="scroll-mt-4" id="investment-lab-small-adjustment">
        <Suspense fallback={<InvestmentLabSmallAdjustmentSkeleton />}>
          <InvestmentLabSmallAdjustmentContent
            modelPromise={portfolioStructurePromise}
            scopeCatalog={scopeContext.catalog.scopes}
            selectedScope={selectedScope}
          />
        </Suspense>
      </div>
    </div>
  );
}

async function InvestmentLabStressReplayContent({
  modelPromise,
}: {
  modelPromise: ReturnType<typeof getReadOnlyTenantInvestmentLabStressReplay>;
}) {
  let model;
  try {
    model = await modelPromise;
  } catch {
    return <InvestmentLabStressReplayUnavailable />;
  }
  return <InvestmentLabStressReplayView model={model} />;
}

async function InvestmentLabContent({
  dataAvailabilityPromise,
  fixedMixSelection,
  modelPromise,
  scopeCatalog,
  scopeQuery,
  selectedScope,
}: {
  scopeCatalog: readonly PortfolioAnalysisScope[];
  scopeQuery: PortfolioAnalysisScopeQuery;
  dataAvailabilityPromise: ReturnType<
    typeof getReadOnlyTenantInvestmentLabDataAvailabilityForScope
  >;
  fixedMixSelection: InvestmentLabFixedMixSelection;
  modelPromise: ReturnType<
    typeof getReadOnlyTenantInvestmentLabCounterfactualForScope
  >;
  selectedScope: PortfolioAnalysisScope;
}) {
  const {
    accountComposition,
    anchorBasketScenario,
    anchorValueWeightScenario,
    anchorCurrentWeightMonthlyScenario,
    anchorEqualWeightMonthlyScenario,
    approvedTargetWeightScenario,
    fountScopeAdjustment,
    fundingPreflight,
    model,
    observedHistory,
    period,
    preperiodOptimizer,
    rollingComparison,
  } = await modelPromise;
  return (
    <>
      <InvestmentLabView
        accountComposition={accountComposition}
        anchorBasketScenario={anchorBasketScenario}
        anchorValueWeightScenario={anchorValueWeightScenario}
        anchorCurrentWeightMonthlyScenario={
          anchorCurrentWeightMonthlyScenario
        }
        anchorEqualWeightMonthlyScenario={anchorEqualWeightMonthlyScenario}
        approvedTargetWeightScenario={approvedTargetWeightScenario}
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
        observedHistory={observedHistory}
        optimizerStatus={preperiodOptimizer.status}
        period={period}
        scopeCatalog={scopeCatalog}
        scopeQuery={scopeQuery}
        selectedScope={selectedScope}
      />
      <InvestmentLabFixedMix
        comparison={model.fixedMixComparison}
        model={model.fixedMixScenario}
        period={period}
        scopeKey={selectedScope.key}
        selection={fixedMixSelection}
      />
      <InvestmentLabPreperiodMinVolatilityView
        model={model.preperiodMinVolatility}
      />
      <div className="scroll-mt-4" id="investment-lab-optimizer">
        <InvestmentLabPreperiodOptimizerView model={preperiodOptimizer} />
      </div>
      <InvestmentLabAnchorBasket
        fixedMixSelection={fixedMixSelection}
        model={anchorBasketScenario}
        period={period}
        scopeKey={selectedScope.key}
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
  modelPromise: ReturnType<
    typeof getReadOnlyTenantInvestmentLabDataAvailabilityForScope
  >;
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
  modelPromise: ReturnType<
    typeof getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio
  >;
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
  scopeCatalog,
  selectedScope,
}: {
  modelPromise: ReturnType<
    typeof getReadOnlyTenantPortfolioStructureForScope
  >;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  let portfolio;
  try {
    portfolio = await modelPromise;
  } catch {
    return <InvestmentLabSmallAdjustmentUnavailable />;
  }
  return (
    <InvestmentLabSmallAdjustment
      key={selectedScope.key}
      model={buildInvestmentLabSmallAdjustmentModel(
        applyInvestmentLabCurrentHoldingScope(portfolio).portfolio,
        portfolio.holdingRows.map((row) => row.account),
        new Map(
          scopeCatalog.flatMap((scope) =>
            scope.kind === "account"
              ? [[scope.accountCode, scope.label] as const]
              : [],
          ),
        ),
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
