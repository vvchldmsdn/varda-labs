import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioRiskView } from "@/components/portfolio-risk/portfolio-risk-view";
import { getReadOnlyTenantPortfolioRisk } from "@/db/queries/portfolio-risk";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

type PortfolioRiskPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    window?: string | string[];
  }>;
};

export default async function PortfolioRiskPage({
  searchParams,
}: PortfolioRiskPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);

  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        resolution={resolution}
        title="Portfolio risk"
      />
    );
  }

  const model = await getReadOnlyTenantPortfolioRisk({
    account: params.account,
    window: params.window,
    tenantContext: resolution.tenantContext,
  });

  return <PortfolioRiskView model={model} />;
}
