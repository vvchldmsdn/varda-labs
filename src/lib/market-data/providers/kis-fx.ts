import type {
  FxProviderParseResult,
  FxRateCandidate,
} from "../fx-refresh";

export const KIS_US_EXCHANGES = ["NAS", "NYS", "AMS"] as const;

export type KisUsExchange = (typeof KIS_US_EXCHANGES)[number];

export type KisUsdKrwQuoteTarget = Readonly<{
  ticker: string;
  exchange: KisUsExchange | null;
}>;

type KisUsdKrwTargetEvidence = Readonly<{
  ticker: string;
  market: string;
  currency: string;
}>;

type KisUsdKrwQuoteEvidence = KisUsdKrwTargetEvidence &
  Readonly<{ source: string | null }>;

export function selectKisUsdKrwQuoteTarget({
  quotes,
  targets,
}: {
  quotes: readonly KisUsdKrwQuoteEvidence[];
  targets: readonly KisUsdKrwTargetEvidence[];
}): KisUsdKrwQuoteTarget | null {
  const usdTargets = targets
    .filter(
      (target) =>
        target.market.trim().toLowerCase() === "us" &&
        target.currency.trim().toUpperCase() === "USD" &&
        target.ticker.trim() !== "",
    )
    .map((target) => target.ticker.trim().toUpperCase())
    .sort((left, right) => left.localeCompare(right));

  for (const ticker of usdTargets) {
    const quote = quotes.find(
      (candidate) =>
        candidate.ticker.trim().toUpperCase() === ticker &&
        candidate.market.trim().toLowerCase() === "us" &&
        candidate.currency.trim().toUpperCase() === "USD",
    );
    const exchange = parseKisExchangeFromSource(quote?.source ?? null);
    if (exchange) return Object.freeze({ ticker, exchange });
  }

  const ticker = usdTargets[0];
  return ticker ? Object.freeze({ ticker, exchange: null }) : null;
}

export function parseKisUsdKrwPriceDetailResponse(
  payload: unknown,
  options: {
    exchange: KisUsExchange;
    fetchedAt: Date | string;
    rateDate: string;
  },
): FxProviderParseResult {
  const record = asRecord(payload);
  if (!record) return { ok: false, error: "malformed_provider_response" };
  if (record.rt_cd !== "0") {
    return { ok: false, error: "provider_status_not_success" };
  }
  if (!isDateKey(options.rateDate)) {
    return { ok: false, error: "missing_or_invalid_rate_date" };
  }

  const output = asRecord(record.output);
  if (!output) return { ok: false, error: "missing_provider_output" };

  const currency = optionalText(output.curr)?.toUpperCase();
  if (currency && currency !== "USD") {
    return { ok: false, error: "unexpected_provider_currency" };
  }

  const usdKrw = positiveDecimalString(output.t_rate);
  if (!usdKrw) return { ok: false, error: "missing_or_invalid_usdkrw" };

  const fetchedAt = validIsoString(options.fetchedAt);
  if (!fetchedAt) return { ok: false, error: "invalid_fetch_timestamp" };

  const candidate: FxRateCandidate = {
    provider: "kis",
    pair: "USD/KRW",
    rateDate: options.rateDate,
    usdKrw,
    source: `kis_overseas_price_detail:${options.exchange}`,
    status: "ok",
    fetchedAt,
  };

  return { ok: true, candidate };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveDecimalString(value: unknown) {
  const parsed = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
}

function validIsoString(value: Date | string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseKisExchangeFromSource(source: string | null) {
  const exchange = source
    ?.trim()
    .match(/^kis_overseas_price(?:_detail)?:([A-Z]+)$/)?.[1];
  return KIS_US_EXCHANGES.find((candidate) => candidate === exchange) ?? null;
}
