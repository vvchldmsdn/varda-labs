import type {
  ClosePrice,
  HistoricalPriceResult,
  PriceLookupTarget,
} from "./providers/types";

export const KIS_HISTORY_PREVIEW_POLICY = Object.freeze({
  version: "kis_history_preview_v1",
  databaseReads: "none",
  databaseWrites: "none",
  maximumInstrumentCount: 2,
  maximumRangeCalendarDays: 180,
  responseShape: "coverage_summary_without_full_series",
  defaultMode: "dry_run",
  actualWriteGuard: "dryRun=false_write=true_confirmWrite=true",
} as const);

export type KisHistoryPreviewRequest = Readonly<{
  startDate: string;
  endDate: string;
  targets: readonly PriceLookupTarget[];
  dryRun: boolean;
  write: boolean;
  confirmWrite: boolean;
}>;

export class KisHistoryPreviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KisHistoryPreviewInputError";
  }
}

export function parseKisHistoryPreviewRequest(
  value: unknown,
): KisHistoryPreviewRequest {
  const record = objectRecord(value);
  const startDate = parseDateKey(record?.startDate);
  const endDate = parseDateKey(record?.endDate);
  const rawTargets = record?.targets;
  const dryRun = parseOptionalBoolean(record?.dryRun, true, "dryRun");
  const write = parseOptionalBoolean(record?.write, false, "write");
  const confirmWrite = parseOptionalBoolean(
    record?.confirmWrite,
    false,
    "confirmWrite",
  );

  if (dryRun && write) {
    throw new KisHistoryPreviewInputError(
      "KIS history dry-run does not accept write=true",
    );
  }
  if (dryRun && confirmWrite) {
    throw new KisHistoryPreviewInputError(
      "KIS history dry-run does not accept confirmWrite=true",
    );
  }
  if (!dryRun && (!write || !confirmWrite)) {
    throw new KisHistoryPreviewInputError(
      "KIS history writes require dryRun=false, write=true, and confirmWrite=true",
    );
  }
  if (!startDate || !endDate || startDate > endDate) {
    throw new KisHistoryPreviewInputError(
      "startDate and endDate must be valid YYYY-MM-DD values with startDate <= endDate",
    );
  }

  const rangeCalendarDays = differenceInCalendarDays(startDate, endDate) + 1;
  if (
    rangeCalendarDays >
    KIS_HISTORY_PREVIEW_POLICY.maximumRangeCalendarDays
  ) {
    throw new KisHistoryPreviewInputError(
      `KIS history preview is limited to ${KIS_HISTORY_PREVIEW_POLICY.maximumRangeCalendarDays} calendar days`,
    );
  }
  if (
    !Array.isArray(rawTargets) ||
    rawTargets.length === 0 ||
    rawTargets.length > KIS_HISTORY_PREVIEW_POLICY.maximumInstrumentCount
  ) {
    throw new KisHistoryPreviewInputError(
      `targets must contain between 1 and ${KIS_HISTORY_PREVIEW_POLICY.maximumInstrumentCount} instruments`,
    );
  }

  const targets = rawTargets.map((target, index) =>
    parseTarget(target, index),
  );

  return Object.freeze({
    startDate,
    endDate,
    targets: Object.freeze(targets),
    dryRun,
    write,
    confirmWrite,
  });
}

export function summarizeKisHistoryPreview(result: HistoricalPriceResult) {
  const failuresByInstrument = new Map<string, number>();
  for (const failure of result.failures) {
    failuresByInstrument.set(
      failure.instrumentKey,
      (failuresByInstrument.get(failure.instrumentKey) ?? 0) + 1,
    );
  }

  const rowsByInstrument = new Map<string, ClosePrice[]>();
  for (const row of result.rows) {
    const key = instrumentKey(row);
    const rows = rowsByInstrument.get(key) ?? [];
    rows.push(row);
    rowsByInstrument.set(key, rows);
  }

  const instrumentKeys = new Set([
    ...rowsByInstrument.keys(),
    ...failuresByInstrument.keys(),
  ]);
  const instruments = Array.from(instrumentKeys)
    .sort()
    .map((key) => {
      const rows = (rowsByInstrument.get(key) ?? []).sort((left, right) =>
        left.priceDate.localeCompare(right.priceDate),
      );
      const first = rows[0] ?? null;
      const last = rows.at(-1) ?? null;

      return Object.freeze({
        instrumentKey: key,
        rowCount: rows.length,
        firstDate: first?.priceDate ?? null,
        lastDate: last?.priceDate ?? null,
        firstClose: first?.closePrice ?? null,
        lastClose: last?.closePrice ?? null,
        sources: Object.freeze(
          [...new Set(rows.map((row) => row.source))].sort(),
        ),
        adjustedCloseRowCount: rows.filter(
          (row) => row.adjustedClosePrice !== null,
        ).length,
        failureCount: failuresByInstrument.get(key) ?? 0,
      });
    });

  return Object.freeze({
    policy: KIS_HISTORY_PREVIEW_POLICY,
    provider: result.provider,
    priceBasis: result.priceBasis,
    dryRun: true,
    databaseWrites: 0,
    fetchedAt: result.fetchedAt.toISOString(),
    requestCount: result.requestCount,
    rowCount: result.rows.length,
    failureCount: result.failures.length,
    instruments: Object.freeze(instruments),
    failures: Object.freeze(result.failures.map((failure) => ({ ...failure }))),
    warnings: Object.freeze([...result.warnings]),
  });
}

function parseTarget(value: unknown, index: number): PriceLookupTarget {
  const record = objectRecord(value);
  const ticker = normalizeText(record?.ticker)?.toUpperCase() ?? null;
  const market = normalizeText(record?.market)?.toLowerCase() ?? null;
  const currency = normalizeText(record?.currency)?.toUpperCase() ?? null;

  if (
    !ticker ||
    !/^[A-Z0-9._-]{1,50}$/.test(ticker) ||
    !(
      (market === "korea" && currency === "KRW") ||
      (market === "us" && currency === "USD")
    )
  ) {
    throw new KisHistoryPreviewInputError(
      `targets[${index}] must specify a valid ticker and korea/KRW or us/USD`,
    );
  }

  return {
    key: `${market}|${currency}|${ticker}`,
    ticker,
    market,
    currency,
    accounts: [],
    assetIds: [],
    assetNames: [],
  };
}

function instrumentKey(
  row: Pick<ClosePrice, "market" | "currency" | "ticker">,
) {
  return [
    row.market.trim().toLowerCase(),
    row.currency.trim().toUpperCase(),
    row.ticker.trim().toUpperCase(),
  ].join("|");
}

function parseDateKey(value: unknown) {
  const normalized = normalizeText(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function differenceInCalendarDays(startDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseOptionalBoolean(
  value: unknown,
  fallback: boolean,
  label: string,
) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  throw new KisHistoryPreviewInputError(`${label} must be a boolean`);
}
