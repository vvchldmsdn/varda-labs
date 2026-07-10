import { PortfolioRiskView } from "@/components/portfolio-risk/portfolio-risk-view";
import { getReadOnlyPortfolioRisk } from "@/db/queries/portfolio-risk";

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
  const params = await searchParams;
  const model = await getReadOnlyPortfolioRisk({
    account: params.account,
    window: params.window,
  });

  return <PortfolioRiskView model={model} />;
}
