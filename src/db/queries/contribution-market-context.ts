import "server-only";

import { loadUsablePortfolioFxRows } from "@/db/queries/portfolio-fx-rates";
import { buildContributionMarketContext } from "@/lib/contribution-market-context";

/** Called after authentication. Reads bounded shared observations, never a provider. */
export async function getContributionMarketContext(now = new Date()) {
  try {
    return buildContributionMarketContext(await loadUsablePortfolioFxRows(180), now);
  } catch {
    // Optional context cannot block the tenant's core contribution calculation.
    return buildContributionMarketContext([], now);
  }
}
