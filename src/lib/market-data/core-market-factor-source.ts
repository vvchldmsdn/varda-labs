import {
  CORE_MARKET_FACTOR_DEFINITIONS,
  type CoreMarketFactorObservation,
} from "./core-market-factor-policy.ts";
import {
  buildFrankfurterHistoryUrl,
  parseFrankfurterV2UsdKrwHistory,
} from "./frankfurter-history.ts";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FRED_GRAPH_CSV_ENDPOINT =
  "https://fred.stlouisfed.org/graph/fredgraph.csv";

export type CoreMarketFactorSourceResult = Readonly<{
  providerCallCount: 3;
  series: ReadonlyMap<string, readonly CoreMarketFactorObservation[]>;
}>;

export function buildFredSeriesCsvUrl(
  seriesId: "DGS10" | "T10Y2Y",
  fromDate: string,
  toDate: string,
) {
  assertDateRange(fromDate, toDate);
  const url = new URL(FRED_GRAPH_CSV_ENDPOINT);
  url.searchParams.set("id", seriesId);
  url.searchParams.set("cosd", fromDate);
  url.searchParams.set("coed", toDate);
  return url.toString();
}

export function parseFredSeriesCsv(
  csv: string,
  seriesId: "DGS10" | "T10Y2Y",
) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines[0]?.trim() !== `observation_date,${seriesId}`) {
    throw new Error(`Unexpected FRED ${seriesId} CSV header`);
  }

  const rows: CoreMarketFactorObservation[] = [];
  const seen = new Set<string>();
  for (const [offset, line] of lines.slice(1).entries()) {
    if (!line.trim()) continue;
    const [date, rawValue, ...extra] = line.split(",");
    if (extra.length > 0 || !isDateKey(date)) {
      throw new Error(`Invalid FRED ${seriesId} row ${offset + 2}`);
    }
    if (rawValue === "." || rawValue === "") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || seen.has(date)) {
      throw new Error(`Invalid FRED ${seriesId} value ${offset + 2}`);
    }
    seen.add(date);
    rows.push(Object.freeze({ date, value }));
  }
  return Object.freeze(
    rows.sort((left, right) => left.date.localeCompare(right.date)),
  );
}

export async function fetchCoreMarketFactorSources({
  fetchImpl = fetch,
  fromDate,
  toDate,
}: {
  fetchImpl?: typeof fetch;
  fromDate: string;
  toDate: string;
}): Promise<CoreMarketFactorSourceResult> {
  assertDateRange(fromDate, toDate);
  const dgs10 = CORE_MARKET_FACTOR_DEFINITIONS[1].sourceSeriesId;
  const curve = CORE_MARKET_FACTOR_DEFINITIONS[2].sourceSeriesId;
  const [fxResponse, dgs10Response, curveResponse] = await Promise.all([
    fetchImpl(buildFrankfurterHistoryUrl(fromDate, toDate), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    }),
    fetchImpl(buildFredSeriesCsvUrl(dgs10, fromDate, toDate), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    }),
    fetchImpl(buildFredSeriesCsvUrl(curve, fromDate, toDate), {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    }),
  ]);
  for (const response of [fxResponse, dgs10Response, curveResponse]) {
    if (!response.ok) {
      throw new Error(`Core factor provider returned HTTP ${response.status}`);
    }
  }

  const [fxPayload, dgs10Csv, curveCsv] = await Promise.all([
    fxResponse.json(),
    dgs10Response.text(),
    curveResponse.text(),
  ]);
  const fxRows = parseFrankfurterV2UsdKrwHistory(fxPayload).map((row) =>
    Object.freeze({ date: row.rateDate, value: Number(row.usdKrw) }),
  );
  return Object.freeze({
    providerCallCount: 3 as const,
    series: new Map([
      [CORE_MARKET_FACTOR_DEFINITIONS[0].factorKey, Object.freeze(fxRows)],
      [
        CORE_MARKET_FACTOR_DEFINITIONS[1].factorKey,
        parseFredSeriesCsv(dgs10Csv, dgs10),
      ],
      [
        CORE_MARKET_FACTOR_DEFINITIONS[2].factorKey,
        parseFredSeriesCsv(curveCsv, curve),
      ],
    ]),
  });
}

function assertDateRange(fromDate: string, toDate: string) {
  if (!isDateKey(fromDate) || !isDateKey(toDate) || fromDate > toDate) {
    throw new Error("Core factor dates must be an ordered YYYY-MM-DD range");
  }
}

function isDateKey(value: string) {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
