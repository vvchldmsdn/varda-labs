export const FSC_KRX_GOLD_SOURCE_CONTRACT = Object.freeze({
  version: "fsc_public_data_krx_gold_close_v1",
  datasetId: "15094805",
  provider: "financial_services_commission_public_data",
  operation: "getGoldPriceInfo",
  endpoint:
    "https://apis.data.go.kr/1160100/service/GetGeneralProductInfoService/getGoldPriceInfo",
  source: "fsc_public_data_gold_daily",
  serviceKeyEnv: "FSC_PUBLIC_DATA_SERVICE_KEY",
  serviceKeyForm: "decoding_key",
  access: "free_auto_approval",
  license: "unrestricted",
  publication: "business_day_plus_one_after_13_00_kst",
  readOnlyDryRunWrites: Object.freeze([]),
  target: Object.freeze({
    productKey: "gold_9999_1kg",
    shortCode: "04020000",
    isin: "KRD040200002",
    itemName: "금 99.99_1Kg",
    quoteKind: "official_close",
    closeField: "clpr",
    priceDateField: "basDt",
    quoteCurrency: "KRW",
    quoteUnit: "KRW_PER_G",
  }),
} as const);

export type FscKrxGoldSourceRow = Readonly<{
  priceDate: string;
  shortCode: string;
  isin: string;
  itemName: string;
  closeKrwPerG: string;
  fetchedAt: string;
  source: typeof FSC_KRX_GOLD_SOURCE_CONTRACT.source;
  quoteKind: typeof FSC_KRX_GOLD_SOURCE_CONTRACT.target.quoteKind;
}>;

export type FscKrxGoldRejectedRow = Readonly<{
  index: number;
  reason:
    | "malformed_row"
    | "invalid_price_date"
    | "missing_identity"
    | "invalid_close";
}>;

export type FscKrxGoldParseResult =
  | Readonly<{
      ok: true;
      pageNo: number | null;
      numOfRows: number | null;
      totalCount: number | null;
      rawItemCount: number;
      rows: readonly FscKrxGoldSourceRow[];
      rejectedRows: readonly FscKrxGoldRejectedRow[];
    }>
  | Readonly<{
      ok: false;
      error:
        | "malformed_provider_response"
        | "provider_status_not_success"
        | "malformed_provider_body"
        | "malformed_provider_items";
      providerResultCode: string | null;
    }>;

type UnknownRecord = Record<string, unknown>;

const COMPACT_DATE_PATTERN = /^\d{8}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseFscKrxGoldPriceResponse(
  payload: unknown,
  options: Readonly<{ fetchedAt?: Date | string }> = {},
): FscKrxGoldParseResult {
  const root = asRecord(payload);
  if (!root) return parseFailure("malformed_provider_response");

  const response = asRecord(root.response) ?? root;
  const header = asRecord(response.header);
  const resultCode = stableText(header?.resultCode);
  if (resultCode !== "00") {
    return parseFailure("provider_status_not_success", resultCode);
  }

  const body = asRecord(response.body);
  if (!body) return parseFailure("malformed_provider_body", resultCode);

  const rawItems = extractRawItems(body.items);
  if (!rawItems) {
    return parseFailure("malformed_provider_items", resultCode);
  }

  const fetchedAt = toIsoString(options.fetchedAt);
  const rows: FscKrxGoldSourceRow[] = [];
  const rejectedRows: FscKrxGoldRejectedRow[] = [];

  rawItems.forEach((rawItem, index) => {
    const parsed = parseSourceRow(rawItem, fetchedAt);
    if (parsed.ok) rows.push(parsed.row);
    else rejectedRows.push(Object.freeze({ index, reason: parsed.reason }));
  });

  return Object.freeze({
    ok: true,
    pageNo: toNonNegativeInteger(body.pageNo),
    numOfRows: toNonNegativeInteger(body.numOfRows),
    totalCount: toNonNegativeInteger(body.totalCount),
    rawItemCount: rawItems.length,
    rows: Object.freeze(rows),
    rejectedRows: Object.freeze(rejectedRows),
  });
}

function parseSourceRow(
  rawItem: unknown,
  fetchedAt: string,
):
  | Readonly<{ ok: true; row: FscKrxGoldSourceRow }>
  | Readonly<{ ok: false; reason: FscKrxGoldRejectedRow["reason"] }> {
  const row = asRecord(rawItem);
  if (!row) return Object.freeze({ ok: false, reason: "malformed_row" });

  const priceDate = compactDateToIso(row.basDt);
  if (!priceDate) {
    return Object.freeze({ ok: false, reason: "invalid_price_date" });
  }

  const shortCode = stableText(row.srtnCd);
  const isin = stableText(row.isinCd);
  const itemName = stableText(row.itmsNm);
  if (!shortCode || !isin || !itemName) {
    return Object.freeze({ ok: false, reason: "missing_identity" });
  }

  const closeKrwPerG = toPositiveDecimalString(row.clpr);
  if (!closeKrwPerG) {
    return Object.freeze({ ok: false, reason: "invalid_close" });
  }

  return Object.freeze({
    ok: true,
    row: Object.freeze({
      priceDate,
      shortCode,
      isin,
      itemName,
      closeKrwPerG,
      fetchedAt,
      source: FSC_KRX_GOLD_SOURCE_CONTRACT.source,
      quoteKind: FSC_KRX_GOLD_SOURCE_CONTRACT.target.quoteKind,
    }),
  });
}

function extractRawItems(itemsValue: unknown): unknown[] | null {
  if (itemsValue === null || itemsValue === undefined) return [];
  if (Array.isArray(itemsValue)) return itemsValue;

  const items = asRecord(itemsValue);
  if (!items) return null;
  if (items.item === null || items.item === undefined) return [];
  return Array.isArray(items.item) ? items.item : [items.item];
}

function compactDateToIso(value: unknown) {
  const compact = stableText(value);
  if (!compact || !COMPACT_DATE_PATTERN.test(compact)) return null;
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  return isIsoDate(iso) ? iso : null;
}

function isIsoDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function toPositiveDecimalString(value: unknown) {
  const text =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : stableText(value);
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return null;

  const [rawWhole, rawFraction = ""] = text.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return Number(normalized) > 0 ? normalized : null;
}

function toNonNegativeInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(stableText(value));
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function toIsoString(value: Date | string | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_fetched_at");
  return date.toISOString();
}

function stableText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text || null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function parseFailure(
  error: Extract<FscKrxGoldParseResult, { ok: false }>["error"],
  providerResultCode: string | null = null,
): Extract<FscKrxGoldParseResult, { ok: false }> {
  return Object.freeze({ ok: false, error, providerResultCode });
}
