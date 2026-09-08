import { localizedMetadata } from "@/lib/i18n/server";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioRiskView } from "@/components/portfolio-risk/portfolio-risk-view";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioRiskForScope } from "@/db/queries/portfolio-risk";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "위험 분석 | VARDA LABS" }, "Risk analysis | VARDA LABS");
}

type PortfolioRiskPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    preview?: string | string[];
    scope?: string | string[];
    window?: string | string[];
  }>;
};

export default async function PortfolioRiskPage({
  searchParams,
}: PortfolioRiskPageProps) {
  if (process.env.NODE_ENV === "development") {
    const previewParams = await searchParams;
    if ((Array.isArray(previewParams.preview) ? previewParams.preview[0] : previewParams.preview) === "design") {
      const { buildPortfolioStructureDesignPreview } = await import("@/lib/portfolio-structure-design-preview");
      const sample = buildPortfolioStructureDesignPreview(previewParams.scope);
      return <PortfolioRiskView model={sample.riskModel} scopes={sample.analysisScopes} selectedScope={sample.selectedScope} isDesignPreview />;
    }
  }
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        resolution={resolution}
        title="위험 분석" titleEn="Portfolio risk"
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
        basePath="/portfolio/risk"
        context={scopeContext}
        title="위험 분석" titleEn="Portfolio risk"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const model = await getReadOnlyTenantPortfolioRiskForScope({
    scope: selectedScope,
    window: params.window,
    tenantContext: resolution.tenantContext,
  });

  return (
    <PortfolioRiskView
      model={model}
      scopes={scopeContext.catalog.scopes}
      selectedScope={selectedScope}
    />
  );
}
