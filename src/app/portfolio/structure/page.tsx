import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioStructureView } from "@/components/portfolio/portfolio-structure-view";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioRiskForScope } from "@/db/queries/portfolio-risk";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { buildPortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";
import { buildPortfolioStructureDesignPreview } from "@/lib/portfolio-structure-design-preview";
import { buildPortfolioSpecialHoldingsModel } from "@/lib/portfolio-special-holdings";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

type PortfolioStructurePageProps = {
  searchParams: Promise<{
    account?: string | string[];
    preview?: string | string[];
    scope?: string | string[];
    window?: string | string[];
  }>;
};

export default async function PortfolioStructurePage({
  searchParams,
}: PortfolioStructurePageProps) {
  const params = await searchParams;
  if (
    process.env.NODE_ENV === "development" &&
    firstSearchParam(params.preview) === "design"
  ) {
    return (
      <PortfolioStructureView
        data={buildPortfolioStructureDesignPreview(params.scope)}
      />
    );
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        resolution={resolution}
        title="Portfolio structure"
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
        basePath="/portfolio/structure"
        context={scopeContext}
        title="포트 구조"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const now = new Date();
  const serviceDate = resolveSnapshotCycle(now).snapshotDate;
  const [model, riskModel] = await Promise.all([
    getReadOnlyTenantPortfolioTargetPolicyModel({
      scope: selectedScope,
      serviceDate,
      tenantContext: resolution.tenantContext,
    }),
    getReadOnlyTenantPortfolioRiskForScope({
      scope: selectedScope,
      tenantContext: resolution.tenantContext,
      window: params.window,
      now,
    }),
  ]);
  const structure = model.structure;

  return (
    <PortfolioStructureView
      data={{
        analysisScopes: scopeContext.catalog.scopes,
        selectedScope,
        generatedAt: now.toISOString(),
        serviceDate,
        structure,
        targetProjection: model.structureTargetProjection,
        targetEffectiveServiceDate:
          model.approvedPolicy.policy?.effectiveServiceDate ?? null,
        directHoldingsBaseline:
          buildPortfolioDirectHoldingsBaseline(structure),
        specialHoldingsCoverage:
          buildPortfolioSpecialHoldingsModel(structure),
        riskModel,
      }}
    />
  );
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
