import { config } from "dotenv";

import { summarizeSimulationOwnerReadiness } from "../src/lib/simulation-owner-readiness-audit.ts";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const [
    { and, asc, eq, inArray },
    client,
    schema,
    queryModule,
    parametricFactorQueryModule,
  ] =
    await Promise.all([
      import("drizzle-orm"),
      import("../src/db/client.ts"),
      import("../src/db/schema.ts"),
      import("../src/db/queries/simulation-owner-research.ts"),
      import("../src/db/queries/simulation-owner-parametric-factor.ts"),
    ]);
  const { accounts, appUsers } = schema;
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
      `readiness audit requires exactly one active portfolio owner; found ${ownerRows.length}`,
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
  const accountsToAudit = ["all", "brokerage", "isa", "irp"] as const;
  const results = await Promise.all(
    accountsToAudit.map(async (account) => {
      const ownerResearchPromise =
        queryModule.getReadOnlyTenantSimulationOwnerResearch({
          tenantContext,
          account,
        });
      const [ownerResearch, parametricFactor] = await Promise.all([
        ownerResearchPromise,
        parametricFactorQueryModule.getReadOnlyTenantSimulationOwnerParametricFactorResearch(
          { ownerResearchPromise },
        ),
      ]);
      return {
        account,
        ...ownerResearch,
        parametricFactor,
      };
    }),
  );
  const summary = summarizeSimulationOwnerReadiness(results);

  console.log(
    JSON.stringify(
      {
        operation: "simulation_owner_research_readiness_audit",
        generatedAt: new Date().toISOString(),
        ...summary,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "unknown readiness audit error",
  );
  process.exitCode = 1;
});
