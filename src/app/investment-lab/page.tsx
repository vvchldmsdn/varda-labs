import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { Suspense, type ReactNode } from "react";

import {
  HoldingAnalysisDataPanel,
  HoldingAnalysisDataPanelSkeleton,
} from "@/components/holding-analysis-data-panel";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import {
  InvestmentLabDataAvailabilitySkeleton,
  InvestmentLabDataAvailabilityUnavailable,
  InvestmentLabDataAvailabilityView,
} from "@/components/investment-lab/investment-lab-data-availability";
import { InvestmentLabView } from "@/components/investment-lab/investment-lab-view";
import { getReadOnlyTenantInvestmentLabDataAvailabilityForScope } from "@/db/queries/investment-lab-data-availability";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope } from "@/db/queries/holding-analysis-data-readiness";
import { getReadOnlyTenantInvestmentLabCounterfactualForScope } from "@/db/queries/investment-lab";
import { getReadOnlyTenantInvestmentLabAnalysisScopeEvidence } from "@/db/queries/investment-lab-scope-evidence";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { applyInvestmentLabFountAvailabilityScope } from "@/lib/investment-lab-data-availability";
import { resolveInvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type { InvestmentLabFixedMixSelection } from "@/lib/investment-lab-fixed-mix-selection";
import type {
  PortfolioAnalysisScope,
  PortfolioAnalysisScopeQuery,
} from "@/lib/portfolio-analysis-scope";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export const metadata = { title: "투자 랩 | VARDA LABS" };

type InvestmentLabPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    start?: string | string[];
    end?: string | string[];
    kodexWeight?: string | string[];
    basketAnchor?: string | string[];
    view?: string | string[];
    preview?: string | string[];
  }>;
};

export default async function InvestmentLabPage({
  searchParams,
}: InvestmentLabPageProps) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "design") {
    const { InvestmentLabDesignPreview } =
      await import("@/components/investment-lab/investment-lab-design-preview");
    return <InvestmentLabDesignPreview query={params} />;
  }
  const resolution = await resolveCurrentTenantContext();

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
    view: params.view,
  });
  const fixedMixSelection = resolveInvestmentLabFixedMixSelection(
    params.kodexWeight,
  );
  const tenantContext = resolution.tenantContext;
  const generatedAt = new Date();
  const serviceDate = resolveSnapshotCycle(generatedAt).snapshotDate;
  const scopeEvidencePromise =
    getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({
      scope: selectedScope,
      tenantContext,
    });
  const dataAvailabilityPromise =
    getReadOnlyTenantInvestmentLabDataAvailabilityForScope({
      evidencePromise: scopeEvidencePromise,
      scope: selectedScope,
      tenantContext,
    });
  const analysisDataReadinessPromise =
    getReadOnlyTenantHoldingAnalysisDataReadinessForScope({
      scope: selectedScope,
      serviceDate,
      tenantContext,
    });
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

  return (
    <div
      className="min-h-screen bg-[var(--paper)] text-[var(--ink)]"
      data-page="investment-lab"
    >
      <Suspense fallback={<InvestmentLabSkeleton />}>
        <InvestmentLabContent
          dataAvailabilityPromise={dataAvailabilityPromise}
          fixedMixSelection={fixedMixSelection}
          generatedAt={generatedAt.toISOString()}
          modelPromise={modelPromise}
          scopeCatalog={scopeContext.catalog.scopes}
          scopeQuery={scopeQuery}
          selectedScope={selectedScope}
          readiness={
            <Suspense fallback={<HoldingAnalysisDataPanelSkeleton />}>
              <HoldingAnalysisDataPanel
                resultPromise={analysisDataReadinessPromise}
              />
            </Suspense>
          }

        />
      </Suspense>
    </div>
  );
}

async function InvestmentLabContent({
  readiness,
  dataAvailabilityPromise,
  fixedMixSelection,
  generatedAt,
  modelPromise,
  scopeCatalog,
  scopeQuery,
  selectedScope,
}: {
  readiness: ReactNode;
  scopeCatalog: readonly PortfolioAnalysisScope[];
  scopeQuery: PortfolioAnalysisScopeQuery;
  dataAvailabilityPromise: ReturnType<
    typeof getReadOnlyTenantInvestmentLabDataAvailabilityForScope
  >;
  fixedMixSelection: InvestmentLabFixedMixSelection;
  generatedAt: string;
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
    <InvestmentLabView
      weightEvidence={{ period, selection: fixedMixSelection, fixedMixScenario: model.fixedMixScenario, fixedMixComparison: model.fixedMixComparison, preperiodMinVolatility: model.preperiodMinVolatility, optimizer: preperiodOptimizer, anchorBasket: anchorBasketScenario, rollingComparison }}
      accountComposition={accountComposition}
      anchorBasketScenario={anchorBasketScenario}
      anchorValueWeightScenario={anchorValueWeightScenario}
      anchorCurrentWeightMonthlyScenario={anchorCurrentWeightMonthlyScenario}
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
      generatedAt={generatedAt}
      model={model}
      observedHistory={observedHistory}
      readiness={readiness}

      period={period}
      scopeCatalog={scopeCatalog}
      scopeQuery={scopeQuery}
      selectedScope={selectedScope}
    />
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
      model={applyInvestmentLabFountAvailabilityScope(model, fountScopeStatus)}
    />
  );
}

function normalizeSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return "__ambiguous__";
  return value ?? null;
}

function InvestmentLabSkeleton() {
  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1540px] px-5 py-8 sm:px-8 lg:px-10">
        <div className="h-12 border-y border-[var(--line)]" />
        <div className="mt-12 h-28 border-b border-[var(--line)]" />
        <div className="grid border-b border-[var(--line)] sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-24 border-r border-[var(--line)] last:border-r-0"
            />
          ))}
        </div>
        <div className="mt-8 h-[420px] border-b border-[var(--line)]" />
      </div>
    </main>
  );
}
