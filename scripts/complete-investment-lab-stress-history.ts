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

  if (options.mode === "fx_write") {
    const fxRows = await fetchStressFxHistory();
    const fxWrite = await insertMissingStressFxRows({
      sqlClient: client.sqlClient,
      rows: fxRows,
    });
    console.log(
      JSON.stringify(
        fxOnlyWriteSummary(fxRows.length, fxWrite),
        null,
        2,
      ),
    );
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
      ? await insertMissingStressFxRows({
          sqlClient: client.sqlClient,
          rows: fxRows,
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

async function insertMissingStressFxRows({
  sqlClient,
  rows,
}: {
  sqlClient: {
    query: (
      query: string,
      params: unknown[],
    ) => Promise<Record<string, unknown>[]>;
  };
  rows: readonly { rateDate: string; usdKrw: string; source: string }[];
}) {
  const range = INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.fxRange;
  const payload = rows.map((row) => ({
    rateDate: row.rateDate,
    usdKrw: row.usdKrw,
    source: row.source,
  }));
  const [result] = await sqlClient.query(
    `
      with write_lock as materialized (
        select pg_advisory_xact_lock(
          hashtext('investment_lab_stress_fx_history_write_v1')
        ) as acquired
      ),
      incoming_raw as (
        select
          value->>'rateDate' as rate_date,
          value->>'usdKrw' as usd_krw,
          value->>'source' as source
        from jsonb_array_elements($1::jsonb)
      ),
      incoming as materialized (
        select distinct on (rate_date)
          rate_date::date as rate_date,
          usd_krw::numeric(20, 6) as usd_krw,
          source::varchar(100) as source
        from incoming_raw
        order by rate_date
      ),
      existing as materialized (
        select date, usdkrw, status
        from fx_rates
        cross join write_lock
        where is_sample = false
          and date between $2::date and $3::date
      ),
      inserted as (
        insert into fx_rates (
          date,
          usdkrw,
          source,
          status,
          fetched_at,
          is_sample
        )
        select
          incoming.rate_date,
          incoming.usd_krw,
          incoming.source,
          'ok',
          $4::timestamptz,
          false
        from incoming
        cross join write_lock
        where not exists (
          select 1
          from existing
          where existing.date = incoming.rate_date
        )
        returning date
      )
      select
        (select count(*)::int from inserted) as inserted_count,
        (select count(distinct date)::int from existing) as existing_date_count,
        (
          select count(distinct date)::int
          from existing
          where usdkrw <= 0
            or (status is not null and lower(trim(status)) <> 'ok')
        ) as invalid_existing_date_count
    `,
    [JSON.stringify(payload), range.startDate, range.endDate, new Date().toISOString()],
  );
  if (!result) throw new Error("FX history insert returned no summary");
  return {
    insertedCount: Number(result.inserted_count),
    existingDateCount: Number(result.existing_date_count),
    invalidExistingDateCount: Number(result.invalid_existing_date_count),
  };
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

function fxOnlyWriteSummary(
  fxFetchedRowCount: number,
  fxWrite: {
    insertedCount: number;
    existingDateCount: number;
    invalidExistingDateCount: number;
  },
) {
  return {
    operation: "investment_lab_stress_history_completion",
    mode: "fx_write",
    providerInstances: 0,
    priceProviderCalls: 0,
    priceDatabaseWrites: 0,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
