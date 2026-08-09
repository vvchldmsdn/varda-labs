import { config } from "dotenv";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const [ownerModule, structureModule, stressModule] = await Promise.all([
    import("../src/db/queries/active-portfolio-owners.ts"),
    import("../src/db/queries/portfolio-structure.ts"),
    import("../src/db/queries/investment-lab-stress-replay.ts"),
  ]);
  const ownerUserIds = await ownerModule.getActivePortfolioOwnerUserIds();
  if (ownerUserIds.length !== 1) {
    throw new Error("Stress replay audit requires exactly one active portfolio owner");
  }
  const tenantContext = Object.freeze({
    ownerUserId: ownerUserIds[0],
    role: "user" as const,
  });

  const scopes = ["all", "brokerage", "isa", "irp"] as const;
  const summaries = [];
  for (const account of scopes) {
    const portfolioStructurePromise =
      structureModule.getReadOnlyTenantPortfolioStructure({
        account,
        tenantContext,
      });
    const model = await stressModule.getReadOnlyTenantInvestmentLabStressReplay({
      account,
      portfolioStructurePromise,
      tenantContext,
    });
    summaries.push({
      account,
      windows: model.windows.map((window) => ({
        id: window.id,
        status: window.status,
        currentValueCoveragePct: round(window.currentValueCoveragePct),
        eligibleInstrumentCount: window.eligibleInstrumentCount,
        excludedHoldingCount: window.excludedHoldingCount,
        exclusionReasons: countBy(
          window.excludedHoldings.map((holding) => holding.reason),
        ),
        adjustedInstrumentCount: window.priceBasis.adjustedInstrumentCount,
        privateRawInstrumentCount: window.priceBasis.privateRawInstrumentCount,
        strategies: Object.fromEntries(
          window.strategies.map((strategy) => [strategy.id, strategy.status]),
        ),
      })),
    });
  }

  console.log(
    JSON.stringify(
      {
        operation: "investment_lab_stress_replay_audit",
        databaseMode: "select_only",
        providerCalls: 0,
        databaseWrites: 0,
        activeOwnerCount: ownerUserIds.length,
        scopes: summaries,
      },
      null,
      2,
    ),
  );
}

function countBy(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort());
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
