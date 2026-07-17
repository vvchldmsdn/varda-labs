import { config } from "dotenv";

import {
  FSC_KRX_GOLD_SOURCE_CONTRACT,
  parseFscKrxGoldPriceResponse,
} from "../src/lib/market-data/fsc-krx-gold.ts";
import {
  buildFscKrxGoldCoverageReport,
} from "../src/lib/market-data/fsc-krx-gold-coverage.ts";
import { resolveFscKrxGoldPublicationSafeEndDate } from "../src/lib/market-data/fsc-krx-gold-publication.ts";

config({ path: ".env.local", quiet: true });

const DEFAULT_FROM_DATE = "2026-05-21";
const PAGE_SIZE = 1_000;
const MAX_PAGE_COUNT = 20;
const args = parseArgs(process.argv.slice(2));
const fromDate = args.from ?? DEFAULT_FROM_DATE;
const toDate = args.to ?? resolveFscKrxGoldPublicationSafeEndDate(new Date());
assertDateRange(fromDate, toDate);

const rawServiceKey = process.env[FSC_KRX_GOLD_SOURCE_CONTRACT.serviceKeyEnv];
if (!rawServiceKey?.trim()) {
  throw new Error(
    `${FSC_KRX_GOLD_SOURCE_CONTRACT.serviceKeyEnv} is not set; obtain the decoding key from data.go.kr and keep it server-only`,
  );
}

const serviceKey = normalizeServiceKey(rawServiceKey);
const fetchedAt = new Date();
const rows = [];
let rejectedRowCount = 0;
let fetchedProviderRowCount = 0;
let providerTotalCount = null;
let providerRequestCount = 0;
let pageNo = 1;

while (pageNo <= MAX_PAGE_COUNT) {
  const payload = await fetchProviderPage({
    serviceKey,
    pageNo,
    fromDate,
    toDate,
  });
  providerRequestCount += 1;

  const parsed = parseFscKrxGoldPriceResponse(payload, { fetchedAt });
  if (!parsed.ok) {
    throw new Error(
      `FSC public data response blocked: ${parsed.error}${parsed.providerResultCode ? ` (${parsed.providerResultCode})` : ""}`,
    );
  }

  rows.push(...parsed.rows);
  rejectedRowCount += parsed.rejectedRows.length;
  fetchedProviderRowCount += parsed.rawItemCount;
  providerTotalCount ??= parsed.totalCount;

  if (providerTotalCount === null || fetchedProviderRowCount >= providerTotalCount) {
    break;
  }
  pageNo += 1;
}

const report = buildFscKrxGoldCoverageReport({
  rows,
  rejectedRowCount,
  fromDate,
  toDate,
  providerTotalCount,
  fetchedProviderRowCount,
});
const target = FSC_KRX_GOLD_SOURCE_CONTRACT.target;
const targetRows = rows
  .filter(
    (row) =>
      row.shortCode === target.shortCode &&
      row.isin === target.isin &&
      row.itemName === target.itemName &&
      row.priceDate >= fromDate &&
      row.priceDate <= toDate,
  )
  .sort((left, right) =>
    left.priceDate < right.priceDate
      ? -1
      : left.priceDate > right.priceDate
        ? 1
        : 0,
  );

console.log(
  JSON.stringify(
    {
      audit: FSC_KRX_GOLD_SOURCE_CONTRACT.version,
      dryRun: true,
      boundary: {
        providerRequests: providerRequestCount,
        databaseReads: 0,
        databaseWrites: 0,
        schemaChanges: 0,
        rawPayloadLogged: false,
        serviceKeyLogged: false,
      },
      range: { fromDate, toDate },
      source: FSC_KRX_GOLD_SOURCE_CONTRACT.source,
      provider: FSC_KRX_GOLD_SOURCE_CONTRACT.provider,
      datasetId: FSC_KRX_GOLD_SOURCE_CONTRACT.datasetId,
      target,
      coverage: report,
      sampleCloseRows: sampleEdges(targetRows, 3).map((row) => ({
        priceDate: row.priceDate,
        closeKrwPerG: row.closeKrwPerG,
      })),
      nextBoundary:
        report.status === "ready_for_schema_review"
          ? "review additive instrument-keyed close schema; no write is authorized"
          : "resolve reported source or coverage blockers before schema review",
    },
    null,
    2,
  ),
);

async function fetchProviderPage({
  serviceKey,
  pageNo,
  fromDate,
  toDate,
}) {
  const url = new URL(FSC_KRX_GOLD_SOURCE_CONTRACT.endpoint);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("resultType", "json");
  url.searchParams.set("beginBasDt", compactDate(fromDate));
  url.searchParams.set("endBasDt", compactDate(shiftIsoDate(toDate, 1)));

  let response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("FSC public data request failed");
  }

  if (!response.ok) {
    throw new Error(`FSC public data HTTP error (${response.status})`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("FSC public data returned invalid JSON");
  }
}

function parseArgs(values) {
  const parsed = { from: null, to: null };
  for (const value of values) {
    if (value.startsWith("--from=")) parsed.from = value.slice("--from=".length);
    else if (value.startsWith("--to=")) parsed.to = value.slice("--to=".length);
    else throw new Error(`unsupported argument: ${value}`);
  }
  return parsed;
}

function assertDateRange(fromDate, toDate) {
  if (!isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    throw new Error("use a valid inclusive range: --from=YYYY-MM-DD --to=YYYY-MM-DD");
  }
}

function normalizeServiceKey(value) {
  const trimmed = value.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function compactDate(value) {
  return value.replaceAll("-", "");
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function shiftIsoDate(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sampleEdges(values, count) {
  if (values.length <= count * 2) return values;
  return [...values.slice(0, count), ...values.slice(-count)];
}
