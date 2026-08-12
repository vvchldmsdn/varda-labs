import { config } from "dotenv";

import { compareAdditionalContributionMa120Overlay } from "../src/lib/additional-contribution-ma120-overlay.ts";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";

config({ path: ".env.local", quiet: true });

main().catch(() => {
  console.error(
    JSON.stringify({
      mode: "select_only",
      status: "blocked",
      reason: "audit_failed",
    }),
  );
  process.exitCode = 1;
});

async function main() {
  const databaseTarget = guardProductionDatabaseTarget(process.env);
  const [{ eq }, client, schema, ownerModule, queryModule] = await Promise.all([
    import("drizzle-orm"),
    import("../src/db/client.ts"),
    import("../src/db/schema.ts"),
    import("../src/db/queries/active-portfolio-owners.ts"),
    import("../src/db/queries/additional-contribution.ts"),
  ]);
  const ownerUserIds = await ownerModule.getActivePortfolioOwnerUserIds();
  if (ownerUserIds.length !== 1) {
    throw new Error("Expected exactly one active portfolio owner.");
  }

  const userRows = await client.db
    .select({ role: schema.appUsers.role })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.id, ownerUserIds[0]))
    .limit(2);
  const role = userRows[0]?.role;
  if (userRows.length !== 1 || (role !== "user" && role !== "admin")) {
    throw new Error("Active portfolio owner role is unavailable.");
  }
  const tenantContext = Object.freeze({
    ownerUserId: ownerUserIds[0],
    role,
  });

  const cashAmountKrw = 3_000_000;
  const summaries = await Promise.all(
    (["brokerage", "isa", "irp"] as const).map(async (account) => {
      const preview =
        await queryModule.getReadOnlyTenantAdditionalContributionPreview({
          account,
          cashAmountKrw,
          tenantContext,
        });
      if (preview.status !== "ready" || !("ma120Evidence" in preview)) {
        return Object.freeze({
          account,
          baselineStatus: preview.status,
          blockers: preview.blockers,
        });
      }

      const comparison = compareAdditionalContributionMa120Overlay({
        mode: "candidate",
        serviceDate: preview.serviceDate,
        baseline: Object.freeze({
          cashAmountKrw: preview.cashAmountKrw,
          totalAllocatedKrw: preview.totalAllocatedKrw,
          residualCashKrw: preview.residualCashKrw,
          allocations: Object.freeze(
            preview.rows.map((row) =>
              Object.freeze({
                market: row.market,
                currency: row.currency,
                ticker: row.ticker,
                allocationKrw: row.allocationKrw,
              }),
            ),
          ),
        }),
        evidence: Object.freeze(
          preview.rows.map((row) =>
            Object.freeze({
              instrumentKey: instrumentKey(row),
              status: row.ma120Evidence.status,
              latestWindowPriceDate:
                row.ma120Evidence.latestWindowPriceDate,
              distanceFromMaPct: row.ma120Evidence.distanceFromMaPct,
            }),
          ),
        ),
      });

      return Object.freeze({
        account,
        baselineStatus: preview.status,
        evidenceStatus: preview.ma120Evidence.status,
        serviceDate: preview.serviceDate,
        usableEvidence: `${preview.ma120Evidence.usableCount}/${preview.rows.length}`,
        comparisonStatus: comparison.status,
        strategicAllocatedKrw: comparison.strategicAllocatedKrw,
        overlayAllocatedKrw: comparison.overlayAllocatedKrw,
        overlayResidualCashKrw: comparison.overlayResidualCashKrw,
        totalReductionKrw: comparison.totalReductionKrw,
        rows: comparison.rows.map((row) =>
          Object.freeze({
            ticker: row.ticker,
            decision: row.decision,
            multiplier: row.multiplier,
            strategicAllocationKrw: row.strategicAllocationKrw,
            overlayAllocationKrw: row.overlayAllocationKrw,
            reductionKrw: row.reductionKrw,
          }),
        ),
      });
    }),
  );

  console.log(
    JSON.stringify(
      {
        mode: "select_only",
        databaseTarget: databaseTarget.status,
        cashAmountKrw,
        summaries,
      },
      null,
      2,
    ),
  );
}

function instrumentKey(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  return `${String(row.market).toLowerCase()}:${String(row.currency).toUpperCase()}:${String(row.ticker).toUpperCase()}`;
}
