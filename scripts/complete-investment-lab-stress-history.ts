import { config } from "dotenv";

import {
  INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY,
  parseInvestmentLabStressHistoryCommandArgs,
  planInvestmentLabStressHistoryCompletion,
  type InvestmentLabStressHistoryPlan,
} from "../src/lib/market-data/investment-lab-stress-history-completion.ts";
import {
  buildFrankfurterHistoryUrl,
  parseFrankfurterV2UsdKrwHistory,
} from "../src/lib/market-data/frankfurter-history.ts";
import type { KisHistoryCacheSyncResult } from "../src/lib/market-data/kis-history-cache-sync.ts";
import type { HistoricalPriceResult } from "../src/lib/market-data/providers/types.ts";

async function main() {
  config({ path: ".env.local", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const options = parseInvestmentLabStressHistoryCommandArgs(
    process.argv.slice(2),
  );
  const [{ and, asc, eq, gt, inArray, isNotNull }, client, schema] =
    await Promise.all([
      import("drizzle-orm"),
      import("../src/db/client.ts"),
      import("../src/db/schema.ts"),
    ]);
  const { accounts, appUsers, assets } = schema;
  const activeOwnerRows = await client.db
    .select({ id: appUsers.id })
    .from(appUsers)
    .where(
      and(
        eq(appUsers.status, "active"),
        inArray(appUsers.role, ["user", "admin"]),
      ),
    );
  if (activeOwnerRows.length !== 1) {
    throw new Error(
      `stress history completion requires exactly one active owner; found ${activeOwnerRows.length}`,
    );
  }
  const activeOwnerUserId = activeOwnerRows[0].id;
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
        eq(accounts.canonicalOwnerUserId, activeOwnerUserId),
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
  const completion = planInvestmentLabStressHistoryCompletion({
    holdings: holdingRows,
  });

  if (options.mode === "plan_only") {
    console.log(JSON.stringify(planSummary(completion.plans), null, 2));
    return;
  }

  const [providerModule, syncModule] = await Promise.all([
    import("../src/lib/market-data/providers/kis.ts"),
    import("../src/lib/market-data/kis-history-cache-sync.ts"),
  ]);
  const providerPolicy = providerModule.getKisProviderPolicy();
  if (!providerPolicy.configured) {
    throw new Error(
      `KIS provider is not configured: ${providerPolicy.missingEnvKeys.join(",")}`,
    );
  }
  const provider = providerModule.createKisMarketDataProvider();
  const priceDryRuns: Array<{ id: string; result: HistoricalPriceResult }> = [];
  const priceWrites: Array<{ id: string; result: KisHistoryCacheSyncResult }> = [];

  for (const range of completion.plans) {
    for (const batch of range.plan.batches) {
      if (options.mode === "write") {
        priceWrites.push({
          id: range.id,
          result: await syncModule.runKisHistoryCacheSync({
            targets: batch.map((target) => ({ ...target })),
            startDate: range.plan.startDate,
            endDate: range.plan.endDate,
            provider,
          }),
        });
      } else {
        if (!provider.fetchHistoricalClosePrices) {
          throw new Error("KIS historical provider is unavailable");
        }
        priceDryRuns.push({
          id: range.id,
          result: await provider.fetchHistoricalClosePrices(
            batch.map((target) => ({ ...target })),
            {
              dryRun: true,
              requestedAt: new Date(),
              startDate: range.plan.startDate,
              endDate: range.plan.endDate,
            },
          ),
        });
      }
    }
  }

  const fxRows = await fetchStressFxHistory();
  const fxWrite =
    options.mode === "write"
      ? await client.db.transaction(async (tx) => {
          const existingRows = await tx
            .select({
              rateDate: schema.fxRates.rateDate,
              usdKrw: schema.fxRates.usdKrw,
              status: schema.fxRates.status,
            })
            .from(schema.fxRates)
            .where(eq(schema.fxRates.isSample, false));
          const relevant = existingRows.filter(
            (row) =>
              row.rateDate >=
                INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.fxRange
                  .startDate &&
              row.rateDate <=
                INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.fxRange.endDate,
          );
          const existingDates = new Set(
            relevant.map((row) => row.rateDate),
          );
          const invalidExistingDateCount = new Set(
            relevant
              .filter((row) => {
                const rate = Number(row.usdKrw);
                const status = row.status?.trim().toLowerCase();
                return (
                  !Number.isFinite(rate) ||
                  rate <= 0 ||
                  Boolean(status && status !== "ok")
                );
              })
              .map((row) => row.rateDate),
          ).size;
          const missingRows = fxRows.filter(
            (row) => !existingDates.has(row.rateDate),
          );
          const fetchedAt = new Date();
          for (const batch of chunk(missingRows, 250)) {
            if (batch.length === 0) continue;
            await tx.insert(schema.fxRates).values(
              batch.map((row) => ({
                rateDate: row.rateDate,
                usdKrw: row.usdKrw,
                source: row.source,
                status: "ok",
                fetchedAt,
                isSample: false,
              })),
            );
          }
          return {
            insertedCount: missingRows.length,
            existingDateCount: existingDates.size,
            invalidExistingDateCount,
          };
        })
      : { insertedCount: 0, existingDateCount: 0, invalidExistingDateCount: 0 };

  console.log(
    JSON.stringify(
      options.mode === "write"
        ? writeSummary(priceWrites, fxRows.length, fxWrite)
        : dryRunSummary(priceDryRuns, fxRows.length),
      null,
      2,
    ),
  );
}

async function fetchStressFxHistory() {
  const range = INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.fxRange;
  const response = await fetch(
    buildFrankfurterHistoryUrl(range.startDate, range.endDate),
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw new Error(`Frankfurter history failed (${response.status})`);
  return parseFrankfurterV2UsdKrwHistory(await response.json());
}

function planSummary(plans: readonly InvestmentLabStressHistoryPlan[]) {
  return {
    operation: "investment_lab_stress_history_completion",
    mode: "plan_only",
    providerInstances: 0,
    providerCalls: 0,
    databaseWrites: 0,
    policy: INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.version,
    rangeCount: plans.length,
    ranges: plans.map(({ id, plan }) => ({
      id,
      startDate: plan.startDate,
      endDate: plan.endDate,
      targetCount: plan.targets.length,
      batchCount: plan.batches.length,
      excludedHoldingCount: plan.excludedHoldingCount,
    })),
    fxRange: INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.fxRange,
  };
}

function dryRunSummary(
  results: readonly { id: string; result: HistoricalPriceResult }[],
  fxFetchedRowCount: number,
) {
  return {
    operation: "investment_lab_stress_history_completion",
    mode: "provider_dry_run",
    providerInstances: 1,
    databaseWrites: 0,
    priceFetchedRowCount: sumBy(results, (row) => row.result.rows.length),
    priceProviderCallCount: sumBy(results, (row) => row.result.requestCount),
    priceFailureCount: sumBy(results, (row) => row.result.failures.length),
    priceFailureCodes: countBy(
      results.flatMap((row) => row.result.failures.map((failure) => failure.code)),
    ),
    fetchedInstrumentCountsByRange: Object.fromEntries(
      [...new Set(results.map((row) => row.id))].sort().map((id) => [
        id,
        new Set(
          results
            .filter((row) => row.id === id)
            .flatMap((row) =>
              row.result.rows.map(
                (price) => `${price.market}|${price.currency}|${price.ticker}`,
              ),
            ),
        ).size,
      ]),
    ),
    fxFetchedRowCount,
  };
}

function writeSummary(
  results: readonly { id: string; result: KisHistoryCacheSyncResult }[],
  fxFetchedRowCount: number,
  fxWrite: {
    insertedCount: number;
    existingDateCount: number;
    invalidExistingDateCount: number;
  },
) {
  return {
    operation: "investment_lab_stress_history_completion",
    mode: "write",
    providerInstances: 1,
    priceFetchedRowCount: sumBy(results, (row) => row.result.fetchedRowCount),
    priceInsertedCount: sumBy(results, (row) => row.result.insertedCount),
    priceUpdatedCount: sumBy(results, (row) => row.result.updatedCount),
    priceSkippedCount: sumBy(results, (row) => row.result.skippedCount),
    priceFailedCount: sumBy(results, (row) => row.result.failedCount),
    priceConflictCount: sumBy(results, (row) => row.result.conflictCount),
    fxFetchedRowCount,
    fxInsertedCount: fxWrite.insertedCount,
    fxExistingDateCount: fxWrite.existingDateCount,
    fxInvalidExistingDateCount: fxWrite.invalidExistingDateCount,
  };
}

function countBy(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort());
}

function sumBy<T>(rows: readonly T[], select: (row: T) => number) {
  return rows.reduce((total, row) => total + select(row), 0);
}

function chunk<T>(rows: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
