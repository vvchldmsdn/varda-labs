import "server-only";

import { and, asc, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots } from "@/db/schema";
import { ADJUSTED_CLOSE_BASIS } from "@/lib/market-data/providers/types";
import type {
  ClosePrice,
  PriceLookupTarget,
} from "@/lib/market-data/providers/types";

const DEFAULT_KIS_VALUE_CONFLICT_THRESHOLD_PCT = 3;
const DECIMAL_COMPARE_ABSOLUTE_TOLERANCE = 1e-9;
const DECIMAL_COMPARE_RELATIVE_TOLERANCE = 1e-10;

export type AssetPriceSnapshotWritePolicy = "none" | "stub_fixture" | "kis";

export type AssetPriceSnapshotWriteAction =
  | "planned_insert"
  | "planned_update"
  | "planned_skip"
  | "inserted"
  | "updated"
  | "skipped"
  | "failed"
  | "conflict";

export type AssetPriceSnapshotWriteResult = {
  ticker: string;
  market: string;
  currency: string;
  priceDate: string;
  source: string | null;
  action: AssetPriceSnapshotWriteAction;
  reason?: string;
  existingSource?: string | null;
};

export type AssetPriceSnapshotWriteSummary = {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  conflictCount: number;
  results: AssetPriceSnapshotWriteResult[];
};

type AssetPriceSnapshotRow = typeof assetPriceSnapshots.$inferSelect;
type AssetPriceSnapshotInsert = typeof assetPriceSnapshots.$inferInsert;

type Candidate = {
  index: number;
  row: ClosePrice;
  snapshot: AssetPriceSnapshotInsert;
};

type WritableCandidate = Candidate & {
  existing: AssetPriceSnapshotRow | null;
};

export async function applyAssetPriceSnapshotRows(options: {
  rows: ClosePrice[];
  targets: PriceLookupTarget[];
  dryRun: boolean;
  writePolicy: AssetPriceSnapshotWritePolicy;
  allowWrite: boolean;
}): Promise<AssetPriceSnapshotWriteSummary> {
  const targetByKey = new Map(
    options.targets.map((target) => [instrumentKey(target), target] as const),
  );
  const results: Array<AssetPriceSnapshotWriteResult | undefined> = Array.from({
    length: options.rows.length,
  });
  const candidateGroups = new Map<string, Candidate[]>();

  options.rows.forEach((row, index) => {
    const rowKey = writeResultKey(row);
    const target = targetByKey.get(instrumentKey(row));
    const validationError = validateClosePriceRow(
      row,
      target,
      options.writePolicy,
    );

    if (validationError) {
      results[index] = {
        ...rowKey,
        action: row.status === "error" ? "failed" : "skipped",
        reason: validationError,
      };
      return;
    }

    const candidate = {
      index,
      row,
      snapshot: toSnapshotInsert(row, target),
    };
    const key = snapshotKey(candidate.snapshot);
    const group = candidateGroups.get(key) ?? [];
    group.push(candidate);
    candidateGroups.set(key, group);
  });

  const candidates: Candidate[] = [];
  for (const group of candidateGroups.values()) {
    if (group.length === 1) {
      candidates.push(group[0]);
      continue;
    }

    const [first, ...duplicates] = group;
    const hasConflict = duplicates.some(
      (candidate) =>
        !sameIncomingSnapshot(first.snapshot, candidate.snapshot),
    );
    if (hasConflict) {
      for (const candidate of group) {
        results[candidate.index] = {
          ...writeResultKey(candidate.row),
          action: "conflict",
          reason: "duplicate_input_value_conflict",
        };
      }
      continue;
    }

    candidates.push(first);
    for (const duplicate of duplicates) {
      results[duplicate.index] = {
        ...writeResultKey(duplicate.row),
        action: options.dryRun ? "planned_skip" : "skipped",
        reason: "duplicate_input_same_value",
      };
    }
  }

  const existingByKey = await loadExistingSnapshots(
    candidates.map(({ snapshot }) => snapshot),
  );
  const writable: WritableCandidate[] = [];

  for (const candidate of candidates) {
    const existing = existingByKey.get(snapshotKey(candidate.snapshot)) ?? null;
    const protectedReason = getProtectedExistingReason(
      existing,
      candidate.snapshot,
      options.writePolicy,
    );

    if (protectedReason) {
      results[candidate.index] = {
        ...writeResultKey(candidate.row),
        action: protectedReason.startsWith("value_conflict")
          ? "conflict"
          : options.dryRun
            ? "planned_skip"
            : "skipped",
        reason: protectedReason,
        existingSource: existing?.source ?? null,
      };
      continue;
    }

    if (existing && snapshotMatches(existing, candidate.snapshot)) {
      results[candidate.index] = {
        ...writeResultKey(candidate.row),
        action: options.dryRun ? "planned_skip" : "skipped",
        reason: "unchanged",
        existingSource: existing.source,
      };
      continue;
    }

    if (options.dryRun) {
      results[candidate.index] = {
        ...writeResultKey(candidate.row),
        action: existing ? "planned_update" : "planned_insert",
        existingSource: existing?.source ?? null,
      };
      continue;
    }

    if (!options.allowWrite || options.writePolicy === "none") {
      results[candidate.index] = {
        ...writeResultKey(candidate.row),
        action: "skipped",
        reason: "write_guard_not_satisfied",
        existingSource: existing?.source ?? null,
      };
      continue;
    }

    writable.push({ ...candidate, existing });
  }

  if (writable.length > 0) {
    const returned = await db
      .insert(assetPriceSnapshots)
      .values(writable.map(({ snapshot }) => snapshot))
      .onConflictDoUpdate({
        target: [
          assetPriceSnapshots.market,
          assetPriceSnapshots.currency,
          assetPriceSnapshots.ticker,
          assetPriceSnapshots.priceDate,
        ],
        set: {
          assetId: sql`coalesce(excluded.asset_id, ${assetPriceSnapshots.assetId})`,
          closePrice: sql`excluded.close_price`,
          adjustedClosePrice: sql`coalesce(excluded.adjusted_close_price, ${assetPriceSnapshots.adjustedClosePrice})`,
          adjustedCloseBasis: sql`coalesce(excluded.adjusted_close_basis, ${assetPriceSnapshots.adjustedCloseBasis})`,
          adjustedCloseProvider: sql`coalesce(excluded.adjusted_close_provider, ${assetPriceSnapshots.adjustedCloseProvider})`,
          adjustedCloseSource: sql`coalesce(excluded.adjusted_close_source, ${assetPriceSnapshots.adjustedCloseSource})`,
          adjustedCloseFetchedAt: sql`coalesce(excluded.adjusted_close_fetched_at, ${assetPriceSnapshots.adjustedCloseFetchedAt})`,
          closePriceKrw: sql`coalesce(excluded.close_price_krw, ${assetPriceSnapshots.closePriceKrw})`,
          fxRate: sql`coalesce(excluded.fx_rate, ${assetPriceSnapshots.fxRate})`,
          source: sql`excluded.source`,
          providerSymbol: sql`excluded.provider_symbol`,
          providerExchange: sql`excluded.provider_exchange`,
          fetchedAt: sql`excluded.fetched_at`,
          isSample: sql`excluded.is_sample`,
          updatedAt: new Date(),
        },
        setWhere: getUpsertSetWhere(options.writePolicy),
      })
      .returning({
        market: assetPriceSnapshots.market,
        currency: assetPriceSnapshots.currency,
        ticker: assetPriceSnapshots.ticker,
        priceDate: assetPriceSnapshots.priceDate,
      });

    const returnedKeys = new Set(returned.map(snapshotKey));
    for (const candidate of writable) {
      const wasWritten = returnedKeys.has(snapshotKey(candidate.snapshot));
      results[candidate.index] = {
        ...writeResultKey(candidate.row),
        action: wasWritten
          ? candidate.existing
            ? "updated"
            : "inserted"
          : "skipped",
        reason: wasWritten
          ? undefined
          : "write_guard_not_satisfied_after_conflict_check",
        existingSource: candidate.existing?.source ?? null,
      };
    }
  }

  return summarizeResults(
    results.filter(
      (result): result is AssetPriceSnapshotWriteResult =>
        result !== undefined,
    ),
  );
}

export function getAssetPriceSnapshotWritePolicy(
  providerName: string,
  fixture: boolean,
): AssetPriceSnapshotWritePolicy {
  if (providerName === "kis") return "kis";
  if (fixture) return "stub_fixture";
  return "none";
}

export function emptyAssetPriceSnapshotWriteSummary(): AssetPriceSnapshotWriteSummary {
  return {
    insertedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    conflictCount: 0,
    results: [],
  };
}

async function loadExistingSnapshots(
  snapshots: AssetPriceSnapshotInsert[],
): Promise<Map<string, AssetPriceSnapshotRow>> {
  if (snapshots.length === 0) return new Map();

  const tickers = [
    ...new Set(snapshots.map(({ ticker }) => normalizeTicker(ticker) ?? "")),
  ].filter(Boolean);
  const dates = snapshots.map(({ priceDate }) => priceDate);
  const rows = await db
    .select()
    .from(assetPriceSnapshots)
    .where(
      and(
        inArray(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          tickers,
        ),
        gte(assetPriceSnapshots.priceDate, dates.toSorted()[0]),
        lte(assetPriceSnapshots.priceDate, dates.toSorted().at(-1)!),
      ),
    )
    .orderBy(
      asc(assetPriceSnapshots.priceDate),
      asc(assetPriceSnapshots.market),
      asc(assetPriceSnapshots.currency),
      asc(assetPriceSnapshots.ticker),
    );

  return new Map(rows.map((row) => [snapshotKey(row), row] as const));
}

function validateClosePriceRow(
  row: ClosePrice,
  target: PriceLookupTarget | undefined,
  writePolicy: AssetPriceSnapshotWritePolicy,
) {
  if (row.status !== "ok") return row.error ?? `provider_status_${row.status}`;
  if (!target) return "target_not_found";
  if (instrumentKey(row) !== instrumentKey(target)) {
    return "target_identity_mismatch";
  }
  if (!isDateKey(row.priceDate)) return "invalid_price_date";
  if (!isDecimalString(row.closePrice)) return "invalid_close_price";
  if (row.adjustedClosePrice === null) {
    if (
      row.adjustedCloseBasis !== null ||
      row.adjustedCloseProvider !== null ||
      row.adjustedCloseSource !== null ||
      row.adjustedCloseFetchedAt !== null
    ) {
      return "adjusted_close_metadata_without_value";
    }
  } else {
    if (!isDecimalString(row.adjustedClosePrice)) {
      return "invalid_adjusted_close_price";
    }
    if (!isAllowedAdjustedCloseBasis(row.adjustedCloseBasis, writePolicy)) {
      return "unsupported_adjusted_close_basis";
    }
    if (!normalizeText(row.adjustedCloseProvider)) {
      return "missing_adjusted_close_provider";
    }
    if (!normalizeText(row.adjustedCloseSource)) {
      return "missing_adjusted_close_source";
    }
    if (!isValidDate(row.adjustedCloseFetchedAt)) {
      return "invalid_adjusted_close_fetched_at";
    }
  }
  if (row.closePriceKrw !== null && !isDecimalString(row.closePriceKrw)) {
    return "invalid_close_price_krw";
  }
  if (row.fxRate !== null && !isDecimalString(row.fxRate)) {
    return "invalid_fx_rate";
  }
  if (!normalizeTicker(row.providerSymbol)) return "missing_provider_symbol";
  if (!normalizeText(row.providerExchange)) {
    return "missing_provider_exchange";
  }
  if (!isValidDate(row.fetchedAt)) return "invalid_fetched_at";
  if (!isAllowedClosePriceSource(row.source, writePolicy)) {
    return "unsupported_write_source";
  }
  return null;
}

function toSnapshotInsert(
  row: ClosePrice,
  target: PriceLookupTarget | undefined,
): AssetPriceSnapshotInsert {
  return {
    legacyBase44Id: null,
    priceDate: row.priceDate,
    ticker: normalizeTicker(row.ticker) ?? row.ticker,
    assetId: target?.assetIds[0] ?? null,
    market: normalizeText(row.market)?.toLowerCase() ?? row.market,
    currency: normalizeText(row.currency)?.toUpperCase() ?? row.currency,
    closePrice: row.closePrice ?? "0",
    adjustedClosePrice: row.adjustedClosePrice,
    adjustedCloseBasis: row.adjustedCloseBasis,
    adjustedCloseProvider: row.adjustedCloseProvider,
    adjustedCloseSource: row.adjustedCloseSource,
    adjustedCloseFetchedAt: row.adjustedCloseFetchedAt,
    closePriceKrw: row.closePriceKrw,
    fxRate: row.fxRate,
    source: row.source,
    providerSymbol: normalizeTicker(row.providerSymbol),
    providerExchange: row.providerExchange?.trim().toUpperCase() ?? null,
    fetchedAt: row.fetchedAt,
    isSample: row.isSample ?? true,
    base44CreatedAt: null,
    base44UpdatedAt: null,
  };
}

function getProtectedExistingReason(
  existing: AssetPriceSnapshotRow | null,
  incoming: AssetPriceSnapshotInsert,
  writePolicy: AssetPriceSnapshotWritePolicy,
) {
  if (!existing) return null;

  if (writePolicy === "stub_fixture") {
    if (incoming.source !== "stub_fixture") return "unsupported_write_source";
    return existing.source === "stub_fixture"
      ? null
      : "protected_existing_source";
  }

  if (writePolicy === "kis") {
    if (!isKisClosePriceSource(incoming.source ?? null)) {
      return "unsupported_write_source";
    }
    if (isKisClosePriceSource(existing.source)) return null;
    return getKisValueConflictReason(existing, incoming);
  }

  return "write_policy_disabled";
}

function getUpsertSetWhere(writePolicy: AssetPriceSnapshotWritePolicy) {
  if (writePolicy === "stub_fixture") {
    return sql`${assetPriceSnapshots.source} = 'stub_fixture'`;
  }
  if (writePolicy === "kis") {
    const threshold = getKisValueConflictThresholdPct() / 100;
    return sql`
      ${assetPriceSnapshots.source} like 'kis_%'
      or (
        abs(${assetPriceSnapshots.closePrice} - excluded.close_price)
        / greatest(abs(${assetPriceSnapshots.closePrice}), 1)
      ) <= ${threshold}
    `;
  }
  return sql`false`;
}

function isAllowedClosePriceSource(
  source: string | null,
  writePolicy: AssetPriceSnapshotWritePolicy,
) {
  if (writePolicy === "stub_fixture") return source === "stub_fixture";
  if (writePolicy === "kis") return isKisClosePriceSource(source);
  return false;
}

function isAllowedAdjustedCloseBasis(
  basis: ClosePrice["adjustedCloseBasis"],
  writePolicy: AssetPriceSnapshotWritePolicy,
) {
  if (writePolicy === "stub_fixture") {
    return basis === ADJUSTED_CLOSE_BASIS.syntheticFixture;
  }
  if (writePolicy === "kis") {
    return basis === ADJUSTED_CLOSE_BASIS.provider;
  }
  return false;
}

function isKisClosePriceSource(source: string | null) {
  return (
    source === "kis_domestic_itemchartprice" ||
    /^kis_overseas_dailyprice:[A-Z]+$/.test(source ?? "")
  );
}

function getKisValueConflictReason(
  existing: AssetPriceSnapshotRow,
  incoming: AssetPriceSnapshotInsert,
) {
  const existingClose = Number(existing.closePrice);
  const incomingClose = Number(incoming.closePrice);
  if (!Number.isFinite(existingClose) || !Number.isFinite(incomingClose)) {
    return "value_conflict_invalid_decimal";
  }

  const thresholdPct = getKisValueConflictThresholdPct();
  const relativeDiffPct =
    (Math.abs(existingClose - incomingClose) /
      Math.max(Math.abs(existingClose), 1)) *
    100;
  return relativeDiffPct <= thresholdPct
    ? null
    : `value_conflict:${relativeDiffPct.toFixed(4)}pct_gt_${thresholdPct}pct`;
}

function getKisValueConflictThresholdPct() {
  const configured = Number(process.env.KIS_VALUE_CONFLICT_THRESHOLD_PCT);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_KIS_VALUE_CONFLICT_THRESHOLD_PCT;
}

function snapshotMatches(
  existing: AssetPriceSnapshotRow,
  incoming: AssetPriceSnapshotInsert,
) {
  const adjustedCloseMatches =
    incoming.adjustedClosePrice === null ||
    incoming.adjustedClosePrice === undefined ||
    sameNullableDecimal(
      existing.adjustedClosePrice,
      incoming.adjustedClosePrice,
    );

  return (
    (incoming.assetId === null ||
      incoming.assetId === undefined ||
      existing.assetId === incoming.assetId) &&
    existing.market === incoming.market &&
    existing.currency === incoming.currency &&
    sameDecimal(existing.closePrice, String(incoming.closePrice)) &&
    adjustedCloseMatches &&
    preservesNullableText(
      existing.adjustedCloseBasis,
      incoming.adjustedCloseBasis,
    ) &&
    preservesNullableText(
      existing.adjustedCloseProvider,
      incoming.adjustedCloseProvider,
    ) &&
    preservesNullableText(
      existing.adjustedCloseSource,
      incoming.adjustedCloseSource,
    ) &&
    preservesNullableDate(
      existing.adjustedCloseFetchedAt,
      incoming.adjustedCloseFetchedAt,
    ) &&
    preservesNullableDecimal(existing.closePriceKrw, incoming.closePriceKrw) &&
    preservesNullableDecimal(existing.fxRate, incoming.fxRate) &&
    existing.source === incoming.source &&
    existing.providerSymbol === incoming.providerSymbol &&
    existing.providerExchange === incoming.providerExchange &&
    existing.isSample === incoming.isSample
  );
}

function sameIncomingSnapshot(
  left: AssetPriceSnapshotInsert,
  right: AssetPriceSnapshotInsert,
) {
  return (
    left.assetId === right.assetId &&
    left.market === right.market &&
    left.currency === right.currency &&
    left.ticker === right.ticker &&
    left.priceDate === right.priceDate &&
    sameDecimal(String(left.closePrice), String(right.closePrice)) &&
    sameNullableDecimalValue(
      left.adjustedClosePrice,
      right.adjustedClosePrice,
    ) &&
    left.adjustedCloseBasis === right.adjustedCloseBasis &&
    left.adjustedCloseProvider === right.adjustedCloseProvider &&
    left.adjustedCloseSource === right.adjustedCloseSource &&
    sameNullableDateValue(
      left.adjustedCloseFetchedAt,
      right.adjustedCloseFetchedAt,
    ) &&
    sameNullableDecimalValue(left.closePriceKrw, right.closePriceKrw) &&
    sameNullableDecimalValue(left.fxRate, right.fxRate) &&
    left.source === right.source &&
    left.providerSymbol === right.providerSymbol &&
    left.providerExchange === right.providerExchange &&
    left.isSample === right.isSample
  );
}

function summarizeResults(
  results: AssetPriceSnapshotWriteResult[],
): AssetPriceSnapshotWriteSummary {
  const summary: AssetPriceSnapshotWriteSummary = {
    ...emptyAssetPriceSnapshotWriteSummary(),
    results,
  };
  for (const result of results) {
    if (result.action === "inserted") summary.insertedCount += 1;
    if (result.action === "updated") summary.updatedCount += 1;
    if (result.action === "failed") summary.failedCount += 1;
    if (result.action === "conflict") {
      summary.conflictCount += 1;
      summary.skippedCount += 1;
    }
    if (result.action === "skipped" || result.action === "planned_skip") {
      summary.skippedCount += 1;
    }
  }
  return summary;
}

function writeResultKey(row: ClosePrice) {
  return {
    ticker: row.ticker,
    market: row.market,
    currency: row.currency,
    priceDate: row.priceDate,
    source: row.source,
  };
}

function snapshotKey(
  row: Pick<
    AssetPriceSnapshotInsert,
    "market" | "currency" | "ticker" | "priceDate"
  >,
) {
  return `${normalizeText(row.market)?.toLowerCase() ?? ""}|${normalizeText(row.currency)?.toUpperCase() ?? ""}|${normalizeTicker(row.ticker) ?? ""}|${row.priceDate}`;
}

function instrumentKey(
  row: Pick<PriceLookupTarget, "market" | "currency" | "ticker">,
) {
  return `${normalizeText(row.market)?.toLowerCase() ?? ""}|${normalizeText(row.currency)?.toUpperCase() ?? ""}|${normalizeTicker(row.ticker) ?? ""}`;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function isValidDate(value: Date | null | undefined) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isDecimalString(value: string | null) {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return false;
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function sameDecimal(left: string, right: string) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return left === right;
  }
  const difference = Math.abs(leftNumber - rightNumber);
  if (difference <= DECIMAL_COMPARE_ABSOLUTE_TOLERANCE) return true;
  return (
    difference <=
    Math.max(Math.abs(leftNumber), Math.abs(rightNumber), 1) *
      DECIMAL_COMPARE_RELATIVE_TOLERANCE
  );
}

function sameNullableDecimal(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return sameDecimal(left, right);
}

function sameNullableDecimalValue(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
) {
  const normalizedLeft = left === undefined ? null : left;
  const normalizedRight = right === undefined ? null : right;
  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight;
  }
  return sameDecimal(String(normalizedLeft), String(normalizedRight));
}

function preservesNullableDecimal(
  left: string | null,
  right: string | number | null | undefined,
) {
  return right === null || right === undefined
    ? true
    : sameNullableDecimal(left, String(right));
}

function preservesNullableText(
  left: string | null,
  right: string | null | undefined,
) {
  return right === null || right === undefined || left === right;
}

function preservesNullableDate(
  left: Date | null,
  right: Date | null | undefined,
) {
  return (
    right === null ||
    right === undefined ||
    (left !== null && left.getTime() === right.getTime())
  );
}

function sameNullableDateValue(
  left: Date | null | undefined,
  right: Date | null | undefined,
) {
  const normalizedLeft = left ?? null;
  const normalizedRight = right ?? null;
  return normalizedLeft === null || normalizedRight === null
    ? normalizedLeft === normalizedRight
    : normalizedLeft.getTime() === normalizedRight.getTime();
}

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeTicker(value: string | null | undefined) {
  return normalizeText(value)?.toUpperCase() ?? null;
}
