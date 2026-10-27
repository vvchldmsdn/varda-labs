export type InvestmentLabPanel = "weights" | "composition";

export function resolveInvestmentLabPanel(value: unknown): InvestmentLabPanel | null {
  return value === "weights" || value === "composition" ? value : null;
}

/** Start only the reads required by the requested detail panel. */
export function startInvestmentLabPanelQueries<Portfolio, EtfXray, StressReplay>(
  panel: InvestmentLabPanel | null,
  loaders: {
    portfolio: () => Promise<Portfolio>;
    etfXray: (portfolio: Promise<Portfolio>) => Promise<EtfXray>;
    stressReplay: (portfolio: Promise<Portfolio>) => Promise<StressReplay>;
  },
) {
  const portfolioStructurePromise = panel ? loaders.portfolio() : null;
  return {
    portfolioStructurePromise,
    etfXrayPromise:
      panel === "composition" && portfolioStructurePromise
        ? loaders.etfXray(portfolioStructurePromise)
        : null,
    stressReplayPromise:
      panel === "composition" && portfolioStructurePromise
        ? loaders.stressReplay(portfolioStructurePromise)
        : null,
  };
}
