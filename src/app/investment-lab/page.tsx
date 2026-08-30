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
import { InvestmentLabDisclosure } from "@/components/investment-lab/investment-lab-disclosure";
import { getReadOnlyTenantInvestmentLabDataAvailabilityForScope } from "@/db/queries/investment-lab-data-availability";
import { getReadOnlyTenantHoldingAnalysisDataReadinessForScope } from "@/db/queries/holding-analysis-data-readiness";
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
  const portfolioStructurePromise = getReadOnlyTenantPortfolioStructureForScope(
    {
      scope: selectedScope,
      serviceDate,
      tenantContext,
    },
  );
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
  const etfXrayPromise = getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio(
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
          composition={
            <div className="space-y-8 py-7">
              <Suspense fallback={<InvestmentLabEtfXraySkeleton />}>
                <div id="investment-lab-etf-xray">
                  <InvestmentLabEtfXrayContent modelPromise={etfXrayPromise} />
                </div>
              </Suspense>
              <InvestmentLabDisclosure
                title="과거 충격 구간"
                detail="최대 낙폭 · 회복 · 전체 기간"
              >
                <div id="investment-lab-stress">
                  <Suspense fallback={<InvestmentLabStressReplaySkeleton />}>
                    <InvestmentLabStressReplayContent
                      modelPromise={stressReplayPromise}
                    />
                  </Suspense>
                </div>
              </InvestmentLabDisclosure>
            </div>
          }
          smallAdjustment={
            <div id="investment-lab-small-adjustment">
              <Suspense fallback={<InvestmentLabSmallAdjustmentSkeleton />}>
                <InvestmentLabSmallAdjustmentContent
                  modelPromise={portfolioStructurePromise}
                  scopeCatalog={scopeContext.catalog.scopes}
                  selectedScope={selectedScope}
                />
              </Suspense>
            </div>
          }
        />
      </Suspense>
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
  composition,
  readiness,
  smallAdjustment,
  dataAvailabilityPromise,
  fixedMixSelection,
  generatedAt,
  modelPromise,
  scopeCatalog,
  scopeQuery,
  selectedScope,
}: {
  composition: ReactNode;
  readiness: ReactNode;
  smallAdjustment: ReactNode;
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
      composition={composition}
      readiness={readiness}
      experiments={
        <div className="space-y-8 py-7">
          <div id="investment-lab-optimizer">
            <InvestmentLabPreperiodOptimizerView model={preperiodOptimizer} />
          </div>
          <InvestmentLabDisclosure
            title="국내·미국 지수 비중 조정"
            detail="KODEX 200 · Vanguard S&P 500 ETF"
            open
          >
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
          </InvestmentLabDisclosure>
          <InvestmentLabDisclosure
            title="시작일 바스켓과 반복 비교"
            detail="동일 비중 · 시간별 검증"
          >
            <InvestmentLabAnchorBasket
              fixedMixSelection={fixedMixSelection}
              model={anchorBasketScenario}
              period={period}
              scopeKey={selectedScope.key}
            />
            <InvestmentLabRollingComparisonView model={rollingComparison} />
          </InvestmentLabDisclosure>
          <InvestmentLabDisclosure
            title="작은 조정 실험"
            detail="보유 비중 변경 전후 구조"
          >
            {smallAdjustment}
          </InvestmentLabDisclosure>
        </div>
      }
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
  modelPromise: ReturnType<typeof getReadOnlyTenantPortfolioStructureForScope>;
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
