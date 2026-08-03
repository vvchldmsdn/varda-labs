import { createHash } from "node:crypto";

import { config } from "dotenv";

import {
  buildFrankfurterHistoryUrl,
  parseFrankfurterV2UsdKrwHistory,
} from "../src/lib/market-data/frankfurter-history.ts";
import {
  buildInclusiveDateRange,
  previousCalendarDate,
  SNAPSHOT_GAP_BACKFILL_POLICY,
  type SnapshotGapBackfillAuthorization,
} from "../src/lib/snapshots/gap-backfill.ts";

async function main() {
  config({ path: ".env.local", quiet: true });

  const options = parseArgs(process.argv.slice(2));
  const range = buildInclusiveDateRange(options.fromDate, options.toDate);
  if (!range.ok) throw new Error(range.reason);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (
    (options.writePriceData || options.writeFxData || options.writeSnapshots) &&
    !options.confirmUnchangedHoldings
  ) {
    throw new Error(
      "writes require --confirm-unchanged-holdings after operator review",
    );
  }

  const [drizzle, clientModule, schema, dailyModule, kisModule, kisSyncModule] =
    await Promise.all([
      import("drizzle-orm"),
      import("../src/db/client.ts"),
      import("../src/db/schema.ts"),
      import("../src/lib/snapshots/daily.ts"),
      import("../src/lib/market-data/providers/kis.ts"),
      import("../src/lib/market-data/kis-history-cache-sync.ts"),
    ]);

  const { and, asc, eq, gte, inArray, lte } = drizzle;
  const { db } = clientModule;
  const {
    accounts,
    appUsers,
    assets,
    dailyPortfolioSnapshots,
    dailyPositionSnapshots,
    eventLedgerEntries,
    fxRates,
  } = schema;

  const ownerRows = await db
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
      `backfill requires exactly one active portfolio owner; found ${ownerRows.length}`,
    );
  }
  const owner = ownerRows[0];

  const holdingRows = await loadCurrentHoldings(owner.ownerUserId);
  if (holdingRows.length === 0) throw new Error("no active holdings found");
  const initialHoldingFingerprint = holdingFingerprint(holdingRows);

  const eventRows = await db
    .select({
      eventType: eventLedgerEntries.eventType,
      eventDate: eventLedgerEntries.eventDate,
      quantityDelta: eventLedgerEntries.quantityDelta,
    })
    .from(eventLedgerEntries)
    .where(
      and(
        gte(eventLedgerEntries.eventDate, options.fromDate),
        lte(eventLedgerEntries.eventDate, options.toDate),
      ),
    );
  if (eventRows.length > 0) {
    throw new Error(
      `event-ledger attestation failed: ${eventRows.length} events exist in the gap`,
    );
  }

  const dateStates = await classifySnapshotDates({
    ownerUserId: owner.ownerUserId,
    dates: range.dates,
    expectedHoldingIds: holdingRows.map((row) => row.assetId),
  });
  const partialDates = dateStates.filter((state) => state.status === "partial");
  if (partialDates.length > 0) {
    throw new Error(
      `partial snapshot dates require manual review: ${partialDates.map((row) => row.date).join(",")}`,
    );
  }
  const missingDates = dateStates
    .filter((state) => state.status === "missing")
    .map((state) => state.date);
  const completeDates = dateStates
    .filter((state) => state.status === "complete")
    .map((state) => state.date);

  const authorization: SnapshotGapBackfillAuthorization = Object.freeze({
    policyId: SNAPSHOT_GAP_BACKFILL_POLICY.id,
    fromDate: options.fromDate,
    toDate: options.toDate,
    ownerUserId: owner.ownerUserId,
    holdingsAttestation: SNAPSHOT_GAP_BACKFILL_POLICY.holdingsAttestation,
    eventLedgerMutationCount: 0,
  });
  const priceFromDate = previousCalendarDate(options.fromDate);
  const priceToDate = previousCalendarDate(options.toDate);
  const targets = buildPriceTargets(holdingRows);
  const selectedTargets =
    options.tickers.length === 0
      ? targets
      : targets.filter((target) => options.tickers.includes(target.ticker));
  if (selectedTargets.length !== (options.tickers.length || targets.length)) {
    throw new Error("one or more requested --ticker values are not active holdings");
  }
  const targetBatches = chunk(selectedTargets, 5);

  const provider = kisModule.createKisMarketDataProvider();
  const kisPreview = await previewKisHistory({
    provider,
    targetBatches,
    startDate: priceFromDate,
    endDate: priceToDate,
  });
  const fxPreview = await previewFrankfurterHistory(priceFromDate, priceToDate);

  printSummary("preflight", {
    policy: SNAPSHOT_GAP_BACKFILL_POLICY.id,
    fromDate: options.fromDate,
    toDate: options.toDate,
    requestedDateCount: range.dates.length,
    missingDateCount: missingDates.length,
    alreadyCompleteDateCount: completeDates.length,
    holdingCount: holdingRows.length,
    tickeredInstrumentCount: targets.length,
    selectedPriceTargetCount: selectedTargets.length,
    manualHoldingCount: holdingRows.length - targets.length,
    eventCount: eventRows.length,
    kisPreview,
    fxPreview: {
      rowCount: fxPreview.rows.length,
      firstDate: fxPreview.rows[0]?.rateDate ?? null,
      lastDate: fxPreview.rows.at(-1)?.rateDate ?? null,
    },
    writesRequested: {
      priceData: options.writePriceData,
      fxData: options.writeFxData,
      snapshots: options.writeSnapshots,
    },
  });

  if (options.writePriceData) {
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let providerFailureCount = 0;
    for (const batch of targetBatches) {
      const result = await kisSyncModule.runKisHistoryCacheSync({
        targets: batch,
        startDate: priceFromDate,
        endDate: priceToDate,
        provider,
      });
      insertedCount += result.insertedCount;
      updatedCount += result.updatedCount;
      skippedCount += result.skippedCount;
      failedCount += result.failedCount;
      providerFailureCount += result.providerFailureCount;
    }
    printSummary("price-data-write", {
      kisBatchCount: targetBatches.length,
      kisInstrumentCount: selectedTargets.length,
      insertedCount,
      updatedCount,
      skippedCount,
      failedCount,
      providerFailureCount,
    });
  }

  if (options.writeFxData) {
    const fxWrite = await insertMissingFxRows(fxPreview.rows);
    printSummary("fx-data-write", {
      fxInsertedCount: fxWrite.insertedCount,
      fxExistingCount: fxWrite.existingCount,
    });
  }

  const currentHoldingRows = await loadCurrentHoldings(owner.ownerUserId);
  if (holdingFingerprint(currentHoldingRows) !== initialHoldingFingerprint) {
    throw new Error("holding rows changed while the backfill was running");
  }

  const previewResults = [];
  for (const snapshotDate of missingDates) {
    const result = await dailyModule.runDailySnapshot({
      tenantContext: {
        ownerUserId: owner.ownerUserId,
        role: owner.role as "user" | "admin",
      },
      dryRun: true,
      snapshotDate,
      historicalWriteAuthorization: authorization,
    });
    previewResults.push(summarizeSnapshotResult(result));
  }
  const blockedPreviews = previewResults.filter((result) => !result.writeReady);

  printSummary("snapshot-dry-run", {
    plannedDateCount: previewResults.length,
    readyDateCount: previewResults.length - blockedPreviews.length,
    blockedDateCount: blockedPreviews.length,
    missingCloseCount: previewResults.reduce(
      (sum, result) => sum + result.missingCloseCount,
      0,
    ),
    portfolioInsertCount: previewResults.reduce(
      (sum, result) => sum + result.portfolioInsertCount,
      0,
    ),
    positionInsertCount: previewResults.reduce(
      (sum, result) => sum + result.positionInsertCount,
      0,
    ),
    blockedDates: blockedPreviews.map((result) => result.snapshotDate),
    missingCloseGroups: summarizeMissingCloseGroups(previewResults),
  });

  if (options.writeSnapshots) {
    if (blockedPreviews.length > 0) {
      throw new Error(
        "snapshot writes blocked because the full dry-run is not ready",
      );
    }
    for (const preview of previewResults) {
      assertSnapshotInsertPlan(preview, holdingRows.length);
    }

    let writtenDateCount = 0;
    for (const snapshotDate of missingDates) {
      const immediatePreview = await dailyModule.runDailySnapshot({
        tenantContext: {
          ownerUserId: owner.ownerUserId,
          role: owner.role as "user" | "admin",
        },
        dryRun: true,
        snapshotDate,
        historicalWriteAuthorization: authorization,
      });
      assertSnapshotInsertPlan(
        summarizeSnapshotResult(immediatePreview),
        holdingRows.length,
      );

      const result = await dailyModule.runDailySnapshot({
        tenantContext: {
          ownerUserId: owner.ownerUserId,
          role: owner.role as "user" | "admin",
        },
        dryRun: false,
        snapshotDate,
        historicalWriteAuthorization: authorization,
      });
      if (!result.ok || !result.writeReady) {
        throw new Error(`snapshot write failed for ${snapshotDate}`);
      }
      writtenDateCount += 1;
    }
    printSummary("snapshot-write", { writtenDateCount });
  }

  const finalStates = await classifySnapshotDates({
    ownerUserId: owner.ownerUserId,
    dates: range.dates,
    expectedHoldingIds: holdingRows.map((row) => row.assetId),
  });
  printSummary("final", {
    completeDateCount: finalStates.filter((row) => row.status === "complete")
      .length,
    missingDateCount: finalStates.filter((row) => row.status === "missing")
      .length,
    partialDateCount: finalStates.filter((row) => row.status === "partial")
      .length,
    dryRun:
      !options.writePriceData &&
      !options.writeFxData &&
      !options.writeSnapshots,
  });

  async function loadCurrentHoldings(ownerUserId: string) {
    const rows = await db
      .select({
        assetId: assets.id,
        accountId: assets.accountId,
        account: assets.account,
        name: assets.name,
        ticker: assets.ticker,
        market: assets.market,
        currency: assets.currency,
        assetType: assets.assetType,
        quantity: assets.quantity,
        fractionalKrwValue: assets.fractionalKrwValue,
      })
      .from(assets)
      .innerJoin(
        accounts,
        and(
          eq(assets.accountId, accounts.id),
          eq(assets.account, accounts.code),
        ),
      )
      .where(
        and(
          eq(accounts.canonicalOwnerUserId, ownerUserId),
          eq(accounts.isActive, true),
        ),
      )
      .orderBy(asc(assets.account), asc(assets.name));

    return rows.filter((row) =>
      ["etf", "stock", "pension", "commodity"].includes(row.assetType ?? "etf"),
    );
  }

  async function classifySnapshotDates(input: {
    ownerUserId: string;
    dates: readonly string[];
    expectedHoldingIds: readonly string[];
  }) {
    const [portfolioRows, positionRows] = await Promise.all([
      db
        .select({
          date: dailyPortfolioSnapshots.snapshotDate,
          account: dailyPortfolioSnapshots.account,
          source: dailyPortfolioSnapshots.source,
        })
        .from(dailyPortfolioSnapshots)
        .where(
          and(
            eq(dailyPortfolioSnapshots.canonicalOwnerUserId, input.ownerUserId),
            inArray(dailyPortfolioSnapshots.snapshotDate, [...input.dates]),
          ),
        ),
      db
        .select({
          date: dailyPositionSnapshots.snapshotDate,
          account: dailyPositionSnapshots.account,
          assetId: dailyPositionSnapshots.assetId,
          source: dailyPositionSnapshots.source,
        })
        .from(dailyPositionSnapshots)
        .where(
          and(
            eq(dailyPositionSnapshots.canonicalOwnerUserId, input.ownerUserId),
            inArray(dailyPositionSnapshots.snapshotDate, [...input.dates]),
          ),
        ),
    ]);
    const expectedAccounts = new Set(["all", "brokerage", "isa", "irp"]);
    const expectedAssets = new Set(input.expectedHoldingIds);

    return input.dates.map((date) => {
      const portfolios = portfolioRows.filter((row) => row.date === date);
      const positions = positionRows.filter((row) => row.date === date);
      if (portfolios.length === 0 && positions.length === 0) {
        return { date, status: "missing" as const };
      }
      const portfolioAccounts = new Set(portfolios.map((row) => row.account));
      const positionAssets = new Set(
        positions
          .map((row) => row.assetId)
          .filter((assetId): assetId is string => Boolean(assetId)),
      );
      const complete =
        portfolios.length === expectedAccounts.size &&
        positions.length === expectedAssets.size &&
        portfolios.every(
          (row) =>
            row.source === "varda_manual_daily_snapshot" &&
            expectedAccounts.has(row.account),
        ) &&
        positions.every(
          (row) =>
            row.source === "varda_manual_daily_snapshot" &&
            row.assetId !== null &&
            expectedAssets.has(row.assetId),
        ) &&
        portfolioAccounts.size === expectedAccounts.size &&
        positionAssets.size === expectedAssets.size;
      return {
        date,
        status: complete ? ("complete" as const) : ("partial" as const),
      };
    });
  }

  function buildPriceTargets(
    holdings: Awaited<ReturnType<typeof loadCurrentHoldings>>,
  ) {
    const targets = new Map<
      string,
      {
        key: string;
        ticker: string;
        market: string;
        currency: string;
        accounts: string[];
        assetIds: string[];
        assetNames: string[];
      }
    >();
    for (const holding of holdings) {
      const ticker = holding.ticker?.trim().toUpperCase();
      if (!ticker) continue;
      const market = holding.market.trim().toLowerCase();
      const currency = holding.currency.trim().toUpperCase();
      const key = `${market}|${currency}|${ticker}`;
      const existing = targets.get(key);
      if (existing) {
        existing.accounts.push(holding.account);
        existing.assetIds.push(holding.assetId);
        existing.assetNames.push(holding.name);
        continue;
      }
      targets.set(key, {
        key,
        ticker,
        market,
        currency,
        accounts: [holding.account],
        assetIds: [holding.assetId],
        assetNames: [holding.name],
      });
    }
    return [...targets.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
  }

  async function previewKisHistory(input: {
    provider: ReturnType<typeof kisModule.createKisMarketDataProvider>;
    targetBatches: ReturnType<
      typeof chunk<ReturnType<typeof buildPriceTargets>[number]>
    >;
    startDate: string;
    endDate: string;
  }) {
    let rowCount = 0;
    let requestCount = 0;
    let failureCount = 0;
    const covered = new Set<string>();
    for (const batch of input.targetBatches) {
      const result = await input.provider.fetchHistoricalClosePrices!(batch, {
        dryRun: true,
        requestedAt: new Date(),
        startDate: input.startDate,
        endDate: input.endDate,
      });
      rowCount += result.rows.length;
      requestCount += result.requestCount;
      failureCount += result.failures.length;
      for (const row of result.rows) {
        covered.add(
          `${row.market.toLowerCase()}|${row.currency.toUpperCase()}|${row.ticker.toUpperCase()}`,
        );
      }
    }
    const targetCount = input.targetBatches.flat().length;
    if (failureCount > 0 || covered.size !== targetCount) {
      throw new Error(
        `KIS history preview incomplete: covered=${covered.size}/${targetCount}, failures=${failureCount}`,
      );
    }
    return { targetCount, rowCount, requestCount, failureCount };
  }

  async function previewFrankfurterHistory(fromDate: string, toDate: string) {
    const response = await fetch(buildFrankfurterHistoryUrl(fromDate, toDate), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Frankfurter history request failed: ${response.status}`);
    }
    const rows = parseFrankfurterV2UsdKrwHistory(await response.json());
    const expected = buildInclusiveDateRange(fromDate, toDate);
    if (!expected.ok) throw new Error(expected.reason);
    const available = new Set(rows.map((row) => row.rateDate));
    const missing = expected.dates.filter((date) => !available.has(date));
    if (missing.length > 0) {
      throw new Error(`Frankfurter history is missing ${missing.length} dates`);
    }
    return { rows };
  }

  async function insertMissingFxRows(
    rows: Awaited<ReturnType<typeof previewFrankfurterHistory>>["rows"],
  ) {
    const existing = await db
      .select({
        rateDate: fxRates.rateDate,
        usdKrw: fxRates.usdKrw,
      })
      .from(fxRates)
      .where(
        inArray(
          fxRates.rateDate,
          rows.map((row) => row.rateDate),
        ),
      );
    const grouped = new Map<string, typeof existing>();
    for (const row of existing) {
      const values = grouped.get(row.rateDate) ?? [];
      values.push(row);
      grouped.set(row.rateDate, values);
    }
    const duplicateDates = [...grouped.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([date]) => date);
    if (duplicateDates.length > 0) {
      throw new Error(
        `duplicate FX dates block backfill: ${duplicateDates.join(",")}`,
      );
    }
    const inserts = rows.filter((row) => !grouped.has(row.rateDate));
    if (inserts.length > 0) {
      await db.insert(fxRates).values(
        inserts.map((row) => ({
          rateDate: row.rateDate,
          usdKrw: row.usdKrw,
          source: row.source,
          status: "ok",
          fetchedAt: new Date(),
          isSample: false,
        })),
      );
    }
    return { insertedCount: inserts.length, existingCount: existing.length };
  }

  function summarizeSnapshotResult(
    result: Awaited<ReturnType<typeof dailyModule.runDailySnapshot>>,
  ) {
    return {
      snapshotDate: result.snapshotDate,
      writeReady: result.writeReady,
      missingCloseCount: result.freshClose.missingCount,
      missingCloseAssets: result.freshClose.missing.map((row) => ({
        ticker: row.ticker,
        name: row.name,
        account: row.account,
        market: row.market,
        expectedCloseDate: row.expectedCloseDate,
        reason: row.reason,
      })),
      portfolioInsertCount: result.plannedWrites.dailyPortfolioSnapshots.insert,
      portfolioUpdateCount: result.plannedWrites.dailyPortfolioSnapshots.update,
      positionInsertCount: result.plannedWrites.dailyPositionSnapshots.insert,
      positionUpdateCount: result.plannedWrites.dailyPositionSnapshots.update,
      mode: result.writePolicy.mode,
    };
  }

  function summarizeMissingCloseGroups(
    results: readonly ReturnType<typeof summarizeSnapshotResult>[],
  ) {
    const groups = new Map<
      string,
      {
        ticker: string | null;
        name: string;
        account: string;
        market: string;
        count: number;
        firstExpectedCloseDate: string;
        lastExpectedCloseDate: string;
        reasons: Set<string>;
      }
    >();

    for (const result of results) {
      for (const missing of result.missingCloseAssets) {
        const key = [
          missing.market,
          missing.ticker ?? "manual",
          missing.account,
          missing.name,
        ].join("|");
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
          existing.firstExpectedCloseDate = [
            existing.firstExpectedCloseDate,
            missing.expectedCloseDate,
          ].sort()[0];
          existing.lastExpectedCloseDate = [
            existing.lastExpectedCloseDate,
            missing.expectedCloseDate,
          ]
            .sort()
            .at(-1)!;
          existing.reasons.add(missing.reason);
          continue;
        }
        groups.set(key, {
          ticker: missing.ticker,
          name: missing.name,
          account: missing.account,
          market: missing.market,
          count: 1,
          firstExpectedCloseDate: missing.expectedCloseDate,
          lastExpectedCloseDate: missing.expectedCloseDate,
          reasons: new Set([missing.reason]),
        });
      }
    }

    return [...groups.values()]
      .map((group) => ({ ...group, reasons: [...group.reasons].sort() }))
      .sort((left, right) =>
        [left.market, left.ticker ?? "", left.account]
          .join("|")
          .localeCompare(
            [right.market, right.ticker ?? "", right.account].join("|"),
          ),
      );
  }

  function assertSnapshotInsertPlan(
    result: ReturnType<typeof summarizeSnapshotResult>,
    expectedHoldingCount: number,
  ) {
    if (
      !result.writeReady ||
      result.mode !== "historical_unchanged_holdings_backfill" ||
      result.missingCloseCount !== 0 ||
      result.portfolioInsertCount !== 4 ||
      result.portfolioUpdateCount !== 0 ||
      result.positionInsertCount !== expectedHoldingCount ||
      result.positionUpdateCount !== 0
    ) {
      throw new Error(`unexpected insert plan for ${result.snapshotDate}`);
    }
  }

  function holdingFingerprint(
    rows: Awaited<ReturnType<typeof loadCurrentHoldings>>,
  ) {
    const canonical = rows
      .map((row) => ({
        assetId: row.assetId,
        accountId: row.accountId,
        account: row.account,
        quantity: String(row.quantity),
        fractionalKrwValue: String(row.fractionalKrwValue ?? 0),
      }))
      .sort((left, right) => left.assetId.localeCompare(right.assetId));
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  }

  function chunk<T>(values: readonly T[], size: number) {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
      chunks.push(values.slice(index, index + size));
    }
    return chunks;
  }

  function parseArgs(args: readonly string[]) {
    const fromDate = valueAfter(args, "--from");
    const toDate = valueAfter(args, "--to");
    if (!fromDate || !toDate) {
      throw new Error("--from YYYY-MM-DD and --to YYYY-MM-DD are required");
    }
    const writeAll = args.includes("--write");
    const writeReferenceData =
      writeAll || args.includes("--write-reference-data");
    const tickers = (valueAfter(args, "--ticker") ?? "")
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter(Boolean);
    return {
      fromDate,
      toDate,
      tickers: [...new Set(tickers)].sort(),
      writePriceData: writeReferenceData || args.includes("--write-price-data"),
      writeFxData: writeReferenceData || args.includes("--write-fx-data"),
      writeSnapshots: writeAll || args.includes("--write-snapshots"),
      confirmUnchangedHoldings: args.includes("--confirm-unchanged-holdings"),
    };
  }

  function valueAfter(args: readonly string[], key: string) {
    const index = args.indexOf(key);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  }

  function printSummary(phase: string, value: Record<string, unknown>) {
    console.log(JSON.stringify({ phase, ...value }, null, 2));
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "unknown backfill error",
  );
  process.exitCode = 1;
});
