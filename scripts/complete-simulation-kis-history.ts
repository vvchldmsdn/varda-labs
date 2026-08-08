import { config } from "dotenv";

import {
  planSimulationHistoryCompletion,
  type SimulationHistoryHoldingInput,
} from "../src/lib/market-data/simulation-history-completion.ts";
import type { KisHistoryCacheSyncResult } from "../src/lib/market-data/kis-history-cache-sync.ts";
import type { HistoricalPriceResult } from "../src/lib/market-data/providers/types.ts";

const WRITE_CONFIRMATION = "--confirm-shared-history-write";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const options = parseArgs(process.argv.slice(2));
  const [{ and, asc, eq, gt, inArray, isNotNull }, client, schema, providerModule, syncModule] =
    await Promise.all([
      import("drizzle-orm"),
      import("../src/db/client.ts"),
      import("../src/db/schema.ts"),
      import("../src/lib/market-data/providers/kis.ts"),
      import("../src/lib/market-data/kis-history-cache-sync.ts"),
    ]);
  const { accounts, appUsers, assets } = schema;

  const holdingRows = await client.db
    .select({
      accountCode: accounts.code,
      market: assets.market,
      currency: assets.currency,
      ticker: assets.ticker,
      quantity: assets.quantity,
    })
    .from(assets)
    .innerJoin(
      accounts,
      and(
        eq(assets.accountId, accounts.id),
        eq(accounts.isActive, true),
        inArray(accounts.code, ["brokerage", "isa", "irp"]),
        isNotNull(accounts.canonicalOwnerUserId),
      ),
    )
    .innerJoin(
      appUsers,
      and(
        eq(accounts.canonicalOwnerUserId, appUsers.id),
        eq(appUsers.status, "active"),
        inArray(appUsers.role, ["user", "admin"]),
      ),
    )
    .where(gt(assets.quantity, "0"))
    .orderBy(asc(accounts.code), asc(assets.market), asc(assets.ticker));

  const plan = planSimulationHistoryCompletion({
    startDate: options.startDate,
    endDate: options.endDate,
    holdings: holdingRows satisfies SimulationHistoryHoldingInput[],
  });
  const providerPolicy = providerModule.getKisProviderPolicy();
  if (!providerPolicy.configured) {
    throw new Error(
      `KIS provider is not configured: ${providerPolicy.missingEnvKeys.join(",")}`,
    );
  }

  const provider = providerModule.createKisMarketDataProvider();
  const dryRunSummaries: HistoricalPriceResult[] = [];
  const writeSummaries: KisHistoryCacheSyncResult[] = [];
  for (const batch of plan.batches) {
    if (options.write) {
      writeSummaries.push(
        await syncModule.runKisHistoryCacheSync({
          targets: batch.map((target) => ({ ...target })),
          startDate: plan.startDate,
          endDate: plan.endDate,
          provider,
        }),
      );
      continue;
    }

    if (!provider.fetchHistoricalClosePrices) {
      throw new Error("KIS historical provider is unavailable");
    }
    dryRunSummaries.push(
      await provider.fetchHistoricalClosePrices(
        batch.map((target) => ({ ...target })),
        {
          dryRun: true,
          requestedAt: new Date(),
          startDate: plan.startDate,
          endDate: plan.endDate,
        },
      ),
    );
  }

  console.log(
    JSON.stringify(
      options.write
        ? summarizeWrite(plan, writeSummaries)
        : summarizeDryRun(plan, dryRunSummaries),
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]) {
  let startDate: string | null = null;
  let endDate: string | null = null;
  let write = false;
  let confirmed = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      startDate = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--to") {
      endDate = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === WRITE_CONFIRMATION) {
      confirmed = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!startDate || !endDate) {
    throw new Error("Usage: --from YYYY-MM-DD --to YYYY-MM-DD [--write --confirm-shared-history-write]");
  }
  if (write !== confirmed) {
    throw new Error(
      `writes require both --write and ${WRITE_CONFIRMATION}; dry-run accepts neither`,
    );
  }
  return { startDate, endDate, write };
}

function summarizeDryRun(
  plan: ReturnType<typeof planSimulationHistoryCompletion>,
  summaries: HistoricalPriceResult[],
) {
  const rows = summaries.flatMap((summary) => summary.rows ?? []);
  const failures = summaries.flatMap((summary) => summary.failures ?? []);
  const instruments = new Map<string, { rowCount: number; firstDate: string | null; lastDate: string | null }>();
  for (const row of rows) {
    const key = `${row.market}|${row.currency}|${row.ticker}`;
    const current = instruments.get(key) ?? {
      rowCount: 0,
      firstDate: null,
      lastDate: null,
    };
    current.rowCount += 1;
    current.firstDate =
      current.firstDate === null || row.priceDate < current.firstDate
        ? row.priceDate
        : current.firstDate;
    current.lastDate =
      current.lastDate === null || row.priceDate > current.lastDate
        ? row.priceDate
        : current.lastDate;
    instruments.set(key, current);
  }

  return {
    operation: "simulation_kis_history_completion",
    mode: "dry_run",
    databaseWrites: 0,
    policy: plan.policy.version,
    startDate: plan.startDate,
    endDate: plan.endDate,
    targetCount: plan.targets.length,
    batchCount: plan.batches.length,
    excludedHoldingCount: plan.excludedHoldingCount,
    excludedByReason: plan.excludedByReason,
    fetchedRowCount: rows.length,
    failureCount: failures.length,
    instruments: [...instruments.entries()].map(([instrumentKey, value]) => ({
      instrumentKey,
      ...value,
    })),
    failureCodes: countBy(failures.map((failure) => failure.code)),
  };
}

function summarizeWrite(
  plan: ReturnType<typeof planSimulationHistoryCompletion>,
  summaries: KisHistoryCacheSyncResult[],
) {
  return {
    operation: "simulation_kis_history_completion",
    mode: "write",
    policy: plan.policy.version,
    startDate: plan.startDate,
    endDate: plan.endDate,
    targetCount: plan.targets.length,
    batchCount: plan.batches.length,
    excludedHoldingCount: plan.excludedHoldingCount,
    excludedByReason: plan.excludedByReason,
    fetchedRowCount: sumBy(summaries, (row) => row.fetchedRowCount),
    insertedCount: sumBy(summaries, (row) => row.insertedCount),
    updatedCount: sumBy(summaries, (row) => row.updatedCount),
    skippedCount: sumBy(summaries, (row) => row.skippedCount),
    failedCount: sumBy(summaries, (row) => row.failedCount),
    conflictCount: sumBy(summaries, (row) => row.conflictCount),
    providerFailureCount: sumBy(
      summaries,
      (row) => row.providerFailureCount,
    ),
    runCount: summaries.length,
  };
}

function countBy(values: unknown[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = String(value ?? "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort());
}

function sumBy<T>(rows: readonly T[], select: (row: T) => number) {
  return rows.reduce((total, row) => total + select(row), 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
