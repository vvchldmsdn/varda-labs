import { config } from "dotenv";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  buildAuditTenantContext,
  parseAuditOwnerUserId,
} from "./lib/audit-tenant-selector.ts";

async function main() {
  config({ path: ".env.local", quiet: true });
  const ownerUserId = parseAuditOwnerUserId(process.argv.slice(2));
  guardProductionDatabaseTarget(process.env);

  const [{ eq }, client, schema, structureModule, stressModule] = await Promise.all([
    import("drizzle-orm"),
    import("../src/db/client.ts"),
    import("../src/db/schema.ts"),
    import("../src/db/queries/portfolio-structure.ts"),
    import("../src/db/queries/investment-lab-stress-replay.ts"),
  ]);
  const userRows = await client.db
    .select({ role: schema.appUsers.role, status: schema.appUsers.status })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.id, ownerUserId))
    .limit(2);
  const tenantContext = buildAuditTenantContext(ownerUserId, userRows);

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
        tenantSelection: "explicit_active_owner",
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
