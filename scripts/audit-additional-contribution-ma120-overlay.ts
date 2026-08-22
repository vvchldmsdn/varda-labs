import { config } from "dotenv";

import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import {
  buildAuditTenantContext,
  parseAuditOwnerUserId,
} from "./lib/audit-tenant-selector.ts";

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
  const ownerUserId = parseAuditOwnerUserId(process.argv.slice(2));
  const databaseTarget = guardProductionDatabaseTarget(process.env);
  const [{ eq }, client, schema, queryModule] = await Promise.all([
    import("drizzle-orm"),
    import("../src/db/client.ts"),
    import("../src/db/schema.ts"),
    import("../src/db/queries/additional-contribution.ts"),
  ]);

  const userRows = await client.db
    .select({ role: schema.appUsers.role, status: schema.appUsers.status })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.id, ownerUserId))
    .limit(2);
  const tenantContext = buildAuditTenantContext(ownerUserId, userRows);

  const cashAmountKrw = 3_000_000;
  const summaries = await Promise.all(
    (["brokerage", "isa", "irp"] as const).map(async (account) => {
      const preview =
        await queryModule.getReadOnlyTenantAdditionalContributionPreview({
          account,
          cashAmountKrw,
          tenantContext,
        });
      if (!isMa120AuditPreview(preview)) {
        return Object.freeze({
          account,
          baselineStatus: preview.status,
          blockers: preview.blockers,
        });
      }
      const auditPreview: Ma120AuditPreview = preview;

      return Object.freeze({
        account,
        baselineStatus: auditPreview.status,
        evidenceStatus: auditPreview.ma120Evidence.status,
        serviceDate: auditPreview.serviceDate,
        usableEvidence: `${auditPreview.ma120Evidence.usableCount}/${auditPreview.rows.length}`,
        comparisonStatus: auditPreview.ma120Evidence.overlayStatus,
        strategicAllocatedKrw: auditPreview.rows.reduce(
          (sum, row) => sum + row.strategicAllocationKrw,
          0,
        ),
        overlayAllocatedKrw: auditPreview.totalAllocatedKrw,
        overlayResidualCashKrw: auditPreview.residualCashKrw,
        totalReductionKrw: auditPreview.ma120Evidence.totalReductionKrw,
        rows: auditPreview.rows.map((row) =>
          Object.freeze({
            ticker: row.ticker,
            decision: row.ma120Decision,
            multiplier: row.ma120Multiplier,
            strategicAllocationKrw: row.strategicAllocationKrw,
            overlayAllocationKrw: row.allocationKrw,
            reductionKrw: row.ma120ReductionKrw,
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

type Ma120AuditPreview = Readonly<{
  status: "ready";
  serviceDate: string;
  totalAllocatedKrw: number;
  residualCashKrw: number;
  blockers: readonly string[];
  ma120Evidence: Readonly<{
    status: string;
    overlayStatus: string;
    usableCount: number;
    totalReductionKrw: number;
  }>;
  rows: readonly Readonly<{
    ticker: string | null;
    allocationKrw: number;
    strategicAllocationKrw: number;
    ma120Decision: string;
    ma120Multiplier: number;
    ma120ReductionKrw: number;
  }>[];
}>;

function isMa120AuditPreview(value: unknown): value is Ma120AuditPreview {
  if (!isRecord(value) || value.status !== "ready") return false;
  if (!isRecord(value.ma120Evidence) || !Array.isArray(value.rows)) return false;
  return (
    typeof value.serviceDate === "string" &&
    isFiniteNumber(value.totalAllocatedKrw) &&
    isFiniteNumber(value.residualCashKrw) &&
    typeof value.ma120Evidence.status === "string" &&
    typeof value.ma120Evidence.overlayStatus === "string" &&
    isFiniteNumber(value.ma120Evidence.usableCount) &&
    isFiniteNumber(value.ma120Evidence.totalReductionKrw) &&
    value.rows.every(
      (row) =>
        isRecord(row) &&
        (row.ticker === null || typeof row.ticker === "string") &&
        isFiniteNumber(row.allocationKrw) &&
        isFiniteNumber(row.strategicAllocationKrw) &&
        typeof row.ma120Decision === "string" &&
        isFiniteNumber(row.ma120Multiplier) &&
        isFiniteNumber(row.ma120ReductionKrw),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
