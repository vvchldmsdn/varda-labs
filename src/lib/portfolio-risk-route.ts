import type {
  PortfolioRiskAccount,
  PortfolioRiskWindow,
} from "./portfolio-risk-read-model-types.ts";

export function buildPortfolioRiskHref(
  account: PortfolioRiskAccount,
  window: PortfolioRiskWindow,
) {
  const searchParams = new URLSearchParams();
  if (account !== "brokerage") searchParams.set("account", account);
  if (window !== 90) searchParams.set("window", String(window));
  const query = searchParams.toString();
  return query ? `/portfolio/risk?${query}` : "/portfolio/risk";
}
