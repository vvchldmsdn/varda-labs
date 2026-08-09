import { config } from "dotenv";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const [{ and, asc, eq, inArray, isNull, sql }, client, schema, queryModule] =
    await Promise.all([
      import("drizzle-orm"),
      import("../src/db/client.ts"),
      import("../src/db/schema.ts"),
      import("../src/db/queries/investment-lab.ts"),
    ]);
  const { accounts, appUsers, dailyPositionSnapshots } = schema;
  const ownerRows = await client.db
    .selectDistinct({ ownerUserId: appUsers.id, role: appUsers.role })
    .from(appUsers)
    .innerJoin(
      accounts,
      and(
        eq(accounts.canonicalOwnerUserId, appUsers.id),
        eq(accounts.isActive, true),
        inArray(accounts.code, ["brokerage", "isa", "irp"]),
      ),
    )
    .where(
      and(
        eq(appUsers.status, "active"),
        inArray(appUsers.role, ["user", "admin"]),
      ),
    )
    .orderBy(asc(appUsers.id));

  if (ownerRows.length !== 1) {
    throw new Error(
      `optimizer audit requires exactly one active portfolio owner; found ${ownerRows.length}`,
    );
  }
  const owner = ownerRows[0];
  if (owner.role !== "user" && owner.role !== "admin") {
    throw new Error("active portfolio owner has an unsupported role");
  }
  const tenantContext = Object.freeze({
    ownerUserId: owner.ownerUserId,
    role: owner.role,
  });
  const manualValuationRows = await client.db
    .select({
      source: dailyPositionSnapshots.source,
      priceSource: dailyPositionSnapshots.priceSource,
      priceBasis: dailyPositionSnapshots.priceBasis,
      rowCount: sql<number>`count(*)::int`,
      firstSnapshotDate: sql<string>`min(${dailyPositionSnapshots.snapshotDate})`,
      lastSnapshotDate: sql<string>`max(${dailyPositionSnapshots.snapshotDate})`,
      missingReferenceDateCount:
        sql<number>`count(*) filter (where coalesce(${dailyPositionSnapshots.referenceDate}, ${dailyPositionSnapshots.priceDate}) is null)::int`,
    })
    .from(dailyPositionSnapshots)
    .innerJoin(accounts, eq(dailyPositionSnapshots.accountId, accounts.id))
    .where(
      and(
        eq(accounts.canonicalOwnerUserId, owner.ownerUserId),
        eq(accounts.isActive, true),
        eq(accounts.code, "brokerage"),
        eq(dailyPositionSnapshots.account, accounts.code),
        eq(dailyPositionSnapshots.isSample, false),
        isNull(dailyPositionSnapshots.ticker),
        eq(dailyPositionSnapshots.assetType, "commodity"),
      ),
    )
    .groupBy(
      dailyPositionSnapshots.source,
      dailyPositionSnapshots.priceSource,
      dailyPositionSnapshots.priceBasis,
    )
    .orderBy(
      asc(dailyPositionSnapshots.source),
      asc(dailyPositionSnapshots.priceSource),
      asc(dailyPositionSnapshots.priceBasis),
    );
  const scopes = ["all", "brokerage", "isa", "irp"] as const;
  const results = [];
  for (const account of scopes) {
    const readModel =
      await queryModule.getReadOnlyTenantInvestmentLabCounterfactual({
        account,
        tenantContext,
      });
    const optimizer = readModel.preperiodOptimizer;
    const anchorScenario = readModel.anchorBasketScenario;
    results.push(
      Object.freeze({
        account,
        status: optimizer.status,
        selectedAnchorDate: anchorScenario.anchor.selectedAnchorDate,
        candidateAnchorDateCount:
          anchorScenario.anchor.candidateAnchorDates.length,
        candidateCount: optimizer.candidates.length,
        readyPathCount: optimizer.candidates.filter(
          (candidate) => candidate.scenario.status === "ready",
        ).length,
        instrumentCount: optimizer.training?.instrumentCount ?? 0,
        returnObservationCount:
          optimizer.training?.returnObservationCount ?? 0,
        commonPriceDateCount: optimizer.coverage.commonPriceDateCount,
        manualValuationComponentCount:
          anchorScenario.coverage.manualValuationComponentCount,
        manualObservationRows: anchorScenario.coverage.manualObservationRows,
        manualCarryRows: anchorScenario.coverage.manualCarryRows,
        blockerCount: optimizer.blockers.length,
        blockers: optimizer.blockers,
        evidenceBlockers: [
          ...new Set(
            optimizer.candidates.flatMap((candidate) =>
              candidate.scenario.evidenceBlockers.map((row) => row.reason),
            ),
          ),
        ].sort(),
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        operation: "investment_lab_preperiod_optimizer_readonly_audit",
        databaseWrites: false,
        providerCalls: false,
        manualValuationMetadata: manualValuationRows,
        results,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "unknown optimizer audit error",
  );
  process.exitCode = 1;
});
